// rwk deploy with several folders at once: the command line, the pool, the shared lock
// and the one file all the games write to.

import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { test } from "node:test";
import { DEFAULT_JOBS, MAX_JOBS, commandHelp, COMMANDS, parseCommandLine } from "../cli/lib/args.js";
import { deployMany, inPool, labelsOf, runChild } from "../cli/commands/deploy-many.js";
import { putGameConfig, updateGameConfigs } from "../cli/lib/cloudflare.js";
import { pidAlive, withLock } from "../cli/lib/lock.js";
import { failedResult } from "../cli/lib/report.js";
import { warnings } from "../cli/lib/ui.js";

const tmp = (t) => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "rwk-par-"));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  return dir;
};
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

//---------------------------------------------------------------------------
// The command line
//---------------------------------------------------------------------------

test("deploy: several folders, each an existing directory", () => {
  const dirs = new Set(["/g/a", "/g/b", "/g/My Game"]);
  const isDir = (p) => dirs.has(p);
  const parse = (args) => parseCommandLine(args, { stdinIsTTY: true, isDir });
  assert.deepEqual(parse(["deploy", "/g/a", "/g/b"]).targets, ["/g/a", "/g/b"]);
  assert.deepEqual(parse(["deploy", "/g/My", "Game"]).targets, ["/g/My Game"], "one path with spaces stays one game");
  assert.deepEqual(parse(["deploy", "/g/My Game"]).targets, ["/g/My Game"]);
  assert.deepEqual(parse(["deploy", "/g/a", "/g/missing"]).targets, ["/g/a /g/missing"], "a word that is no folder: one path, which the deploy then reports");
  assert.deepEqual(parse(["deploy"]).targets, []);
});

test("deploy: --jobs counts the games at once, and only whole numbers up to the maximum", () => {
  const isDir = (p) => p === "/a" || p === "/b";
  const parse = (args) => parseCommandLine(args, { stdinIsTTY: true, isDir });
  assert.equal(parse(["deploy", "/a", "/b", "--jobs", "2"]).flags.jobs, 2);
  assert.equal(parse(["deploy", "/a", "/b", "-j", "1"]).flags.jobs, 1);
  assert.equal(parse(["deploy", "/a", "/b"]).flags.jobs, undefined);
  assert.equal(parse(["deploy", "/a", "--jobs", "4"]).flags.jobs, 4, "ignored for one game");
  for (const bad of ["0", "x", "-1", "1.5", String(MAX_JOBS + 1)]) {
    assert.throws(() => parse(["deploy", "/a", "/b", "--jobs", bad]), (err) => err.exitCode === 64 && /--jobs/.test(err.message), bad);
  }
  assert.throws(() => parseCommandLine(["analyze", "/a", "--jobs", "2"], { stdinIsTTY: true }), (err) => err.exitCode === 64 && /Unknown option --jobs/.test(err.message));
  assert.match(commandHelp(COMMANDS.find((cmd) => cmd.name === "deploy")), new RegExp(`--jobs +With several folders[^\\n]*default ${DEFAULT_JOBS}, max ${MAX_JOBS}`));
});

test("deploy: options that belong to one game do not go with several folders", () => {
  const isDir = (p) => p === "/a" || p === "/b";
  for (const flag of [["--name", "x"], ["--new-site"], ["--dry-run"]]) {
    assert.throws(() => parseCommandLine(["deploy", "/a", "/b", ...flag], { stdinIsTTY: true, isDir }), (err) => err.exitCode === 64 && /one game/.test(err.message), flag.join(" "));
  }
});

//---------------------------------------------------------------------------
// The lock
//---------------------------------------------------------------------------

test("withLock: one holder at a time", async (t) => {
  const file = path.join(tmp(t), "x.lock");
  let inside = 0;
  let worst = 0;
  const order = [];
  await Promise.all(
    [1, 2, 3, 4].map((n) =>
      withLock(file, async () => {
        worst = Math.max(worst, ++inside);
        await sleep(15);
        order.push(n);
        inside--;
      }, { pollMs: 2 })
    )
  );
  assert.equal(worst, 1);
  assert.equal(order.length, 4);
  assert.equal(fs.existsSync(file), false, "released");
});

test("withLock: released after an error, and a lock of a dead process is taken over", async (t) => {
  const file = path.join(tmp(t), "x.lock");
  await assert.rejects(withLock(file, async () => { throw new Error("boom"); }), /boom/);
  assert.equal(fs.existsSync(file), false);

  fs.writeFileSync(file, "2147483646"); // no such process
  assert.equal(pidAlive(2147483646), false);
  assert.equal(await withLock(file, async () => "got it", { pollMs: 2 }), "got it");
});

test("withLock: a live holder is waited for, and the wait ends with a message", async (t) => {
  const file = path.join(tmp(t), "x.lock");
  fs.writeFileSync(file, String(process.pid)); // alive, and not stale
  await assert.rejects(withLock(file, async () => {}, { timeoutMs: 60, pollMs: 5 }), /holds .*x\.lock/);
});

//---------------------------------------------------------------------------
// games.json: two deploys must not lose each other's game
//---------------------------------------------------------------------------

function fakeR2() {
  const store = { json: "{}" };
  return {
    store,
    load: async () => {
      await sleep(5); // a real read takes time: this is where deploys used to overlap
      return JSON.parse(store.json);
    },
    save: async (bucket, configs) => {
      await sleep(5);
      store.json = JSON.stringify(configs);
    },
  };
}

test("updateGameConfigs: parallel writers each keep their game", async (t) => {
  const r2 = fakeR2();
  const lockFile = path.join(tmp(t), "games.lock");
  const games = Array.from({ length: 6 }, (_, i) => i);
  await Promise.all(games.map((i) => putGameConfig("b", `fp${i}`, { slug: `game-${i}` }, { lockFile, load: r2.load, save: r2.save })));
  assert.deepEqual(Object.keys(JSON.parse(r2.store.json)).sort(), games.map((i) => `fp${i}`));
});

test("updateGameConfigs: without the lock the same writers do lose games (what the lock is for)", async () => {
  const r2 = fakeR2();
  await Promise.all([0, 1, 2].map(async (i) => {
    const configs = await r2.load();
    configs[`fp${i}`] = { slug: `g${i}` };
    await r2.save("b", configs);
  }));
  assert.ok(Object.keys(JSON.parse(r2.store.json)).length < 3);
});

test("putGameConfig: a site name another game just took stops the deploy", async (t) => {
  const r2 = fakeR2();
  const opts = { lockFile: path.join(tmp(t), "games.lock"), load: r2.load, save: r2.save };
  await putGameConfig("b", "fpA", { slug: "game" }, opts);
  await assert.rejects(putGameConfig("b", "fpB", { slug: "game" }, opts), (err) => /just taken/.test(err.message) && /--name/.test(err.hint));
  assert.deepEqual(Object.keys(JSON.parse(r2.store.json)), ["fpA"]);
  await putGameConfig("b", "fpA", { slug: "game", url: "https://x" }, opts); // its own name, changed later
  assert.equal(JSON.parse(r2.store.json).fpA.url, "https://x");
  await updateGameConfigs("b", (configs) => delete configs.fpA, opts);
  assert.deepEqual(JSON.parse(r2.store.json), {});
});

//---------------------------------------------------------------------------
// The runs
//---------------------------------------------------------------------------

test("inPool: at most `limit` at a time, results in order", async () => {
  let running = 0;
  let worst = 0;
  const out = await inPool([5, 1, 4, 2, 3], 2, async (n) => {
    worst = Math.max(worst, ++running);
    await sleep(n * 3);
    running--;
    return n * 10;
  });
  assert.deepEqual(out, [50, 10, 40, 20, 30]);
  assert.equal(worst, 2);
  assert.deepEqual(await inPool([], 3, async () => 1), []);
});

test("labelsOf: folder names, told apart when they repeat", () => {
  assert.deepEqual(labelsOf(["/a/Game", "/b/Game", "/c/Other"]), ["Game", "Game#2", "Other"]);
});

const ok = (site, extra = {}) => JSON.stringify({ schema: 1, ok: true, command: "deploy", site, url: `https://${site}.x.workers.dev`, locked: false, build: { files: 3, bytes: 9, r2Files: 0, r2Uploaded: 0 }, warnings: [], ...extra });
const fail = (error, exitCode = 1, hint = null) => JSON.stringify({ schema: 1, ok: false, command: "deploy", error, hint, exitCode, warnings: [] });

function gameFolders(t, names) {
  const root = tmp(t);
  return names.map((n) => {
    const dir = path.join(root, n);
    fs.mkdirSync(dir);
    return dir;
  });
}

test("deployMany: logs in once, runs every game, prefixes its log lines", async (t) => {
  const [a, b] = gameFolders(t, ["alpha", "beta"]);
  const lines = [];
  const calls = [];
  let logins = 0;
  const result = await deployMany([a, b], {
    jobs: 2,
    profile: "work",
    deps: {
      color: false,
      connectFn: async () => logins++,
      write: (line) => lines.push(line),
      run: async (args, { onLine }) => {
        calls.push(args);
        onLine("  ✓ uploaded");
        return { code: 0, stdout: ok(path.basename(args[1])), stderr: "" };
      },
    },
  });
  assert.equal(logins, 1);
  assert.equal(calls.length, 2);
  assert.deepEqual(calls[0], ["deploy", a, "--json", "--no-color", "--profile", "work"]);
  assert.ok(lines.includes("[alpha] " + "  ✓ uploaded") && lines.includes("[beta ] " + "  ✓ uploaded"), lines.join("|"));
  assert.deepEqual(result.sites.map((s) => s.site), ["alpha", "beta"]);
  assert.equal(result.games.length, 2);
  assert.equal(result.facts[0][1], "2 deployed");
});

test("deployMany: one game failing does not stop the others, and the run fails with a way on", async (t) => {
  const [a, b, c] = gameFolders(t, ["alpha", "beta", "gamma"]);
  const started = [];
  const run = async (args) => {
    const name = path.basename(args[1]);
    started.push(name);
    if (name === "beta") return { code: 2, stdout: fail('Nobody can answer "Access".', 2, "Run it in a terminal"), stderr: "" };
    if (name === "gamma") return { code: 1, stdout: "", stderr: "line\nboom\n" };
    return { code: 0, stdout: ok(name, { warnings: ["slow"] }), stderr: "" };
  };
  warnings.length = 0;
  t.after(() => (warnings.length = 0));
  const err = await deployMany([a, b, c], { jobs: 1, deps: { color: false, connectFn: async () => {}, write: () => {}, run } }).catch((e) => e);
  assert.deepEqual(started, ["alpha", "beta", "gamma"], "all of them ran");
  assert.match(err.message, /2 of 3 games were not deployed/);
  assert.match(err.message, /beta: Nobody can answer/);
  assert.match(err.message, /gamma: line \/ boom/, "a run that died without a result: the end of its log");
  assert.ok(err.hint.includes(`rwk deploy "${b}"`) && err.hint.includes(`rwk deploy "${c}"`));
  assert.equal(err.exitCode, 1, "2 only when every failure needs a person");
  assert.deepEqual(err.games.map((g) => g.ok), [true, false, false]);
  assert.deepEqual(warnings, ["[alpha] slow"]);
  assert.equal(failedResult("deploy", err, []).games.length, 3, "the JSON result keeps the per-game outcome");

  const onlyAsking = await deployMany([b], { jobs: 1, deps: { color: false, connectFn: async () => {}, write: () => {}, run } }).catch((e) => e);
  assert.equal(onlyAsking.exitCode, 2);
});

test("deployMany: the same folder twice is one run; a missing folder stops before any login", async (t) => {
  const [a] = gameFolders(t, ["alpha"]);
  let runs = 0;
  let logins = 0;
  const deps = { color: false, connectFn: async () => logins++, write: () => {}, run: async () => (runs++, { code: 0, stdout: ok("alpha"), stderr: "" }) };
  await deployMany([a, a + path.sep], { deps });
  assert.equal(runs, 1);
  await assert.rejects(deployMany([a, path.join(a, "nope")], { deps }), (err) => err.exitCode === 64 && /Folder not found/.test(err.message));
  assert.equal(logins, 1, "the second call stopped before logging in");
});

test("runChild: the CLI as a child, its log by line and its result apart", async () => {
  const lines = [];
  const ok = await runChild(["--version"], { onLine: (l) => lines.push(l) });
  assert.equal(ok.code, 0);
  assert.match(ok.stdout, /^\d+\.\d+\.\d+/);
  assert.deepEqual(lines, []);

  const children = new Set();
  const bad = await runChild(["--no-such-flag", "--no-color"], { onLine: (l) => lines.push(l), children });
  assert.equal(bad.code, 64);
  assert.match(lines.join("\n"), /Unknown option/);
  assert.equal(children.size, 0, "a finished child is forgotten");
});
