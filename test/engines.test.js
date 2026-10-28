// The per-engine table (cli/lib/engines.js) and the analyze step that reads it.

import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { test } from "node:test";
import { ENGINES, detectEngine, engineOf, markerList } from "../cli/lib/engines.js";
import { analyzeGame } from "../cli/lib/game.js";
import { listSaveFiles } from "../cli/lib/cloudflare.js";

function game(files) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "rwk-engine-"));
  for (const [rel, content] of Object.entries({ "index.html": "<html></html>", "data/System.json": "{}", ...files })) {
    const abs = path.join(dir, ...rel.split("/"));
    fs.mkdirSync(path.dirname(abs), { recursive: true });
    fs.writeFileSync(abs, content);
  }
  return dir;
}

test("engines: detected by their marker file, MZ when an old config names none", () => {
  const has = (...wanted) => (...segments) => wanted.includes(segments.join("/"));
  assert.equal(detectEngine(has("js/rmmz_core.js")), "MZ");
  assert.equal(detectEngine(has("js/rpg_core.js")), "MV");
  assert.equal(detectEngine(has("js/main.js")), null);
  assert.equal(engineOf("MV").saveExtension, ".rpgsave");
  assert.equal(engineOf(undefined), ENGINES.MZ);
  assert.equal(markerList(), "neither js/rmmz_core.js nor js/rpg_core.js");
});

test("engines: analyze reads the fingerprint and save folder from the table", () => {
  const mz = analyzeGame(game({ "js/rmmz_core.js": "", "data/System.json": JSON.stringify({ gameTitle: "A", advanced: { gameId: 42 } }), "save/file1.rmmzsave": "x", "save/file2.rpgsave": "x" }));
  assert.equal(mz.engine, "MZ");
  assert.equal(mz.fingerprint, "mz:42");
  assert.deepEqual(listSaveFiles(mz.saveDir, mz.engine).map((s) => s.name), ["file1"]);

  const mv = analyzeGame(game({ "js/rpg_core.js": "", "data/System.json": JSON.stringify({ gameTitle: "B", advanced: { gameId: 42 } }), "save/file1.rpgsave": "x" }));
  assert.equal(mv.engine, "MV");
  assert.equal(mv.fingerprint, "mv:B", "MV has no gameId");
  assert.deepEqual(listSaveFiles(mv.saveDir, mv.engine).map((s) => s.name), ["file1"]);

  assert.throws(() => analyzeGame(game({ "js/main.js": "" })), /Unknown engine \(neither js\/rmmz_core\.js nor js\/rpg_core\.js found\)/);
});
