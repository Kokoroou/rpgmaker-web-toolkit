// Worker entry shared by every deployed game. The CLI generates a tiny
// `worker.js` per game that calls createWorker() with that game's
// overflow list (files > 25 MiB that live in R2 instead of static assets),
// the deployer's per-player settings, and, after `rwk update-from-link`, the
// newer toolkit to serve (toolkit.js).
//
// playerSettings: { [userHash(email)]: { key: runtime value } }, made by the
// CLI (playerOverrides in cli/lib/stage.js). Hashed, so the emails are not
// in the Worker. Each player's js/plugins.js carries their own settings, and
// the save API applies the ones it enforces (saveHistory).

import { AuthError, identify, userHash } from "./auth.js";
import { handleHistory, handleSaves, json } from "./saves.js";
import { patchConfig, serveToolkit } from "./toolkit.js";

export function createWorker({ overflow = [], toolkit = null, playerSettings = {} } = {}) {
  const overflowSet = new Set(overflow);
  const perPlayer = Object.keys(playerSettings).length > 0;

  // -> the request's user, with `settings` (their own entry, or null)
  const whoIs = async (request, env) => {
    const user = await identify(request, env);
    return { ...user, settings: perPlayer ? playerSettings[await userHash(user.email)] || null : null };
  };

  return {
    async fetch(request, env) {
      const url = new URL(request.url);
      const path = safeDecode(url.pathname);

      if (env.RWK_LOCKED === "1") return lockedPage();

      if (path.startsWith("/api/")) return handleApi(request, env, path, whoIs);

      const rel = path.slice(1);
      let res = null;
      if (toolkit) res = await serveToolkit(request, env, rel, toolkit);
      if (!res && overflowSet.has(rel) && env.BUCKET) res = await serveOverflow(request, env, rel);
      if (perPlayer && rel === "js/plugins.js" && request.method === "GET") res = await servePlayerPlugins(request, env, res, whoIs);
      if (res) {
        if (env.RWK_INDEXABLE !== "1") res.headers.set("x-robots-tag", "noindex, nofollow");
        return res;
      }
      return env.ASSETS.fetch(request);
    },
  };
}

async function handleApi(request, env, path, whoIs) {
  try {
    const user = await whoIs(request, env);
    if (path === "/api/me") return json({ email: user.email, gameId: env.GAME_ID });
    // What this player gets on top of everyone's settings (js/plugins.js).
    if (path === "/api/config") return json({ email: user.email, gameId: env.GAME_ID, settings: user.settings || {} });
    if (path === "/api/saves") return handleSaves(request, env, user, null);
    if (path.startsWith("/api/saves/")) return handleSaves(request, env, user, path.slice("/api/saves/".length));
    if (path === "/api/history") return handleHistory(request, env, user, "");
    if (path.startsWith("/api/history/")) return handleHistory(request, env, user, path.slice("/api/history/".length));
    return json({ error: "Not found" }, 404);
  } catch (err) {
    if (err instanceof AuthError) return json({ error: err.message }, err.status);
    console.error(err);
    return json({ error: "Internal error" }, 500);
  }
}

// js/plugins.js with the player's own settings in RWK_Core's config.
// res: the toolkit's plugins.js (update-from-link), or null for the static one.
async function servePlayerPlugins(request, env, res, whoIs) {
  // Without the browser's conditional headers, so the original always has a body.
  const base = res || (await env.ASSETS.fetch(new Request(request.url)));
  if (!base.ok) return res; // null: left to static assets
  let settings = null;
  try {
    settings = (await whoIs(request, env)).settings;
  } catch {
    // Not signed in (yet): everyone's settings. The API refuses them anyway.
  }
  const body = await base.text();
  return new Response(settings ? patchConfig(body, settings) : body, {
    // Never shared between players, nor kept without asking again.
    headers: { "content-type": "text/javascript; charset=utf-8", "cache-control": "private, no-cache" },
  });
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
<meta name="viewport" content="width=device-width,initial-scale=1"><meta name="robots" content="noindex, nofollow"><title>Setting up</title>
<style>body{margin:0;min-height:100vh;display:grid;place-items:center;background:#111;color:#ddd;font:16px/1.5 system-ui,sans-serif;padding:16px}main{max-width:32rem}</style>
</head><body><main><h1>This game is being set up</h1>
<p>The site stays locked until access protection is enabled. Finish the setup in the terminal, then reload this page.</p></main></body></html>`;
  return new Response(html, {
    status: 503,
    headers: {
      "content-type": "text/html; charset=utf-8",
      "cache-control": "no-store",
      "x-rwk-locked": "1",
      "x-robots-tag": "noindex, nofollow",
    },
  });
}
