// rwk test: plays the first minutes of a game in a headless Chrome and reports
// what broke: the game does not start, a script error, the engine's error
// screen, a file that does not load (404, letter case), the save that does not
// reach the cloud, the touch controls that do not show on a phone.
//
// The game, in any of the three forms:
//   folder  its web build, made as a deploy makes it (first-deploy defaults +
//           rwk.json, touch controls on), served on this PC by the real Worker:
//           nothing is published and no login is needed
//   link    the deployed site, as a player opens it; no login
//   name    the deployed site, its link read from the account (needs the login)
// On a deployed site the save API is answered on this PC (cli/lib/test-server.js),
// so the test never touches the players' cloud saves.
//
// The steps (a step that cannot run is skipped, with why):
//   boot, title, new game, walk (and OK on what it meets), menu, save + cloud
//   upload, load, the toolkit's ⚙ menu, and a phone (landscape, touch) from boot.
// Screenshots and report.json go to --out (default: rwk-test-<name>).

import fs from "node:fs";
import path from "node:path";
import { loadSettings } from "../lib/config.js";
import { findChrome, launchChrome, openPage } from "../lib/chrome.js";
import { workerVars } from "../lib/cloudflare.js";
import { baseConfig } from "../lib/features.js";
import { analyzeGame, collectFiles, siteNameFromLink, suggestSlug } from "../lib/game.js";
import { applyPolicy, readPolicy } from "../lib/policy.js";
import { readProjectFile, siteNameFor, withProjectPatterns } from "../lib/project.js";
import { connect, siteOf } from "../lib/session.js";
import { generatedFiles, runtimeConfigOf } from "../lib/stage.js";
import { expectTarget } from "../lib/target.js";
import { localSaveApi, startTestServer } from "../lib/test-server.js";
import { CliError, ask, c, log } from "../lib/ui.js";
import { findSite } from "./site.js";

const USAGE = "rwk test <game folder | game link | site name> [--out <folder>]";
const PROBE = fs.readFileSync(path.join(import.meta.dirname, "..", "lib", "test-probe.js"), "utf8");
const DESKTOP = { width: 1280, height: 720 };
const PHONE = { width: 844, height: 390 };
const PHONE_UA = "Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Mobile Safari/537.36";
const MAX_PROBLEMS = 50;
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

// A response worth reporting -> its problem text, or null.
// rel: the path on the site; caseOf: (rel) => the real name when only the letter case differs.
export function responseProblem({ status, method = "GET", rel, sameOrigin }, caseOf = () => null) {
  if (status < 400) return null;
  // The save API answers 404 for a save the cloud does not have, 412 for a conflict it reports itself.
  if (sameOrigin && rel.startsWith("api/") && (status === 404 || status === 412)) return null;
  // Chrome asks for it by itself; a game has none.
  if (sameOrigin && rel === "favicon.ico") return null;
  const real = sameOrigin && status === 404 ? caseOf(rel) : null;
  if (real) return `${rel}: not found (HTTP 404). The file is ${real}: only the letter case differs, which works on Windows but not on the web. Fix it with rwk fix-paths`;
  return `${rel}: HTTP ${status}${method !== "GET" ? ` (${method})` : ""}`;
}

// The same problem many times (a sound asked every frame) is one line with a count.
export function addProblem(list, kind, text, step) {
  const found = list.find((p) => p.kind === kind && p.text === text);
  if (found) {
    found.count++;
    return;
  }
  if (list.length < MAX_PROBLEMS) list.push({ kind, text, step, count: 1 });
}

const firstLine = (text) => String(text || "").split("\n")[0].slice(0, 300);

// The link of a link target, with https:// when it has none.
const linkOf = (value) => (/^https?:\/\//i.test(value) ? value : `https://${value}`).replace(/\/*$/, "/");

// The game to test -> { url, label, site, cfg, local: server | null }
async function prepare(target, d) {
  if (target.kind === "folder") {
    log.step("Building the web version on this PC");
    const game = d.analyzeGame(target.value);
    log.ok(`${game.engine} · ${game.title}`);
    const project = readProjectFile(game);
    const slug = siteNameFor(undefined, project) ?? suggestSlug(game);
    const cfg = withProjectPatterns(baseConfig(game, { slug }), project);
    // The phone step checks the touch controls: on for the test, as a deploy offers them.
    cfg.controls = { ...cfg.controls, enabled: true };
    const used = applyPolicy(cfg, readPolicy(game));
    const files = collectFiles(game, cfg);
    const generated = generatedFiles(game, used, files);
    const vars = workerVars({ gameId: slug, auth: { mode: "none" }, locked: false, indexable: false, saveHistory: runtimeConfigOf(game.engine, used).saveHistory });
    const server = await d.startTestServer({ files, generated, vars });
    log.ok(`${files.length} files, served at ${server.origin} (first-deploy settings, touch controls on)`);
    return { url: server.origin + "/", label: slug, game: { title: game.title, engine: game.engine }, local: server, site: null };
  }
  if (target.kind === "name") {
    await d.connect(d.loadSettings());
    const cfg = await d.findSite(target);
    if (!cfg.url) throw new CliError(`No link is recorded for "${cfg.slug}".`, { hint: "Deploy it again from the game folder, or test it by its link." });
    return { url: linkOf(cfg.url), label: cfg.slug, game: { title: cfg.title, engine: cfg.engine }, local: null, site: siteOf(cfg) };
  }
  let name;
  try {
    name = siteNameFromLink(target.value);
  } catch {
    name = new URL(linkOf(target.value)).hostname.split(".")[0];
  }
  return { url: linkOf(target.value), label: name, game: null, local: null, site: { site: name, url: linkOf(target.value) } };
}

export async function testGame(input, { out } = {}, deps = {}) {
  // walkSeconds: how long the walk step plays; bootSeconds: how long the game may take to load (shorter in the tests).
  const d = { analyzeGame, startTestServer, connect, loadSettings, findSite, findChrome, launchChrome, ask, walkSeconds: 8, bootSeconds: 90, ...deps };
  if (!input) input = await d.ask("Drag and drop or paste the game folder, or the game's link or site name", "", null, { hint: `Pass it after the command: ${USAGE}` });
  const target = expectTarget(input, ["folder", "link", "name"], USAGE);
  const executable = d.findChrome();
  const prepared = await prepare(target, d);
  const folder = path.resolve(out || `rwk-test-${prepared.label}`);
  fs.mkdirSync(folder, { recursive: true });

  log.step(`Playing ${prepared.url}`);
  log.info(c.dim(`Browser: ${executable}`));
  const chrome = await d.launchChrome({ executable });
  let run;
  try {
    run = await play(chrome, prepared, folder, d);
  } finally {
    await chrome.close();
    if (prepared.local) await prepared.local.close();
  }

  const report = { url: prepared.url, game: run.game || prepared.game, browser: run.browser, steps: run.steps, problems: run.problems };
  fs.writeFileSync(path.join(folder, "report.json"), JSON.stringify(report, null, 2));

  const failed = run.steps.filter((s) => s.status === "fail");
  const passed = run.steps.filter((s) => s.status === "ok").length;
  if (run.problems.length) {
    log.step(`Problems (${run.problems.length})`);
    for (const p of run.problems) log.warn(`[${p.step}] ${p.text}${p.count > 1 ? c.dim(` ×${p.count}`) : ""}`);
  }
  const result = {
    ...(prepared.site || {}),
    test: { url: prepared.url, folder, steps: run.steps.map(({ name, status, detail }) => ({ name, status, detail })), problems: run.problems },
    facts: [
      ["Steps", `${passed} of ${run.steps.length} passed${failed.length ? `, failed: ${failed.map((s) => s.name).join(", ")}` : ""}`],
      ["Problems", run.problems.length ? `${run.problems.length} (in the list above)` : "none"],
      ["Report", folder],
    ],
    next: [`Screenshots and report.json: ${folder}`],
  };
  if (failed.length || run.problems.length) {
    const what = failed.length ? `${failed.length} step(s) failed (${failed.map((s) => s.name).join(", ")})` : `${run.problems.length} problem(s) found`;
    const hint = failed[0]?.detail || run.problems[0]?.text;
    const err = new CliError(`${what}. Screenshots and report.json: ${folder}`, { hint });
    err.result = result;
    throw err;
  }
  return result;
}

// The steps in the browser. -> { steps, problems, browser, game }
async function play(chrome, prepared, folder, { walkSeconds, bootSeconds }) {
  const boot = () => page.evaluate(`RWK_TEST.boot(${bootSeconds * 1000})`, bootSeconds * 1000 + 30000);
  const browser = (await chrome.cdp.send("Browser.getVersion")).product;
  const page = await openPage(chrome.cdp);
  const origin = new URL(prepared.url).origin;
  const steps = [];
  const problems = [];
  let current = "boot";
  const requests = new Map();
  const uploads = [];

  await page.send("Network.enable");
  await page.send("Page.addScriptToEvaluateOnNewDocument", { source: PROBE });
  page.on("Runtime.consoleAPICalled", (e) => {
    if (e.type !== "error") return;
    const text = e.args.map((a) => (a.value !== undefined ? String(a.value) : a.description || "")).join(" ");
    addProblem(problems, "console", `console.error: ${firstLine(text)}`, current);
  });
  page.on("Network.requestWillBeSent", (e) => requests.set(e.requestId, { url: e.request.url, method: e.request.method }));
  page.on("Network.responseReceived", (e) => {
    const req = requests.get(e.requestId) || { url: e.response.url, method: "GET" };
    const url = new URL(e.response.url);
    const sameOrigin = url.origin === origin;
    const rel = sameOrigin ? safeDecode(url.pathname).replace(/^\/+/, "") : e.response.url;
    if (sameOrigin && req.method === "PUT" && rel.startsWith("api/saves/")) uploads.push({ rel, status: e.response.status });
    const problem = responseProblem({ status: e.response.status, method: req.method, rel, sameOrigin }, prepared.local ? prepared.local.caseOf : undefined);
    if (problem) addProblem(problems, "network", problem, current);
  });
  page.on("Network.loadingFailed", (e) => {
    if (e.canceled || e.errorText === "net::ERR_ABORTED") return;
    const req = requests.get(e.requestId);
    addProblem(problems, "network", `${req ? req.url : "a request"}: ${e.errorText}`, current);
  });

  // A deployed site: its save API answered on this PC.
  if (!prepared.local) {
    const api = localSaveApi({ GAME_ID: prepared.label, RWK_SAVE_HISTORY: "off" });
    await page.send("Fetch.enable", { patterns: [{ urlPattern: `${origin}/api/saves*` }, { urlPattern: `${origin}/api/history*` }] });
    page.on("Fetch.requestPaused", async (e) => {
      try {
        const entries = e.request.postDataEntries || [];
        const body = entries.length ? Buffer.concat(entries.map((x) => Buffer.from(x.bytes || "", "base64"))) : e.request.postData;
        const res = await api(new Request(e.request.url, { method: e.request.method, headers: e.request.headers, body: ["GET", "HEAD"].includes(e.request.method) ? undefined : body }));
        await page.send("Fetch.fulfillRequest", {
          requestId: e.requestId,
          responseCode: res.status,
          responseHeaders: [...res.headers].map(([name, value]) => ({ name, value })),
          body: Buffer.from(await res.arrayBuffer()).toString("base64"),
        });
      } catch (err) {
        await page.send("Fetch.failRequest", { requestId: e.requestId, errorReason: "Failed" }).catch(() => {});
        addProblem(problems, "network", `the test's save API: ${firstLine(err.message)}`, current);
      }
    });
  }

  let shot = 0;
  const screenshot = async (name) => {
    try {
      const { data } = await page.send("Page.captureScreenshot", { format: "png" });
      const file = `${String(++shot).padStart(2, "0")}-${name.replace(/\W+/g, "-")}.png`;
      fs.writeFileSync(path.join(folder, file), Buffer.from(data, "base64"));
      return file;
    } catch {
      return null;
    }
  };
  // What the page saw since the last step: the engine's caught errors and its error screen.
  const collect = async () => {
    let st;
    try {
      // Short: a page still loading may not answer.
      st = await page.evaluate("RWK_TEST.state()", 3000);
    } catch {
      return;
    }
    for (const e of st.engineErrors) addProblem(problems, "engine", `${e.name}: ${firstLine(e.message)}${pluginOf(e.stack)}`, current);
    if (st.errorShown) addProblem(problems, "engine", `the game shows its error screen: ${st.errorShown}`, current);
  };
  const exceptionsSeen = { n: 0 };
  const collectExceptions = () => {
    for (const text of page.errors.slice(exceptionsSeen.n)) addProblem(problems, "script", `uncaught ${firstLine(text)}`, current);
    exceptionsSeen.n = page.errors.length;
  };

  const step = async (name, fn, { skip } = {}) => {
    current = name;
    if (skip) {
      steps.push({ name, status: "skip", detail: skip });
      log.info(c.dim(`– ${name}: skipped (${skip})`));
      return null;
    }
    const t = Date.now();
    let value = null;
    let error = null;
    try {
      value = await fn();
    } catch (e) {
      // The whole test stops (a site behind Access), not this step.
      if (e instanceof CliError) throw e;
      error = e;
    }
    await sleep(300);
    collectExceptions();
    await collect();
    const file = await screenshot(name);
    const ms = Date.now() - t;
    const detail = error ? firstLine(error.message) : describe(name, value);
    steps.push({ name, status: error ? "fail" : "ok", detail, ms, screenshot: file });
    if (error) log.error(`${name}: ${detail}`);
    else log.ok(`${name}${detail ? c.dim(` · ${detail}`) : ""} ${c.dim(`${(ms / 1000).toFixed(1)} s`)}`);
    return error ? null : value || {};
  };

  // Desktop
  await page.viewport(DESKTOP.width, DESKTOP.height);
  const opened = await step("open", () => openSite(page, prepared.url));
  const booted = await step("boot", boot, { skip: opened ? null : "the page did not open" });
  const game = booted ? { engine: booted.engine } : null;
  const onMap = await step("new game", () => page.evaluate("RWK_TEST.newGame()", 90000), { skip: booted ? null : "the game did not start" });
  const noMap = onMap ? null : "the new game did not reach a map";
  await step("walk", () => page.evaluate(`RWK_TEST.walk(${walkSeconds})`, 60000), { skip: noMap });
  await step("menu", () => page.evaluate("RWK_TEST.menu()", 60000), { skip: noMap });
  const saved = await step("save", () => page.evaluate("RWK_TEST.save(1)", 60000), { skip: noMap });
  await step("cloud save", () => waitUpload(uploads), { skip: !saved ? "the save failed" : !booted.sync ? "cloud save sync is off for this game" : null });
  await step("load", () => page.evaluate("RWK_TEST.load(1)", 60000), { skip: saved ? null : "the save failed" });
  await step("toolkit menu", () => page.evaluate("RWK_TEST.toolkitMenu()", 30000), { skip: !booted ? "the game did not start" : !booted.toolkit ? "the toolkit is not in this game" : null });

  // Phone: from boot, in landscape with touch, as a player on a phone opens it.
  if (booted) {
    await page.send("Emulation.setUserAgentOverride", { userAgent: PHONE_UA, platform: "Linux armv8l" });
    await page.send("Emulation.setTouchEmulationEnabled", { enabled: true, maxTouchPoints: 5 });
    await page.send("Emulation.setEmitTouchEventsForMouse", { enabled: true, configuration: "mobile" });
    await page.viewport(PHONE.width, PHONE.height, true);
    await step("phone", async () => {
      await openSite(page, prepared.url);
      await boot();
      await page.evaluate("RWK_TEST.newGame()", 90000).catch(() => {});
      await sleep(1500);
      const seen = await page.evaluate("RWK_TEST.phone()");
      const wrong = [];
      if (!seen.fits) wrong.push(`the game (${seen.canvas}) does not fit the screen (${seen.viewport})`);
      if (seen.scroll) wrong.push("the page scrolls sideways");
      if (booted.controls && !seen.controls) wrong.push("the touch controls do not show");
      if (wrong.length) throw new Error(wrong.join("; "));
      return seen;
    });
  }
  return { steps, problems, browser, game };
}

// Opens the site; a site behind Cloudflare Access stops here, as a test cannot sign in.
export async function openSite(page, url, timeoutMs = 30000) {
  const nav = await page.send("Page.navigate", { url });
  if (nav.errorText) throw new Error(`${url} cannot be opened (${nav.errorText})`);
  const end = Date.now() + timeoutMs;
  for (;;) {
    let here = "";
    try {
      here = await page.evaluate("location.href + ' ' + document.readyState", 5000);
    } catch {
      // Navigating.
    }
    if (/cloudflareaccess\.com/i.test(here)) {
      throw new CliError("The site is behind Cloudflare Access: the test cannot sign in.", { hint: 'Test the game folder instead (rwk test "<game folder>"): the same build, served on this PC' });
    }
    if (/ (interactive|complete)$/.test(here)) return { url: here.split(" ")[0] };
    if (Date.now() > end) throw new Error(`${url} did not load in ${timeoutMs / 1000} s`);
    await sleep(200);
  }
}

export async function waitUpload(uploads, timeoutMs = 15000) {
  const end = Date.now() + timeoutMs;
  while (Date.now() < end) {
    const done = uploads.find((u) => u.status < 300);
    if (done) return { saves: uploads.filter((u) => u.status < 300).map((u) => safeDecode(u.rel.slice("api/saves/".length))) };
    const bad = uploads.find((u) => u.status >= 300 && u.status !== 412);
    if (bad) throw new Error(`the upload of ${bad.rel} failed (HTTP ${bad.status})`);
    await sleep(200);
  }
  throw new Error(`the save did not go up to the cloud in ${timeoutMs / 1000} s`);
}

// A path as the site sees it; a name that is no valid escape stays as it was asked.
export function safeDecode(text) {
  try {
    return decodeURIComponent(text);
  } catch {
    return text;
  }
}

// " (plugin X)" from an error's stack: the first plugin file in it.
export function pluginOf(stack) {
  const m = /js\/plugins\/([^/?#:)]+)\.js/.exec(stack || "");
  if (!m) return "";
  const name = safeDecode(m[1]);
  return ` (plugin ${name}${name.startsWith("RWK_") ? ", rpgmaker-web-toolkit" : ""})`;
}

// One step's result in a few words.
export function describe(name, v) {
  if (!v) return "";
  if (v.skipped) return v.skipped;
  switch (name) {
    case "boot":
      return `${v.engine || "?"}, ${v.scene}${v.toolkit ? "" : ", no toolkit"}`;
    case "new game":
      return `map ${v.mapId}${v.eventRunning ? ", an event runs" : ""}`;
    case "walk":
      return `${v.steps} step(s)${v.to && v.from && v.to.mapId !== v.from.mapId ? `, now on map ${v.to.mapId}` : ""}${v.scene && v.scene !== "Scene_Map" ? `, now in ${v.scene}` : ""}`;
    case "save":
      return `file ${v.slot}`;
    case "cloud save":
      return `uploaded: ${v.saves.join(", ")}`;
    case "load":
      return `map ${v.mapId}`;
    case "toolkit menu":
      return `${v.rows} entries`;
    case "phone":
      return `${v.viewport}, game ${v.canvas}${v.controls ? ", touch controls shown" : ""}`;
    default:
      return "";
  }
}
