#!/usr/bin/env node
// Measures how the toolkit's runtime plugins (runtime/RWK_*.js) change a real
// game's speed. Loads the game in Chrome once per variant (no toolkit plugin,
// all of them, RWK_Core + one plugin...) and compares the runs:
//   update    game logic per frame while walking and while reading messages
//             (the game loop stopped, no drawing: the most precise number)
//   realtime  frame CPU and frame times while the game runs and draws, and
//             the browser's style / layout work (the touch controls are on)
//   save      a save on the map, as an autosave does it, then cloud upload
//   audio     decoded audio still in memory after playing and stopping sounds
//   resize    4 phone rotations
// Boot time and the JS heap are measured in every run.
//
//   node tools/perf/bench.js "D:\Games\My Game" [options]   (npm run perf -- ...)
//
// Never writes into the game folder. Needs Chrome (or Edge / Chromium).

import fs from "node:fs";
import path from "node:path";
import { parseArgs } from "node:util";
import { analyzeGame } from "../../cli/lib/game.js";
import { RUNTIME_PLUGINS, pluginsJsWith, runtimeConfigOf } from "../../cli/lib/stage.js";
import { TOOLKIT_ROOT } from "../../cli/lib/config.js";
import { MemoryBucket } from "../../test/helpers.js";
import { findChrome, launchChrome, openPage } from "./chrome.js";
import { startServer } from "./server.js";
import { combine, formatReport, median, metricsOf, parseVariants, short } from "./stats.js";

const HELP = `Usage: node tools/perf/bench.js <game folder> [options]

  --variants <list>   none, all, core, each (RWK_Core + one plugin, for every
                      plugin), +Name, -Name (all but Name)   [none,all,each]
  --rounds <n>        runs of each variant, interleaved       [2]
  --scenarios <list>  update, realtime, save, audio, resize   [all]
  --steps <n>         logic frames per update scenario        [1500]
  --seconds <n>       length of the realtime scenario         [4]
  --audio <n>         BGM files and SE files to play          [6]
  --cpu <n>           CPU slowdown, e.g. 4 for a mid phone    [1]
  --chrome <path>     browser to use (or CHROME_PATH)
  --headed            show the browser window
  --json <file>       also write every number to a JSON file
`;

const SCENARIOS = ["update", "realtime", "save", "audio", "resize"];

// As a first deploy with cloud saves on would set it up; the touch controls
// show on a desktop too, so their cost is measured.
const GAME_CONFIG = {
  slug: "perf",
  sync: { enabled: true },
  controls: { enabled: true, showOn: "always", gamepad: true, dpad: true, extras: ["fullscreen", "editLayout"] },
  saveHistory: true,
};

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

function audioNames(root, folder) {
  const dir = path.join(root, "audio", folder);
  if (!fs.existsSync(dir)) return [];
  const names = fs
    .readdirSync(dir)
    .filter((f) => /\.(ogg|m4a|rpgmvo|ogg_|m4a_)$/i.test(f))
    .map((f) => f.replace(/\.[^.]+$/, ""))
    .filter(Boolean);
  return [...new Set(names)].sort();
}

async function runVariant(page, server, variant, ctx) {
  const { opts, pluginsJsFor, saveHistory } = ctx;
  server.use({
    pluginsJs: pluginsJsFor(variant.plugins),
    env: {
      GAME_ID: "perf",
      AUTH_MODE: "none",
      RWK_LOCKED: "0",
      RWK_SAVE_HISTORY: JSON.stringify(saveHistory),
      BUCKET: new MemoryBucket(),
    },
  });
  page.errors.length = 0;
  await page.send("Storage.clearDataForOrigin", { origin: server.origin, storageTypes: "all" });
  await page.viewport(1280, 720);
  await page.send("Page.navigate", { url: server.origin + "/index.html" });
  await page.waitFor("window.RWK_PERF");

  const raw = { errors: [] };
  try {
    await scenarios(page, raw, opts);
  } finally {
    raw.errors.push(...page.errors.map((e) => "page: " + e.split("\n")[0]));
  }
  return raw;
}

async function scenarios(page, raw, opts) {
  const has = (s) => opts.scenarios.includes(s);
  const step = async (name, fn) => {
    try {
      await fn();
    } catch (e) {
      raw.errors.push(`${name}: ${e.message.split("\n")[0]}`);
    }
  };
  await step("boot", async () => (raw.boot = await page.evaluate("RWK_PERF.boot()")));
  if (!raw.boot) return;
  raw.hooks = await page.evaluate("RWK_PERF.hooks()");
  await step("new game", async () => (raw.start = await page.evaluate("RWK_PERF.startGame()")));
  if (!raw.start) return;

  if (has("update")) {
    await step("update", async () => {
      raw.walk = await page.evaluate(`RWK_PERF.tight("walk", ${opts.steps})`);
      raw.message = await page.evaluate(`RWK_PERF.tight("message", ${opts.steps})`);
      raw.hot = await page.evaluate(`RWK_PERF.counts(${JSON.stringify(raw.hooks.all)})`);
      raw.overhead = await page.evaluate(`RWK_PERF.overhead(${JSON.stringify(Object.keys(raw.hot))})`);
    });
  }
  if (has("realtime")) {
    await step("realtime", async () => {
      const m0 = await page.metrics();
      raw.realtime = await page.evaluate(`RWK_PERF.realtime(${opts.seconds})`);
      const m1 = await page.metrics();
      const secs = m1.Timestamp - m0.Timestamp;
      raw.realtime.styleLayoutMsPerS = ((m1.LayoutDuration - m0.LayoutDuration + m1.RecalcStyleDuration - m0.RecalcStyleDuration) * 1000) / secs;
      raw.realtime.scriptMsPerS = ((m1.ScriptDuration - m0.ScriptDuration) * 1000) / secs;
    });
  }
  if (has("save")) {
    await step("save", async () => {
      // The game loop is stopped so the CPU time is the save's (and upload's) alone.
      await page.evaluate("RWK_PERF.stop()");
      const m0 = await page.metrics();
      raw.save = await page.evaluate("RWK_PERF.save()");
      const m1 = await page.metrics();
      await page.evaluate("RWK_PERF.resume()");
      raw.save.busyMs = (m1.TaskDuration - m0.TaskDuration) * 1000;
    });
  }
  if (has("audio")) {
    await step("audio", async () => {
      raw.audio = await page.evaluate(`RWK_PERF.audio(${opts.audio})`, 300000);
      await page.gc();
      const live = await page.evaluate("RWK_PERF.audioLive()");
      raw.audio.kept = live.count;
      raw.audio.bytes = live.bytes;
    });
  }
  if (has("resize")) {
    await step("resize", async () => {
      await page.evaluate("RWK_PERF.stop()");
      const m0 = await page.metrics();
      for (const [w, h] of [[390, 844], [844, 390], [390, 844], [1280, 720]]) {
        await page.viewport(w, h, w < 1000);
        await sleep(800); // the controls lay out again 150 and 500 ms after a rotation
      }
      const m1 = await page.metrics();
      await page.evaluate("RWK_PERF.resume()");
      const d = (k) => m1[k] - m0[k];
      raw.resize = { cpuMs: (d("ScriptDuration") + d("LayoutDuration") + d("RecalcStyleDuration")) * 1000 };
    });
  }
  await page.gc();
  raw.heapBytes = (await page.send("Runtime.getHeapUsage")).usedSize;
}

async function main() {
  const { values: o, positionals } = parseArgs({
    allowPositionals: true,
    options: {
      variants: { type: "string", default: "none,all,each" },
      rounds: { type: "string", default: "2" },
      scenarios: { type: "string", default: SCENARIOS.join(",") },
      steps: { type: "string", default: "1500" },
      seconds: { type: "string", default: "4" },
      audio: { type: "string", default: "6" },
      cpu: { type: "string", default: "1" },
      chrome: { type: "string" },
      headed: { type: "boolean", default: false },
      json: { type: "string" },
      help: { type: "boolean", short: "h", default: false },
    },
  });
  if (o.help || !positionals.length) {
    process.stdout.write(HELP);
    process.exitCode = o.help ? 0 : 1;
    return;
  }
  const opts = {
    rounds: Math.max(1, Number(o.rounds) || 1),
    scenarios: o.scenarios.split(",").map((s) => s.trim()),
    steps: Math.max(100, Number(o.steps) || 1500),
    seconds: Math.max(1, Number(o.seconds) || 4),
    audio: Math.max(0, Number(o.audio) || 0),
    cpu: Math.max(1, Number(o.cpu) || 1),
  };
  const unknown = opts.scenarios.filter((s) => !SCENARIOS.includes(s));
  if (unknown.length) throw new Error(`Unknown scenario: ${unknown.join(", ")} (${SCENARIOS.join(", ")})`);

  const game = analyzeGame(positionals[0]);
  const variants = parseVariants(o.variants, RUNTIME_PLUGINS);
  const runtimeConfig = runtimeConfigOf(game, GAME_CONFIG);
  const perfConfig = { audio: { bgm: audioNames(game.root, "bgm"), se: audioNames(game.root, "se") } };
  const gamePluginsJs = fs.readFileSync(path.join(game.root, "js", "plugins.js"), "utf8");
  const perfEntry = { name: "RWK_Perf", status: true, description: "", parameters: { config: JSON.stringify(perfConfig) } };
  // RWK_Perf right after the game's plugins, before the toolkit's.
  const pluginsJsFor = (names) =>
    pluginsJsWith(`${gamePluginsJs.replace(/\s*$/, "")}\n$plugins.push(${JSON.stringify(perfEntry)});\n`, names, runtimeConfig);

  const executable = findChrome(o.chrome);
  console.log(`${game.title} (${game.engine}) · ${variants.length} variants × ${opts.rounds} rounds · CPU ×${opts.cpu}`);
  console.log(`Browser: ${executable}`);

  const server = await startServer({
    root: game.root,
    runtimeDir: path.join(TOOLKIT_ROOT, "runtime"),
    files: { "js/plugins/RWK_Perf.js": path.join(TOOLKIT_ROOT, "tools", "perf", "profiler.js") },
  });
  const chrome = await launchChrome({ executable, headed: o.headed });
  const runs = Object.fromEntries(variants.map((v) => [v.id, []]));
  let browserVersion = "";
  try {
    browserVersion = (await chrome.cdp.send("Browser.getVersion")).product;
    const page = await openPage(chrome.cdp);
    if (opts.cpu > 1) await page.send("Emulation.setCPUThrottlingRate", { rate: opts.cpu });
    const ctx = { opts, pluginsJsFor, saveHistory: runtimeConfig.saveHistory };

    // Fills Chrome's cache so the first variant does not load the game cold.
    process.stdout.write("Warming up… ");
    await runVariant(page, server, variants[0], { ...ctx, opts: { ...opts, scenarios: [] } });
    console.log("done");

    const total = variants.length * opts.rounds;
    let n = 0;
    for (let round = 1; round <= opts.rounds; round++) {
      for (const variant of variants) {
        n++;
        const started = Date.now();
        process.stdout.write(`[${n}/${total}] ${variant.id.padEnd(16)} `);
        const raw = await runVariant(page, server, variant, ctx);
        const metrics = metricsOf(raw);
        runs[variant.id].push({ round, raw, metrics });
        const note = raw.errors.length ? `  ⚠ ${raw.errors.length} error(s): ${raw.errors[0]}` : "";
        console.log(
          `hooks ${fmtN(metrics.hookUs)} µs · walk ${fmtN(metrics.walkUs)} µs · frame ${fmtN(metrics.frameCpuP50)} ms · save ${fmtN(metrics.saveBlockMs)} ms · ` +
            `audio ${fmtN(metrics.audioMB)} MB · ${((Date.now() - started) / 1000).toFixed(0)} s${note}`
        );
      }
    }
  } finally {
    await chrome.close();
    await server.close();
  }

  const combined = Object.fromEntries(variants.map((v) => [v.id, combine(runs[v.id].map((r) => r.metrics))]));
  const allRun = (runs.all || runs[variants[variants.length - 1].id] || [])[0];
  const report = formatReport({
    combined,
    hooks: allRun && allRun.raw.hooks ? allRun.raw.hooks.byPlugin : {},
    hot: allRun && allRun.raw.hot ? allRun.raw.hot : {},
    overhead: medianOverhead(runs.all || []),
    info: [
      "",
      `${game.title} (${game.engine}) · ${browserVersion} · CPU ×${opts.cpu} · ${opts.rounds} round(s)`,
      `Variants: ${variants.map((v) => `${v.id} = ${v.plugins.map(short).join("+") || "no toolkit plugin"}`).join("; ")}`,
    ],
  });
  console.log(report);

  const errors = Object.entries(runs).flatMap(([id, list]) => list.flatMap((r) => r.raw.errors.map((e) => `${id} #${r.round}: ${e}`)));
  if (errors.length) console.log("\nErrors:\n  " + [...new Set(errors)].slice(0, 20).join("\n  "));

  if (o.json) {
    const out = { game: { title: game.title, engine: game.engine }, browser: browserVersion, opts, variants, combined, runs };
    fs.writeFileSync(o.json, JSON.stringify(out, null, 2));
    console.log(`\nAll numbers: ${path.resolve(o.json)}`);
  }
}

// { label: median ns per call } over the runs of a variant.
function medianOverhead(list) {
  const values = {};
  for (const { raw } of list) for (const [label, ns] of Object.entries(raw.overhead || {})) (values[label] ||= []).push(ns);
  return Object.fromEntries(Object.entries(values).map(([label, v]) => [label, median(v)]));
}

const fmtN =(v) => (typeof v === "number" && Number.isFinite(v) ? (Math.abs(v) >= 100 ? v.toFixed(0) : v.toFixed(1)) : "–");

main().catch((e) => {
  console.error(e.stack || e.message);
  process.exitCode = 1;
});
