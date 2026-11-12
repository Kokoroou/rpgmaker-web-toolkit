// Host-only endpoints: the whole web build, as one ZIP or as a folder.
//
//   GET /api/download        -> game-<GAME_ID>.zip  (401/403 for non-owners, 503 without a bucket)
//   GET /api/download?check=1 -> { owner, gameId, ready, folder }   (the in-game entries ask this)
//   GET /api/download/list   -> { gameId, files: [{ rel, size }] }  (the folder download's list)
//
// Only emails listed in RWK_DOWNLOAD_OWNERS (hashes, set at deploy like
// RWK_LENS_OWNERS) may call these. They are off when that var is empty or missing.
// RWK_DOWNLOAD_FOLDER = "0" / RWK_DOWNLOAD_ZIP = "0" turn one way off
// ("download": { "folder": false } / no "zip": true in the config).
//
// The ZIP is made by the CLI at deploy and kept in R2 (assets/<GAME_ID>/rwk.zip,
// cli/lib/zip.js): a Worker cannot stream a game's archive by reading its files
// one by one, because every read is a subrequest and a game has thousands of
// files. A deploy only makes it when the config asks for it ("download": { "zip": true }).
//
// The folder download (Chromium's File System Access API) reads the list here,
// then fetches each file from the site itself: those are static assets, which
// never reach this Worker (run_worker_first only sends /api/*, /_lens/* and the
// files the Worker serves), so the list is the only thing this file does for it.

import { userHash } from "./auth.js";

const ZIP_KEY = (gameId) => `assets/${gameId}/rwk.zip`;

// The build's complete file list, written at deploy (cli/lib/stage.js): every
// path the site serves, with its size. Only names and sizes.
export const BUILD_MANIFEST = "rwk-build.json";

// Files the build holds but the site never serves, so a download must not ask
// for them. `_headers` is configuration for Workers Assets: Cloudflare reads it
// and does not serve it, and /_headers answers 404.
export const UNSERVED_FILES = new Set(["_headers"]);

export async function isDownloadOwner(env, user) {
  if (env.AUTH_MODE !== "access" || !env.BUCKET) return false;
  let owners = [];
  try {
    owners = JSON.parse(env.RWK_DOWNLOAD_OWNERS || "[]");
  } catch {
    owners = [];
  }
  return Array.isArray(owners) && owners.includes(await userHash(user.email));
}

const folderOn = (env) => env.RWK_DOWNLOAD_FOLDER !== "0";
const zipOn = (env) => env.RWK_DOWNLOAD_ZIP !== "0";

export async function handleDownload(request, env, user) {
  if (!env.BUCKET) return jsonErr("Download needs the R2 bucket", 503);
  if (!(await isDownloadOwner(env, user))) return jsonErr("Only the game's owner can download it", 403);
  if (request.method !== "GET" && request.method !== "HEAD") return jsonErr("Method not allowed", 405);

  const url = new URL(request.url);
  if (url.searchParams.get("check") === "1" || request.method === "HEAD") {
    // Whether each entry is worth showing: the owner, a ZIP to download, and
    // the file list the folder download needs.
    const obj = zipOn(env) ? await env.BUCKET.head(ZIP_KEY(env.GAME_ID)) : null;
    const folder = folderOn(env) && (await hasManifest(request, env));
    const body = request.method === "HEAD" ? null : JSON.stringify({ owner: true, gameId: env.GAME_ID, ready: !!obj, folder });
    return new Response(body, {
      status: 200,
      headers: { "content-type": "application/json", "cache-control": "no-store" },
    });
  }

  if (!zipOn(env)) return jsonErr("Downloading this game as a ZIP is turned off", 404);
  const obj = await env.BUCKET.get(ZIP_KEY(env.GAME_ID), { range: request.headers, onlyIf: request.headers });
  if (!obj) {
    return jsonErr("This build has no ZIP yet: a deploy makes one when the config asks for it (\"download\": { \"zip\": true })", 404);
  }

  const headers = new Headers({
    "content-type": "application/zip",
    "content-disposition": `attachment; filename="game-${env.GAME_ID}.zip"`,
    "cache-control": "no-store",
    "x-robots-tag": "noindex, nofollow",
  });
  // A failed precondition (If-None-Match hit) answers with headers only.
  headers.set("etag", obj.httpEtag);
  headers.set("accept-ranges", "bytes");
  if (!("body" in obj)) return new Response(null, { status: 304, headers });

  let status = 200;
  if (obj.range && request.headers.has("range")) {
    const { start, length } = rangeBounds(obj.range, obj.size);
    headers.set("content-range", `bytes ${start}-${start + length - 1}/${obj.size}`);
    status = 206;
  }
  headers.set("content-length", String(obj.size));
  return new Response(obj.body, { status, headers });
}

// GET /api/download/list: every file of the build, so the host can write the
// game into a folder. The list comes from rwk-build.json, which a deploy
// writes; a game deployed before it has none, and the answer is empty (the
// entry stays hidden until the game is deployed again).
export async function handleDownloadList(request, env, user) {
  if (!env.BUCKET) return jsonErr("Download needs the R2 bucket", 503);
  if (!(await isDownloadOwner(env, user))) return jsonErr("Only the game's owner can download it", 403);
  if (request.method !== "GET" && request.method !== "HEAD") return jsonErr("Method not allowed", 405);
  if (!folderOn(env)) return jsonErr("Downloading this game into a folder is turned off", 404);

  const manifest = await readManifest(request, env);
  if (!manifest) return jsonReply({ gameId: env.GAME_ID, files: [] });
  const files = [];
  for (const [rel, size] of Object.entries(manifest.files || {})) {
    if (!safeRel(rel) || UNSERVED_FILES.has(rel)) continue;
    files.push({ rel, size: Number(size) >= 0 ? Number(size) : 0 });
  }
  files.sort((a, b) => (a.rel < b.rel ? -1 : a.rel > b.rel ? 1 : 0));
  return jsonReply({ gameId: env.GAME_ID, files });
}

async function hasManifest(request, env) {
  return !!(await readManifest(request, env));
}

// -> { v, files: { rel: size } } from the build, or null. A missing file (a
// game deployed before it existed) is not an error.
async function readManifest(request, env) {
  if (!env.ASSETS) return null;
  try {
    const res = await env.ASSETS.fetch(new Request(new URL(`/${BUILD_MANIFEST}`, request.url), { method: "GET" }));
    if (!res.ok) return null;
    const data = await res.json();
    return data && typeof data === "object" && data.files && typeof data.files === "object" ? data : null;
  } catch {
    return null;
  }
}

// A path the folder download may write: relative, inside the build, no way out.
export function safeRel(rel) {
  return (
    typeof rel === "string" &&
    rel.length > 0 &&
    rel.length <= 400 &&
    !rel.startsWith("/") &&
    !rel.includes("\\") &&
    !rel.split("/").some((part) => part === "" || part === "." || part === "..")
  );
}

function rangeBounds(range, size) {
  if ("suffix" in range && range.suffix !== undefined) {
    const length = Math.min(range.suffix, size);
    return { start: size - length, length };
  }
  const start = range.offset ?? 0;
  return { start, length: range.length ?? size - start };
}

function jsonErr(error, status) {
  return new Response(JSON.stringify({ error }), {
    status,
    headers: { "content-type": "application/json", "cache-control": "no-store" },
  });
}

function jsonReply(data, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { "content-type": "application/json", "cache-control": "no-store" },
  });
}
