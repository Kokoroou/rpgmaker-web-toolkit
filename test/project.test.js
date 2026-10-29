// rwk.json: the site name and file patterns that travel with the game folder.

import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { analyze } from "../cli/commands/analyze.js";
import { parseProjectFile, readProjectFile, siteNameFor, withProjectPatterns } from "../cli/lib/project.js";
import { warnings } from "../cli/lib/ui.js";

function makeGame(files = {}) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "rwk-project-"));
  for (const sub of ["js", "data", "img"]) fs.mkdirSync(path.join(dir, sub));
  fs.writeFileSync(path.join(dir, "index.html"), "<html></html>");
  fs.writeFileSync(path.join(dir, "js", "rmmz_core.js"), "");
  fs.writeFileSync(path.join(dir, "js", "plugins.js"), "var $plugins = [];");
  fs.writeFileSync(path.join(dir, "data", "System.json"), JSON.stringify({ gameTitle: "Demo", advanced: { gameId: 1 } }));
  for (const [rel, text] of Object.entries(files)) {
    fs.mkdirSync(path.dirname(path.join(dir, rel)), { recursive: true });
    fs.writeFileSync(path.join(dir, rel), text);
  }
  return dir;
}

const snapshot = (dir) => fs.readdirSync(dir, { recursive: true }).sort().map((f) => `${f}:${fs.statSync(path.join(dir, f)).mtimeMs}`);

test("rwk.json: parsed and checked", () => {
  assert.deepEqual(parseProjectFile({ name: "my-game", include: ["Fonts2"], exclude: [" data-tw/** "] }, "rwk.json"), {
    file: "rwk.json",
    name: "my-game",
    include: ["Fonts2"],
    exclude: ["data-tw/**"],
    problems: [],
  });
  assert.deepEqual(parseProjectFile({ $schema: "x" }).problems, [], "$schema is allowed");
  assert.match(parseProjectFile({ nmae: "x" }).problems[0], /unknown key "nmae" is ignored/);
  const bad = (raw, re) => assert.throws(() => parseProjectFile(raw), (err) => err.exitCode === 1 && re.test(err.message) && !!err.hint);
  bad([], /must hold a JSON object/);
  bad(null, /must hold a JSON object/);
  bad({ name: "My Game" }, /"name" in rwk\.json is not a site name/);
  bad({ name: 3 }, /not a site name/);
  bad({ exclude: "data-tw/**" }, /"exclude" in rwk\.json must be a list/);
  bad({ include: ["ok", ""] }, /"include" in rwk\.json must be a list/);
});

test("rwk.json: read next to index.html or in the folder given, and invalid JSON is an error", () => {
  const game = { root: makeGame({ "rwk.json": '{"name":"from-root"}' }) };
  game.folder = game.root;
  assert.equal(readProjectFile(game).name, "from-root");
  assert.equal(readProjectFile({ root: makeGame(), folder: makeGame() }), null);

  // An MV game in www/: the repository's root holds the file.
  const outer = fs.mkdtempSync(path.join(os.tmpdir(), "rwk-www-"));
  fs.writeFileSync(path.join(outer, "RWK.json"), '﻿{"exclude":["movies/**"]}');
  assert.deepEqual(readProjectFile({ root: makeGame(), folder: outer }).exclude, ["movies/**"]);

  const broken = makeGame({ "rwk.json": "{ name: x }" });
  assert.throws(() => readProjectFile({ root: broken, folder: broken }), (err) => err.exitCode === 1 && /is not valid JSON/.test(err.message));
});

test("rwk.json: --name wins, then the file, and a published game keeps its name", () => {
  const project = { name: "file-name", include: [], exclude: [], problems: [] };
  assert.equal(siteNameFor("flag-name", project, null), "flag-name");
  assert.equal(siteNameFor(undefined, project, null), "file-name");
  assert.equal(siteNameFor(undefined, project, { slug: "file-name" }), "file-name");
  assert.equal(siteNameFor(undefined, null, null), undefined);
  assert.equal(siteNameFor(undefined, { ...project, name: undefined }, null), undefined);
  warnings.length = 0;
  assert.equal(siteNameFor(undefined, project, { slug: "renamed" }), undefined, "the saved name is used");
  assert.match(warnings[0], /rwk\.json says "file-name", but this game is published as "renamed"/);
  warnings.length = 0;
});

test("rwk.json: its patterns are added to the config's", () => {
  const cfg = { slug: "g", include: ["a"], exclude: ["x/**"] };
  assert.equal(withProjectPatterns(cfg, null), cfg);
  const out = withProjectPatterns(cfg, { include: ["a", "b"], exclude: ["y/**"] });
  assert.deepEqual([out.include, out.exclude], [["a", "b"], ["x/**", "y/**"]]);
  assert.deepEqual(cfg.exclude, ["x/**"], "the saved config is not changed");
  assert.deepEqual(withProjectPatterns({}, { include: [], exclude: ["z"] }).exclude, ["z"]);
});

test("analyze: counts what rwk.json leaves out and brings in, and takes its site name", async () => {
  process.env.RWK_LIMITS_URL = "off";
  const game = makeGame({
    "img/a.png": "x",
    "data-tw/Map001.json": "{}",
    "Extra/notes.txt": "n",
    "rwk.json": JSON.stringify({ name: "repo-game", include: ["Extra"], exclude: ["data-tw/**"], typo: 1 }),
  });
  const before = snapshot(game);
  warnings.length = 0;
  const result = await analyze(game);
  assert.deepEqual(snapshot(game), before, "nothing written in the game folder");
  // index.html, js/rmmz_core.js, js/plugins.js, data/System.json, img/a.png, Extra/notes.txt (rwk.json itself is not served)
  assert.equal(result.build.files, 6);
  assert.match(result.facts.find(([k]) => k === "Site name")[1], /^repo-game .*from rwk\.json/);
  assert.equal(result.facts.find(([k]) => k === "Settings file")[1], path.join(game, "rwk.json"));
  assert.equal(result.next[0], `Nothing was published. To publish: rwk deploy "${game}"`, "no --name needed");
  assert.ok(warnings.some((w) => /unknown key "typo"/.test(w)));

  // --name still wins over the file.
  const flagged = await analyze(game, { name: "other-name" });
  assert.match(flagged.facts.find(([k]) => k === "Site name")[1], /^other-name \(on a first deploy, if no other game uses it\)$/);
  assert.match(flagged.next[0], /--name other-name$/);
  warnings.length = 0;
});
