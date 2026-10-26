//=============================================================================
// rwk-sw.js - rpgmaker-web-toolkit
// Required Notice: Copyright 2026 Trương Tuấn Anh (https://github.com/Kokoroou)
// License: PolyForm Noncommercial 1.0.0 with the Game Creators permission,
// https://github.com/Kokoroou/rpgmaker-web-toolkit/blob/main/LICENSE
// Service Worker for the web build. The CLI fills in the file list.
// Keeps the game's pictures, sounds and data in Cache Storage, so a phone
// does not download them again at every launch. Never touches /api/.
//=============================================================================

"use strict";

// { "img/pictures/a.png": "<size>-<mtime>", … }: files worth caching and the
// version of each. Replaced by the CLI at build time.
const MANIFEST = /*RWK_MANIFEST*/ {};
const BUILD_ID = "/*RWK_BUILD_ID*/";

const CACHE = "rwk-files";
const INDEX_URL = "/__rwk-index";

// A new worker waits until every tab of the game is closed (no skipWaiting),
// so a game that is open never gets a mix of old and new files.
self.addEventListener("install", () => {});

self.addEventListener("activate", (event) => {
  event.waitUntil(prune().then(() => self.clients.claim()));
});

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
    if (rel === null) continue;
    if (!MANIFEST[rel] || previous[rel] !== MANIFEST[rel]) await cache.delete(request);
  }
  await cache.put(INDEX_URL, new Response(JSON.stringify(MANIFEST), { headers: { "content-type": "application/json" } }));
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

self.addEventListener("fetch", (event) => {
  const request = event.request;
  // Range requests (some browsers stream audio and movies) go to the network:
  // a cached whole file cannot answer them with a 206.
  if (request.method !== "GET" || request.headers.has("range")) return;
  const rel = relOf(request.url);
  if (rel === null || !MANIFEST[rel]) return;
  event.respondWith(cacheFirst(event, request));
});

async function cacheFirst(event, request) {
  // The URL alone is the key: ignores a ?query some plugins append.
  const url = new URL(request.url);
  const key = url.origin + url.pathname;
  const cache = await caches.open(CACHE);
  const hit = await cache.match(key);
  if (hit) return hit;
  const res = await fetch(request);
  // Only a plain 200 from this site: not a login page Access redirected to,
  // not a partial or failed answer.
  if (res.status === 200 && res.type === "basic" && !res.redirected) {
    event.waitUntil(cache.put(key, res.clone()).catch(() => {}));
  }
  return res;
}
