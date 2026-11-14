// rwk deploy with several folders: the games are deployed at the same time, a few at
// once (--jobs). Each game is a run of this CLI of its own (rwk deploy <folder> --json),
// so nothing is shared between them in memory: their logs, step counts and warnings
// stay apart, and one that fails does not stop the others. The only thing they share
// is the list of games in R2, which is written under a lock (updateGameConfigs).
//
// No questions: a run with several games answers each with its default, as --yes does
// (a first deploy that needs a person, e.g. to set up Access, says so and is run alone).

import { spawn } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { DEFAULT_JOBS } from "../lib/args.js";
import { loadSettings } from "../lib/config.js";
import { connect } from "../lib/session.js";
import { CliError, UsageError, c, isQuiet, log, print, useColor, warnings } from "../lib/ui.js";

const CLI_ENTRY = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "index.js");

// One run of the CLI: stderr (its log) line by line to onLine, stdout (its JSON result) collected.
// -> { code, stdout, stderr }
export function runChild(args, { env = process.env, onLine = () => {}, children = new Set() } = {}) {
  return new Promise((resolve) => {
    const child = spawn(process.execPath, [CLI_ENTRY, ...args], { env, stdio: ["ignore", "pipe", "pipe"] });
    children.add(child);
    let stdout = "";
    let stderr = "";
    let rest = "";
    child.stdout.on("data", (d) => (stdout += d));
    child.stderr.on("data", (d) => {
      stderr += d;
      const lines = (rest + d).split(/\r?\n/);
      rest = lines.pop();
      lines.forEach(onLine);
    });
    const end = (code, extra = "") => {
      children.delete(child);
      if (rest) onLine(rest);
      resolve({ code, stdout, stderr: stderr + extra });
    };
    child.on("error", (err) => end(1, err.message));
    child.on("close", (code) => end(code ?? 1));
  });
}

// At most `limit` tasks at a time, started in order; -> the results in order.
export async function inPool(items, limit, task) {
  const results = new Array(items.length);
  let next = 0;
  const worker = async () => {
    while (next < items.length) {
      const i = next++;
      results[i] = await task(items[i], i);
    }
  };
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, worker));
  return results;
}

// The JSON a child printed, or null when it died before printing one.
function resultOf(stdout) {
  try {
    const result = JSON.parse(stdout);
    return result && typeof result === "object" ? result : null;
  } catch {
    return null;
  }
}

// Labels that tell the games apart in the shared log: the folder's name, made unique.
export function labelsOf(folders) {
  const seen = new Map();
  return folders.map((folder) => {
    const base = path.basename(folder).slice(0, 24) || folder;
    const n = (seen.get(base) || 0) + 1;
    seen.set(base, n);
    return n > 1 ? `${base}#${n}` : base;
  });
}

// folders: paths as typed. flags: --jobs, --profile, --account, --quiet, --verbose of this run.
// deps: the login and the child runner, replaceable in tests.
export async function deployMany(folders, { jobs, profile, account, deps = {} } = {}) {
  const { connectFn = () => connect(loadSettings()), run = runChild, write = print, color = useColor(), quiet = isQuiet(), verbose = false } = deps;

  // The same folder twice would be two runs on one game.
  const unique = [...new Map(folders.map((f) => [path.resolve(f), f])).entries()].map(([abs, typed]) => ({ abs, typed }));
  const missing = unique.filter(({ abs }) => !fs.existsSync(abs) || !fs.statSync(abs).isDirectory());
  if (missing.length) throw new UsageError(`Folder not found: ${missing.map(({ typed }) => typed).join(", ")}`, { hint: 'Usage: rwk deploy "<game folder>" "<game folder>" ...' });

  const limit = Math.min(jobs || DEFAULT_JOBS, unique.length);
  log.info(`Deploying ${unique.length} games${limit > 1 ? `, ${limit} at a time` : " one after the other"}. Questions take their default (as --yes); a game that needs a person is reported at the end.`);

  // Logged in once here, before the runs: they would otherwise each open the browser.
  await connectFn();

  const labels = labelsOf(unique.map(({ abs }) => abs));
  const width = Math.max(...labels.map((l) => l.length));
  const passthrough = [...(profile ? ["--profile", profile] : []), ...(account ? ["--account", account] : []), ...(quiet ? ["--quiet"] : []), ...(verbose ? ["--verbose"] : [])];
  const env = { ...process.env, ...(color ? { FORCE_COLOR: "1" } : {}) };
  const children = new Set();
  const stop = () => children.forEach((child) => child.kill());
  process.once("exit", stop);

  let outcomes;
  try {
    outcomes = await inPool(unique, limit, async ({ abs }, i) => {
      const label = labels[i];
      const tag = c.dim(`[${label.padEnd(width)}] `);
      const done = await run(["deploy", abs, "--json", ...(color ? [] : ["--no-color"]), ...passthrough], { env, onLine: (line) => write(`${tag}${line}`), children });
      const result = resultOf(done.stdout);
      if (result?.ok) return { label, folder: abs, ok: true, result };
      const reason = result || { error: done.stderr.trim().split("\n").slice(-3).join(" / ") || `exit code ${done.code}`, hint: null, exitCode: done.code || 1 };
      return { label, folder: abs, ok: false, result: reason };
    });
  } finally {
    process.removeListener("exit", stop);
  }

  const good = outcomes.filter((o) => o.ok);
  const bad = outcomes.filter((o) => !o.ok);
  for (const o of good) for (const w of o.result.warnings || []) warnings.push(`[${o.label}] ${w}`);

  const games = outcomes.map((o) => ({
    folder: o.folder,
    ok: o.ok,
    site: o.result.site || null,
    url: o.result.url || null,
    ...(o.ok ? { locked: !!o.result.locked, build: o.result.build || null } : { error: o.result.error, hint: o.result.hint || null, exitCode: o.result.exitCode || 1 }),
  }));
  const facts = [
    ["Games", [`${good.length} deployed`, bad.length ? `${bad.length} failed` : ""].filter(Boolean).join(", ")],
    ...good.map((o) => ["", `${o.result.site || o.label}  ${o.result.url || ""}${o.result.locked ? c.yellow("  (still locked)") : ""}`.trimEnd()]),
  ];
  if (bad.length) {
    const lines = bad.map((o) => `${o.label}: ${o.result.error}${o.result.hint ? ` (${o.result.hint})` : ""}`);
    throw new CliError(`${bad.length} of ${outcomes.length} games were not deployed:\n${lines.join("\n")}`, {
      games,
      hint: `Run each alone to answer its questions: ${bad.map((o) => `rwk deploy "${o.folder}"`).join("   ")}`,
      // 2 (needs a person) only when that is why every one failed.
      exitCode: bad.every((o) => o.result.exitCode === 2) ? 2 : bad.find((o) => o.result.exitCode !== 2)?.result.exitCode || 1,
    });
  }
  return { site: null, url: null, sites: good.map((o) => ({ site: o.result.site, url: o.result.url || null })), games, facts, next: ["Each game's link is above. Run rwk deploy <game folder> to update one later."] };
}
