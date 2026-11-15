// Path problems that work on Windows but not on the web: letter case, upper-case extensions, engine folders.

import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { analyze } from "../cli/commands/analyze.js";
import { analyzeGame, collectFiles, otherFiles } from "../cli/lib/game.js";
import { countByKind, pathWarnings, scanPaths } from "../cli/lib/paths.js";
import { fixPaths } from "../cli/lib/paths-fix.js";
import { warnings } from "../cli/lib/ui.js";


// Windows and macOS disks ignore letter case: two files that differ only by case cannot exist there.
const caseSensitiveDisk = (() => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "rwk-case-"));
  fs.writeFileSync(path.join(dir, "a"), "");
  return !fs.existsSync(path.join(dir, "A"));
})();

// files: { "img/characters/Actor1.png": "x", "data/Actors.json": object | string, "js/rmmz_core.js": null (left out) }
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
    if (content === null) continue;
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

test("paths: a font with an upper-case extension is left as it is: it is asked for with its extension", () => {
  // System.json and a plugin parameter ask for fonts/FRADM.TTF: renaming the file to .ttf
  // (as for Actor1.PNG) broke every font of a game on the web.
  const dir = makeGame({
    "fonts/FRADM.TTF": "x",
    "js/plugins/Fonts.JS": "",
    "data/System.json": { gameTitle: "Demo", advanced: { gameId: 1, mainFontFilename: "FRADM.TTF", numberFontFilename: "FRADM.TTF" } },
  });
  const result = scan(dir);
  assert.deepEqual(result.issues.map((i) => [i.kind, i.source]), [["ext", "js/plugins/Fonts.JS"]], "a plugin is named without its extension: that one is renamed");
  assert.equal(fixPaths(dir, { level: "standard" }).renames.some((r) => /FRADM/.test(r.from)), false);
});

test("paths: the fonts in System.json are checked for letter case", () => {
  const dir = makeGame({
    "fonts/FRADM.ttf": "x",
    "data/System.json": { gameTitle: "Demo", advanced: { gameId: 1, mainFontFilename: "FRADM.TTF", numberFontFilename: "fradm.ttf" } },
  });
  const result = scan(dir);
  const fonts = result.issues.filter((i) => i.source === "data/System.json");
  assert.deepEqual(fonts.map((i) => [i.kind, i.ref, i.to, i.fix]), [["case", "FRADM.TTF", "FRADM.ttf", "reference"], ["case", "fradm.ttf", "FRADM.ttf", "reference"]]);
  assert.equal(fonts[0].sites[0].where, "data/System.json $.advanced.mainFontFilename");
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

test("paths: plugin parameters the header marks as files are checked, also in structs and lists", () => {
  // MOG_TitleParticles: "P3 File Name":"particles3" with @dir img/titles2/ and an encrypted Particles3.png_.
  const header = [
    "/*:",
    " * @param P3 File Name",
    " * @type file",
    " * @dir img/titles2/",
    " *",
    " * @param Count",
    " * @default particles3",
    " *",
    " * @param Data",
    " * @type file",
    " * @dir img/system",
    " *",
    " * @param Layers",
    " * @type struct<Layer>[]",
    " *",
    " * @command show",
    " * @arg picture",
    " * @type file",
    " * @dir img/pictures",
    " */",
    "/*:ja",
    " * @param P3 File Name",
    " * @type string",
    " */",
    "/*~struct~Layer:",
    " * @param image",
    " * @type file",
    " * @dir img/pictures/",
    " */",
  ].join("\n");
  const layers = JSON.stringify([JSON.stringify({ image: "back" }), JSON.stringify({ image: "back" }), JSON.stringify({ image: "Gone" })]);
  const params = { "P3 File Name": "particles3", Count: "particles3", Data: "Reco.json", Layers: layers, picture: "nope" };
  const dir = makeGame({
    "js/plugins/Particles.js": header,
    "js/plugins.js": `var $plugins = [\n${JSON.stringify({ name: "Particles", status: true, description: "", parameters: params })},\n${JSON.stringify({ name: "Off", status: false, parameters: {} })}\n];`,
    "img/titles2/Particles3.png_": "x",
    "img/system/Reco.json": "x",
    "img/pictures/Back.png": "x",
  });
  const result = scan(dir);
  const text = fs.readFileSync(path.join(dir, "js", "plugins.js"), "utf8");
  const particles = find(result, "case", "particles3");
  assert.deepEqual([particles.to, particles.fix, particles.actual, particles.count], ["Particles3", "reference", "img/titles2/Particles3.png_", 1], "a parameter with no @type file is not a file");
  assert.equal(text.slice(particles.sites[0].at.start, particles.sites[0].at.end), "particles3");
  assert.equal(particles.sites[0].where, 'js/plugins.js plugin "Particles" parameter "P3 File Name"');
  const back = find(result, "case", "back");
  assert.deepEqual([back.to, back.count, back.sites.length], ["Back", 2, 2], "a struct in a list, escaped inside the JSON");
  for (const site of back.sites) assert.equal(text.slice(site.at.start, site.at.end), "back");
  assert.equal(find(result, "missing", "Gone").expected, "img/pictures/Gone");
  assert.equal(find(result, "missing", "Reco.json"), undefined, "a value that has its extension");
  assert.equal(find(result, "missing", "nope"), undefined, "a plugin command's argument is not a parameter");
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

test("paths: a folder written in plugin code is case-checked", () => {
  // loadBitmap('img/menus/CG/', name) asks for a folder by name, with no file extension.
  const dir = makeGame({
    "js/plugins/Menu.js": "ImageManager.loadCg = function (n) { return this.loadBitmap('img/menus/CG/', n, 0, true); };\nconst absent = 'img/menus/equip/';\nconst built = `img/${x}/`;",
    "img/menus/cg/Cg_1.png": "x",
  });
  const result = scan(dir);
  const folder = find(result, "case", "img/menus/CG/");
  assert.deepEqual([folder.to, folder.fix, folder.actual], ["img/menus/cg/", "reference", "img/menus/cg"]);
  assert.equal(find(result, "missing", "img/menus/equip/"), undefined, "a folder that is absent may be an unused plugin: no missing report");
  assert.equal(find(result, "case", "img/${x}/"), undefined, "a name built at run time cannot be checked");
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

test("paths: a Live2D model file spelled differently from its folder, also in a folder left out of the build", () => {
  const dir = makeGame({
    "live2dModel/Model_01/model_01.model3.json": "{}",
    "live2dModel/Model_01/Model_01.moc3": "x",
    "live2dModel/Model_02/Model_02.model3.json": "{}",
    "live2dModel/Model_03/Model_03_alt.model3.json": "{}",
    "img/live2d/Hero/hero.model.json": "{}",
  });
  const game = analyzeGame(dir);
  const files = collectFiles(game, {});
  // Left out of the build (not an engine folder): only the Live2D check reads it.
  const others = otherFiles(game, files);
  assert.ok(others.some((f) => f.rel === "live2dModel/Model_01/model_01.model3.json"));
  const { issues } = scanPaths(files, { others });
  const models = issues.filter((i) => i.kind === "model").map((i) => [i.actual, i.to, i.fix]);
  assert.deepEqual(models.sort(), [
    ["img/live2d/Hero/hero.model.json", "img/live2d/Hero/Hero.model.json", "file"],
    ["live2dModel/Model_01/model_01.model3.json", "live2dModel/Model_01/Model_01.model3.json", "file"],
  ]);
  assert.equal(countByKind(issues).model, 2);
  assert.ok(pathWarnings(issues).some((w) => /2 Live2D model file\(s\).*must be live2dModel\/Model_01\/Model_01\.model3\.json/.test(w)));
  // Without the left-out folders, only the one in the build.
  assert.deepEqual(scan(dir).issues.filter((i) => i.kind === "model").map((i) => i.actual), ["img/live2d/Hero/hero.model.json"]);
});

test("paths: a data file that is not JSON and a plugin list that cannot be read are skipped, not errors", () => {
  const dir = makeGame({
    "data/Broken.json": "{ not json",
    "js/plugins.js": "var $plugins = [ {",
    "img/characters/Actor1.png": "x",
    "data/Actors.json": [null, { characterName: "actor1", faceName: "", battlerName: "" }],
  });
  const result = scan(dir);
  assert.deepEqual(result.issues.map((i) => [i.kind, i.source]), [["case", "data/Actors.json"]]);
});

test("paths: characters that break a web address", () => {
  const dir = makeGame({ "img/pictures/a#1.png": "x", "img/pictures/ok.png": "x" });
  const result = scan(dir);
  assert.deepEqual(result.issues.filter((i) => i.kind === "unsafe").map((i) => i.source), ["img/pictures/a#1.png"]);
});

test("paths: a folder written in code gets its own warning line, apart from file references", () => {
  const dir = makeGame({
    "js/plugins/Menu.js": "this.loadBitmap('img/menus/CG/', n, 0, true);",
    "img/menus/cg/Cg_1.png": "x",
    "data/Actors.json": [null, { characterName: "", faceName: "actor1", battlerName: "" }],
    "img/faces/Actor1.png": "x",
  });
  const lines = pathWarnings(scan(dir).issues);
  assert.equal(lines.length, 2, lines.join("\n"));
  assert.match(lines[0], /1 reference\(s\).*data\/Actors\.json/, "a file reference keeps the usual line");
  assert.match(lines[1], /Menu\.js.*img\/menus\/CG\/.*must be "img\/menus\/cg\/"/, "the folder has its own line");
  assert.match(lines[1], /Now Loading/);
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

test("paths: a file the MV engine always loads unencrypted (img/system/Window.png) spelled differently is renamed, not the engine", () => {
  const dir = makeGame({
    "js/rmmz_core.js": null,
    "js/rpg_core.js": 'Decrypter._ignoreList = [\n    "img/system/Window.png"\n];',
    "js/rpg_windows.js": "this.windowskin = ImageManager.loadSystem('Window');\nthis.contents.blt(ImageManager.loadSystem('IconSet'), 0, 0);",
    "js/rpg_scenes.js": "ImageManager.reserveSystem('Balloon', 0, this._id);",
    "data/System.json": { gameTitle: "Demo", hasEncryptedImages: true },
    // The plain window.png is the one the engine reads; window.rpgmvp is for a plugin's loadSystem("window").
    "img/system/window.png": "x",
    "img/system/window.rpgmvp": "x",
    "img/system/iconset.rpgmvp": "x",
    "img/system/Balloon.rpgmvp": "x",
  });
  const { issues } = scan(dir);
  const engine = issues.filter((i) => i.kind === "engine").map((i) => [i.source, i.actual, i.to, i.fix]);
  assert.deepEqual(engine.sort(), [
    ["js/rpg_core.js", "img/system/window.png", "img/system/Window.png", "file"],
    ["js/rpg_windows.js", "img/system/iconset.rpgmvp", "img/system/IconSet.rpgmvp", "file"],
  ]);
  assert.equal(countByKind(issues).engine, 2);
  assert.ok(pathWarnings(issues).some((w) => /2 file\(s\) the engine asks for by name.*img\/system\/window\.png \(must be img\/system\/Window\.png\)/.test(w)));

  const report = fixPaths(dir, { level: "standard", apply: true });
  assert.deepEqual(report.renames.map((r) => r.to.split(path.sep).join("/")).sort(), ["img/system/IconSet.rpgmvp", "img/system/Window.png"]);
  assert.equal(report.rolledBack, false);
  assert.equal(report.remaining.engine, 0);
  const names = fs.readdirSync(path.join(dir, "img", "system")).sort();
  assert.deepEqual(names, ["Balloon.rpgmvp", "IconSet.rpgmvp", "Window.png", "window.rpgmvp"]);
  assert.equal(fixPaths(dir, { level: "safe" }).renames.length, 0, "safe renames nothing");
});

test("paths: MZ engine names follow the encryption (.png_), and two files for one name are left to a person", () => {
  const encrypted = makeGame({
    "js/rmmz_windows.js": 'this.windowskin = ImageManager.loadSystem("Window");',
    "data/System.json": { gameTitle: "Demo", hasEncryptedImages: true },
    "img/system/window.png_": "x",
  });
  assert.deepEqual(scan(encrypted).issues.map((i) => [i.kind, i.actual, i.to, i.fix]), [["engine", "img/system/window.png_", "img/system/Window.png_", "file"]]);
  // Not encrypted: Window.png is asked for, and window.png_ is no match.
  const plain = makeGame({
    "js/rmmz_windows.js": 'this.windowskin = ImageManager.loadSystem("Window");',
    "img/system/window.png_": "x",
  });
  assert.deepEqual(scan(plain).issues, []);
  if (caseSensitiveDisk) {
    const two = makeGame({
      "js/rmmz_windows.js": 'ImageManager.loadSystem("Window");',
      "img/system/window.png": "x",
      "img/system/WINDOW.png": "x",
    });
    assert.equal(find(scan(two), "engine").fix, null);
  }
});

test("paths: a name a plugin loads (loadTitle2(\"Title\")) spelled differently from the file is rewritten in the plugin, from --level standard", () => {
  const plugin = [
    'this._title = new Sprite(ImageManager.loadTitle2("Title"));',
    "this._cursor = new Sprite(ImageManager.loadTitle2('Cursor'));",
    'ImageManager.loadPicture("NoSuchPicture");',
  ].join("\n");
  const dir = makeGame({
    "js/plugins/TitleMenu.js": plugin,
    "img/titles2/title.png": "x",
    "img/titles2/Cursor.png": "x",
  });
  const { issues } = scan(dir);
  assert.deepEqual(issues.map((i) => [i.kind, i.source, i.ref, i.actual, i.to, i.fix, i.sites[0].where]), [
    ["case", "js/plugins/TitleMenu.js", "Title", "img/titles2/title.png", "title", "reference", "js/plugins/TitleMenu.js:1"],
  ]);

  assert.equal(fixPaths(dir, { level: "safe" }).edits.length, 0, "safe leaves plugin code alone");
  const report = fixPaths(dir, { level: "standard", apply: true });
  assert.equal(report.rolledBack, false);
  assert.equal(report.remaining.case, 0);
  assert.equal(fs.readFileSync(path.join(dir, "js", "plugins", "TitleMenu.js"), "utf8"), plugin.replace('"Title"', '"title"'));
  assert.deepEqual(fs.readdirSync(path.join(dir, "img", "titles2")).sort(), ["Cursor.png", "title.png"], "the files are not renamed");
});

test("paths: a name a plugin loads follows the encryption (MV .rpgmvp)", () => {
  const dir = makeGame({
    "js/rmmz_core.js": null,
    "js/rpg_core.js": "",
    "data/System.json": { gameTitle: "Demo", hasEncryptedImages: true },
    "js/plugins/Hud.js": 'ImageManager.loadSystem("hud_gauge");',
    "img/system/Hud_Gauge.rpgmvp": "x",
  });
  assert.deepEqual(scan(dir).issues.map((i) => [i.kind, i.expected, i.actual, i.to]), [["case", "img/system/hud_gauge.rpgmvp", "img/system/Hud_Gauge.rpgmvp", "Hud_Gauge"]]);
});

test("paths: the start of a name a plugin's own loader builds (\"actor_\" + id) is checked against the files in its folder", () => {
  const loader = "ImageManager.loadMenusFaces3 = function(filename) {\n    return this.loadBitmap('img/menus/faces/faces3/', filename, 0, true);\n};";
  const menu = [
    'this._char = new Sprite(ImageManager.loadMenusFaces3("actor_" + this._actor._actorId));',
    'this._face = ImageManager.loadMenusFaces3("Actor_" + id);', // already right
    'this._other = ImageManager.loadMenusFaces3("bust_" + id);', // no such file in any case: not ours to judge
    'this._pic = ImageManager.loadPicture("cg_" + n);', // two spellings on disk: a person picks
  ].join("\n");
  const dir = makeGame({
    "js/plugins/MenuCore.js": loader,
    "js/plugins/MenuFaces.js": menu,
    "img/menus/faces/faces3/Actor_1.png": "x",
    "img/menus/faces/faces3/Actor_2.png": "x",
    "img/pictures/CG_1.png": "x",
    "img/pictures/Cg_2.png": "x",
  });
  const { issues } = scan(dir);
  assert.deepEqual(issues.map((i) => [i.kind, i.ref, i.to, i.fix, i.sites[0].where]).sort(), [
    ["case", "actor_…", "Actor_", "reference", "js/plugins/MenuFaces.js:1"],
    ["case", "cg_…", null, null, "js/plugins/MenuFaces.js:4"],
  ]);
  const report = fixPaths(dir, { level: "standard", apply: true });
  assert.equal(report.rolledBack, false);
  assert.equal(fs.readFileSync(path.join(dir, "js", "plugins", "MenuFaces.js"), "utf8"), menu.replace('"actor_"', '"Actor_"'));
});

test("paths: a fix that would leave a new problem is rolled back, and a fix with nothing to do leaves no backup", () => {
  // Renaming Bg.PNG to Bg.png breaks the percent-encoded reference, which cannot be rewritten safely.
  const dir = makeGame({
    "index.html": '<html><body><img src="img/pictures/B%67.PNG"><script src="js/main.js"></script></body></html>',
    "img/pictures/Bg.PNG": "x",
  });
  const report = fixPaths(dir, { level: "standard", apply: true });
  assert.equal(report.rolledBack, true);
  assert.ok(report.skipped.some((s) => /everything was restored/.test(s)), report.skipped.join("\n"));
  assert.deepEqual(fs.readdirSync(path.join(dir, "img", "pictures")), ["Bg.PNG"]);
  assert.deepEqual(report.remaining, report.before);

  const clean = makeGame({ "img/pictures/Bg.png": "x" });
  const none = fixPaths(clean, { level: "standard", apply: true });
  assert.equal(none.backup, null);
  assert.equal(fs.existsSync(path.join(clean, ".rwk-paths-backup")), true, "the backup folder may stay, but empty");
  assert.deepEqual(fs.readdirSync(path.join(clean, ".rwk-paths-backup")), []);
});
