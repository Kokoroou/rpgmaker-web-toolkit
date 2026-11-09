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

// A Response as a browser hands it over: `type` is "basic", and `url` is where
// it came from (and `redirected` whether fetch followed a redirect to get there).
const at = (url, { redirected = false, type = "basic" } = {}) => {
  const res = new Response("x");
  for (const [key, value] of Object.entries({ url, redirected, type })) Object.defineProperty(res, key, { value });
  return res;
};

test("folder download: the site's own .html redirect is not a sign-out", () => {
  const { RWK } = load();
  // Workers Assets answers /index.html with a 307 to /, which fetch follows: the
  // answer is the site's start page. Treating that as a sign-out is what stopped
  // a real download at index.html, leaving js/ and movies/ never fetched.
  assert.equal(RWK.download.signedOut(at(`${ORIGIN}/`, { redirected: true }), "index.html"), false, "start page");
  assert.equal(RWK.download.signedOut(at(`${ORIGIN}/credits`, { redirected: true }), "credits.html"), false, "page without its extension");
  assert.equal(RWK.download.signedOut(at(`${ORIGIN}/docs/`, { redirected: true }), "docs/index.html"), false, "a page's index.html");

  // Access answers a signed-out visitor with its login page: not the file.
  assert.equal(RWK.download.signedOut(at("https://team.cloudflareaccess.com/login", { redirected: true }), "index.html"), true);
  assert.equal(RWK.download.signedOut(at(`${ORIGIN}/cdn-cgi/access/login`, { redirected: true }), "js/main.js"), true, "even on this site's origin");
  assert.equal(RWK.download.signedOut(at(`${ORIGIN}/`, { redirected: true }), "js/main.js"), true, "only .html has a redirect of its own");

  const opaque = at("", { type: "opaqueredirect" });
  assert.equal(RWK.download.signedOut(opaque, "img/a.png"), true, "no readable answer");
  assert.equal(RWK.download.signedOut(at(`${ORIGIN}/img/a.png`), "img/a.png"), false, "a plain answer is the file");
});

test("folder download: folderNameFrom makes a folder name every filesystem accepts", () => {
  const { RWK } = load();
  assert.equal(RWK.download.folderNameFrom("Magical Reventia"), "Magical Reventia");
  assert.equal(RWK.download.folderNameFrom("レヴァンティアチャンネル"), "レヴァンティアチャンネル", "non-ASCII names are kept");

  // Characters Windows, macOS and Linux refuse (or that break a path).
  assert.equal(RWK.download.folderNameFrom('a/b\\c:d*e?f"g<h>i|j'), "a-b-c-d-e-f-g-h-i-j");
  assert.equal(RWK.download.folderNameFrom("My Game: Episode 1"), "My Game- Episode 1");
  assert.equal(RWK.download.folderNameFrom("Game\u0000\u001fName"), "Game--Name", "control characters go too");

  // Windows drops trailing dots and spaces, so the name must not keep them.
  assert.equal(RWK.download.folderNameFrom("Game. "), "Game");
  assert.equal(RWK.download.folderNameFrom("  .Game  "), "Game");

  assert.equal(RWK.download.folderNameFrom(""), "Game web build", "an unnamed page still gets a folder");
  assert.equal(RWK.download.folderNameFrom("   "), "Game web build");
  assert.equal(RWK.download.folderNameFrom("..."), "Game web build");
  assert.equal(RWK.download.folderNameFrom("x".repeat(300)).length, 120, "bounded, so a crazy title cannot make a path too long");
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

//---------------------------------------------------------------------------
// The panel and the pill (dom + a fake File System Access API)
//---------------------------------------------------------------------------

// Just enough DOM: elements with children, classes, click listeners and a body.
function fakeDom() {
  const make = (tag) => {
    const node = {
      tagName: String(tag).toUpperCase(),
      children: [],
      parentNode: null,
      style: {},
      hidden: false,
      textContent: "",
      className: "",
      attrs: {},
      listeners: {},
      classList: {
        add: (c) => (node.className = [node.className, c].filter(Boolean).join(" ")),
        remove: (c) => (node.className = node.className.split(" ").filter((x) => x && x !== c).join(" ")),
        contains: (c) => node.className.split(" ").includes(c),
      },
      appendChild(child) {
        child.parentNode = node;
        node.children.push(child);
        return child;
      },
      append(...kids) {
        for (const k of kids) node.appendChild(k);
      },
      remove() {
        if (!node.parentNode) return;
        node.parentNode.children = node.parentNode.children.filter((c) => c !== node);
        node.parentNode = null;
      },
      setAttribute(k, v) {
        node.attrs[k] = String(v);
      },
      getAttribute: (k) => (k in node.attrs ? node.attrs[k] : null),
      addEventListener(type, fn) {
        (node.listeners[type] ||= []).push(fn);
      },
      click() {
        for (const fn of node.listeners.click || []) fn({ target: node });
      },
      get firstChild() {
        return node.children[0];
      },
    };
    return node;
  };
  const doc = { body: make("body"), head: make("head"), createElement: (tag) => make(tag), title: "Test Game" };
  return { doc, make };
}

// A folder the File System Access API would hand back: nested fake handles
// that only remember what was "written" (nothing is on disk).
function fakeFs(doc) {
  const dir = (name) => {
    const files = new Map();
    return {
      name,
      files,
      async getDirectoryHandle(child, { create } = {}) {
        if (!dirs.has(`${name}/${child}`)) {
          if (!create) throw Object.assign(new Error("not found"), { name: "NotFoundError" });
          dirs.set(`${name}/${child}`, dir(`${name}/${child}`));
        }
        return dirs.get(`${name}/${child}`);
      },
      async getFileHandle(file, { create } = {}) {
        if (!files.has(file)) {
          if (!create) throw Object.assign(new Error("not found"), { name: "NotFoundError" });
          files.set(file, { size: 0 });
        }
        return {
          async getFile() {
            return files.get(file);
          },
          async createWritable() {
            let size = 0;
            return new WritableStream({
              write(chunk) {
                size += chunk.byteLength;
              },
              close() {
                files.set(file, { size });
              },
            });
          },
        };
      },
    };
  };
  const dirs = new Map();
  const root = dir("root");
  dirs.set("root", root);
  void doc;
  return { root, dirs };
}

// Loads RWK_Download over the fake DOM, with fetch answering the file list and
// every file's body. -> the pieces a test drives.
function loadUi({ files = [{ rel: "index.html", size: 4 }, { rel: "js/main.js", size: 6 }] } = {}) {
  const { doc, make } = fakeDom();
  const fs = fakeFs(doc);
  const tools = [];
  const toasts = [];
  const waits = [];
  const win = {
    RWK: {
      config: { gameId: "g" },
      tools: { add: (t) => tools.push(t) },
      icons: { download: "<svg/>", folderOpen: "<svg/>" },
      toast: (message) => toasts.push(message),
      shield() {},
      // RWK_Core's panel(): puts the node up and returns the function that
      // takes it down. It never calls close itself.
      panel(node) {
        doc.body.appendChild(node);
        return () => node.remove();
      },
      choose: async () => true,
    },
    addEventListener() {},
    $dataSystem: { gameTitle: "Test Game" },
  };
  win.showDirectoryPicker = () => Promise.resolve(fs.root);
  const context = {
    window: win,
    console,
    document: doc,
    location: { origin: ORIGIN },
    navigator: { onLine: true },
    URL,
    Response,
    Request,
    AbortController,
    TransformStream,
    setTimeout: (fn, ms) => {
      waits.push({ fn, ms });
      return waits.length;
    },
    clearTimeout() {},
    fetch: async (url) => {
      if (url === "/api/download?check=1") return new Response(JSON.stringify({ owner: true, folder: true, ready: false }));
      if (url === "/api/download/list") return new Response(JSON.stringify({ files }));
      // A same-origin fetch in a browser is type "basic"; Node's is "default".
      const body = new Response("data");
      Object.defineProperty(body, "type", { value: "basic" });
      Object.defineProperty(body, "url", { value: ORIGIN + new URL(url, ORIGIN).pathname });
      return body;
    },
  };
  vm.runInNewContext(source(), context);
  const loaded = { doc, make, fs, tools, toasts, waits, win, RWK: win.RWK };
  // The entry's click: the picker, then start(). Resolves with the panel up.
  loaded.flushStart = async () => {
    await flush(); // /api/download?check=1 lands and adds the entry
    tools.find((t) => t.label === "Download game (folder)").onSelect();
    const until = Date.now() + 3000;
    while (Date.now() < until && !doc.body.children.some((n) => n.className === "rwk-modal")) await flush();
    await flush();
  };
  return loaded;
}

const flush = async (n = 6) => {
  for (let i = 0; i < n; i++) await new Promise((r) => setImmediate(r));
};
const all = (node, out = []) => {
  for (const child of node.children) {
    out.push(child);
    all(child, out);
  }
  return out;
};
const byLabel = (node, label) => all(node).find((n) => n.tagName === "BUTTON" && n.textContent === label);

test("folder download: the build goes into a new folder named after the game", async () => {
  const ui = loadUi();
  await ui.flushStart(); // the picker, then start()
  assert.ok(ui.fs.dirs.has("root/Test Game"), "a folder named after the game, inside the one picked");
  assert.equal(ui.fs.dirs.get("root/Test Game").files.get("index.html").size, 4, "and the build is written into it");
  void byLabel;
});

test("folder download: Hide keeps the download going and leaves a pill with the percent", async () => {
  const ui = loadUi();
  await ui.flushStart();
  const panel = ui.doc.body.children.find((n) => n.className === "rwk-modal");
  assert.ok(panel, "the panel is up");
  assert.equal(byLabel(panel, "Close"), undefined, "no Close any more");
  const hide = byLabel(panel, "Hide");
  const cancel = byLabel(panel, "Cancel");
  assert.ok(hide && cancel, "Hide and Cancel");
  assert.match(cancel.className, /rwk-dl-danger/, "Cancel is the red one");

  hide.click();
  assert.equal(ui.doc.body.children.includes(panel), false, "the panel is gone");
  const pill = ui.doc.body.children.find((n) => n.className.startsWith("rwk-dl-pill"));
  assert.ok(pill, "a pill stays on the page");
  assert.ok(all(pill).some((n) => n.className === "rwk-dl-spin"), "with a spinner");
});

test("folder download: the pill shows 100%, waits 5 s, then goes", async () => {
  const ui = loadUi();
  await ui.flushStart();
  const panel = ui.doc.body.children.find((n) => n.className === "rwk-modal");
  byLabel(panel, "Hide").click();
  const pill = ui.doc.body.children.find((n) => n.className.startsWith("rwk-dl-pill"));
  const pct = all(pill).find((n) => n.className === "rwk-dl-pct");

  // The run has finished by now: 100%, spinner hidden, and a 5 s wait.
  assert.equal(pct.textContent, "100%");
  assert.ok(pill.classList.contains("done"), "the spinner is replaced by the finished look");
  const wait = ui.waits.find((w) => w.ms === 5000);
  assert.ok(wait, "it waits 5 seconds");
  assert.ok(ui.doc.body.children.includes(pill), "still there before the wait ends");

  wait.fn(); // the 5 seconds pass
  assert.equal(ui.doc.body.children.includes(pill), false, "then the pill goes");
});
