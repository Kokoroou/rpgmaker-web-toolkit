// analyze, deploy --dry-run, doctor and the current folder as the default target: all without Cloudflare.

import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { COMMANDS, commandHelp, parseCommandLine } from "../cli/lib/args.js";
import { analyze } from "../cli/commands/analyze.js";
import { runChecks } from "../cli/commands/doctor.js";
import { renderSummary, runResult, stepSummary } from "../cli/lib/report.js";
import { currentGameFolder } from "../cli/lib/target.js";
import { warnings } from "../cli/lib/ui.js";

const parse = (args) => parseCommandLine(args, { stdinIsTTY: true });

function makeGame(extra = {}) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "rwk-dry-"));
  for (const sub of ["js", "data", "img"]) fs.mkdirSync(path.join(dir, sub));
  fs.writeFileSync(path.join(dir, "index.html"), "<html><head></head><body></body></html>");
  fs.writeFileSync(path.join(dir, "js", "rmmz_core.js"), "");
  fs.writeFileSync(path.join(dir, "js", "plugins.js"), "var $plugins = [];");
  fs.writeFileSync(path.join(dir, "data", "System.json"), JSON.stringify({ gameTitle: "Demo", advanced: { gameId: 1 } }));
  for (const [rel, text] of Object.entries(extra)) fs.writeFileSync(path.join(dir, rel), text);
  return dir;
}

const snapshot = (dir) => fs.readdirSync(dir, { recursive: true }).sort().map((f) => `${f}:${fs.statSync(path.join(dir, f)).mtimeMs}`);

test("args: analyze, doctor and deploy --dry-run", () => {
  for (const name of ["analyze", "doctor"]) assert.ok(COMMANDS.some((c) => c.name === name), name);
  assert.deepEqual([parse(["analyze", "g"]).spec.name, parse(["analyze", "g"]).target], ["analyze", "g"]);
  assert.equal(parse(["analyze"]).target, undefined, "no target: the current folder, decided by the CLI");
  assert.equal(parse(["doctor"]).spec.targets.length, 0);
  const dry = parse(["deploy", "--dry-run", "g"]);
  assert.deepEqual([dry.spec.name, dry.target, dry.flags.dryRun], ["deploy", "g", true]);
  assert.equal(parse(["deploy", "g"]).flags.dryRun, false);
  assert.match(commandHelp(dry.spec), /Usage:\n  rwk deploy <game folder> \[--dry-run\] \[flags\]/);
  assert.match(commandHelp(dry.spec), /--dry-run\s+Only check the game/);
  assert.throws(() => parse(["rename", "g", "--dry-run"]), (err) => err.exitCode === 64 && /Unknown option --dry-run/.test(err.message));
  assert.throws(() => parse(["status", "g", "--dry-run"]), (err) => err.exitCode === 64);
});

test("target: the current directory is the game when it holds one", () => {
  const game = makeGame();
  assert.equal(currentGameFolder({ cwd: game }), game);
  // A game folder with the files in www/ (MV deployments) counts too.
  const outer = fs.mkdtempSync(path.join(os.tmpdir(), "rwk-www-"));
  fs.renameSync(makeGame(), path.join(outer, "www"));
  assert.equal(currentGameFolder({ cwd: outer }), outer);
  assert.equal(currentGameFolder({ cwd: fs.mkdtempSync(path.join(os.tmpdir(), "rwk-empty-")) }), undefined);
  // Windows spells it Index.html / JS/: found regardless of case.
  const windows = fs.mkdtempSync(path.join(os.tmpdir(), "rwk-win-"));
  fs.mkdirSync(path.join(windows, "JS"));
  fs.writeFileSync(path.join(windows, "Index.html"), "");
  assert.equal(currentGameFolder({ cwd: windows }), windows);
});

test("analyze: the file count and the warnings, and the game folder stays untouched", async () => {
  process.env.RWK_LIMITS_URL = "off"; // no network: the bundled limits
  const game = makeGame({ "img/été.png": "x", "img/a.png": "yy" });
  const before = snapshot(game);
  warnings.length = 0;
  const result = await analyze(game);
  assert.deepEqual(snapshot(game), before, "nothing written in the game folder");
  assert.equal(result.dryRun, true);
  assert.deepEqual(result.game, { title: "Demo", engine: "MZ" });
  // index.html, js/rmmz_core.js, js/plugins.js, data/System.json, img/a.png, img/été.png
  assert.equal(result.build.files, 6);
  assert.equal(result.build.bytes, fs.statSync(path.join(game, "index.html")).size + fs.statSync(path.join(game, "js", "plugins.js")).size + fs.statSync(path.join(game, "data", "System.json")).size + 3);
  assert.deepEqual([result.build.r2Files, result.build.r2Uploaded], [0, 0]);
  assert.equal(warnings.length, 1);
  assert.match(warnings[0], /non-ASCII/);
  warnings.length = 0;
});

test("analyze: a folder that is not a game is an error, a missing one too", async () => {
  await assert.rejects(analyze(fs.mkdtempSync(path.join(os.tmpdir(), "rwk-none-"))), /No index\.html \+ js\//);
  await assert.rejects(analyze(path.join(os.tmpdir(), "rwk-does-not-exist-xyz")), /Folder not found/);
});

test("analyze: the summary says nothing was published", () => {
  const result = runResult("deploy", { dryRun: true, build: { files: 6, bytes: 10, r2Files: 0, r2Uploaded: 0 } }, []);
  assert.match(renderSummary(result), /checked, nothing published/);
  assert.match(stepSummary(result), /checked, nothing published/);
  assert.doesNotMatch(renderSummary(runResult("deploy", {}, [])), /nothing published/);
});

//---------------------------------------------------------------------------
// doctor
//---------------------------------------------------------------------------

const answers = (routes) => async (url) => {
  const route = url.replace("https://api.cloudflare.com/client/v4", "");
  const key = Object.keys(routes).find((k) => route.startsWith(k));
  const status = key ? routes[key] : 404;
  const result = route.startsWith("/accounts?") ? [{ id: "acc1", name: "Alice" }] : [];
  return Response.json({ success: status === 200, result, errors: [] }, { status });
};
const by = (checks, label) => checks.find((x) => x.label === label);

test("doctor: Node.js and wrangler come first, and a missing wrangler stops the checks", async () => {
  const old = await runChecks({ nodeVersion: "20.1.0", wranglerVersion: "4.1.0", getToken: async () => null });
  assert.equal(by(old, "Node.js").status, "fail");
  const none = await runChecks({ nodeVersion: "22.1.0", wranglerVersion: null, getToken: async () => assert.fail("no login check without wrangler") });
  assert.deepEqual(none.map((x) => [x.label, x.status]), [["Node.js", "ok"], ["wrangler", "fail"]]);
});

test("doctor: not logged in is a warning, not a failure", async () => {
  const checks = await runChecks({ nodeVersion: "22.1.0", wranglerVersion: "4.1.0", getToken: async () => null, fetchImpl: () => assert.fail("no request without a token") });
  assert.equal(by(checks, "Cloudflare login").status, "warn");
  assert.ok(!checks.some((x) => x.status === "fail"));
});

test("doctor: a token is probed for each permission and the missing ones are named", async () => {
  const urls = [];
  const fetchImpl = async (url, init) => {
    urls.push(url);
    assert.equal(init.headers.authorization, "Bearer tok");
    return answers({ "/accounts?": 200, "/user": 403, "/accounts/acc1/workers": 200, "/accounts/acc1/r2": 403, "/accounts/acc1/access/apps": 200, "/accounts/acc1/access/organizations": 403 })(url);
  };
  const checks = await runChecks({ nodeVersion: "22.1.0", wranglerVersion: "4.1.0", getToken: async () => "tok", usingEnvToken: true, accountId: "acc1", fetchImpl });
  assert.equal(by(checks, "Account").detail, "Alice (acc1)");
  assert.equal(by(checks, "Workers scripts").status, "ok");
  const r2 = by(checks, "R2 storage");
  assert.equal(r2.status, "fail");
  assert.match(r2.hint, /Workers R2 Storage → Edit/);
  assert.equal(by(checks, "User details").status, "warn", "optional permission: only a warning");
  assert.equal(by(checks, "Access applications").status, "ok");
  assert.equal(by(checks, "Access organization").status, "warn");
  assert.ok(urls.every((u) => u.startsWith("https://api.cloudflare.com/client/v4/")));
});

test("doctor: the browser login is not asked about Access, and an unreachable API is a failure", async () => {
  const fetchImpl = answers({ "/accounts?": 200, "/user": 200, "/accounts/acc1/workers": 200, "/accounts/acc1/r2": 200 });
  const checks = await runChecks({ nodeVersion: "22.1.0", wranglerVersion: "4.1.0", getToken: async () => "tok", usingEnvToken: false, accountId: "acc1", fetchImpl });
  assert.ok(!checks.some((x) => /Access/.test(x.label)));
  assert.ok(checks.every((x) => x.status === "ok"));

  const offline = await runChecks({ nodeVersion: "22.1.0", wranglerVersion: "4.1.0", getToken: async () => "tok", fetchImpl: async () => { throw new Error("getaddrinfo ENOTFOUND"); } });
  assert.equal(by(offline, "Cloudflare API").status, "fail");
});

test("doctor: a token set but not read is pointed out", async () => {
  const checks = await runChecks({ nodeVersion: "22.1.0", wranglerVersion: "4.1.0", getToken: async () => null, envTokenIgnored: true });
  assert.equal(by(checks, "CLOUDFLARE_API_TOKEN").status, "warn");
});
