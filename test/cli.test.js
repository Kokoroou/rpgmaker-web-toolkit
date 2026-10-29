import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { test } from "node:test";
import LZString from "lz-string";
import { overflowRoutes, retitleMvGlobal, writeWorkerProject } from "../cli/lib/cloudflare.js";
import { WORKERS_API, checkWorkersApi, deployKeepingAssets, keepAssetsPatch } from "../cli/lib/workers-api.js";
import { compileGlobs, findGameBySite, mobileOnlyMissing, nonAsciiPaths, siteNameFromLink, storageIdOf, suggestSlug, takenNames, validateSlug } from "../cli/lib/game.js";
import { BUNDLED_LIMITS_FILE, loadLimits, parseLimits } from "../cli/lib/limits.js";
import { cleanHint, gamepadKeys, pluginHint, scanKeys, stripComments } from "../cli/lib/keys.js";
import { allowsPublic, applyPolicy, isIndexable, parsePolicy, readPolicy } from "../cli/lib/policy.js";
import { LIVE_KEYS, keysNeedingDeploy, liveSettingsOf } from "../cli/lib/stage.js";
import { RUNTIME_PLUGINS, generatedFiles, runtimeConfigOf, serviceWorkerSource, runtimeSources, backlogConfig, remapConfig, saveHistoryConfig, syncPublicDir, fastForwardConfig, messageModeConfig, alwaysDashConfig, saveToolsConfig, cheatsConfig, playerOverrides } from "../cli/lib/stage.js";
import { checkFeatureConfig, withPlayer, withPreset } from "../cli/lib/features.js";
import { userHash } from "../cli/lib/cloudflare.js";
import { splitToolkit } from "../worker/toolkit.js";
import { publishedEntry } from "../cli/commands/upgrade.js";
import { log, warnings } from "../cli/lib/ui.js";

const tmp = () => fs.mkdtempSync(path.join(os.tmpdir(), "rwk-test-"));

test("globs", () => {
  const m = compileGlobs(["**/.*", "**/*.zip", "data-tw/**", "Thumbs.db"]);
  assert.ok(m(".DS_Store"));
  assert.ok(m("js/.DS_Store"));
  assert.ok(m("img/menu/newPictures.zip"));
  assert.ok(m("data-tw/Map001.json"));
  assert.ok(m("img/Thumbs.db"));
  assert.ok(!m("img/menu/a.png"));
  assert.ok(!m("data/Map001.json"));
});

test("slug suggestion and validation", () => {
  assert.equal(
    suggestSlug({ folderName: "Sample Quest of the Moon  v1.292 VH (Team01)", title: "示例游戏" }),
    "sample-quest-of-the-moon"
  );
  assert.equal(suggestSlug({ folderName: "Ký Sự Đường Xa [Việt hóa]", title: "" }), "ky-su-duong-xa");
  assert.equal(validateSlug("ok-name-1"), null);
  assert.ok(validateSlug("-bad"));
  assert.ok(validateSlug("Bad"));
});

test("overflow routes: exact, folder fallback, everything", () => {
  assert.deepEqual(overflowRoutes([]), ["/api/*"]);
  assert.deepEqual(overflowRoutes(["img/parallaxes/A.png_"]), ["/api/*", "/img/parallaxes/A.png_"]);
  const cjk = overflowRoutes(["img/p/大图.png_"]);
  assert.ok(cjk.includes("/img/p/大图.png_") && cjk.includes("/img/p/%E5%A4%A7%E5%9B%BE.png_"));
  const many = Array.from({ length: 120 }, (_, i) => `img/parallaxes/f${i}.png_`);
  assert.deepEqual(overflowRoutes(many), ["/api/*", "/img/parallaxes/*"]);
  assert.equal(overflowRoutes(["root-file.bin".repeat(1)].concat(many.map((m) => m.replace("img/parallaxes/", "")))), true);
});

test("scanKeys reads only enabled plugins and skips touch-covered keys", () => {
  const root = tmp();
  fs.mkdirSync(path.join(root, "js", "plugins"), { recursive: true });
  fs.writeFileSync(
    path.join(root, "js", "plugins.js"),
    `var $plugins =\n[\n{"name":"A","status":true,"description":"[v1.2] Quest journal","parameters":{}},\n{"name":"B","status":false,"description":"","parameters":{}}\n];\n`
  );
  fs.writeFileSync(
    path.join(root, "js", "plugins", "A.js"),
    `if (Input.isTriggered('r')) {}\nInput.keyMapper[84] = 't';\n// Input.isTriggered('x')\nif (Input.isPressed("ok")) {}\nif (Input.isRepeated('pagedown')) {}`
  );
  fs.writeFileSync(path.join(root, "js", "plugins", "B.js"), `Input.isTriggered('z')`);
  assert.deepEqual(scanKeys(root).map((k) => k.key).sort(), ["pagedown", "r", "t"]);
  assert.equal(scanKeys(root)[0].hint, "Quest journal");
  assert.equal(pluginHint({ name: "MiniMap", description: "" }), "MiniMap");
  assert.equal(cleanHint("v1.0.0 FlyCat-<快捷键提示>"), "快捷键提示");
  assert.equal(cleanHint("Shows a <b>bold</b> hint"), "Shows a <b>bold</b> hint");
  assert.equal(stripComments('a = "http://x"; // note').trim(), 'a = "http://x";');
});

test("syncPublicDir never writes through hard links into the game folder", () => {
  const src = tmp();
  const pub = path.join(tmp(), "public");
  const file = (rel, content) => {
    const abs = path.join(src, ...rel.split("/"));
    fs.mkdirSync(path.dirname(abs), { recursive: true });
    fs.writeFileSync(abs, content);
    const st = fs.statSync(abs);
    return { rel, abs, size: st.size, mtimeMs: Math.floor(st.mtimeMs) };
  };
  const files = [file("js/plugins.js", "ORIGINAL"), file("img/a.png", "AAA"), file("img/b.png", "BBB")];

  let stats = syncPublicDir(pub, files, new Map([["js/plugins.js", "PATCHED"]]));
  assert.equal(stats.linked + stats.copied, 2);
  assert.equal(fs.readFileSync(path.join(src, "js", "plugins.js"), "utf8"), "ORIGINAL");
  assert.equal(fs.readFileSync(path.join(pub, "js", "plugins.js"), "utf8"), "PATCHED");

  // Second run: unchanged files are skipped, removed files disappear,
  // and a file that was linked before then becomes generated stays safe.
  stats = syncPublicDir(pub, files.slice(0, 2), new Map([["js/plugins.js", "PATCHED"], ["img/a.png", "GEN"]]));
  assert.equal(stats.removed, 1);
  assert.equal(fs.readFileSync(path.join(src, "img", "a.png"), "utf8"), "AAA");
  assert.equal(fs.readFileSync(path.join(pub, "img", "a.png"), "utf8"), "GEN");
  assert.ok(!fs.existsSync(path.join(pub, "img", "b.png")));
});

test("creator policy: parsing, strict fallback, feature locks", () => {
  const p = parsePolicy({ hosting: "shared", features: { saveTools: false, itemBatch: true, translate: false }, message: " Hi " });
  assert.equal(p.hosting, "shared");
  assert.deepEqual(p.features, { saveTools: false });
  assert.equal(p.message, "Hi");
  assert.deepEqual(p.problems, []);
  assert.equal(parsePolicy({ hosting: "everyone" }).hosting, "personal");
  assert.equal(parsePolicy({}).problems.length, 1);

  const cfg = { slug: "g", sync: { enabled: true }, saveTools: true };
  const locked = applyPolicy(cfg, parsePolicy({ hosting: "personal", features: { saveTools: false, fastForward: false, messageMode: false, alwaysDash: false, backlog: false, remap: false, quickSave: false, autoSave: false, cheats: false, sync: false } }));
  assert.equal(locked.saveTools, false);
  assert.equal(locked.fastForward, false);
  assert.equal(locked.messageMode, false);
  assert.equal(locked.alwaysDash, false);
  assert.equal(locked.backlog, false);
  assert.equal(locked.remap, false);
  assert.equal(locked.quickSave, false);
  assert.equal(locked.autoSave, false);
  assert.equal(locked.cheats, false);
  assert.equal(locked.sync.enabled, false);
  assert.equal(cfg.sync.enabled, true, "the stored config is left alone");
  assert.equal(applyPolicy(cfg, null), cfg);

  assert.ok(allowsPublic(null));
  assert.ok(allowsPublic(parsePolicy({ hosting: "public" })));
  assert.ok(!allowsPublic(parsePolicy({ hosting: "shared" })));
});

test("readPolicy looks in the web root and the game folder", () => {
  const folder = tmp();
  const root = path.join(folder, "www");
  fs.mkdirSync(root);
  assert.equal(readPolicy({ folder, root }), null);
  fs.writeFileSync(path.join(folder, "rwk-policy.json"), '{"hosting":"none"}');
  assert.equal(readPolicy({ folder, root }).hosting, "none");
  fs.writeFileSync(path.join(root, "rwk-policy.json"), "{not json");
  const bad = readPolicy({ folder, root });
  assert.equal(bad.hosting, "personal");
  assert.equal(bad.problems.length, 1);
});

test("web build: search engines are kept out unless a public site asks to be listed", () => {
  const root = tmp();
  fs.mkdirSync(path.join(root, "js"));
  fs.writeFileSync(path.join(root, "js", "plugins.js"), "var $plugins = [];\n");
  fs.writeFileSync(path.join(root, "index.html"), "<html><head><title>G</title></head><body></body></html>");
  const game = { root, engine: "MZ", title: "G" };
  const cfg = { slug: "g", sync: { enabled: false } };

  let out = generatedFiles(game, cfg);
  assert.match(out.get("index.html"), /name="generator" content="rpgmaker-web-toolkit"/);
  assert.match(out.get("index.html"), /name="robots" content="noindex, nofollow"/);
  assert.match(out.get("_headers"), /X-Robots-Tag: noindex/);
  assert.match(out.get("robots.txt"), /Disallow: \//);

  // Public without a stated reason is never listed.
  assert.ok(!isIndexable({ ...cfg, auth: { mode: "none" }, indexable: true }));
  out = generatedFiles(game, { ...cfg, auth: { mode: "none", basis: "author" }, indexable: true });
  assert.doesNotMatch(out.get("index.html"), /name="robots"/);
  assert.ok(!out.has("_headers"));
  assert.match(out.get("robots.txt"), /Allow: \//);
});

test("free plan limits: newest valid copy wins, offline falls back", async () => {
  const dir = tmp();
  const bundledFile = path.join(dir, "bundled.json");
  const cacheFile = path.join(dir, "cache", "limits.json");
  const write = (file, updated, assets) => fs.writeFileSync(file, JSON.stringify({ updated, assets }));
  write(bundledFile, "2026-01-01", { maxFiles: 20000, maxFileBytes: 25 * 1024 ** 2 });
  const serve = (body, ok = true) => async () => ({ ok, json: async () => body });
  const offline = async () => {
    throw new Error("offline");
  };

  // Shipped file is valid and the CLI falls back to it with no network.
  const shipped = await loadLimits({ url: "off" });
  assert.equal(shipped.from, "bundled");
  assert.ok(parseLimits(JSON.parse(fs.readFileSync(BUNDLED_LIMITS_FILE, "utf8"))));

  let res = await loadLimits({ bundledFile, cacheFile, fetchFn: offline });
  assert.deepEqual([res.from, res.newer, res.assets.maxFiles], ["bundled", false, 20000]);

  // A newer copy on main is used and cached; extra fields are dropped.
  const remote = { updated: "2026-06-01", extra: 1, assets: { maxFiles: 15000, maxFileBytes: 10 * 1024 ** 2, other: 2 } };
  res = await loadLimits({ bundledFile, cacheFile, fetchFn: serve(remote) });
  assert.deepEqual([res.from, res.newer, res.assets], ["remote", true, { maxFiles: 15000, maxFileBytes: 10 * 1024 ** 2 }]);
  assert.equal(JSON.parse(fs.readFileSync(cacheFile, "utf8")).updated, "2026-06-01");

  // Offline later: the cache still beats the older bundled file.
  res = await loadLimits({ bundledFile, cacheFile, fetchFn: serve(null, false) });
  assert.deepEqual([res.from, res.assets.maxFiles], ["cache", 15000]);

  // A bundled file newer than the cache wins (e.g. a newer toolkit).
  write(bundledFile, "2026-09-01", { maxFiles: 30000, maxFileBytes: 25 * 1024 ** 2 });
  res = await loadLimits({ bundledFile, cacheFile, fetchFn: offline });
  assert.deepEqual([res.from, res.newer, res.assets.maxFiles], ["bundled", false, 30000]);

  // Broken remote values are ignored.
  for (const bad of [{ updated: "2027-01-01", assets: { maxFiles: 0, maxFileBytes: 1 } }, { updated: "soon", assets: {} }, "nope"]) {
    res = await loadLimits({ bundledFile, fetchFn: serve(bad) });
    assert.equal(res.from, "bundled");
  }
  assert.equal(parseLimits({ updated: "2026-01-01", assets: { maxFiles: 1.5, maxFileBytes: 25 * 1024 ** 2 } }), null);
  await assert.rejects(loadLimits({ bundledFile: path.join(dir, "missing.json"), url: "off" }), /Invalid limits file/);
});

test("analyze: non-ASCII file names", () => {
  const files = ["img/pictures/大图.png", "audio/se/Cursor.ogg", "audio/bgm/Café.ogg", "index.html"].map((rel) => ({ rel }));
  assert.deepEqual(nonAsciiPaths(files), ["img/pictures/大图.png", "audio/bgm/Café.ogg"]);
});

test("warnings are kept for the build report", (t) => {
  t.mock.method(console, "log", () => {});
  const before = warnings.length;
  log.warn("first");
  log.info("not a warning");
  log.warn("second");
  assert.deepEqual(warnings.slice(before), ["first", "second"]);
});

test("MV phone media: Ogg / WebM without an .m4a / .mp4 twin", () => {
  const files = [
    "audio/bgm/Town.ogg",
    "audio/bgm/Town.m4a",
    "audio/se/Cursor.rpgmvo",
    "audio/se/Cursor.rpgmvm",
    "audio/me/Fanfare.ogg",
    "Audio/bgs/Rain.rpgmvo",
    "img/pictures/notaudio.ogg",
    "movies/Intro.webm",
    "movies/Intro.mp4",
  ].map((rel) => ({ rel }));
  assert.deepEqual(mobileOnlyMissing(files), { audio: 2, movies: 0 });
  assert.deepEqual(mobileOnlyMissing([{ rel: "movies/End.webm" }]), { audio: 0, movies: 1 });

  const root = tmp();
  fs.mkdirSync(path.join(root, "js"));
  fs.writeFileSync(path.join(root, "js", "plugins.js"), "var $plugins = [];\n");
  fs.writeFileSync(path.join(root, "index.html"), "<html><head></head><body></body></html>");
  const runtimeConfig = (engine) => {
    const js = generatedFiles({ root, engine, title: "G" }, { slug: "g", sync: {} }, files).get("js/plugins.js");
    return JSON.parse(JSON.parse(/\$plugins\.push\((\{"name":"RWK_Core".*\})\);/.exec(js)[1]).parameters.config);
  };
  assert.deepEqual(runtimeConfig("MV").media, { oggOnly: true, webmOnly: false });
  assert.equal(runtimeConfig("MZ").media, undefined, "MZ decodes Ogg itself");
});

test("web build: runtime plugins and the toolkit version for the problem report", () => {
  const root = tmp();
  fs.mkdirSync(path.join(root, "js"));
  fs.writeFileSync(path.join(root, "js", "plugins.js"), "var $plugins = [];\n");
  fs.writeFileSync(path.join(root, "index.html"), "<html><head></head><body></body></html>");
  const out = generatedFiles({ root, engine: "MZ", title: "G" }, { slug: "g", sync: {} });
  assert.ok(out.has("js/plugins/RWK_Report.js"));
  assert.ok(out.has("js/plugins/RWK_Speed.js"));
  assert.ok(out.has("js/plugins/RWK_Message.js"));
  assert.ok(out.has("js/plugins/RWK_Dash.js"));
  assert.ok(out.has("js/plugins/RWK_Backlog.js"));
  assert.ok(out.has("js/plugins/RWK_Remap.js"));
  assert.ok(out.has("js/plugins/RWK_SafeSaves.js"));
  assert.ok(out.has("js/plugins/RWK_SaveHistory.js"));
  const js = out.get("js/plugins.js");
  const core = JSON.parse(/\$plugins\.push\((\{"name":"RWK_Core".*\})\);/.exec(js)[1]);
  const pkg = JSON.parse(fs.readFileSync(new URL("../package.json", import.meta.url), "utf8"));
  assert.equal(JSON.parse(core.parameters.config).version, pkg.version);
});

test("web build: quick save and autosave settings", () => {
  const root = tmp();
  fs.mkdirSync(path.join(root, "js"));
  fs.writeFileSync(path.join(root, "js", "plugins.js"), "var $plugins = [];\n");
  fs.writeFileSync(path.join(root, "index.html"), "<html><head></head><body></body></html>");
  const runtimeConfig = (extra) => {
    const js = generatedFiles({ root, engine: "MZ", title: "G" }, { slug: "g", sync: {}, ...extra }).get("js/plugins.js");
    return JSON.parse(JSON.parse(/\$plugins\.push\((\{"name":"RWK_Core".*\})\);/.exec(js)[1]).parameters.config);
  };
  const defaults = runtimeConfig({});
  assert.deepEqual(defaults.quickSave, { ignoreSaveLock: true });
  assert.deepEqual(defaults.autoSave, { minutes: 5 });
  const off = runtimeConfig({ quickSave: false, autoSave: false });
  assert.equal(off.quickSave, false);
  assert.equal(off.autoSave, false);
  assert.deepEqual(runtimeConfig({ quickSave: { ignoreSaveLock: false } }).quickSave, { ignoreSaveLock: false });
  assert.deepEqual(runtimeConfig({ autoSave: { minutes: 10 } }).autoSave, { minutes: 10 });
  assert.deepEqual(runtimeConfig({ autoSave: { minutes: 999 } }).autoSave, { minutes: 60 });
  assert.deepEqual(runtimeConfig({ autoSave: { minutes: "x" } }).autoSave, { minutes: 5 });
});

test("backlog settings reach the plugin", () => {
  assert.deepEqual(backlogConfig(undefined), { max: 100 });
  assert.deepEqual(backlogConfig(true), { max: 100 });
  assert.equal(backlogConfig(false), false);
  assert.deepEqual(backlogConfig(250), { max: 250 });
  assert.deepEqual(backlogConfig({ max: 30 }), { max: 30 });
  assert.deepEqual(backlogConfig({ max: 99999 }), { max: 500 });
  assert.deepEqual(backlogConfig({ max: 2 }), { max: 100 });
  assert.deepEqual(backlogConfig("x"), { max: 100 });
  assert.deepEqual(runtimeConfigOf("MV", { slug: "g" }).backlog, { max: 100 });
  assert.equal(runtimeConfigOf("MV", { slug: "g", backlog: false }).backlog, false);
});

test("remap settings reach the plugin", () => {
  assert.deepEqual(remapConfig(undefined), { keyboard: true, gamepad: true });
  assert.deepEqual(remapConfig(true), { keyboard: true, gamepad: true });
  assert.equal(remapConfig(false), false);
  assert.deepEqual(remapConfig({ gamepad: false }), { keyboard: true, gamepad: false });
  assert.equal(remapConfig({ keyboard: false, gamepad: false }), false);
  assert.deepEqual(runtimeConfigOf("MZ", { slug: "g" }).remap, { keyboard: true, gamepad: true });
  assert.equal(runtimeConfigOf("MZ", { slug: "g", remap: false }).remap, false);
});

test("save history settings reach the plugin and the Worker", () => {
  assert.deepEqual(saveHistoryConfig(undefined), { keep: 10, days: 30 });
  assert.deepEqual(saveHistoryConfig(true), { keep: 10, days: 30 });
  assert.equal(saveHistoryConfig(false), false);
  assert.deepEqual(saveHistoryConfig({ keep: 3 }), { keep: 3, days: 30 });
  assert.deepEqual(saveHistoryConfig({ keep: 500, days: 9999 }), { keep: 50, days: 365 });
  assert.deepEqual(saveHistoryConfig({ keep: 0, days: "x" }), { keep: 10, days: 30 });

  const root = tmp();
  fs.mkdirSync(path.join(root, "js"));
  fs.writeFileSync(path.join(root, "js", "plugins.js"), "var $plugins = [];\n");
  fs.writeFileSync(path.join(root, "index.html"), "<html><head></head><body></body></html>");
  const js = generatedFiles({ root, engine: "MZ", title: "G" }, { slug: "g", sync: {}, saveHistory: { keep: 5 } }).get("js/plugins.js");
  const runtime = JSON.parse(JSON.parse(/\$plugins\.push\((\{"name":"RWK_Core".*\})\);/.exec(js)[1]).parameters.config);
  assert.deepEqual(runtime.saveHistory, { keep: 5, days: 30 });

  const vars = (saveHistory) => {
    const buildDir = tmp();
    const project = { buildDir, slug: "g", bucket: "b", overflowRels: [], auth: {}, locked: false, saveHistory };
    const file = writeWorkerProject({ ...project, toolkitRoot: path.join(import.meta.dirname, "..") });
    return JSON.parse(fs.readFileSync(file, "utf8")).vars;
  };
  assert.equal(vars({ keep: 5, days: 30 }).RWK_SAVE_HISTORY, '{"keep":5,"days":30}');
  assert.equal(vars(false).RWK_SAVE_HISTORY, "off");
});

test("save import: MV saves made under an older game title get the current one", () => {
  const slot = (title) => ({ globalId: "RPGMV", title, playtime: "08:11:17", timestamp: 1612715447909 });
  const text = LZString.compressToBase64(JSON.stringify([null, slot("Game v1.05"), slot("Game v1.07"), null]));
  const { text: out, fixed } = retitleMvGlobal(text, "Game v1.07");
  assert.equal(fixed, 1);
  assert.deepEqual(JSON.parse(LZString.decompressFromBase64(out)), [null, slot("Game v1.07"), slot("Game v1.07"), null]);

  assert.deepEqual(retitleMvGlobal(out, "Game v1.07"), { text: out, fixed: 0 }, "already right: sent as is");
  assert.deepEqual(retitleMvGlobal("not a save", "Game"), { text: "not a save", fixed: 0 });
});

test("rename: a new Worker name, the same storage", () => {
  const renamed = { slug: "new-name", storageId: "old-name", sync: {} };
  assert.equal(storageIdOf(renamed), "old-name");
  assert.equal(storageIdOf({ slug: "never-renamed" }), "never-renamed");

  const buildDir = tmp();
  const project = { buildDir, slug: renamed.slug, gameId: storageIdOf(renamed), bucket: "b", overflowRels: [], auth: {}, locked: false };
  const config = JSON.parse(fs.readFileSync(writeWorkerProject({ ...project, toolkitRoot: path.join(import.meta.dirname, "..") }), "utf8"));
  assert.equal(config.name, "new-name");
  assert.equal(config.vars.GAME_ID, "old-name", "saves and large files stay where they are");

  const root = tmp();
  fs.mkdirSync(path.join(root, "js"));
  fs.writeFileSync(path.join(root, "js", "plugins.js"), "var $plugins = [];\n");
  fs.writeFileSync(path.join(root, "index.html"), "<html><head></head><body></body></html>");
  const js = generatedFiles({ root, engine: "MZ", title: "G" }, renamed).get("js/plugins.js");
  const runtime = JSON.parse(JSON.parse(/\$plugins\.push\((\{"name":"RWK_Core".*\})\);/.exec(js)[1]).parameters.config);
  assert.equal(runtime.gameId, "old-name");

  const configs = {
    "mv:A": { slug: "a-new", storageId: "a", retiredWorkers: ["a"] },
    "mv:B": { slug: "b" },
  };
  assert.deepEqual([...takenNames(configs, "mv:B")].sort(), ["a", "a-new"]);
  assert.deepEqual([...takenNames(configs, "mv:A")], ["b"], "a game may go back to its own old name");
});

test("upgrade: which game a link names", () => {
  assert.equal(siteNameFromLink("https://my-game.alice.workers.dev/"), "my-game");
  assert.equal(siteNameFromLink(' "my-game.alice.workers.dev/index.html" '), "my-game");
  assert.equal(siteNameFromLink("HTTPS://My-Game.Alice.Workers.Dev"), "my-game");
  for (const bad of ["D:\\Games\\My Game", "https://example.com", "https://a.b.c.workers.dev", "https://-x.alice.workers.dev", "http://"]) {
    assert.throws(() => siteNameFromLink(bad), /Not a game link/, bad);
  }

  const configs = { "mz:1": { slug: "new-name", storageId: "old-name", retiredWorkers: ["old-name"], url: "https://new-name.alice.workers.dev" }, "mv:B": { slug: "b" } };
  assert.equal(findGameBySite(configs, "b")[0], "mv:B");
  assert.throws(() => findGameBySite(configs, "old-name"), /old name of "new-name".*https:\/\/new-name/);
  assert.throws(() => findGameBySite(configs, "zzz"), /Games in this account: b, new-name/);
  assert.throws(() => findGameBySite({}, "zzz"), /no games yet/);
});

test("upgrade: which game a folder names", () => {
  const configs = { "mz:1": { slug: "my-game" }, "mv:B": { slug: "b" } };
  assert.deepEqual(publishedEntry(configs, { fingerprint: "mz:1" }, "D:\\Games\\G"), ["mz:1", { slug: "my-game" }]);
  assert.throws(
    () => publishedEntry(configs, { fingerprint: "mz:2" }, "D:\\Games\\G"),
    (err) => /not published yet/.test(err.message) && err.hint === 'Publish it first: rwk deploy "D:\\Games\\G"'
  );
});

test("upgrade: the Worker patch keeps the deployed files", async () => {
  const toolkit = { names: RUNTIME_PLUGINS, plugins: runtimeSources(), config: runtimeConfigOf("MV", { slug: "g", storageId: "first", sync: { enabled: true } }), keepOff: false };
  assert.equal(toolkit.config.gameId, "first");
  assert.equal(toolkit.config.media, undefined, "taken from the deployed build by the Worker");
  const patch = keepAssetsPatch({
    slug: "g",
    gameId: "first",
    bucket: "b",
    overflowRels: ["movies/big.webm"],
    auth: { mode: "access", teamDomain: "t.cloudflareaccess.com", aud: "abc" },
    toolkitRoot: path.join(import.meta.dirname, ".."),
    saveHistory: { keep: 5, days: 30 },
    playerSettings: { abc: { fastForward: false } },
    toolkit,
  });
  assert.equal(patch.main_module, "worker.js");
  assert.equal(patch.assets.jwt, undefined, "no new files: the deployed ones carry over");
  const vars = Object.fromEntries(patch.bindings.filter((b) => b.type === "plain_text").map((b) => [b.name, b.text]));
  assert.deepEqual(vars, {
    GAME_ID: "first",
    AUTH_MODE: "access",
    ACCESS_TEAM_DOMAIN: "t.cloudflareaccess.com",
    ACCESS_AUD: "abc",
    RWK_LOCKED: "0",
    RWK_INDEXABLE: "0",
    RWK_SAVE_HISTORY: '{"keep":5,"days":30}',
  });
  assert.ok(patch.bindings.some((b) => b.type === "r2_bucket" && b.name === "BUCKET" && b.bucket_name === "b"));
  assert.ok(patch.bindings.some((b) => b.type === "assets" && b.name === "ASSETS"));
  const routes = patch.assets.config.run_worker_first;
  for (const r of ["/api/*", "/js/plugins.js", "/js/plugins/RWK_Core.js", "/movies/big.webm"]) assert.ok(routes.includes(r), r);

  const modules = new Map(patch.modules.map((m) => [m.name, m]));
  for (const name of ["worker.js", "rwk-overflow.js", "rwk-toolkit.js", "rwk-player-settings.js", "worker/index.js", "worker/auth.js", "worker/saves.js", "worker/players.js", "worker/toolkit.js"]) {
    assert.equal(modules.get(name)?.content_type, "application/javascript+module", name);
  }
  const source = (name) => Buffer.from(modules.get(name).content_base64, "base64").toString("utf8");
  // Uploaded unbundled: every relative import must name another module.
  for (const name of modules.keys()) {
    for (const [, spec] of source(name).matchAll(/^(?:import|export) .* from "(\.[^"]+)";$/gm)) {
      const target = path.posix.join(path.posix.dirname(name), spec);
      assert.ok(modules.has(target), `${name} imports ${spec}: no module "${target}"`);
    }
  }
  assert.equal(source("worker/toolkit.js"), fs.readFileSync(new URL("../worker/toolkit.js", import.meta.url), "utf8"));
  const { default: uploaded } = await import(`data:text/javascript,${encodeURIComponent(source("rwk-toolkit.js"))}`);
  assert.deepEqual(uploaded, toolkit);
  const { default: settings } = await import(`data:text/javascript,${encodeURIComponent(source("rwk-player-settings.js"))}`);
  assert.deepEqual(settings, { abc: { fastForward: false } });
});

test("upgrade: Workers API calls and their errors", async (t) => {
  const calls = [];
  let replies = [];
  t.mock.method(globalThis, "fetch", async (url, init) => {
    calls.push({ url, init });
    const [status, body, headers] = replies.shift();
    return new Response(JSON.stringify(body), { status, headers });
  });
  t.mock.method(console, "log", () => {});
  const patch = { main_module: "worker.js" };
  const run = () => deployKeepingAssets({ token: "tok", accountId: "acc", slug: "g", patch });

  replies = [
    [200, { success: true, result: {} }],
    [200, { success: true, result: {}, messages: [{ message: "fine" }] }, { deprecation: "true" }],
  ];
  warnings.length = 0;
  await run();
  assert.equal(calls[0].url, `${WORKERS_API.base}/accounts/acc/workers/workers/g`);
  assert.equal(calls[0].init.method, "GET");
  assert.equal(calls[0].init.body, undefined);
  assert.equal(calls[1].url, `${WORKERS_API.base}/accounts/acc/workers/workers/g/versions/latest?deploy=true`);
  assert.equal(calls[1].init.method, "PATCH");
  assert.deepEqual(JSON.parse(calls[1].init.body), patch);
  assert.equal(calls[1].init.headers["content-type"], "application/merge-patch+json");
  assert.equal(calls[1].init.headers.authorization, "Bearer tok");
  assert.match(warnings[0], /going away \(deprecation: true\).*checked against the Cloudflare API on/);
  warnings.length = 0;

  replies = [[404, { success: false, errors: [{ code: 10007, message: "workers.api.error.script_not_found" }] }]];
  await assert.rejects(run, /no Worker named "g"/);
  replies = [[500, "not json"]];
  await assert.rejects(run, /Could not read the Worker: HTTP 500/);
  replies = [
    [200, { success: true }],
    [400, { success: false, errors: [{ code: 10021, message: "Unknown field" }] }],
  ];
  await assert.rejects(run, (err) => /Could not update the Worker: Unknown field \[code: 10021\]/.test(err.message) && err.message.includes(WORKERS_API.checked));
  replies = [
    [200, { success: true }],
    [200, { success: false, errors: [{ message: "odd" }] }],
  ];
  await assert.rejects(run, /Could not update the Worker: odd\n/);
});

// A trimmed copy of the parts of Cloudflare's OpenAPI schema the patch relies on.
function workersSchema() {
  const prop = (properties) => ({ type: "object", properties });
  return {
    paths: {
      [WORKERS_API.worker]: { get: {} },
      [WORKERS_API.patchLatest]: {
        patch: {
          description: "Creates a new Worker version by applying a JSON Merge Patch (RFC 7396) to the latest version. Omitted fields are inherited from the latest version.",
          parameters: [{ $ref: "#/components/parameters/deploy" }],
          requestBody: {
            content: {
              "application/merge-patch+json": {
                schema: {
                  allOf: [
                    prop({ main_module: {}, compatibility_date: {}, bindings: {} }),
                    prop({
                      modules: { type: "array", items: prop({ name: {}, content_type: {}, content_base64: {} }) },
                      assets: { $ref: "#/components/schemas/assets" },
                    }),
                  ],
                },
              },
            },
          },
        },
      },
    },
    components: {
      parameters: { deploy: { name: "deploy", in: "query" } },
      schemas: {
        assets: prop({ config: prop({ not_found_handling: {}, run_worker_first: {} }), jwt: {} }),
        workers_binding_kind_plain_text: prop({ name: {}, type: {}, text: {} }),
        workers_binding_kind_r2_bucket: prop({ name: {}, type: {}, bucket_name: {} }),
        workers_binding_kind_assets: prop({ name: {}, type: {} }),
      },
    },
  };
}

test("upgrade: noticing Workers API changes in Cloudflare's schema", () => {
  assert.deepEqual(checkWorkersApi(workersSchema()), []);
  assert.match(WORKERS_API.checked, /^\d{4}-\d{2}-\d{2}$/);

  const broken = (change) => {
    const schema = workersSchema();
    change(schema, schema.paths[WORKERS_API.patchLatest].patch);
    return checkWorkersApi(schema);
  };
  assert.deepEqual(broken((s) => delete s.paths[WORKERS_API.worker]), [`GET ${WORKERS_API.worker} is gone`]);
  assert.deepEqual(broken((s) => delete s.paths[WORKERS_API.patchLatest]), [`PATCH ${WORKERS_API.patchLatest} is gone`]);
  assert.deepEqual(broken((s, p) => (p.parameters = [])), ["the version patch has no ?deploy= any more"]);
  assert.match(broken((s, p) => (p.description = "Fields are reset."))[0], /omitted fields are inherited/);
  assert.deepEqual(broken((s, p) => delete p.requestBody.content["application/merge-patch+json"]), ["the version patch no longer takes application/merge-patch+json"]);
  assert.deepEqual(broken((s, p) => delete p.requestBody.content["application/merge-patch+json"].schema.allOf[1].properties.modules), [
    'the version patch has no "modules" field',
    'modules[] has no "name"',
    'modules[] has no "content_type"',
    'modules[] has no "content_base64"',
  ]);
  assert.deepEqual(broken((s) => delete s.components.schemas.assets.properties.config.properties.run_worker_first), ['assets.config has no "run_worker_first"']);
  assert.deepEqual(broken((s) => delete s.components.schemas.workers_binding_kind_r2_bucket), ['the r2_bucket binding has no "bucket_name"']);
  assert.deepEqual(broken((s) => (s.components.schemas.assets = { $ref: "#/components/schemas/assets" })), ['assets.config has no "not_found_handling"', 'assets.config has no "run_worker_first"'], "a $ref loop ends");
});

test("web build: Service Worker caches game files, not the ones the toolkit writes or huge ones", () => {
  const root = tmp();
  fs.mkdirSync(path.join(root, "js"));
  fs.writeFileSync(path.join(root, "js", "plugins.js"), "var $plugins = [];\n");
  fs.writeFileSync(path.join(root, "index.html"), "<html><head></head><body></body></html>");
  const f = (rel, size, mtimeMs = 5) => ({ rel, size, mtimeMs });
  const files = [f("img/a.png", 10), f("img/big.png", 26 * 1024 * 1024), f("js/plugins.js", 3), f("js/main.js", 4), f("index.html", 1), f("save/x", 1)];
  const out = generatedFiles({ root, engine: "MZ", title: "G" }, { slug: "g", sync: {} }, files);
  const sw = out.get("rwk-sw.js");
  const manifest = JSON.parse(/const MANIFEST = (\{.*\});/.exec(sw)[1]);
  assert.deepEqual(manifest, { "img/a.png": "10-5", "js/main.js": "4-5" });
  assert.match(sw, /const BUILD_ID = "[0-9a-f]{12}";/);
  const id = (src) => /BUILD_ID = "(\w+)"/.exec(src)[1];
  assert.match(serviceWorkerSource([f("img/a.png", 10, 6)]), /"img\/a\.png":"10-6"/);
  assert.notEqual(id(serviceWorkerSource([f("img/a.png", 10, 6)])), id(serviceWorkerSource([f("img/a.png", 10, 5)])));
  assert.ok(!generatedFiles({ root, engine: "MZ", title: "G" }, { slug: "g", sync: {}, cache: false }, files).has("rwk-sw.js"));
  assert.equal(runtimeConfigOf("MZ", { slug: "g", cache: false }).cache, false);
});

test("feature settings: false, true or an object with limits and a lock", () => {
  assert.equal(fastForwardConfig(false), false);
  assert.deepEqual(fastForwardConfig(undefined), { maxSpeed: 4, speed: 2, inBattle: true, lock: false });
  assert.deepEqual(fastForwardConfig(true), fastForwardConfig(undefined));
  assert.deepEqual(fastForwardConfig({ maxSpeed: 3, speed: 4, inBattle: false, lock: true }), { maxSpeed: 3, speed: 3, inBattle: false, lock: true });
  assert.deepEqual(fastForwardConfig({ maxSpeed: 9, speed: "x", inBattle: "no" }), { maxSpeed: 4, speed: 2, inBattle: true, lock: false });

  assert.equal(messageModeConfig(false), false);
  assert.deepEqual(messageModeConfig(true), { auto: true, skip: true, mode: "normal", autoSpeed: "normal", lock: false });
  assert.deepEqual(messageModeConfig({ skip: false, mode: "auto", autoSpeed: "slow", lock: true }), { auto: true, skip: false, mode: "auto", autoSpeed: "slow", lock: true });
  assert.equal(messageModeConfig({ auto: false, mode: "auto" }).mode, "normal", "no Auto to start in");
  assert.equal(messageModeConfig({ mode: "skip", autoSpeed: "warp" }).mode, "normal");

  assert.equal(alwaysDashConfig(false), false);
  assert.deepEqual(alwaysDashConfig(true), { on: null, lock: false });
  assert.deepEqual(alwaysDashConfig({ on: true }), { on: true, lock: false });
  assert.deepEqual(alwaysDashConfig({ on: false, lock: true }), { on: false, lock: true });
  assert.deepEqual(alwaysDashConfig({ lock: true }), { on: null, lock: false }, "nothing to lock it to");

  assert.equal(saveToolsConfig(false), false);
  assert.deepEqual(saveToolsConfig(true), { export: true, import: true, delete: true });
  assert.deepEqual(saveToolsConfig({ import: false }), { export: true, import: false, delete: true });
  assert.equal(saveToolsConfig({ export: false, import: false, delete: false }), false);

  const runtime = runtimeConfigOf("MZ", { slug: "g" });
  assert.deepEqual(runtime.fastForward, fastForwardConfig(true), "no setting: the toolkit's defaults, as before");
  assert.deepEqual(runtime.saveTools, saveToolsConfig(true));
});

test("cheats: off unless the deployer turns them on, for everyone or one player", () => {
  assert.equal(cheatsConfig(undefined), false);
  assert.equal(cheatsConfig(false), false);
  const all = { party: true, items: true, battle: true, switches: true, movement: true };
  assert.deepEqual(cheatsConfig(true), all);
  assert.deepEqual(cheatsConfig({ battle: false }), { ...all, battle: false });
  assert.deepEqual(cheatsConfig({ party: false, items: false, battle: false, switches: false }), { party: false, items: false, battle: false, switches: false, movement: true });
  assert.equal(cheatsConfig({ party: false, items: false, battle: false, switches: false, movement: false }), false, "no group left");
  for (const preset of ["comfortable", "original", "shared"]) assert.equal(runtimeConfigOf("MZ", { slug: "g", preset }).cheats, false, preset);
  assert.ok(RUNTIME_PLUGINS.includes("RWK_Cheats"));

  const cfg = { slug: "g", players: { "me@example.com": { cheats: { items: false } } } };
  assert.deepEqual(playerOverrides("MZ", cfg, null), { [userHash("me@example.com")]: { cheats: { ...all, items: false } } });
  const policy = parsePolicy({ hosting: "personal", features: { cheats: false } });
  assert.deepEqual(playerOverrides("MZ", cfg, policy), {}, "the creator's policy wins over a player's entry");
  assert.equal(runtimeConfigOf("MZ", applyPolicy({ slug: "g", cheats: true }, policy)).cheats, false);
});

test("presets sit under the keys the config sets, and the creator's policy wins", () => {
  const original = runtimeConfigOf("MZ", { slug: "g", preset: "original" });
  assert.equal(original.fastForward.inBattle, false);
  assert.equal(original.messageMode.skip, false);
  assert.deepEqual(original.quickSave, { ignoreSaveLock: false });
  assert.equal(original.saveTools.import, false);
  assert.deepEqual(original.autoSave, { minutes: 5 }, "what the preset leaves alone keeps the defaults");

  const shared = runtimeConfigOf("MZ", { slug: "g", preset: "shared" });
  assert.deepEqual(shared.saveTools, { export: false, import: false, delete: true });
  assert.deepEqual(shared.saveHistory, { keep: 5, days: 14 });

  const tuned = runtimeConfigOf("MZ", { slug: "g", preset: "original", fastForward: { maxSpeed: 3 }, messageMode: true });
  assert.deepEqual(tuned.fastForward, { maxSpeed: 3, speed: 2, inBattle: false, lock: false }, "an object adds to the preset's");
  assert.equal(tuned.messageMode.skip, true, "true: back to the toolkit's defaults");
  assert.equal(runtimeConfigOf("MZ", applyPolicy({ slug: "g", preset: "original" }, parsePolicy({ hosting: "personal", features: { fastForward: false } }))).fastForward, false);
  assert.deepEqual(withPreset({ slug: "g", preset: "nope" }), { slug: "g", preset: "nope" }, "an unknown preset is the default one");
});

test("per-player settings: the differences only, keyed by the email's hash, never in the web build", () => {
  const cfg = {
    slug: "g",
    preset: "shared",
    fastForward: { maxSpeed: 3 },
    players: {
      "Me@Example.com": { saveTools: true, fastForward: { maxSpeed: 4 }, saveHistory: false, backlog: false },
      "friend@example.com": { fastForward: { maxSpeed: 3 } },
      "kid@example.com": { alwaysDash: false },
    },
  };
  const policy = parsePolicy({ hosting: "shared", features: { backlog: false } });
  const out = playerOverrides("MZ", cfg, policy);
  assert.deepEqual(Object.keys(out).sort(), [userHash("me@example.com"), userHash("kid@example.com")].sort(), "friend's entry changes nothing");
  assert.deepEqual(out[userHash("me@example.com")], {
    fastForward: { maxSpeed: 4, speed: 2, inBattle: true, lock: false },
    saveHistory: false,
    saveTools: { export: true, import: true, delete: true },
  }, "the creator's backlog: false stays, for every player");
  assert.deepEqual(out[userHash("kid@example.com")], { alwaysDash: false });
  assert.equal(withPlayer(cfg, "ME@example.com ").saveHistory, false, "emails match whatever their case");
  assert.equal(withPlayer(cfg, "stranger@example.com"), cfg);

  const root = tmp();
  fs.mkdirSync(path.join(root, "js"));
  fs.writeFileSync(path.join(root, "js", "plugins.js"), "var $plugins = [];\n");
  fs.writeFileSync(path.join(root, "index.html"), "<html><head></head><body></body></html>");
  const built = [...generatedFiles({ root, engine: "MZ", title: "G" }, { ...cfg, sync: {} }).values()].map(String).join("\n");
  assert.ok(!/example\.com/i.test(built), "no email reaches the static files");

  assert.deepEqual(checkFeatureConfig({ preset: "comfortable" }), []);
  assert.match(checkFeatureConfig({ preset: "easy" })[0], /Unknown "preset"/);
  assert.match(checkFeatureConfig({ players: [] })[0], /must be an object/);
  const problems = checkFeatureConfig({ players: { nobody: {}, "a@b.c": 1, "x@y.z": { sync: false, cheats: true, backlog: 50, slug: "x" } } });
  assert.equal(problems.length, 3);
  assert.match(problems[2], /sync, slug cannot be set per player/);
});

test("per-player settings reach the Worker, which then serves js/plugins.js", () => {
  const project = (playerSettings, bucket = "b") => {
    const buildDir = tmp();
    const file = writeWorkerProject({ buildDir, slug: "g", bucket, overflowRels: [], auth: {}, locked: false, toolkitRoot: path.join(import.meta.dirname, ".."), playerSettings });
    return { buildDir, config: JSON.parse(fs.readFileSync(file, "utf8")) };
  };
  assert.deepEqual(project(undefined, null).config.assets.run_worker_first, ["/api/*"]);
  const none = project(undefined);
  assert.deepEqual(none.config.assets.run_worker_first, ["/api/*", "/js/plugins.js"], "the settings in R2 may change it");
  assert.equal(fs.readFileSync(path.join(none.buildDir, "player-settings.json"), "utf8"), "{}");
  const some = project({ abc: { backlog: false } });
  assert.deepEqual(some.config.assets.run_worker_first, ["/api/*", "/js/plugins.js"]);
  assert.deepEqual(JSON.parse(fs.readFileSync(path.join(some.buildDir, "player-settings.json"), "utf8")), { abc: { backlog: false } });
  assert.match(fs.readFileSync(path.join(some.buildDir, "worker.js"), "utf8"), /createWorker\(\{ overflow, playerSettings \}\)/);
});

test("settings without a redeploy: what the Worker reads from R2, and what still needs a deploy", () => {
  const cfg = { slug: "g", auth: { mode: "access" }, sync: { enabled: true }, preset: "original", backlog: { max: 50 }, players: { "me@example.com": { cheats: true } } };
  const live = liveSettingsOf("MZ", cfg, null);
  const runtime = runtimeConfigOf("MZ", cfg);
  for (const key of ["version", "gameId", "engine", "cache"]) assert.equal(key in live.config, false, `${key} is the build's`);
  assert.deepEqual(live.config.backlog, { max: 50 });
  assert.equal(live.config.fastForward.inBattle, false, "with the preset under it");
  assert.deepEqual(live.config, Object.fromEntries(Object.entries(runtime).filter(([key]) => !["version", "gameId", "engine", "cache"].includes(key))));
  assert.deepEqual(live.players, playerOverrides("MZ", cfg, null));
  assert.equal(Object.keys(live.players).length, 1);

  assert.deepEqual(liveSettingsOf("MZ", { ...cfg, auth: { mode: "none" } }, null).players, {}, "a public site cannot tell players apart");
  const policy = parsePolicy({ hosting: "personal", features: { backlog: false, sync: false } });
  const locked = liveSettingsOf("MZ", cfg, policy);
  assert.equal(locked.config.backlog, false, "the creator's policy still wins");
  assert.equal(locked.config.sync.enabled, false);

  for (const key of ["fastForward", "cheats", "players", "preset", "controls", "sync"]) assert.ok(LIVE_KEYS.includes(key), key);
  const after = { ...cfg, backlog: false, players: {}, exclude: ["*.txt"], cache: false, liveSettings: true, toolkitVersion: "9.9.9", url: "https://x" };
  assert.deepEqual(keysNeedingDeploy(cfg, after), ["exclude", "cache"]);
  assert.deepEqual(keysNeedingDeploy(cfg, { ...cfg }), []);
});

test("cli files import the ui.js helpers they use", () => {
  // A merge once dropped `print` from deploy.js's import: the run only failed
  // at its last line, after the deploy, which no other test reaches.
  const ui = fs.readFileSync("cli/lib/ui.js", "utf8");
  const exported = [...ui.matchAll(/^export (?:const|function|async function|class) (\w+)/gm)].map((m) => m[1]);
  const files = fs.readdirSync("cli", { recursive: true }).filter((f) => f.endsWith(".js") && path.basename(f) !== "ui.js");
  for (const file of files) {
    const src = fs.readFileSync(path.join("cli", file), "utf8");
    const imported = new Set(
      [...src.matchAll(/import\s*\{([^}]*)\}\s*from\s*"[./]*(?:lib\/)?ui\.js"/g)].flatMap((m) => m[1].split(",").map((s) => s.trim().split(/\s+as\s+/).pop())),
    );
    for (const name of exported) {
      const used = new RegExp(`(?<![.\\w$])${name}\\s*[(.]`).test(src);
      const defined = new RegExp(`(?:const|let|function|class)\\s+${name}\\b`).test(src);
      if (used && !defined) assert.ok(imported.has(name), `${file} uses ${name} without importing it from ui.js`);
    }
  }
});

test("gamepadKeys: page up / down are covered only when L / R are on", () => {
  assert.equal(gamepadKeys().has("pageup"), false);
  assert.equal(gamepadKeys(false).has("pagedown"), false);
  assert.equal(gamepadKeys(true).has("pageup"), true);
  assert.equal(gamepadKeys(true).has("pagedown"), true);
  assert.equal(gamepadKeys().has("ok"), true);
});
