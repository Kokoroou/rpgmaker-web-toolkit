// Worker entry shared by every deployed game. The CLI generates a tiny
// `worker.js` per game that calls createWorker() with that game's
// overflow list (files > 25 MiB that live in R2 instead of static assets).

import { AuthError, identify } from "./auth.js";
import { handleSaves, json } from "./saves.js";

export function createWorker({ overflow = [] } = {}) {
  const overflowSet = new Set(overflow);

  return {
    async fetch(request, env) {
      const url = new URL(request.url);
      const path = safeDecode(url.pathname);

      if (env.RWK_LOCKED === "1") return lockedPage();

      if (path.startsWith("/api/")) return handleApi(request, env, path);

      const rel = path.slice(1);
      if (overflowSet.has(rel) && env.BUCKET) {
        const res = await serveOverflow(request, env, rel);
        if (res) return res;
      }
      return env.ASSETS.fetch(request);
    },
  };
}

async function handleApi(request, env, path) {
  try {
    const user = await identify(request, env);
    if (path === "/api/me") return json({ email: user.email, gameId: env.GAME_ID });
    if (path === "/api/saves") return handleSaves(request, env, user, null);
    if (path.startsWith("/api/saves/")) return handleSaves(request, env, user, path.slice("/api/saves/".length));
    return json({ error: "Not found" }, 404);
  } catch (err) {
    if (err instanceof AuthError) return json({ error: err.message }, err.status);
    console.error(err);
    return json({ error: "Internal error" }, 500);
  }
}

export async function serveOverflow(request, env, rel) {
  if (request.method !== "GET" && request.method !== "HEAD") return null;
  const obj = await env.BUCKET.get(`assets/${env.GAME_ID}/${rel}`, {
    range: request.headers,
    onlyIf: request.headers,
  });
  if (!obj) return null;

  const headers = new Headers();
  obj.writeHttpMetadata(headers);
  headers.set("etag", obj.httpEtag);
  headers.set("accept-ranges", "bytes");
  headers.set("cache-control", "public, max-age=86400");
  // A failed precondition (If-None-Match hit) returns metadata without a body.
  if (!("body" in obj)) return new Response(null, { status: 304, headers });

  let status = 200;
  if (obj.range && request.headers.has("range")) {
    const { start, length } = rangeBounds(obj.range, obj.size);
    headers.set("content-range", `bytes ${start}-${start + length - 1}/${obj.size}`);
    status = 206;
  }
  return new Response(request.method === "HEAD" ? null : obj.body, { status, headers });
}

function rangeBounds(range, size) {
  if ("suffix" in range && range.suffix !== undefined) {
    const length = Math.min(range.suffix, size);
    return { start: size - length, length };
  }
  const start = range.offset ?? 0;
  return { start, length: range.length ?? size - start };
}

function safeDecode(pathname) {
  try {
    return decodeURIComponent(pathname);
  } catch {
    return pathname;
  }
}

function lockedPage() {
  const html = `<!doctype html><html lang="vi"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1"><title>Đang thiết lập</title>
<style>body{margin:0;min-height:100vh;display:grid;place-items:center;background:#111;color:#ddd;font:16px/1.5 system-ui,sans-serif;padding:16px}main{max-width:32rem}</style>
</head><body><main><h1>Game đang được thiết lập</h1>
<p>Trang tạm khóa cho tới khi bảo vệ truy cập được bật. Hãy hoàn tất bước cấu hình trong cửa sổ dòng lệnh rồi tải lại trang.</p></main></body></html>`;
  return new Response(html, {
    status: 503,
    headers: { "content-type": "text/html; charset=utf-8", "cache-control": "no-store", "x-rwk-locked": "1" },
  });
}
