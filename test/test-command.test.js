// rwk test: the checks on what the browser saw, and real runs in Chrome on a
// fake game (test/fixtures/stub-engine.js), from its folder and from a link.
// The runs are skipped when no Chrome is found (CHROME_PATH sets one).

import assert from "node:assert/strict";
import fs from "node:fs";
import http from "node:http";
import os from "node:os";
import path from "node:path";
import { test } from "node:test";
import { addProblem, describe, openSite, pluginOf, responseProblem, testGame, waitUpload } from "../cli/commands/playtest.js";
import { findChrome, launchChrome, openPage } from "../cli/lib/chrome.js";
import { CliError } from "../cli/lib/ui.js";
import { failedResult } from "../cli/lib/report.js";
import { buildIndex, localSaveApi, startTestServer } from "../cli/lib/playtest-server.js";
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

test("test: the local site answers as the deployed one", async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "rwk-test-site-"));
  fs.writeFileSync(path.join(dir, "Actor1.png"), PNG);
  const generated = new Map([
    ["index.html", "<p>game</p>"],
    // Not a body a Response can have: the server answers 500 instead of stopping.
    ["broken.txt", Symbol("no body")],
  ]);
  const server = await startTestServer({ files: [{ rel: "img/faces/Actor1.png", abs: path.join(dir, "Actor1.png"), size: PNG.length }], generated, vars: { GAME_ID: "t", AUTH_MODE: "none", RWK_LOCKED: "0", RWK_SAVE_HISTORY: "off" } });
  try {
    const get = (rel, init) => fetch(`${server.origin}/${rel}`, init);
    assert.equal(await (await get("")).text(), "<p>game</p>");
    const png = await get("img/faces/Actor1.png");
    assert.equal(png.status, 200);
    assert.equal(png.headers.get("content-type"), "image/png");
    assert.equal((await get("img/faces/Actor1.png", { method: "HEAD" })).status, 200);
    assert.equal((await get("img/faces/actor1.png")).status, 404, "letter case counts");
    assert.equal(server.caseOf("img/faces/actor1.png"), "img/faces/Actor1.png");
    assert.equal((await get("img/%E0%A4%A.png")).status, 400);
    assert.equal((await get("broken.txt")).status, 500);
    const put = await get("api/saves/file1", { method: "PUT", headers: { "content-type": "application/octet-stream", "x-rwk-enc": "lz", "if-none-match": "*" }, body: "data" });
    assert.equal(put.status, 200);
    assert.equal((await get("api/saves/file1")).status, 200);
  } finally {
    await server.close();
  }
});

test("test: a deployed site's save API answered on this PC keeps its own saves", async () => {
  const api = localSaveApi({ GAME_ID: "g", RWK_SAVE_HISTORY: "off" });
  const url = "https://g.a.workers.dev/api/saves/file1";
  assert.equal((await api(new Request(url))).status, 404);
  const put = await api(new Request(url, { method: "PUT", headers: { "content-type": "application/octet-stream", "x-rwk-enc": "lz", "if-none-match": "*" }, body: "x" }));
  assert.equal(put.status, 200);
  assert.equal((await api(new Request(url))).status, 200);
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

// A page that answers `location.href + ' ' + document.readyState` with each of `answers` in turn.
const fakePage = (answers, nav = {}) => ({
  async send() {
    return nav;
  },
  async evaluate() {
    const next = answers.length > 1 ? answers.shift() : answers[0];
    if (next instanceof Error) throw next;
    return next;
  },
});

test("test: opening the site waits for the page, and stops at Cloudflare Access", async () => {
  assert.deepEqual(await openSite(fakePage([new Error("navigating"), "https://g.a.workers.dev/ loading", "https://g.a.workers.dev/ interactive"]), "https://g.a.workers.dev/"), { url: "https://g.a.workers.dev/" });
  await assert.rejects(openSite(fakePage(["https://team.cloudflareaccess.com/cdn-cgi/access/login complete"]), "https://g.a.workers.dev/"), (err) => err instanceof CliError && /behind Cloudflare Access/.test(err.message) && /rwk test "<game folder>"/.test(err.hint));
  await assert.rejects(openSite(fakePage([], { errorText: "net::ERR_NAME_NOT_RESOLVED" }), "https://gone.a.workers.dev/"), /cannot be opened \(net::ERR_NAME_NOT_RESOLVED\)/);
  await assert.rejects(openSite(fakePage(["https://g.a.workers.dev/ loading"]), "https://g.a.workers.dev/", 300), /did not load in 0.3 s/);
});

test("test: the cloud save step waits for the upload", async () => {
  assert.deepEqual(await waitUpload([{ rel: "api/saves/file1", status: 200 }, { rel: "api/saves/global", status: 201 }]), { saves: ["file1", "global"] });
  const later = [];
  setTimeout(() => later.push({ rel: "api/saves/file%201", status: 200 }), 100);
  assert.deepEqual(await waitUpload(later, 3000), { saves: ["file 1"] });
  await assert.rejects(waitUpload([{ rel: "api/saves/file1", status: 500 }]), /upload of api\/saves\/file1 failed \(HTTP 500\)/);
  await assert.rejects(waitUpload([], 300), /did not go up to the cloud in 0.3 s/);
});

test("test: every step in a few words", () => {
  assert.equal(describe("new game", { mapId: 3, eventRunning: true }), "map 3, an event runs");
  assert.equal(describe("walk", { steps: 0, from: { mapId: 1 }, to: { mapId: 1 }, scene: "Scene_Battle" }), "0 step(s), now in Scene_Battle");
  assert.equal(describe("save", { slot: 1 }), "file 1");
  assert.equal(describe("cloud save", { saves: ["file1"] }), "uploaded: file1");
  assert.equal(describe("load", { mapId: 2 }), "map 2");
  assert.equal(describe("toolkit menu", { rows: 7 }), "7 entries");
  assert.equal(describe("phone", { viewport: "844x390", canvas: "694x390", controls: true }), "844x390, game 694x390, touch controls shown");
  assert.equal(describe("menu", { ok: true }), "");
  assert.equal(describe("boot", null), "");
});

test("test: which browser it uses", () => {
  const here = import.meta.filename;
  assert.equal(findChrome(here, { env: {}, candidates: [] }), here);
  assert.equal(findChrome(undefined, { env: { CHROME_PATH: here }, candidates: ["/nope/chrome"] }), here);
  assert.equal(findChrome("/nope/given", { env: {}, candidates: ["/nope/chrome", here] }), here);
  assert.throws(() => findChrome(undefined, { env: {}, candidates: ["/nope/chrome"] }), /Chrome not found: .*CHROME_PATH/);
});

browserTest("test: the browser helpers the bench shares", { timeout: 60000 }, async () => {
  const browser = await launchChrome({ executable: chrome });
  try {
    const page = await openPage(browser.cdp);
    await page.viewport(400, 300);
    await page.send("Page.navigate", { url: "data:text/html,<p id=x>hi</p>" });
    await page.waitFor("document.getElementById('x')");
    await assert.rejects(page.waitFor("window.never", 300), /timed out after 0.3 s waiting for window.never/);
    await assert.rejects(page.evaluate("new Promise(() => {})", 200), /timed out after 0.2 s/);
    await assert.rejects(page.evaluate("missing.thing"), /ReferenceError/);
    assert.equal(await page.evaluate("innerWidth"), 400);
    assert.ok((await page.metrics()).JSHeapUsedSize > 0);
    await page.gc();
    // waitFor keeps asking while the page cannot answer (it is navigating).
    await page.send("Page.navigate", { url: "data:text/html,<script>document.write('<p id=y>')</script>" });
    await page.waitFor("document.getElementById('y')");
    // A call still waiting when Chrome closes fails, rather than wait 5 minutes.
    const waiting = assert.rejects(page.send("Runtime.evaluate", { expression: "new Promise(() => {})", awaitPromise: true }), /closed the DevTools connection/);
    await browser.close();
    await waiting;
  } finally {
    await browser.close();
  }
  // Closing again is no error, and a call on the closed connection fails at once.
  await browser.close();
  await assert.rejects(browser.cdp.send("Browser.getVersion"), /DevTools connection is closed/);
});

test("test: a browser that quits before opening its DevTools port", { timeout: 30000 }, async () => {
  // Node quits at once on Chrome's flags: as a Chrome that cannot start.
  await assert.rejects(launchChrome({ executable: process.execPath }), /exited \(code \d+\) before opening its DevTools port/);
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

browserTest("test: a game that never loads fails at boot, and the steps after it are skipped", { timeout: 120000 }, async () => {
  await assert.rejects(testGame(fakeGame({ stuckBoot: true }), { out: out() }, { ...quick, bootSeconds: 2 }), (err) => {
    assert.match(err.message, /1 step\(s\) failed \(boot\)/);
    const steps = byName(err.result.test.steps);
    assert.equal(steps.open.status, "ok");
    assert.equal(steps.boot.status, "fail");
    assert.match(steps.boot.detail, /did not get past loading in 2 s \(scene: Scene_Boot\)/);
    assert.equal(steps["new game"].status, "skip");
    assert.equal(steps["toolkit menu"].detail, "the game did not start");
    assert.equal(steps.phone, undefined, "no phone run for a game that does not start");
    const texts = err.result.test.problems.map((p) => p.text).join("\n");
    assert.match(texts, /127\.0\.0\.1:9\/gone\.json: net::ERR_/);
    assert.match(texts, /HTTP 400/);
    return true;
  });
});

browserTest("test: a link that cannot be opened fails at open, and nothing else runs", { timeout: 60000 }, async () => {
  await assert.rejects(testGame("http://127.0.0.1:9/", { out: out() }, quick), (err) => {
    const steps = byName(err.result.test.steps);
    assert.equal(steps.open.status, "fail");
    assert.match(steps.open.detail, /http:\/\/127\.0\.0\.1:9\/ cannot be opened \(net::ERR_/);
    assert.equal(steps.boot.detail, "the page did not open");
    assert.equal(err.result.site, "127");
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

    // By its site name: the link comes from the account's game list.
    const named = await testGame("stub-game", { out: out() }, { ...quick, connect: async () => ({}), loadSettings: () => ({}), findSite: async () => ({ slug: "stub-game", url: link, title: "Stub Game", engine: "MZ" }) });
    assert.equal(named.site, "stub-game");
    assert.equal(named.test.url, link);
    await assert.rejects(testGame("stub-game", { out: out() }, { ...quick, connect: async () => ({}), loadSettings: () => ({}), findSite: async () => ({ slug: "stub-game" }) }), /No link is recorded for "stub-game"/);
  } finally {
    server.closeAllConnections();
    await new Promise((resolve) => server.close(resolve));
  }
});
