// rwk test: the checks on what the browser saw, and real runs in Chrome on a
// fake game (test/fixtures/stub-engine.js), from its folder and from a link.
// The runs are skipped when no Chrome is found (CHROME_PATH sets one).

import assert from "node:assert/strict";
import fs from "node:fs";
import http from "node:http";
import os from "node:os";
import path from "node:path";
import { test } from "node:test";
import { addProblem, describe, pluginOf, responseProblem, testGame } from "../cli/commands/test.js";
import { findChrome } from "../cli/lib/chrome.js";
import { failedResult } from "../cli/lib/report.js";
import { buildIndex } from "../cli/lib/test-server.js";
import { contentTypeOf } from "../cli/lib/cloudflare.js";

const STUB = fs.readFileSync(path.join(import.meta.dirname, "fixtures", "stub-engine.js"), "utf8");
// The smallest PNG (1×1).
const PNG = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==", "base64");

function fakeGame(faults = {}) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "rwk-test-game-"));
  const write = (rel, body) => {
    fs.mkdirSync(path.dirname(path.join(dir, rel)), { recursive: true });
    fs.writeFileSync(path.join(dir, rel), body);
  };
  write(
    "index.html",
    `<!DOCTYPE html><html><head><meta charset="utf-8"><title>Stub</title>
<style>html,body{margin:0;height:100%;overflow:hidden}canvas{display:block;width:100%;height:100%}</style></head>
<body><canvas id="gameCanvas"></canvas>
<script>window.STUB_FAULTS = ${JSON.stringify(faults)}; window.RWK = { config: { sync: { enabled: true } } };</script>
<script src="js/rmmz_core.js"></script></body></html>`
  );
  write("js/rmmz_core.js", STUB);
  write("js/plugins.js", "var $plugins =\n[\n];\n");
  write("data/System.json", JSON.stringify({ gameTitle: "Stub Game", advanced: { gameId: 4242 } }));
  write("img/pictures/Title.png", PNG);
  return dir;
}

let chrome = null;
try {
  chrome = findChrome();
} catch {
  chrome = null;
}
const browserTest = chrome ? test : test.skip;
const quick = { walkSeconds: 1 };
const out = () => fs.mkdtempSync(path.join(os.tmpdir(), "rwk-test-out-"));
const byName = (steps) => Object.fromEntries(steps.map((s) => [s.name, s]));

test("test: which responses are problems", () => {
  const caseOf = (rel) => (rel === "img/faces/actor1.png" ? "img/faces/Actor1.png" : null);
  assert.equal(responseProblem({ status: 200, rel: "index.html", sameOrigin: true }), null);
  assert.equal(responseProblem({ status: 404, rel: "api/saves/file1", sameOrigin: true }), null, "a save the cloud does not have");
  assert.equal(responseProblem({ status: 404, rel: "favicon.ico", sameOrigin: true }), null);
  assert.match(responseProblem({ status: 404, rel: "img/faces/actor1.png", sameOrigin: true }, caseOf), /img\/faces\/Actor1\.png: only the letter case differs.*rwk fix-paths/);
  assert.equal(responseProblem({ status: 404, rel: "audio/se/Gone.ogg", sameOrigin: true }, caseOf), "audio/se/Gone.ogg: HTTP 404");
  assert.equal(responseProblem({ status: 500, method: "PUT", rel: "api/saves/file1", sameOrigin: true }), "api/saves/file1: HTTP 500 (PUT)");
  assert.equal(responseProblem({ status: 403, rel: "https://cdn.example.com/x.js", sameOrigin: false }), "https://cdn.example.com/x.js: HTTP 403");
});

test("test: the same problem is one line with a count", () => {
  const list = [];
  addProblem(list, "network", "a.png: HTTP 404", "walk");
  addProblem(list, "network", "a.png: HTTP 404", "menu");
  addProblem(list, "script", "uncaught Error", "menu");
  assert.deepEqual(list, [
    { kind: "network", text: "a.png: HTTP 404", step: "walk", count: 2 },
    { kind: "script", text: "uncaught Error", step: "menu", count: 1 },
  ]);
});

test("test: the plugin an error came from, and a step in a few words", () => {
  assert.equal(pluginOf("TypeError\n    at http://x/js/plugins/YEP_Core.js:12:3"), " (plugin YEP_Core)");
  assert.equal(pluginOf("at http://x/js/plugins/RWK_Speed.js:1:1"), " (plugin RWK_Speed, rpgmaker-web-toolkit)");
  assert.equal(pluginOf("at http://x/js/rmmz_core.js:1:1"), "");
  assert.equal(describe("boot", { engine: "MV", scene: "Scene_Title", toolkit: false }), "MV, Scene_Title, no toolkit");
  assert.equal(describe("walk", { steps: 3, from: { mapId: 1 }, to: { mapId: 2 }, scene: "Scene_Map" }), "3 step(s), now on map 2");
  assert.equal(describe("toolkit menu", { skipped: "the toolkit is not in this game" }), "the toolkit is not in this game");
});

test("test: the local site serves names with the web's letter case", () => {
  const index = buildIndex([{ rel: "img/faces/Actor1.png", abs: "/g/img/faces/Actor1.png", size: 3 }], new Map([["js/plugins.js", "x"]]));
  assert.deepEqual(index.find("js/plugins.js"), { body: "x" });
  assert.deepEqual(index.find("img/faces/Actor1.png"), { file: "/g/img/faces/Actor1.png", size: 3 });
  assert.equal(index.find("img/faces/actor1.png"), null);
  assert.equal(index.caseOf("img/faces/actor1.png"), "img/faces/Actor1.png");
  assert.equal(index.caseOf("img/faces/Actor1.png"), null);
  assert.equal(index.caseOf("img/faces/none.png"), null);
});

test("test: a failed run keeps what it found in the JSON result", () => {
  const err = Object.assign(new Error("1 step(s) failed (boot)"), { hint: "h", result: { site: "s", url: "u", test: { steps: [] }, facts: [["a", "b"]], next: ["n"] } });
  const r = failedResult("test", err, []);
  assert.equal(r.ok, false);
  assert.equal(r.site, "s");
  assert.deepEqual(r.test, { steps: [] });
  assert.equal(r.facts, undefined);
  assert.equal(r.next, undefined);
  assert.equal(r.error, "1 step(s) failed (boot)");
});

browserTest("test: a game folder that works passes every step", { timeout: 180000 }, async () => {
  const folder = out();
  const result = await testGame(fakeGame(), { out: folder }, quick);
  const steps = byName(result.test.steps);
  for (const name of ["open", "boot", "new game", "walk", "menu", "save", "cloud save", "load", "toolkit menu", "phone"]) {
    assert.equal(steps[name]?.status, "ok", `${name}: ${JSON.stringify(steps[name])}`);
  }
  assert.match(steps["cloud save"].detail, /uploaded: file1/);
  assert.match(steps.walk.detail, /step\(s\)/);
  assert.deepEqual(result.test.problems, []);
  const report = JSON.parse(fs.readFileSync(path.join(folder, "report.json"), "utf8"));
  assert.equal(report.steps.length, 10);
  assert.ok(fs.readdirSync(folder).some((f) => f.endsWith("-phone.png")), "a screenshot per step");
});

browserTest("test: a broken game folder fails with each problem", { timeout: 180000 }, async () => {
  const game = fakeGame({ missingImage: true, menuThrows: true, consoleError: true, engineError: true });
  await assert.rejects(testGame(game, { out: out() }, quick), (err) => {
    assert.match(err.message, /problem\(s\) found/);
    const texts = err.result.test.problems.map((p) => `[${p.step}] ${p.text}`).join("\n");
    assert.match(texts, /img\/pictures\/title\.png: not found .*img\/pictures\/Title\.png: only the letter case differs/);
    assert.match(texts, /\[menu\] uncaught TypeError: Cannot read properties of undefined \(reading 'hp'\)/);
    assert.match(texts, /\[menu\] console\.error: Stub: a plugin failed/);
    assert.match(texts, /\[menu\] Error: caught by the engine/);
    return true;
  });
});

browserTest("test: a deployed site by its link, its save API answered on this PC", { timeout: 180000 }, async () => {
  const root = fakeGame();
  const seen = [];
  // The "deployed site": the game's files, and a save API that must never be called.
  const server = http.createServer((req, res) => {
    seen.push(`${req.method} ${req.url}`);
    const rel = decodeURIComponent(new URL(req.url, "http://x").pathname).replace(/^\/+/, "") || "index.html";
    const file = path.join(root, rel);
    if (rel.startsWith("api/") || !fs.existsSync(file)) {
      res.writeHead(rel.startsWith("api/") ? 500 : 404);
      return res.end();
    }
    res.writeHead(200, { "content-type": rel.endsWith(".html") ? "text/html" : contentTypeOf(rel) });
    res.end(fs.readFileSync(file));
  });
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  try {
    const link = `http://127.0.0.1:${server.address().port}/`;
    const result = await testGame(link, { out: out() }, quick);
    const steps = byName(result.test.steps);
    assert.equal(steps["cloud save"].status, "ok");
    assert.equal(result.url, link);
    assert.deepEqual(seen.filter((s) => s.includes("/api/")), [], "the site's own save API was not touched");
  } finally {
    server.closeAllConnections();
    await new Promise((resolve) => server.close(resolve));
  }
});
