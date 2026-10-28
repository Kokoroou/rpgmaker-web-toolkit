// Path problems that work on Windows but not on the web: letter case, upper-case extensions, engine folders.

import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { analyze } from "../cli/commands/analyze.js";
import { analyzeGame, collectFiles } from "../cli/lib/game.js";
import { countByKind, pathWarnings, scanPaths } from "../cli/lib/paths.js";
import { warnings } from "../cli/lib/ui.js";


// Windows and macOS disks ignore letter case: two files that differ only by case cannot exist there.
const caseSensitiveDisk = (() => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "rwk-case-"));
  fs.writeFileSync(path.join(dir, "a"), "");
  return !fs.existsSync(path.join(dir, "A"));
})();

// files: { "img/characters/Actor1.png": "x", "data/Actors.json": object | string }
function makeGame(files) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "rwk-paths-"));
  const base = {
    "index.html": '<html><head><script src="js/main.js"></script><script src="js/plugins.js"></script></head></html>',
    "js/rmmz_core.js": "",
    "js/main.js": "",
    "js/plugins.js": "var $plugins = [];",
    "data/System.json": { gameTitle: "Demo", advanced: { gameId: 1 } },
  };
  for (const [rel, content] of Object.entries({ ...base, ...files })) {
    const abs = path.join(dir, ...rel.split("/"));
    fs.mkdirSync(path.dirname(abs), { recursive: true });
    fs.writeFileSync(abs, typeof content === "string" ? content : JSON.stringify(content));
  }
  return dir;
}

const scan = (dir) => {
  const game = analyzeGame(dir);
  return scanPaths(collectFiles(game, {}));
};
const find = (result, kind, ref) => result.issues.find((i) => i.kind === kind && (ref === undefined || i.ref === ref));

test("paths: a game with exact spelling has no issue", () => {
  const dir = makeGame({
    "img/characters/Actor1.png": "x",
    "audio/bgm/Theme1.ogg": "x",
    "data/Actors.json": [null, { characterName: "Actor1", faceName: "", battlerName: "" }],
    "data/Map001.json": { bgm: { name: "Theme1", pan: 0, pitch: 100, volume: 90 }, events: [] },
  });
  const result = scan(dir);
  assert.equal(result.issues.length, 0, JSON.stringify(result.issues));
  assert.ok(result.checked >= 3);
});

test("paths: data references that differ only by case are found, with where and the fix", () => {
  const dir = makeGame({
    "img/characters/Actor1.png": "x",
    "img/sv_actors/Hero_Battler.png": "x",
    "img/pictures/Title.png": "x",
    "audio/se/Cursor1.ogg": "x",
    "data/Actors.json": [null, { id: 1, characterName: "actor1", battlerName: "hero_battler", faceName: "" }],
    "data/CommonEvents.json": [
      null,
      {
        list: [
          { code: 231, indent: 0, parameters: [1, "title", 0, 0, 0, 0, 100, 100, 255, 0] },
          { code: 250, indent: 0, parameters: [{ name: "cursor1", volume: 90, pitch: 100, pan: 0 }] },
          { code: 231, indent: 0, parameters: [2, "title", 0, 0, 0, 0, 100, 100, 255, 0] },
        ],
      },
    ],
  });
  const result = scan(dir);
  const actor = find(result, "case", "actor1");
  assert.deepEqual([actor.source, actor.to, actor.fix, actor.actual], ["data/Actors.json", "Actor1", "reference", "img/characters/Actor1.png"]);
  assert.deepEqual(actor.sites[0].at.json, [1, "characterName"]);
  assert.equal(actor.sites[0].where, "data/Actors.json $[1].characterName");
  assert.equal(find(result, "case", "hero_battler").to, "Hero_Battler");
  const title = find(result, "case", "title");
  assert.equal(title.count, 2, "the same reference twice is one issue with two sites");
  assert.equal(find(result, "case", "cursor1").expected, "audio/se/cursor1");
  assert.equal(countByKind(result.issues).case, 5);
});

test("paths: a missing file is reported as missing, an empty name is not a reference", () => {
  const dir = makeGame({
    "data/Actors.json": [null, { characterName: "Nobody", faceName: "", battlerName: "" }],
  });
  const result = scan(dir);
  assert.deepEqual(result.issues.filter((i) => i.source === "data/Actors.json").map((i) => [i.kind, i.ref]), [["missing", "Nobody"]]);
});

test("paths: upper-case extension, engine folder spelled differently, name that differs only by case", () => {
  const dir = makeGame({
    "img/characters/Actor1.PNG": "x",
    "img/Faces/Actor1.png": "x",
    "data/Actors.json": [null, { characterName: "Actor1", faceName: "Actor1", battlerName: "" }],
  });
  const result = scan(dir);
  const ext = find(result, "ext");
  assert.deepEqual([ext.actual, ext.to, ext.fix], ["img/characters/Actor1.PNG", "img/characters/Actor1.png", "file"]);
  const folder = find(result, "folder");
  assert.deepEqual([folder.actual, folder.to, folder.fix], ["img/Faces", "img/faces", "file"]);
  // the references are right once those two are fixed: no reference issue on top
  assert.equal(find(result, "case"), undefined);
  assert.equal(find(result, "missing", "Actor1"), undefined);
});

test("paths: the plugin list, index.html and CSS", () => {
  const dir = makeGame({
    "js/plugins/MyPlugin.js": "",
    "js/plugins.js": 'var $plugins = [\n{"name":"myplugin","status":true,"description":"","parameters":{"name":"x"}},\n{"name":"Off","status":false,"parameters":{}},\n{"name":"Gone","status":true,"parameters":{}}];',
    "css/Game.css": "@font-face { src: url(../fonts/Gamefont.woff); } body { background: url('../img/system/Back.png') }",
    "fonts/gamefont.woff": "x",
    "img/system/Back.png": "x",
    "index.html": '<script src="js/main.js"></script><link href="css/game.css" rel="stylesheet"><script src="https://cdn.example/x.js"></script><a href="#top"></a>',
  });
  const result = scan(dir);
  const plugin = find(result, "case", "myplugin");
  assert.deepEqual([plugin.to, plugin.fix], ["MyPlugin", "reference"]);
  const text = fs.readFileSync(path.join(dir, "js", "plugins.js"), "utf8");
  assert.equal(text.slice(plugin.sites[0].at.start, plugin.sites[0].at.end), "myplugin");
  assert.equal(find(result, "case", "Off"), undefined, "a disabled plugin is not loaded");
  const gone = find(result, "missing", "Gone");
  assert.equal(gone.expected, "js/plugins/Gone.js", "a plugin in the list with no file");
  assert.equal(text.slice(gone.sites[0].at.start, gone.sites[0].at.end), "Gone");
  const html = find(result, "case", "css/game.css");
  assert.deepEqual([html.to, html.fix], ["css/Game.css", "reference"]);
  const font = find(result, "case", "../fonts/Gamefont.woff");
  assert.equal(font.to, "../fonts/gamefont.woff");
  assert.deepEqual(result.issues.filter((i) => i.kind === "missing").map((i) => i.ref), ["Gone"], "external links and anchors are not paths");
});

test("paths: path literals in plugin scripts are case-checked only", () => {
  const dir = makeGame({
    "js/plugins/Loader.js": 'const a = "Img/Pictures/Logo.png"; const b = "img/pictures/Nope.png"; const c = `img/${x}.png`;',
    "img/pictures/Logo.png": "x",
  });
  const result = scan(dir);
  const logo = find(result, "case", "Img/Pictures/Logo.png");
  assert.deepEqual([logo.to, logo.fix], ["img/pictures/Logo.png", "reference"]);
  assert.equal(find(result, "missing", "img/pictures/Nope.png"), undefined, "code may build or guard names: no missing report");
});

test("paths: ambiguous spelling has no automatic fix", { skip: !caseSensitiveDisk && "needs a case-sensitive disk" }, () => {
  const dir = makeGame({
    "img/characters/Hero.png": "x",
    "img/characters/hero.PNG": "x",
    "data/Actors.json": [null, { characterName: "HERO", faceName: "", battlerName: "" }],
  });
  const result = scan(dir);
  assert.equal(find(result, "case", "HERO").fix, null);
  assert.ok(find(result, "collision"));
});

test("paths: characters that break a web address", () => {
  const dir = makeGame({ "img/pictures/a#1.png": "x", "img/pictures/ok.png": "x" });
  const result = scan(dir);
  assert.deepEqual(result.issues.filter((i) => i.kind === "unsafe").map((i) => i.source), ["img/pictures/a#1.png"]);
});

test("paths: the warnings are one line per kind and say what to do", () => {
  const dir = makeGame({
    "img/characters/Actor1.PNG": "x",
    "data/Actors.json": [null, { characterName: "Actor1", faceName: "Gone", battlerName: "" }],
  });
  const lines = pathWarnings(scan(dir).issues);
  assert.equal(lines.length, 2, lines.join("\n"));
  assert.match(lines[0], /upper-case extension/);
  assert.match(lines[1], /not in the game/);
  assert.deepEqual(pathWarnings([]), []);
});

test("analyze: reports the path problems in the warnings and the result, and writes nothing", async () => {
  process.env.RWK_LIMITS_URL = "off";
  const dir = makeGame({
    "img/characters/Actor1.png": "x",
    "data/Actors.json": [null, { characterName: "actor1", faceName: "", battlerName: "" }],
  });
  const before = fs.readFileSync(path.join(dir, "data", "Actors.json"), "utf8");
  warnings.length = 0;
  const result = await analyze(dir);
  assert.ok(warnings.some((w) => /different letter case/.test(w)), warnings.join("\n"));
  assert.equal(result.paths.case, 1);
  assert.ok(result.paths.checked >= 1);
  assert.equal(fs.readFileSync(path.join(dir, "data", "Actors.json"), "utf8"), before);
  warnings.length = 0;
});
