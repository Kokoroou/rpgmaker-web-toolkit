//=============================================================================
// rwk-sw.js - rpgmaker-web-toolkit
// Required Notice: Copyright 2026 Trương Tuấn Anh (https://github.com/Kokoroou)
// License: PolyForm Noncommercial 1.0.0 with the Game Creators permission,
// https://github.com/Kokoroou/rpgmaker-web-toolkit/blob/main/LICENSE
// Service Worker for the web build. The CLI fills in the file list.
// Keeps the game's pictures, sounds and data in Cache Storage, so a phone
// does not download them again at every launch, and the page itself, so an
// installed copy opens without a connection. RWK_Offline downloads the whole
// list ahead of time. Never touches /api/.
//=============================================================================

"use strict";

// { "img/pictures/a.png": "<size>-<mtime>", … }: files worth caching and the
// version of each. Replaced by the CLI at build time.
const MANIFEST = /*RWK_MANIFEST*/ {};
// The same for files over the size the browser keeps on its own: only the
// player's "download for offline" stores them.
const LARGE = /*RWK_LARGE*/ {};
const BUILD_ID = "/*RWK_BUILD_ID*/";

const CACHE = "rwk-files";
const INDEX_URL = "/__rwk-index";

// The page and what it needs to start. They change with settings and deploys,
// so the network answers first and the cache only stands in when it cannot.
const SHELL = new Set(["index.html", "js/plugins.js", "rwk.webmanifest"]);
const SHELL_WAIT_MS = 4000;

// A new worker waits until every tab of the game is closed (no skipWaiting),
// so a game that is open never gets a mix of old and new files.
self.addEventListener("install", () => {});

self.addEventListener("activate", (event) => {
  event.waitUntil(prune().then(() => self.clients.claim()));
});

// The key a file is stored under; RWK_Offline builds the same one.
function keyOf(rel) {
  return self.location.origin + "/" + rel.split("/").map(encodeURIComponent).join("/");
}

function versionOf(rel) {
  return MANIFEST[rel] || LARGE[rel] || null;
}

// Drops the cached files that changed or left the build, keeps the others.
async function prune() {
  const cache = await caches.open(CACHE);
  let previous = {};
  try {
    const res = await cache.match(INDEX_URL);
    if (res) previous = await res.json();
  } catch (e) {
    previous = {};
  }
  for (const request of await cache.keys()) {
    const rel = relOf(request.url);
    if (rel === null || rel === "__rwk-index") continue;
    if (SHELL.has(rel)) continue;
    if (!versionOf(rel) || previous[rel] !== versionOf(rel)) await cache.delete(request);
  }
  await cache.put(INDEX_URL, new Response(JSON.stringify({ ...LARGE, ...MANIFEST }), { headers: { "content-type": "application/json" } }));
}

function relOf(href) {
  const url = new URL(href);
  if (url.origin !== self.location.origin) return null;
  try {
    return decodeURIComponent(url.pathname).slice(1);
  } catch (e) {
    return null;
  }
}

// RWK_Offline asks for the list of files to download.
self.addEventListener("message", (event) => {
  if (event.data && event.data.type === "rwk-files" && event.ports[0]) {
    event.ports[0].postMessage({ buildId: BUILD_ID, files: { ...LARGE, ...MANIFEST }, shell: [...SHELL] });
  }
});

self.addEventListener("fetch", (event) => {
  const request = event.request;
  // The page's own download goes straight to the network: it stores the answer itself.
  if (request.method !== "GET" || request.headers.has("x-rwk-preload")) return;
  const rel = relOf(request.url);
  if (rel === null) return;
  const shell = rel === "" ? "index.html" : SHELL.has(rel) ? rel : null;
  if (shell) {
    // A range request for a page is not a thing; leave it.
    if (!request.headers.has("range")) event.respondWith(networkFirst(event, request, shell));
    return;
  }
  if (!versionOf(rel)) return;
  event.respondWith(request.headers.has("range") ? fromCacheOrNetwork(request, rel) : cacheFirst(event, request, rel));
});

// Only a plain 200 from this site: not a login page Access redirected to,
// not a partial or failed answer.
const storable = (res) => res.status === 200 && res.type === "basic" && !res.redirected;

async function cacheFirst(event, request, rel) {
  // The key is the file alone: ignores a ?query some plugins append.
  const key = keyOf(rel);
  const cache = await caches.open(CACHE);
  const hit = await cache.match(key);
  if (hit) return hit;
  const res = await fetch(request);
  // A big file is kept only when the player asked for it (RWK_Offline).
  if (MANIFEST[rel] && storable(res)) event.waitUntil(cache.put(key, res.clone()).catch(() => {}));
  return res;
}

// Some browsers stream audio and movies with Range requests. Answer one from a
// whole cached file with a 206; without the file, the network answers.
async function fromCacheOrNetwork(request, rel) {
  const cache = await caches.open(CACHE);
  const hit = await cache.match(keyOf(rel));
  const range = hit && /^bytes=(\d*)-(\d*)$/.exec(request.headers.get("range"));
  if (!range || (range[1] === "" && range[2] === "")) return fetch(request);
  const blob = await hit.blob();
  let start;
  let end;
  if (range[1] === "") {
    start = Math.max(0, blob.size - Number(range[2]));
    end = blob.size - 1;
  } else {
    start = Number(range[1]);
    end = range[2] === "" ? blob.size - 1 : Math.min(Number(range[2]), blob.size - 1);
  }
  if (start > end || start >= blob.size) {
    return new Response(null, { status: 416, headers: { "content-range": `bytes */${blob.size}` } });
  }
  return new Response(blob.slice(start, end + 1), {
    status: 206,
    headers: {
      "content-type": hit.headers.get("content-type") || "application/octet-stream",
      "content-range": `bytes ${start}-${end}/${blob.size}`,
      "accept-ranges": "bytes",
    },
  });
}

async function networkFirst(event, request, rel) {
  const key = keyOf(rel);
  const cache = await caches.open(CACHE);
  const cached = await cache.match(key);
  const network = fetch(request).then((res) => {
    if (storable(res)) event.waitUntil(cache.put(key, res.clone()).catch(() => {}));
    return res;
  });
  if (!cached) return network;
  network.catch(() => {});
  // On a slow connection the copy from the last visit starts the game.
  const late = new Promise((resolve) => setTimeout(() => resolve(cached), SHELL_WAIT_MS));
  return Promise.race([network, late]).catch(() => cached);
}
