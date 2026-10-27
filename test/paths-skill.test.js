// The rwk-paths skills' scripts (.claude/skills/rwk-paths/scripts): scan.js and fix.js on a game with every kind of problem.

import assert from "node:assert/strict";
import { execFileSync, spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";

const SCRIPTS = path.resolve(".claude/skills/rwk-paths/scripts");
const run = (script, ...args) => spawnSync(process.execPath, [path.join(SCRIPTS, script), ...args], { encoding: "utf8" });

function makeGame() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "rwk-fix-"));
  const files = {
    "index.html": '<script src="js/main.js"></script><link href="css/Game.css" rel="stylesheet">',
    "js/rmmz_core.js": "",
    "js/main.js": "",
    "js/plugins.js": 'var $plugins = [\n{"name":"myplugin","status":true,"description":"","parameters":{}}\n];\n',
    "js/plugins/MyPlugin.js": 'const p = "Img/Pictures/Logo.png";\n',
    "data/System.json": '{"gameTitle":"Demo","advanced":{"gameId":1}}',
    "data/Actors.json": '[\nnull,\n{"id":1,"characterName":"actor1","faceName":"Actor1","battlerName":""},\n{"id":2,"characterName":"a#1","faceName":"","battlerName":""}\n]',
    "css/game.css": "body{background:url(../img/pictures/logo.png)}",
    "img/characters/Actor1.PNG": "x",
    "img/characters/a#1.png": "x",
    "img/Faces/Actor1.png": "x",
    "img/pictures/Logo.png": "x",
  };
  for (const [rel, text] of Object.entries(files)) {
    fs.mkdirSync(path.dirname(path.join(dir, rel)), { recursive: true });
    fs.writeFileSync(path.join(dir, rel), text);
  }
  return dir;
}
const read = (dir, rel) => fs.readFileSync(path.join(dir, rel), "utf8");
const tree = (dir) => fs.readdirSync(dir, { recursive: true }).filter((f) => !f.startsWith(".rwk-paths-backup")).sort();

test("scan.js: --json lists the issues by kind, and the exit code says whether there is one", () => {
  const dir = makeGame();
  const out = run("scan.js", dir, "--json");
  assert.equal(out.status, 1);
  const result = JSON.parse(out.stdout);
  assert.deepEqual(result.counts, { case: 5, unicode: 0, missing: 0, ext: 1, folder: 1, collision: 0, unsafe: 1 });
  const quick = JSON.parse(run("scan.js", dir, "--level", "quick", "--json").stdout);
  assert.equal(quick.counts.case, 0, "quick: names only");
  assert.equal(quick.counts.ext, 1);
  assert.equal(run("scan.js", dir, "--level", "bogus").status, 64);
});

test("scan.js: deep lists plugin code that builds paths", () => {
  const dir = makeGame();
  fs.writeFileSync(path.join(dir, "js", "plugins", "Dyn.js"), 'const b = ImageManager.loadPicture(name);\nconst x = 1;\n');
  const result = JSON.parse(run("scan.js", dir, "--level", "deep", "--json").stdout);
  assert.deepEqual(result.review.map((r) => [r.file, r.line]), [["js/plugins/Dyn.js", 1]]);
});

test("fix.js: without --apply nothing is written", () => {
  const dir = makeGame();
  const before = tree(dir);
  const out = run("fix.js", dir, "--level", "standard");
  assert.equal(out.status, 0);
  assert.match(out.stdout, /Plan \(nothing written/);
  assert.deepEqual(tree(dir), before);
  assert.match(read(dir, "data/Actors.json"), /"actor1"/);
  assert.ok(!fs.existsSync(path.join(dir, ".rwk-paths-backup")));
});

test("fix.js: safe rewrites references only, keeping the formatting", () => {
  const dir = makeGame();
  const before = tree(dir);
  assert.equal(run("fix.js", dir, "--level", "safe", "--apply").status, 0);
  assert.deepEqual(tree(dir), before, "no file is renamed");
  assert.equal(read(dir, "data/Actors.json"), '[\nnull,\n{"id":1,"characterName":"Actor1","faceName":"Actor1","battlerName":""},\n{"id":2,"characterName":"a#1","faceName":"","battlerName":""}\n]');
  assert.match(read(dir, "js/plugins.js"), /"name":"MyPlugin"/);
  assert.match(read(dir, "index.html"), /href="css\/game\.css"/);
  assert.match(read(dir, "css/game.css"), /url\(\.\.\/img\/pictures\/Logo\.png\)/);
  assert.match(read(dir, "js/plugins/MyPlugin.js"), /Img\/Pictures/, "code is left alone at the safe level");
});

test("fix.js: thorough fixes everything, the scan is clean, and --undo restores the game", () => {
  const dir = makeGame();
  const original = Object.fromEntries(tree(dir).filter((f) => fs.statSync(path.join(dir, f)).isFile()).map((f) => [f, read(dir, f)]));
  const out = JSON.parse(run("fix.js", dir, "--level", "thorough", "--apply", "--json").stdout);
  assert.equal(out.rolledBack, false);
  assert.deepEqual(out.remaining, { case: 0, unicode: 0, missing: 0, ext: 0, folder: 0, collision: 0, unsafe: 0 });
  assert.ok(fs.existsSync(path.join(dir, "img", "faces", "Actor1.png")));
  assert.ok(fs.existsSync(path.join(dir, "img", "characters", "Actor1.png")));
  assert.match(read(dir, "data/Actors.json"), /"characterName":"a_1"/);
  assert.match(read(dir, "js/plugins/MyPlugin.js"), /"img\/pictures\/Logo\.png"/);
  assert.equal(run("scan.js", dir).status, 0);

  execFileSync(process.execPath, [path.join(SCRIPTS, "fix.js"), dir, "--undo", out.backup]);
  const restored = Object.fromEntries(tree(dir).filter((f) => fs.statSync(path.join(dir, f)).isFile()).map((f) => [f, read(dir, f)]));
  assert.deepEqual(restored, original);
});

test("fix.js: a reference to a name that is only a guess is never rewritten", () => {
  const dir = makeGame();
  fs.writeFileSync(path.join(dir, "img", "characters", "hero.png"), "x");
  fs.writeFileSync(path.join(dir, "img", "characters", "Hero.PNG"), "x");
  fs.writeFileSync(path.join(dir, "data", "Actors.json"), '[null,{"id":1,"characterName":"HERO","faceName":"","battlerName":""}]');
  run("fix.js", dir, "--level", "thorough", "--apply");
  assert.match(read(dir, "data/Actors.json"), /"HERO"/);
});
