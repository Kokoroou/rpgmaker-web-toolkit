// Play offline: the Service Worker (runtime/rwk-sw.js) and the download that
// fills its cache (runtime/RWK_Offline.js), each run in a VM with the browser
// pieces it touches replaced by small stand-ins.

import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import vm from "node:vm";
import { generatedFiles, pngSize, runtimeConfigOf, serviceWorkerSource } from "../cli/lib/stage.js";
import { applyPolicy, parsePolicy } from "../cli/lib/policy.js";
import { liveSettingsOf } from "../cli/lib/stage.js";

const ORIGIN = "https://game.example";
// What a same-origin fetch gives back (a constructed Response is "default").
const plain = (body, init = {}) => Object.defineProperty(new Response(body, { status: 200, ...init }), "type", { value: "basic" });
const read = (name) => fs.readFileSync(new URL(`../runtime/${name}`, import.meta.url), "utf8");

// Cache Storage: a Map of url -> Response (bodies kept as text).
function fakeCaches() {
  const stores = new Map();
  const open = async (name) => {
    if (!stores.has(name)) stores.set(name, new Map());
    const map = stores.get(name);
    const urlOf = (r) => (typeof r === "string" ? new URL(r, ORIGIN).href : r.url);
    return {
      async match(r) {
        const hit = map.get(urlOf(r));
        return hit ? new Response(hit.body, { status: hit.status, headers: hit.headers }) : undefined;
      },
      async put(r, res) {
        map.set(urlOf(r), { body: Buffer.from(await res.arrayBuffer()), status: res.status, headers: [...res.headers] });
      },
      async delete(r) {
        return map.delete(urlOf(r));
      },
      async keys() {
        return [...map.keys()].map((url) => new Request(url));
      },
    };
  };
  return { stores, open, has: async (name) => stores.has(name) };
}

function loadWorker(files = { manifest: {}, large: {} }) {
  const listeners = {};
  const caches = fakeCaches();
  const sw = serviceWorkerSource(
    [
      ...Object.entries(files.manifest).map(([rel, size]) => ({ rel, size, mtimeMs: 1 })),
      ...Object.entries(files.large).map(([rel, size]) => ({ rel, size, mtimeMs: 1 })),
    ],
    new Set()
  );
  const network = [];
  const context = {
    self: { location: { origin: ORIGIN }, addEventListener: (type, fn) => (listeners[type] = fn), clients: { claim: async () => {} } },
    caches,
    fetch: async (request) => {
      network.push(request.url || String(request));
      if (context.offline) throw new TypeError("Failed to fetch");
      return plain("net:" + new URL(request.url || request).pathname);
    },
    Response,
    Request,
    URL,
    setTimeout,
    Promise,
    offline: false,
  };
  vm.runInNewContext(sw, context);
  const send = async (url, headers = {}) => {
    const request = new Request(ORIGIN + url, { headers });
    let answer = null;
    const pending = [];
    listeners.fetch({ request, respondWith: (p) => (answer = p), waitUntil: (p) => pending.push(p) });
    const res = answer ? await answer : null;
    await Promise.all(pending);
    return res;
  };
  return { caches, listeners, network, send, context, source: sw };
}

test("service worker: files are cache-first, big ones only when the player downloaded them", async () => {
  const w = loadWorker({ manifest: { "img/a.png": 10 }, large: { "movies/op.webm": 30 * 1024 * 1024 } });
  assert.match(w.source, /const LARGE = \{"movies\/op\.webm":"31457280-1"\};/);

  const first = await w.send("/img/a.png?v=2");
  assert.equal(await first.text(), "net:/img/a.png");
  assert.equal(w.network.length, 1);
  const again = await w.send("/img/a.png");
  assert.equal(await again.text(), "net:/img/a.png");
  assert.equal(w.network.length, 1, "the second time comes from the cache, a ?query does not matter");

  const big = await w.send("/movies/op.webm");
  assert.equal(await big.text(), "net:/movies/op.webm");
  assert.equal((await (await w.caches.open("rwk-files")).keys()).filter((r) => r.url.includes("movies")).length, 0, "not stored while playing");
  await (await w.caches.open("rwk-files")).put(`${ORIGIN}/movies/op.webm`, new Response("0123456789"));
  assert.equal(await (await w.send("/movies/op.webm")).text(), "0123456789", "but served once downloaded");

  assert.equal(await w.send("/img/other.png"), null, "not in the list: the browser asks the network");
  assert.equal(await w.send("/api/saves"), null);
  assert.equal(await w.send("/img/a.png", { "x-rwk-preload": "1" }), null, "the download stores its own copy");
});

test("service worker: a cached file answers a Range request with a 206", async () => {
  const w = loadWorker({ manifest: { "audio/bgm/a.ogg": 10 }, large: {} });
  await (await w.caches.open("rwk-files")).put(`${ORIGIN}/audio/bgm/a.ogg`, new Response("0123456789", { headers: { "content-type": "audio/ogg" } }));
  const part = await w.send("/audio/bgm/a.ogg", { range: "bytes=2-5" });
  assert.equal(part.status, 206);
  assert.equal(await part.text(), "2345");
  assert.equal(part.headers.get("content-range"), "bytes 2-5/10");
  assert.equal(await (await w.send("/audio/bgm/a.ogg", { range: "bytes=-3" })).text(), "789");
  assert.equal(await (await w.send("/audio/bgm/a.ogg", { range: "bytes=8-" })).text(), "89");
  assert.equal((await w.send("/audio/bgm/a.ogg", { range: "bytes=20-30" })).status, 416);

  const none = loadWorker({ manifest: { "audio/bgm/b.ogg": 10 }, large: {} });
  assert.equal(await (await none.send("/audio/bgm/b.ogg", { range: "bytes=2-5" })).text(), "net:/audio/bgm/b.ogg", "nothing kept: the network answers");
});

test("service worker: the page opens from the cache when there is no connection", async () => {
  const w = loadWorker({ manifest: { "img/a.png": 10 }, large: {} });
  assert.equal(await (await w.send("/")).text(), "net:/", "online: the network answers and the copy is kept");
  w.context.offline = true;
  assert.equal(await (await w.send("/")).text(), "net:/", "offline: the copy answers");
  assert.equal(await (await w.send("/index.html")).text(), "net:/", "under either name");
  await assert.rejects(w.send("/rwk.webmanifest"), /Failed to fetch/, "never kept: nothing to answer with");
  assert.equal(await w.send("/rwk-sw.js"), null, "the worker itself is left to the browser");
});

test("service worker: a login redirect or a failed answer is not kept", async () => {
  const w = loadWorker({ manifest: { "img/a.png": 10 }, large: {} });
  w.context.fetch = async () => plain("denied", { status: 403 });
  await w.send("/img/a.png");
  assert.equal((await (await w.caches.open("rwk-files")).keys()).length, 0);
});

test("service worker: activation drops only what changed and answers the file list", async () => {
  const w = loadWorker({ manifest: { "img/a.png": 10, "img/b.png": 20 }, large: { "movies/op.webm": 30 * 1024 * 1024 } });
  const cache = await w.caches.open("rwk-files");
  for (const rel of ["img/a.png", "img/b.png", "img/gone.png", "movies/op.webm", "index.html"]) await cache.put(`${ORIGIN}/${rel}`, new Response("x"));
  await cache.put(`${ORIGIN}/__rwk-index`, new Response(JSON.stringify({ "img/a.png": "10-1", "img/b.png": "19-1", "img/gone.png": "5-1", "movies/op.webm": "31457280-1" })));
  let ready;
  w.listeners.activate({ waitUntil: (p) => (ready = p) });
  await ready;
  const kept = (await cache.keys()).map((r) => new URL(r.url).pathname).sort();
  assert.deepEqual(kept, ["/__rwk-index", "/img/a.png", "/index.html", "/movies/op.webm"]);

  let reply;
  w.listeners.message({ data: { type: "rwk-files" }, ports: [{ postMessage: (m) => (reply = m) }] });
  assert.deepEqual(JSON.parse(JSON.stringify(reply.files)), { "movies/op.webm": "31457280-1", "img/a.png": "10-1", "img/b.png": "20-1" });
  assert.deepEqual([...reply.shell], ["index.html", "js/plugins.js", "rwk.webmanifest"]);
});

//---------------------------------------------------------------------------

function loadOffline({ offline = true, files = {}, shell = ["index.html"], respond, quota = null } = {}) {
  const caches = fakeCaches();
  const tools = [];
  const fetched = [];
  const listeners = {};
  const context = {
    window: {
      RWK: { config: { offline }, tools: { add: (t) => tools.push(t) }, toast() {}, icons: { download: "<svg/>" }, shield() {} },
      addEventListener: (type, fn) => (listeners[type] = fn),
      isSecureContext: true,
      caches,
    },
    console,
    caches,
    location: { origin: ORIGIN },
    navigator: {
      onLine: true,
      serviceWorker: {
        ready: Promise.resolve({
          active: { postMessage: (message, [port]) => port.postMessage?.({ files, shell }) },
        }),
      },
      storage: { estimate: async () => (quota ? { quota, usage: 0 } : {}), persist: async () => true },
    },
    document: {},
    fetch: async (url, init) => {
      fetched.push(url.replace(ORIGIN, ""));
      assert.equal(init.headers["x-rwk-preload"], "1");
      return respond ? respond(url) : plain("data:" + url);
    },
    MessageChannel: class {
      constructor() {
        const a = {};
        const b = {};
        this.port1 = a;
        this.port2 = { postMessage: (data) => a.onmessage && a.onmessage({ data }) };
        void b;
      }
    },
    Response,
    TransformStream,
    AbortController,
    URL,
    Promise,
    setTimeout,
    clearTimeout,
    Date,
    encodeURIComponent,
  };
  context.window.addEventListener = (type, fn) => (listeners[type] = fn);
  vm.runInNewContext(read("RWK_Offline.js"), context);
  return { tools, caches, fetched, RWK: context.window.RWK, listeners };
}

test("play offline: the menu entry exists only when the deployer left it on", () => {
  const on = loadOffline({});
  assert.equal(on.tools.length, 1);
  assert.equal(on.tools[0].group, "offline");
  assert.match(on.tools[0].detail(), /without a connection/);
  assert.equal(loadOffline({ offline: false }).tools.length, 0);
});

test("play offline: downloads what is missing, then resumes with only the rest", async () => {
  const files = { "img/a.png": "10-1", "img/b b.png": "20-1", "audio/bgm/c.ogg": "30-1" };
  const w = loadOffline({ files, shell: ["index.html", "js/plugins.js"], quota: 1e9 });
  const plan = await w.RWK.offline.plan();
  assert.equal(plan.files, 5);
  assert.equal(plan.bytes, 60);
  assert.equal(plan.missing.length, 5);
  assert.equal(plan.free, 1e9);
  assert.equal(plan.missing[1].key, `${ORIGIN}/img/b%20b.png`, "the key is the same the Service Worker builds");

  const run = await w.RWK.offline.download(plan.missing.slice(0, 2));
  assert.equal(run.done, 2);
  assert.equal(run.reason, null);
  assert.equal(run.bytes, new Buffer.from("data:" + plan.missing[0].key).length + Buffer.from("data:" + plan.missing[1].key).length);

  const again = await w.RWK.offline.plan();
  assert.equal(again.missing.length, 3, "two already kept");
  w.fetched.length = 0;
  const rest = await w.RWK.offline.download(again.missing);
  assert.equal(rest.done, 3);
  assert.deepEqual(w.fetched.sort(), ["/audio/bgm/c.ogg", "/index.html", "/js/plugins.js"]);
  assert.equal((await w.RWK.offline.plan()).missing.length, 0);
});

test("play offline: a signed-out answer stops the download and nothing is kept for it", async () => {
  const files = { "img/a.png": "10-1", "img/b.png": "10-1" };
  const login = () => Object.defineProperty(plain("login"), "redirected", { value: true });
  const w = loadOffline({ files, shell: [], respond: login });
  const run = await w.RWK.offline.download((await w.RWK.offline.plan()).missing);
  assert.equal(run.reason, "signin");
  assert.equal((await w.RWK.offline.plan()).missing.length, 2);
});

test("play offline: a file that keeps failing is reported, the others still download", async () => {
  const files = { "img/a.png": "10-1", "img/bad.png": "10-1" };
  const respond = (url) => (url.includes("bad") ? plain("no", { status: 500 }) : plain("ok"));
  const w = loadOffline({ files, shell: [], respond });
  const run = await w.RWK.offline.download((await w.RWK.offline.plan()).missing);
  assert.equal(run.reason, "failed");
  assert.deepEqual([...run.failed], ["img/bad.png"]);
  assert.equal(run.done, 1);
});

test("play offline: pausing stops at once and keeps what arrived", async () => {
  const files = { "img/a.png": "10-1", "img/b.png": "10-1", "img/c.png": "10-1", "img/d.png": "10-1" };
  const w = loadOffline({ files, shell: [] });
  const controller = new AbortController();
  const items = (await w.RWK.offline.plan()).missing;
  const run = await w.RWK.offline.download(items, {
    signal: controller.signal,
    onProgress: () => controller.abort(),
  });
  assert.equal(run.reason, "paused");
  assert.ok(run.done < 4);
  assert.equal((await w.RWK.offline.plan()).missing.length, 4 - run.done);
});

//---------------------------------------------------------------------------

test("build: the Service Worker lists big files apart, and css / icon are kept", () => {
  const f = (rel, size) => ({ rel, size, mtimeMs: 7 });
  const sw = serviceWorkerSource([f("css/game.css", 5), f("icon/icon.png", 6), f("movies/op.webm", 30 * 1024 * 1024), f("save/x", 1)]);
  assert.match(sw, /const MANIFEST = \{"css\/game\.css":"5-7","icon\/icon\.png":"6-7"\};/);
  assert.match(sw, /const LARGE = \{"movies\/op\.webm":"31457280-7"\};/);
  const id = (src) => /BUILD_ID = "(\w+)"/.exec(src)[1];
  assert.notEqual(id(sw), id(serviceWorkerSource([f("css/game.css", 5), f("icon/icon.png", 6)])), "a big file changes the build");
});

test("build: the web manifest gives the icon's real size so a browser offers to install", () => {
  const png = Buffer.alloc(33);
  Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]).copy(png);
  png.writeUInt32BE(13, 8);
  png.write("IHDR", 12, "ascii");
  png.writeUInt32BE(512, 16);
  png.writeUInt32BE(384, 20);
  assert.deepEqual(pngSize(png), { width: 512, height: 384 });
  assert.equal(pngSize(Buffer.from("not a png at all, just text")), null);

  const root = fs.mkdtempSync(path.join(os.tmpdir(), "rwk-offline-"));
  try {
    fs.mkdirSync(path.join(root, "js"));
    fs.mkdirSync(path.join(root, "icon"));
    fs.writeFileSync(path.join(root, "js", "plugins.js"), "var $plugins = [];\n");
    fs.writeFileSync(path.join(root, "index.html"), "<html><head></head><body></body></html>");
    fs.writeFileSync(path.join(root, "icon", "icon.png"), png);
    const manifest = JSON.parse(generatedFiles({ root, engine: "MZ", title: "G" }, { slug: "g", sync: {} }, []).get("rwk.webmanifest"));
    assert.deepEqual(manifest.icons, [{ src: "icon/icon.png", sizes: "512x384", type: "image/png", purpose: "any" }]);
    assert.equal(manifest.scope, "./");
    fs.rmSync(path.join(root, "icon"), { recursive: true });
    assert.deepEqual(JSON.parse(generatedFiles({ root, engine: "MZ", title: "G" }, { slug: "g", sync: {} }, []).get("rwk.webmanifest")).icons, []);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test("settings: `offline` is a feature the deployer, a preset, a player and the policy can turn off", () => {
  assert.equal(runtimeConfigOf("MZ", { slug: "g" }).offline, true);
  assert.equal(runtimeConfigOf("MZ", { slug: "g", offline: false }).offline, false);
  assert.equal(runtimeConfigOf("MZ", { slug: "g", cache: false }).offline, false, "no Service Worker, nothing to fill");
  assert.equal(runtimeConfigOf("MZ", { slug: "g", preset: "shared" }).offline, false);
  assert.equal(runtimeConfigOf("MZ", { slug: "g", preset: "shared", offline: true }).offline, true, "the deployer's own key wins over the preset");
  assert.equal(runtimeConfigOf("MZ", applyPolicy({ slug: "g" }, parsePolicy({ hosting: "personal", features: { offline: false } }))).offline, false);
  const live = liveSettingsOf("MZ", { slug: "g", offline: false }, null);
  assert.equal(live.config.offline, false);
});
