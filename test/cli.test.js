import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { test } from "node:test";
import { overflowRoutes } from "../cli/lib/cloudflare.js";
import { compileGlobs, suggestSlug, validateSlug } from "../cli/lib/game.js";
import { cleanHint, pluginHint, scanKeys, stripComments } from "../cli/lib/keys.js";
import { syncPublicDir } from "../cli/lib/stage.js";

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
