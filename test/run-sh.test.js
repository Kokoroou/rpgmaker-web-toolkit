// run.sh: the cache that keeps the toolkit and wrangler between runs, the leases that
// keep --cleanup from pulling it away from a run still using it. Runs the real script
// against local tarballs and a stand-in npm (macOS and Linux only).

import assert from "node:assert/strict";
import { spawn, spawnSync } from "node:child_process";
import crypto from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { test } from "node:test";

const SCRIPT = path.resolve("run.sh");
const skip = process.platform === "win32" ? "run.sh is for macOS and Linux" : false;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const sha = (name) => crypto.createHash("sha1").update(name).digest("hex");

// A world with a fake GitHub (tarballs and the commits API as files) and a counting npm.
function world(t) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "rwk-sh-"));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const dirs = { downloads: path.join(root, "dl"), api: path.join(root, "api"), cache: path.join(root, "cache"), bin: path.join(root, "bin"), count: path.join(root, "npm-count"), home: path.join(root, "home") };
  for (const d of [dirs.downloads, dirs.api, dirs.bin, dirs.home]) fs.mkdirSync(path.join(d, "tar.gz"), { recursive: true });
  fs.mkdirSync(path.join(dirs.api, "commits"), { recursive: true });
  fs.writeFileSync(
    path.join(dirs.bin, "npm"),
    `#!/usr/bin/env bash
# stand-in: npm ci --prefix <dir> ...
echo x >> "${dirs.count}"
while [ $# -gt 0 ]; do [ "$1" = --prefix ] && prefix="$2"; shift; done
mkdir -p "$prefix/node_modules/wrangler/bin"
echo "// wrangler" > "$prefix/node_modules/wrangler/bin/wrangler.js"
`,
    { mode: 0o755 }
  );
  const make = (version, { lock = "lock-1" } = {}) => {
    const stage = fs.mkdtempSync(path.join(root, "src-"));
    const top = path.join(stage, `rpgmaker-web-toolkit-${version}`);
    fs.mkdirSync(path.join(top, "cli"), { recursive: true });
    fs.writeFileSync(path.join(top, "package.json"), "{}");
    fs.writeFileSync(path.join(top, "package-lock.json"), lock);
    // The CLI says where it runs from and with which arguments; RWK_TEST_GATE keeps it running.
    fs.writeFileSync(
      path.join(top, "cli", "index.js"),
      `import fs from "node:fs";
console.log(JSON.stringify({ version: ${JSON.stringify(version)}, args: process.argv.slice(2), wrangler: fs.existsSync(new URL("../node_modules/wrangler/bin/wrangler.js", import.meta.url)) }));
if (process.env.RWK_TEST_GATE) while (!fs.existsSync(process.env.RWK_TEST_GATE)) await new Promise((r) => setTimeout(r, 20));
process.exit(Number(process.env.RWK_TEST_EXIT || 0));
`
    );
    fs.writeFileSync(path.join(top, "package.json"), JSON.stringify({ type: "module" }));
    return top;
  };
  const publish = (name, version, opts) => {
    const top = make(version, opts);
    const id = name.startsWith("v") ? name : sha(name);
    spawnSync("tar", ["-czf", path.join(dirs.downloads, "tar.gz", id), "-C", path.dirname(top), path.basename(top)]);
    if (!name.startsWith("v")) fs.writeFileSync(path.join(dirs.api, "commits", "main"), id);
    return id;
  };
  const env = (extra = {}) => ({
    PATH: `${dirs.bin}:${process.env.PATH}`,
    HOME: dirs.home,
    RWK_CACHE: dirs.cache,
    RWK_DOWNLOAD_BASE: `file://${dirs.downloads}`,
    RWK_API_BASE: `file://${dirs.api}`,
    ...extra,
  });
  const run = (args = [], extra = {}) => {
    const r = spawnSync("bash", [SCRIPT, ...args], { env: env(extra), encoding: "utf8", input: "" });
    let out = null;
    try {
      out = JSON.parse(r.stdout);
    } catch {}
    return { ...r, out };
  };
  const start = (args, extra) => spawn("bash", [SCRIPT, ...args], { env: env(extra), stdio: ["ignore", "pipe", "pipe"] });
  const installs = () => (fs.existsSync(dirs.count) ? fs.readFileSync(dirs.count, "utf8").trim().split("\n").length : 0);
  const versions = () => (fs.existsSync(path.join(dirs.cache, "toolkit")) ? fs.readdirSync(path.join(dirs.cache, "toolkit")) : []);
  const deps = () => (fs.existsSync(path.join(dirs.cache, "deps")) ? fs.readdirSync(path.join(dirs.cache, "deps")).filter((d) => !d.startsWith("tmp-")) : []);
  return { root, dirs, publish, run, start, installs, versions, deps, env };
}

test("run.sh: the first run downloads and installs, the next one only runs", { skip }, (t) => {
  const w = world(t);
  const id = w.publish("c1", "1.0.0");
  const first = w.run(["deploy", "a game"]);
  assert.equal(first.status, 0, first.stderr);
  assert.deepEqual(first.out.args, ["deploy", "a game"]);
  assert.equal(first.out.wrangler, true, "the CLI finds wrangler next to it");
  assert.equal(w.installs(), 1);
  assert.deepEqual(w.versions(), [id]);
  assert.match(first.stderr, /Downloading/);

  // GitHub gone, the files gone: the cache is all there is.
  fs.rmSync(path.join(w.dirs.downloads, "tar.gz", id));
  const second = w.run(["status", "x"]);
  assert.equal(second.status, 0, second.stderr);
  assert.deepEqual(second.out.args, ["status", "x"]);
  assert.doesNotMatch(second.stderr, /Downloading|Installing/);
  assert.equal(w.installs(), 1);
});

test("run.sh: a new version downloads, but wrangler is kept when the lockfile did not change", { skip }, (t) => {
  const w = world(t);
  w.publish("c1", "1.0.0");
  w.run([]);
  const id2 = w.publish("c2", "1.1.0");
  const r = w.run([]);
  assert.equal(r.out.version, "1.1.0");
  assert.equal(w.installs(), 1, "same package-lock.json: no second npm ci");
  assert.equal(w.deps().length, 1);
  assert.ok(w.versions().includes(id2));

  w.publish("c3", "1.2.0", { lock: "lock-2" });
  assert.equal(w.run([]).out.version, "1.2.0");
  assert.equal(w.installs(), 2, "a changed lockfile installs again");
});

test("run.sh: no answer from GitHub, the version already downloaded runs", { skip }, (t) => {
  const w = world(t);
  w.publish("c1", "1.0.0");
  w.run([]);
  fs.rmSync(path.join(w.dirs.api, "commits", "main"));
  const r = w.run(["list"]);
  assert.equal(r.status, 0, r.stderr);
  assert.equal(r.out.version, "1.0.0");
  assert.match(r.stderr, /using the copy already downloaded/);
});

test("run.sh: a release tag is cached for good, without asking GitHub", { skip }, (t) => {
  const w = world(t);
  w.publish("v1.2.3", "1.2.3");
  assert.equal(w.run(["x"], { RWK_REF: "v1.2.3" }).out.version, "1.2.3");
  fs.rmSync(path.join(w.dirs.downloads, "tar.gz", "v1.2.3"));
  assert.equal(w.run(["x"], { RWK_REF: "v1.2.3" }).out.version, "1.2.3");
});

test("run.sh: the CLI's exit code comes back", { skip }, (t) => {
  const w = world(t);
  w.publish("c1", "1.0.0");
  assert.equal(w.run(["x"], { RWK_TEST_EXIT: "2" }).status, 2);
});

test("run.sh: --cleanup removes what the run downloaded, and the CLI never sees it", { skip }, (t) => {
  const w = world(t);
  w.publish("c1", "1.0.0");
  const r = w.run(["deploy", "--cleanup", "g"]);
  assert.equal(r.status, 0, r.stderr);
  assert.deepEqual(r.out.args, ["deploy", "g"]);
  assert.deepEqual(w.versions(), []);
  assert.deepEqual(w.deps(), []);
  // And the cache starts again.
  assert.equal(w.run(["x"]).out.version, "1.0.0");
  assert.equal(w.installs(), 2);
  assert.equal(w.run(["x"], { RWK_CLEANUP: "1" }).status, 0);
  assert.deepEqual(w.versions(), [], "RWK_CLEANUP=1 does the same");
});

test("run.sh: without --cleanup nothing is removed", { skip }, (t) => {
  const w = world(t);
  w.publish("c1", "1.0.0");
  w.run([]);
  w.run([], { RWK_CLEANUP: "0" });
  assert.equal(w.versions().length, 1);
  assert.equal(w.deps().length, 1);
});

test("run.sh: --cleanup waits for a run that is still using the toolkit", { skip }, async (t) => {
  const w = world(t);
  const id = w.publish("c1", "1.0.0");
  const gateDir = fs.mkdtempSync(path.join(os.tmpdir(), "rwk-gate-"));
  const gate = path.join(gateDir, "gate");
  // Run A uses the toolkit until the gate file appears.
  const a = w.start(["deploy", "--cleanup"], { RWK_TEST_GATE: gate });
  // A failing assertion below must not leave A waiting for its gate.
  t.after(() => {
    fs.writeFileSync(gate, ""); // lets A's CLI end, whatever the test found
    a.kill();
    setTimeout(() => fs.rmSync(gateDir, { recursive: true, force: true }), 500).unref();
  });
  let aOut = "";
  a.stdout.on("data", (d) => (aOut += d));
  const aDone = new Promise((resolve) => a.on("close", resolve));
  const leases = path.join(w.dirs.cache, "toolkit", id, ".leases");
  for (let i = 0; i < 200 && !(fs.existsSync(leases) && fs.readdirSync(leases).length && aOut); i++) await sleep(50);
  assert.equal(fs.readdirSync(leases).length, 1, "A holds a lease");

  // Run B finishes with --cleanup while A is still going: A's toolkit must stay.
  const b = w.run(["status", "--cleanup"]);
  assert.equal(b.status, 0, b.stderr);
  assert.match(b.stderr, /Another run is using the cached toolkit/);
  assert.deepEqual(w.versions(), [id]);
  assert.equal(w.installs(), 1);
  assert.ok(fs.existsSync(path.join(w.dirs.cache, "toolkit", id, "node_modules", "wrangler", "bin", "wrangler.js")), "wrangler is still there for A");

  // A ends: the last one out cleans up.
  fs.writeFileSync(gate, "");
  assert.equal(await Promise.race([aDone, sleep(20_000).then(() => "timeout")]), 0);
  assert.deepEqual(w.versions(), []);
  assert.deepEqual(w.deps(), []);
});

test("run.sh: a lease left by a run that died does not keep --cleanup from working", { skip }, (t) => {
  const w = world(t);
  const id = w.publish("c1", "1.0.0");
  w.run([]);
  fs.writeFileSync(path.join(w.dirs.cache, "toolkit", id, ".leases", "2147483646.1"), "");
  assert.equal(w.run([], { RWK_CLEANUP: "1" }).status, 0);
  assert.deepEqual(w.versions(), []);
});

test("run.sh: runs started together share one download", { skip }, async (t) => {
  const w = world(t);
  const id = w.publish("c1", "1.0.0");
  const runs = [1, 2, 3, 4].map(() => {
    const p = w.start(["deploy", "x"]);
    let out = "";
    p.stdout.on("data", (d) => (out += d));
    return new Promise((resolve) => p.on("close", (code) => resolve({ code, out })));
  });
  const done = await Promise.all(runs);
  assert.deepEqual(done.map((d) => d.code), [0, 0, 0, 0]);
  assert.ok(done.every((d) => JSON.parse(d.out).wrangler));
  assert.deepEqual(w.versions(), [id]);
  assert.equal(w.deps().length, 1);
});

test("run.sh: old versions are pruned, the newest stay", { skip }, (t) => {
  const w = world(t);
  const ids = [];
  for (const n of [1, 2, 3, 4, 5]) {
    ids.push(w.publish(`c${n}`, `1.0.${n}`));
    w.run([]);
    // Different modification times, as real runs have.
    const dir = path.join(w.dirs.cache, "toolkit", ids.at(-1));
    fs.utimesSync(dir, new Date(Date.now() - (6 - n) * 60_000), new Date(Date.now() - (6 - n) * 60_000));
  }
  assert.deepEqual(w.versions().sort(), ids.slice(-3).sort());
});
