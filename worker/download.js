// Host-only endpoint: the whole web build as one ZIP archive.
//
//   GET /api/download   -> game-<GAME_ID>.zip  (401/403 for non-owners, 503 without a bucket)
//   HEAD /api/download?check=1 -> { owner: true, gameId }   (the in-game entry asks this)
//
// Only emails listed in RWK_DOWNLOAD_OWNERS (hashes, set at deploy like
// RWK_LENS_OWNERS) may call this. It is off when that var is empty or missing.
//
// The ZIP is made by the CLI at deploy and kept in R2 (assets/<GAME_ID>/rwk.zip,
// cli/lib/zip.js): a Worker cannot stream a game's archive by reading its files
// one by one, because every read is a subrequest and a game has thousands of
// files. Here the archive is one object, read once with Range support, so a
// dropped connection resumes instead of starting again.
//
// A game deployed before this file existed has no archive yet: it answers with
// how to make one (the build itself is untouched).

import { userHash } from "./auth.js";

const ZIP_KEY = (gameId) => `assets/${gameId}/rwk.zip`;

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

export async function handleDownload(request, env, user) {
  if (!env.BUCKET) return jsonErr("Download needs the R2 bucket", 503);
  if (!(await isDownloadOwner(env, user))) return jsonErr("Only the game's owner can download it", 403);
  if (request.method !== "GET" && request.method !== "HEAD") return jsonErr("Method not allowed", 405);

  const url = new URL(request.url);
  if (url.searchParams.get("check") === "1" || request.method === "HEAD") {
    // Whether the entry is worth showing: the owner, and a build to download.
    const obj = await env.BUCKET.head(ZIP_KEY(env.GAME_ID));
    const body = request.method === "HEAD" ? null : JSON.stringify({ owner: true, gameId: env.GAME_ID, ready: !!obj });
    return new Response(body, {
      status: 200,
      headers: { "content-type": "application/json", "cache-control": "no-store" },
    });
  }

  const obj = await env.BUCKET.get(ZIP_KEY(env.GAME_ID), { range: request.headers, onlyIf: request.headers });
  if (!obj) {
    return jsonErr("This build has no ZIP yet: run `rwk deploy` again to make one", 404);
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
