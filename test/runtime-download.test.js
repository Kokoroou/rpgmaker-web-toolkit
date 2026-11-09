// The host's ⚙ → Share → Download game entries (runtime/RWK_Download.js): which
// ones appear, and the pure parts of the folder download. It runs in a VM with
// the browser pieces it touches replaced by small stand-ins; the File System
// Access API itself does not exist in Node, so the click's effect is not run.

import assert from "node:assert/strict";
import fs from "node:fs";
import test from "node:test";
import vm from "node:vm";

const ORIGIN = "https://game.example";
const source = () => fs.readFileSync(new URL("../runtime/RWK_Download.js", import.meta.url), "utf8");

// what: the JSON /api/download?check=1 answers -> a Promise for its Response.
function load({ what = { owner: true, ready: false, folder: false }, directoryPicker = false, online = true, list = { files: [] } } = {}) {
  const tools = [];
  const fetched = [];
  const window = {
    RWK: {
      config: { gameId: "g" },
      tools: { add: (t) => tools.push(t) },
      icons: { download: "<svg/>", folderOpen: "<svg/>" },
      toast() {},
    },
    addEventListener() {},
  };
  if (directoryPicker) window.showDirectoryPicker = () => Promise.reject(Object.assign(new Error("x"), { name: "AbortError" }));
  let resolveCheck;
  const context = {
    window,
    console,
    document: { createElement: () => ({ appendChild() {} }), head: { appendChild() {} }, body: { appendChild() {}, removeChild() {} } },
    location: { origin: ORIGIN },
    navigator: { onLine: online },
    URL,
    Response,
    Request,
    AbortController,
    fetch: async (url) => {
      fetched.push(url);
      if (url === "/api/download?check=1") return new Response(JSON.stringify(what));
      if (url === "/api/download/list") return new Response(JSON.stringify(list));
      return new Response("data");
    },
  };
  void resolveCheck;
  vm.runInNewContext(source(), context);
  return { tools, fetched, RWK: window.RWK, context };
}

// The entries are added when the check's answer arrives: load, then let it land.
const settle = () => new Promise((r) => setTimeout(r, 0));
async function entries(options) {
  const loaded = load(options);
  await settle();
  return { ...loaded, labels: loaded.tools.map((t) => t.label) };
}

test("folder download: the entry appears only for a Chromium browser and a build with a file list", async () => {
  const owner = { owner: true, folder: true };
  assert.deepEqual((await entries({ what: owner, directoryPicker: true })).labels, ["Download game (folder)"]);
  assert.deepEqual((await entries({ what: owner })).labels, [], "no showDirectoryPicker: no entry");
  assert.deepEqual((await entries({ what: { owner: true, folder: false }, directoryPicker: true })).labels, [], "no file list yet: no entry (deploy again)");
  assert.deepEqual((await entries({ what: { owner: false, folder: true }, directoryPicker: true })).labels, [], "not the owner");
  assert.deepEqual((await entries({ what: owner, directoryPicker: true, online: false })).labels, ["Download game (folder)"], "still offered offline: the click says so");
});

test("folder download: the ZIP entry appears only when the deploy made an archive", async () => {
  const both = await entries({ what: { owner: true, ready: true, folder: true }, directoryPicker: true });
  assert.deepEqual(both.labels, ["Download game (folder)", "Download game (ZIP)"]);
  assert.ok(both.fetched.includes("/api/download?check=1"));

  const zipOnly = await entries({ what: { owner: true, ready: true, folder: true } });
  assert.deepEqual(zipOnly.labels, ["Download game (ZIP)"], "Firefox still gets the ZIP: it needs no picker");
  assert.deepEqual((await entries({ what: { owner: true, ready: false, folder: true }, directoryPicker: true })).labels, ["Download game (folder)"], "no archive: no ZIP entry");
});

test("folder download: pathSegments and keyOf build a site path, never one that leaves the folder", () => {
  const { RWK } = load();
  assert.deepEqual(Array.from(RWK.download.pathSegments("img/pictures/a.png")), ["img", "pictures", "a.png"]);
  assert.deepEqual(Array.from(RWK.download.pathSegments("/img//x.png")), ["img", "x.png"], "leading and doubled slashes go");
  assert.deepEqual(Array.from(RWK.download.pathSegments("a/../../etc/passwd")), ["a", "etc", "passwd"], "no step up");
  assert.deepEqual(Array.from(RWK.download.pathSegments("a\\b")), [], "a backslash is never part of a build path");
  assert.deepEqual(Array.from(RWK.download.pathSegments("")), []);

  assert.equal(RWK.download.keyOf("img/pictures/été.png"), `${ORIGIN}/img/pictures/%C3%A9t%C3%A9.png`, "each segment is encoded, like RWK_Offline's keyOf");
  assert.equal(RWK.download.keyOf("data/Map 1.json"), `${ORIGIN}/data/Map%201.json`);
});

test("folder download: folderPlan skips a file already there at the same size", () => {
  const { RWK } = load();
  const files = [
    { rel: "index.html", size: 100 },
    { rel: "img/a.png", size: 200 },
    { rel: "img/b.png", size: 300 },
    { rel: "js/plugins.js", size: 400 },
  ];
  const existing = new Map([
    ["index.html", 100], // same: skipped
    ["img/a.png", 199], // different size: fetched again
  ]);
  const plan = RWK.download.folderPlan(files, existing);
  assert.deepEqual(Array.from(plan.todo.map((f) => f.rel)), ["img/a.png", "img/b.png", "js/plugins.js"]);
  assert.equal(plan.skipped, 1);
  assert.equal(plan.bytes, 900);
  assert.equal(plan.totalBytes, 1000);

  // A plain object works too, and nothing existing fetches everything.
  assert.deepEqual(Array.from(RWK.download.folderPlan(files, {}).todo.map((f) => f.rel)), files.map((f) => f.rel));
  assert.equal(RWK.download.folderPlan(files, { "js/plugins.js": 400 }).skipped, 1);
  assert.equal(RWK.download.folderPlan([], new Map()).todo.length, 0);
});
