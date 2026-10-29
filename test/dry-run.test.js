// analyze, deploy --dry-run, rename / saves import --dry-run, doctor and the current folder as the default target: all without Cloudflare.

import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { COMMANDS, commandHelp, parseCommandLine } from "../cli/lib/args.js";
import { analyze } from "../cli/commands/analyze.js";
import { formatMiB, showPolicy, tooManyFiles, warnMobileMedia } from "../cli/lib/build-checks.js";
import { doctor, runChecks } from "../cli/commands/doctor.js";
import { preview } from "../cli/commands/deploy.js";
import { analyzeGame } from "../cli/lib/game.js";
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
  assert.equal(parse(["rename", "g", "--to", "n", "--dry-run"]).flags.dryRun, true);
  assert.equal(parse(["saves", "import", "g", "--dry-run"]).flags.dryRun, true);
  assert.throws(() => parse(["upgrade", "g", "--dry-run"]), (err) => err.exitCode === 64 && /Unknown option --dry-run/.test(err.message));
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
// rename --dry-run and saves import --dry-run (after reading the configs in R2)
//---------------------------------------------------------------------------

function publishedGame(t, saves = []) {
  const dir = makeGame();
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  if (saves.length) {
    fs.mkdirSync(path.join(dir, "save"));
    for (const name of saves) fs.writeFileSync(path.join(dir, "save", name), "x");
  }
  const game = analyzeGame(dir);
  const cfg = { slug: "demo", url: "https://demo.alice.workers.dev", fingerprint: game.fingerprint, sync: { enabled: true }, auth: { mode: "access" } };
  return { dir, game, configs: { [game.fingerprint]: cfg, other: { slug: "taken", fingerprint: "other" } } };
}

test("rename --dry-run: checks the new name against the other games and changes nothing", async (t) => {
  const { dir, game, configs } = publishedGame(t);
  const before = JSON.stringify(configs);
  const result = await preview(game, null, configs, { inputPath: dir, rename: true, to: "new-demo" });
  assert.equal(result.dryRun, true);
  assert.equal(result.site, "demo", "still the old name");
  assert.deepEqual(result.facts, [["New name", "new-demo"]]);
  assert.match(result.next[0], /Nothing was changed\. To do it: rwk rename ".+" --to new-demo/);
  assert.equal(JSON.stringify(configs), before, "the config is not touched");
  assert.match(renderSummary(runResult("rename", result, [])), /demo: checked, nothing published/);

  await assert.rejects(preview(game, null, configs, { inputPath: dir, rename: true, to: "taken" }), /already used by another game/);
  await assert.rejects(preview(game, null, configs, { inputPath: dir, rename: true, to: "demo" }), /current name/);
  await assert.rejects(preview(game, null, {}, { inputPath: dir, rename: true, to: "x" }), (err) => /not published yet/.test(err.message) && /deploy --dry-run/.test(err.hint));
});

test("saves import --dry-run: the saves that would go up, or why none would", async (t) => {
  const { dir, game, configs } = publishedGame(t, ["file1.rmmzsave", "global.rmmzsave", "notes.txt"]);
  const files = snapshot(dir);
  const result = await preview(game, null, configs, { inputPath: dir });
  assert.deepEqual(result.facts, [["Saves", "2 would be uploaded"]]);
  assert.match(result.next[0], /To do it: rwk saves import ".+"$/);
  assert.deepEqual(snapshot(dir), files, "the game folder stays untouched");

  const off = await preview(game, null, { [game.fingerprint]: { ...configs[game.fingerprint], sync: { enabled: false } } }, { inputPath: dir });
  assert.deepEqual(off.facts, [["Saves", "none would be uploaded"]]);
  assert.equal(off.next[0], "Nothing was changed.");

  const empty = publishedGame(t);
  const none = await preview(empty.game, null, empty.configs, { inputPath: empty.dir });
  assert.deepEqual(none.facts, [["Saves", "none would be uploaded"]]);
});

//---------------------------------------------------------------------------
// doctor
//---------------------------------------------------------------------------

const answers = (routes) => async (url) => {
  const route = url.replace("https://api.cloudflare.com/client/v4", "");
  const key = Object.keys(routes).find((k) => route.startsWith(k));
  const status = key ? routes[key] : 404;
  const result = route.startsWith("/accounts?") ? [{ id: "acc1", name: "Alice" }] : route.endsWith("/workers/subdomain") ? { subdomain: "alice" } : [];
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

test("doctor: the workers.dev subdomain and the R2 bucket are looked at where the login may", async () => {
  const fetchImpl = answers({ "/accounts?": 200, "/user": 200, "/accounts/acc1/workers": 200, "/accounts/acc1/r2": 200 });
  const ready = await runChecks({ nodeVersion: "22.1.0", wranglerVersion: "4.1.0", getToken: async () => "tok", accountId: "acc1", fetchImpl });
  assert.equal(by(ready, "workers.dev subdomain").detail, "alice.workers.dev");
  assert.equal(by(ready, "R2 bucket").detail, "rpgmaker-web-toolkit found");

  const urls = [];
  const fresh = await runChecks({
    nodeVersion: "22.1.0",
    wranglerVersion: "4.1.0",
    getToken: async () => "tok",
    accountId: "acc1",
    fetchImpl: async (url) => {
      urls.push(url);
      if (url.endsWith("/workers/subdomain")) return Response.json({ success: false, result: null, errors: [{ code: 10007, message: "no subdomain" }] }, { status: 404 });
      if (url.endsWith("/r2/buckets/rpgmaker-web-toolkit")) return Response.json({ success: false, result: null, errors: [{ code: 10006, message: "The specified bucket does not exist." }] }, { status: 404 });
      return answers({ "/accounts?": 200, "/user": 200, "/accounts/acc1/workers": 200, "/accounts/acc1/r2": 200 })(url);
    },
  });
  const subdomain = by(fresh, "workers.dev subdomain");
  assert.equal(subdomain.status, "fail");
  assert.match(subdomain.hint, /Workers & Pages/);
  const bucket = by(fresh, "R2 bucket");
  assert.equal(bucket.status, "ok", "a missing bucket is made by the first deploy");
  assert.match(bucket.detail, /first deploy creates it/);
  assert.ok(urls.every((u) => !/\/r2\/buckets\/.+\/objects/.test(u)), "reads only the bucket, not its contents");

  const denied = await runChecks({ nodeVersion: "22.1.0", wranglerVersion: "4.1.0", getToken: async () => "tok", accountId: "acc1", fetchImpl: answers({ "/accounts?": 200, "/user": 200, "/accounts/acc1/workers": 403, "/accounts/acc1/r2": 403 }) });
  assert.ok(!by(denied, "workers.dev subdomain") && !by(denied, "R2 bucket"), "nothing asked of a denied permission");
});

test("doctor: R2 not enabled on the account is a failure that says where to switch it on", async () => {
  const off = Response.json.bind(Response, { success: false, result: null, errors: [{ code: 10042, message: "Please enable R2 through the Cloudflare Dashboard." }] }, { status: 403 });
  const checks = await runChecks({
    nodeVersion: "22.1.0",
    wranglerVersion: "4.1.0",
    getToken: async () => "tok",
    accountId: "acc1",
    fetchImpl: async (url) => (url.endsWith("/r2/buckets") ? off() : answers({ "/accounts?": 200, "/user": 200, "/accounts/acc1/workers": 200 })(url)),
  });
  const r2 = by(checks, "R2 storage");
  assert.equal(r2.status, "fail");
  assert.match(r2.detail, /not enabled/);
  assert.match(r2.hint, /dash\.cloudflare\.com\/acc1\/r2\/overview/);
  assert.ok(!by(checks, "R2 bucket"));
});

test("doctor: a token set but not read is pointed out", async () => {
  const checks = await runChecks({ nodeVersion: "22.1.0", wranglerVersion: "4.1.0", getToken: async () => null, envTokenIgnored: true });
  assert.equal(by(checks, "CLOUDFLARE_API_TOKEN").status, "warn");
});

const base = { nodeVersion: "22.1.0", wranglerVersion: "4.1.0" };
const respond = (status, result, success = status === 200) => async () => Response.json({ success, result, errors: [] }, { status });

test("doctor: a login that cannot be read, or that reaches no account, is a failure", async () => {
  const broken = await runChecks({ ...base, getToken: async () => { throw new Error("corrupt"); } });
  assert.match(by(broken, "Cloudflare login").detail, /corrupt/);
  assert.equal(by(broken, "Cloudflare login").status, "fail");

  const denied = await runChecks({ ...base, getToken: async () => "tok", usingEnvToken: true, fetchImpl: respond(403, []) });
  assert.match(by(denied, "Account").hint, /Account Settings/);
  const expired = await runChecks({ ...base, getToken: async () => "tok", fetchImpl: respond(401, []) });
  assert.match(by(expired, "Account").hint, /log in again/);

  const empty = await runChecks({ ...base, getToken: async () => "tok", fetchImpl: respond(200, []) });
  assert.equal(by(empty, "Account").status, "fail");
});

test("doctor: several accounts and none chosen is a warning, and odd answers are 'could not tell'", async () => {
  const two = [{ id: "a1", name: "One" }, { id: "a2", name: "Two" }];
  const fetchImpl = async (url) => {
    if (url.includes("/accounts?")) return Response.json({ success: true, result: two });
    if (url.endsWith("/user")) return new Response("oops", { status: 500 });
    if (url.includes("/access/apps")) return Response.json({ success: false, result: null }, { status: 400 });
    return Response.json({ success: true, result: [] });
  };
  const checks = await runChecks({ ...base, getToken: async () => "tok", usingEnvToken: true, accountId: "nope", fetchImpl });
  const warn = checks.filter((x) => x.label === "Account");
  assert.equal(warn[0].status, "warn");
  assert.match(warn[0].detail, /One, Two/);
  assert.equal(by(checks, "User details").status, "warn");
  assert.match(by(checks, "User details").detail, /could not tell/);
  assert.match(by(checks, "Access applications").detail, /no Zero Trust team/);
});

test("doctor: the result counts the passed checks, and a failed one stops with its hint", async () => {
  const ok = { status: "ok", label: "Node.js", detail: "22.1.0", hint: null };
  const warn = { status: "warn", label: "Cloudflare login", detail: "not logged in", hint: "Log in" };
  const result = await doctor({ run: async () => [ok, warn] });
  assert.deepEqual(result.facts, [["Checks", "1 of 2 passed"]]);

  const fail = { status: "fail", label: "wrangler", detail: "not installed", hint: "Run npm ci" };
  await assert.rejects(doctor({ run: async () => [ok, fail] }), (err) => /1 check\(s\) failed: wrangler/.test(err.message) && err.hint === "Run npm ci");
});

//---------------------------------------------------------------------------
// The checks deploy and analyze share
//---------------------------------------------------------------------------

test("build checks: sizes, the file-count error and the mobile media warnings", () => {
  assert.equal(formatMiB(25 * 1024 ** 2), "25 MiB");
  assert.equal(formatMiB(1.5 * 1024 ** 2), "1.5 MiB");

  const err = tooManyFiles([{ rel: "img/a.png" }, { rel: "img/b.png" }, { rel: "audio/c.ogg" }], 3, 2);
  assert.match(err.message, /3 files, over the Workers limit of 2/);
  assert.ok(err.message.indexOf("img: 2") < err.message.indexOf("audio: 1"), "the biggest folder first");

  warnings.length = 0;
  warnMobileMedia([{ rel: "audio/bgm/Theme.ogg" }, { rel: "movies/Intro.webm" }, { rel: "audio/bgm/Ok.ogg" }, { rel: "audio/bgm/Ok.m4a" }]);
  assert.equal(warnings.length, 2);
  assert.match(warnings[0], /1 audio file\(s\) have no \.m4a/);
  assert.match(warnings[1], /1 movie\(s\) have no \.mp4/);
  warnings.length = 0;
});

test("build checks: the hosting policy is shown, problems warned about, and 'none' stops", () => {
  warnings.length = 0;
  assert.equal(showPolicy(null), undefined);
  showPolicy({ file: "/g/rwk-policy.json", hosting: "shared", problems: ["unknown key"], message: "Hi", contact: "me@x", features: { cheats: false } });
  assert.match(warnings[0], /unknown key/);
  assert.throws(() => showPolicy({ file: "/g/rwk-policy.json", hosting: "none", problems: [], features: {} }), /does not allow publishing/);
  warnings.length = 0;
});
