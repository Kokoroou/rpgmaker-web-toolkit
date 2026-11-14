// rwk fix-paths (cli/commands/fix-paths.js): the plan, the question, --apply, --undo and what it says next.
// The fixing itself is cli/lib/paths-fix.js, tested through the skill's script in paths-skill.test.js.

import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { fixPaths } from "../cli/commands/fix-paths.js";
import { listBackups } from "../cli/lib/paths-fix.js";
import { parseCommandLine } from "../cli/lib/args.js";
import { setQuiet, setUnattended } from "../cli/lib/ui.js";
import { renderSummary, runResult } from "../cli/lib/report.js";
import { warnPathProblems } from "../cli/lib/build-checks.js";
import { analyzeGame, collectFiles } from "../cli/lib/game.js";

function makeGame(t, { www = false } = {}) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "rwk-fixcmd-"));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  const root = www ? path.join(dir, "www") : dir;
  const files = {
    "index.html": '<script src="js/main.js"></script>',
    "js/rmmz_core.js": "",
    "js/main.js": "",
    "js/plugins.js": "var $plugins = [];\n",
    "data/System.json": '{"gameTitle":"Demo","advanced":{"gameId":1}}',
    "data/Actors.json": '[null,{"id":1,"characterName":"actor1","faceName":"","battlerName":""},{"id":2,"characterName":"a#1","faceName":"","battlerName":""}]',
    "img/characters/Actor1.png": "x",
    "img/characters/a#1.png": "x",
    "img/pictures/Logo.PNG": "x",
  };
  for (const [rel, text] of Object.entries(files)) {
    fs.mkdirSync(path.dirname(path.join(root, rel)), { recursive: true });
    fs.writeFileSync(path.join(root, rel), text);
  }
  return { dir, root };
}
const read = (root, rel) => fs.readFileSync(path.join(root, rel), "utf8");
const quiet = (t) => {
  setQuiet(true);
  t.after(() => setQuiet(false));
};
const noQuestion = { choose: () => assert.fail("no question"), confirm: () => assert.fail("no question") };

test("args: fix-paths takes a folder, --level, --undo and --apply", () => {
  const cli = parseCommandLine(["fix-paths", "./game", "--level", "safe", "--apply"], { stdinIsTTY: true });
  assert.deepEqual([cli.spec.name, cli.target, cli.flags.level, cli.flags.apply], ["fix-paths", "./game", "safe", true]);
  assert.equal(parseCommandLine(["fix-paths", "./game", "--undo", "last"], { stdinIsTTY: true }).flags.undo, "last");
  assert.throws(() => parseCommandLine(["deploy", "./game", "--apply"], { stdinIsTTY: true }), /Unknown option --apply/);
  assert.throws(() => parseCommandLine(["analyze", "./game", "--level", "safe"], { stdinIsTTY: true }), /Unknown option --level/);
});

test("fix-paths: unattended without --apply shows the plan and changes nothing", async (t) => {
  quiet(t);
  setUnattended(true);
  t.after(() => setUnattended(false));
  const { dir, root } = makeGame(t);
  const result = await fixPaths(dir, { level: "standard" }, noQuestion);
  assert.equal(result.dryRun, true);
  assert.deepEqual(result.fix.renames.map((r) => r.to.split(path.sep).join("/")), ["img/pictures/Logo.png"]);
  assert.deepEqual(result.fix.edits.map((e) => [e.from, e.to]), [["actor1", "Actor1"]]);
  assert.match(result.next[0], /--level standard --apply$/);
  assert.match(renderSummary(runResult("fix-paths", result, [])), /plan only, nothing changed/);
  assert.match(read(root, "data/Actors.json"), /"actor1"/);
  assert.ok(fs.existsSync(path.join(root, "img/pictures/Logo.PNG")));
  assert.ok(!fs.existsSync(path.join(root, ".rwk-paths-backup")));
});

test("fix-paths: in a terminal it asks the level and whether to apply; a no changes nothing", async (t) => {
  quiet(t);
  const { dir, root } = makeGame(t);
  const asked = [];
  const result = await fixPaths(dir, {}, {
    choose: async (text, options, index) => (asked.push([text, options.map((o) => o.value), index]), "safe"),
    confirm: async (text) => (asked.push(text), false),
  });
  assert.deepEqual(asked[0], ["How much may be changed?", ["safe", "standard", "thorough"], 1]);
  assert.match(asked[1], /Make these 1 change\(s\)/);
  assert.equal(result.dryRun, true);
  assert.equal(result.fix.level, "safe");
  assert.deepEqual(result.fix.renames, [], "safe renames nothing");
  assert.match(read(root, "data/Actors.json"), /"actor1"/);
});

test("fix-paths: a yes applies, keeps a backup and says to deploy; --undo last puts it back", async (t) => {
  quiet(t);
  const { dir, root } = makeGame(t);
  const original = read(root, "data/Actors.json");
  const result = await fixPaths(dir, { level: "thorough" }, { confirm: async () => true });
  assert.ok(!result.dryRun);
  assert.match(read(root, "data/Actors.json"), /"characterName":"Actor1"/);
  assert.match(read(root, "data/Actors.json"), /"characterName":"a_1"/);
  assert.ok(fs.existsSync(path.join(root, "img/pictures/Logo.png")));
  assert.deepEqual(result.fix.remaining, { case: 0, unicode: 0, missing: 0, ext: 0, folder: 0, collision: 0, unsafe: 0 });
  assert.equal(listBackups(dir).length, 1);
  assert.match(result.next[0], new RegExp(`rwk deploy "${dir.replace(/\\/g, "\\\\")}"`));
  assert.match(result.next[1], /--undo last/);

  const undone = await fixPaths(dir, { undo: "last" }, noQuestion);
  assert.deepEqual(undone.facts, [["Restored", "1 file(s), 2 rename(s)"]]);
  assert.equal(read(root, "data/Actors.json"), original);
  assert.ok(fs.existsSync(path.join(root, "img/pictures/Logo.PNG")));
  assert.ok(fs.existsSync(path.join(root, "img/characters/a#1.png")));
});

test("fix-paths: --apply needs no question, and a game in www/ keeps its backup there", async (t) => {
  quiet(t);
  const { dir, root } = makeGame(t, { www: true });
  const result = await fixPaths(dir, { level: "standard", apply: true }, noQuestion);
  assert.ok(result.fix.backup.startsWith(path.join(root, ".rwk-paths-backup")));
  assert.equal(listBackups(dir).length, 1);
  const again = await fixPaths(dir, { level: "standard", apply: true }, noQuestion);
  assert.deepEqual(again.facts, [["Changes", "none"]], "nothing left: nothing done, no empty backup");
  assert.equal(listBackups(dir).length, 1);
});

test("fix-paths: wrong usage and no backup are explained", async (t) => {
  quiet(t);
  const { dir } = makeGame(t);
  await assert.rejects(fixPaths(dir, { level: "all" }, noQuestion), (err) => err.exitCode === 64 && /safe, standard, thorough/.test(err.hint));
  await assert.rejects(fixPaths(dir, { undo: "last", apply: true }, noQuestion), (err) => err.exitCode === 64);
  await assert.rejects(fixPaths(dir, { undo: "last" }, noQuestion), /no backup/);
  await assert.rejects(fixPaths(dir, { undo: path.join(dir, "nope") }, noQuestion), /not a backup/);
  await assert.rejects(fixPaths("my-game", {}, noQuestion), (err) => err.exitCode === 64);
});

test("analyze points to fix-paths when it can fix something, and not when nothing is left", (t) => {
  const { dir } = makeGame(t);
  const analyze = () => spawnSync(process.execPath, [path.resolve("cli/index.js"), "analyze", dir, "--no-color"], { encoding: "utf8", env: { ...process.env, NODE_V8_COVERAGE: "", RWK_LIMITS_URL: "off" } });
  assert.match(analyze().stderr, new RegExp(`rwk fix-paths "${dir.replace(/[\\^$.*+?()[\]{}|]/g, "\\$&")}"`));
  const counts = warnPathProblems(collectFiles(analyzeGame(dir), {}), dir);
  assert.ok(counts.case && counts.ext && counts.unsafe);
});
