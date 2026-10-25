import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { test } from "node:test";
import LZString from "lz-string";
import { WORKERS_API, deployKeepingAssets, keepAssetsForm, overflowRoutes, retitleMvGlobal, writeWorkerProject } from "../cli/lib/cloudflare.js";
import { compileGlobs, findGameBySite, mobileOnlyMissing, nonAsciiPaths, siteNameFromLink, storageIdOf, suggestSlug, takenNames, validateSlug } from "../cli/lib/game.js";
import { BUNDLED_LIMITS_FILE, loadLimits, parseLimits } from "../cli/lib/limits.js";
import { cleanHint, pluginHint, scanKeys, stripComments } from "../cli/lib/keys.js";
import { allowsPublic, applyPolicy, isIndexable, parsePolicy, readPolicy } from "../cli/lib/policy.js";
import { RUNTIME_PLUGINS, generatedFiles, runtimeConfigOf, runtimeSources, saveHistoryConfig, syncPublicDir } from "../cli/lib/stage.js";
import { splitToolkit } from "../worker/toolkit.js";
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
  const p = parsePolicy({ hosting: "shared", features: { saveTools: false, itemBatch: true, cheats: false }, message: " Hi " });
  assert.equal(p.hosting, "shared");
  assert.deepEqual(p.features, { saveTools: false });
  assert.equal(p.message, "Hi");
  assert.deepEqual(p.problems, []);
  assert.equal(parsePolicy({ hosting: "everyone" }).hosting, "personal");
  assert.equal(parsePolicy({}).problems.length, 1);

  const cfg = { slug: "g", sync: { enabled: true }, saveTools: true };
  const locked = applyPolicy(cfg, parsePolicy({ hosting: "personal", features: { saveTools: false, fastForward: false, messageMode: false, alwaysDash: false, quickSave: false, autoSave: false, sync: false } }));
  assert.equal(locked.saveTools, false);
  assert.equal(locked.fastForward, false);
  assert.equal(locked.messageMode, false);
  assert.equal(locked.alwaysDash, false);
  assert.equal(locked.quickSave, false);
  assert.equal(locked.autoSave, false);
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

test("update-from-link: which game a link names", () => {
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

test("update-from-link: the Worker upload keeps the deployed files", async () => {
  const toolkit = { names: RUNTIME_PLUGINS, plugins: runtimeSources(), config: runtimeConfigOf("MV", { slug: "g", storageId: "first", sync: { enabled: true } }), keepOff: false };
  assert.equal(toolkit.config.gameId, "first");
  assert.equal(toolkit.config.media, undefined, "taken from the deployed build by the Worker");
  const form = keepAssetsForm({
    slug: "g",
    gameId: "first",
    bucket: "b",
    overflowRels: ["movies/big.webm"],
    auth: { mode: "access", teamDomain: "t.cloudflareaccess.com", aud: "abc" },
    toolkitRoot: path.join(import.meta.dirname, ".."),
    saveHistory: { keep: 5, days: 30 },
    toolkit,
  });
  const metadata = JSON.parse(await form.get("metadata").text());
  assert.equal(metadata.keep_assets, true);
  assert.equal(metadata.main_module, "worker.js");
  const vars = Object.fromEntries(metadata.bindings.filter((b) => b.type === "plain_text").map((b) => [b.name, b.text]));
  assert.deepEqual(vars, {
    GAME_ID: "first",
    AUTH_MODE: "access",
    ACCESS_TEAM_DOMAIN: "t.cloudflareaccess.com",
    ACCESS_AUD: "abc",
    RWK_LOCKED: "0",
    RWK_INDEXABLE: "0",
    RWK_SAVE_HISTORY: '{"keep":5,"days":30}',
  });
  assert.ok(metadata.bindings.some((b) => b.type === "r2_bucket" && b.name === "BUCKET" && b.bucket_name === "b"));
  assert.ok(metadata.bindings.some((b) => b.type === "assets" && b.name === "ASSETS"));
  const routes = metadata.assets.config.run_worker_first;
  for (const r of ["/api/*", "/js/plugins.js", "/js/plugins/RWK_Core.js", "/movies/big.webm"]) assert.ok(routes.includes(r), r);

  for (const name of ["worker.js", "rwk-overflow.js", "rwk-toolkit.js", "worker/index.js", "worker/auth.js", "worker/saves.js", "worker/players.js", "worker/toolkit.js"]) {
    assert.equal(form.get(name)?.type, "application/javascript+module", name);
  }
  // Uploaded unbundled: every relative import must name another part.
  for (const [name, part] of form.entries()) {
    if (name === "metadata") continue;
    for (const [, spec] of (await part.text()).matchAll(/^(?:import|export) .* from "(\.[^"]+)";$/gm)) {
      const target = path.posix.join(path.posix.dirname(name), spec);
      assert.ok(form.has(target), `${name} imports ${spec}: no part "${target}"`);
    }
  }
  const toolkitModule = await form.get("rwk-toolkit.js").text();
  const { default: uploaded } = await import(`data:text/javascript,${encodeURIComponent(toolkitModule)}`);
  assert.deepEqual(uploaded, toolkit);
});

test("update-from-link: Workers API calls and their errors", async (t) => {
  const calls = [];
  let replies = [];
  t.mock.method(globalThis, "fetch", async (url, init) => {
    calls.push({ url, init });
    const [status, body, headers] = replies.shift();
    return new Response(JSON.stringify(body), { status, headers });
  });
  t.mock.method(console, "log", () => {});
  const form = new FormData();
  const run = () => deployKeepingAssets({ token: "tok", accountId: "acc", slug: "g", form });

  replies = [
    [200, { success: true, result: {} }],
    [200, { success: true, result: {}, messages: [{ message: "fine" }] }, { deprecation: "true" }],
  ];
  warnings.length = 0;
  await run();
  assert.equal(calls[0].url, `${WORKERS_API.base}/accounts/acc/workers/scripts/g/settings`);
  assert.equal(calls[0].init.method, "GET");
  assert.equal(calls[1].url, `${WORKERS_API.base}/accounts/acc/workers/scripts/g`);
  assert.equal(calls[1].init.method, "PUT");
  assert.equal(calls[1].init.body, form);
  assert.equal(calls[1].init.headers.authorization, "Bearer tok");
  assert.match(warnings[0], /going away \(deprecation: true\).*checked against the Cloudflare API on/);
  warnings.length = 0;

  replies = [[404, { success: false, errors: [{ code: 10007, message: "workers.api.error.script_not_found" }] }]];
  await assert.rejects(run, /no Worker named "g"/);
  replies = [[500, "not json"]];
  await assert.rejects(run, /Could not read the Worker: HTTP 500/);
  replies = [
    [200, { success: true }],
    [400, { success: false, errors: [{ code: 10021, message: "Unknown field keep_assets" }] }],
  ];
  await assert.rejects(run, (err) => /Could not update the Worker: Unknown field keep_assets \[code: 10021\]/.test(err.message) && err.message.includes(WORKERS_API.checked));
  replies = [
    [200, { success: true }],
    [200, { success: false, errors: [{ message: "odd" }] }],
  ];
  await assert.rejects(run, /Could not update the Worker: odd\n/);
});

// The upload in keepAssetsForm() copies how the pinned wrangler builds its
// own. A wrangler bump fails this test until that is checked again and
// WORKERS_API (cli/lib/cloudflare.js) records the new version and date.
test("update-from-link: the Workers API upload was checked against the pinned wrangler", (t) => {
  const pkg = JSON.parse(fs.readFileSync(new URL("../package.json", import.meta.url), "utf8"));
  assert.equal(pkg.devDependencies.wrangler, WORKERS_API.wrangler, "wrangler was bumped: check keepAssetsForm() against it, then update WORKERS_API");
  assert.match(WORKERS_API.checked, /^\d{4}-\d{2}-\d{2}$/);
  const cli = new URL("../node_modules/wrangler/wrangler-dist/cli.js", import.meta.url);
  if (!fs.existsSync(cli)) return t.skip("wrangler is not installed (npm ci)");
  const installed = JSON.parse(fs.readFileSync(new URL("../node_modules/wrangler/package.json", import.meta.url), "utf8")).version;
  assert.equal(installed, WORKERS_API.wrangler, "run npm ci");
  const source = fs.readFileSync(cli, "utf8");
  for (const snippet of [
    "...keep_assets !== void 0 && { keep_assets }",
    'metadataBindings.push({ name: binding, type: "plain_text", text: value });',
    'type: "r2_bucket",',
    'type: "assets"',
    'esm: "application/javascript+module"',
    "run_worker_first: assets?.run_worker_first",
    "main_module: main2.name",
  ]) {
    assert.ok(source.includes(snippet), `wrangler no longer has: ${snippet}`);
  }
});
