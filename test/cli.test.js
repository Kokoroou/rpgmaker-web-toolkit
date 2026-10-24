import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { test } from "node:test";
import { overflowRoutes } from "../cli/lib/cloudflare.js";
import { compileGlobs, mobileOnlyMissing, nonAsciiPaths, suggestSlug, validateSlug } from "../cli/lib/game.js";
import { BUNDLED_LIMITS_FILE, loadLimits, parseLimits } from "../cli/lib/limits.js";
import { cleanHint, pluginHint, scanKeys, stripComments } from "../cli/lib/keys.js";
import { allowsPublic, applyPolicy, isIndexable, parsePolicy, readPolicy } from "../cli/lib/policy.js";
import { generatedFiles, syncPublicDir } from "../cli/lib/stage.js";
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
  const locked = applyPolicy(cfg, parsePolicy({ hosting: "personal", features: { saveTools: false, sync: false } }));
  assert.equal(locked.saveTools, false);
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
  const js = out.get("js/plugins.js");
  const core = JSON.parse(/\$plugins\.push\((\{"name":"RWK_Core".*\})\);/.exec(js)[1]);
  const pkg = JSON.parse(fs.readFileSync(new URL("../package.json", import.meta.url), "utf8"));
  assert.equal(JSON.parse(core.parameters.config).version, pkg.version);
});
