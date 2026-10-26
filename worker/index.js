// Worker entry shared by every deployed game. The CLI generates a tiny
// `worker.js` per game that calls createWorker() with that game's
// overflow list (files > 25 MiB that live in R2 instead of static assets),
// the deployer's per-player settings, and, after `rwk upgrade`, the
// newer toolkit to serve (toolkit.js).
//
// playerSettings: { [userHash(email)]: { key: runtime value } }, made by the
// CLI (playerOverrides in cli/lib/stage.js). Hashed, so the emails are not
// in the Worker. Each player's js/plugins.js carries their own settings, and
// the save API applies the ones it enforces (saveHistory).
//
// The settings file in R2 (settings.js), when there is one, replaces both
// everyone's settings and playerSettings, so an edit needs no redeploy.

import { AuthError, identify, userHash } from "./auth.js";
import { handleHistory, handleSaves, json } from "./saves.js";
import { liveSettings } from "./settings.js";
import { patchConfig, serveToolkit } from "./toolkit.js";

export function createWorker({ overflow = [], toolkit = null, playerSettings = {} } = {}) {
  const overflowSet = new Set(overflow);

  // -> { config: everyone's settings from R2 or null, players }
  const settingsOf = async (env) => {
    const live = await liveSettings(env);
    return live || { config: null, players: playerSettings };
  };

  // -> the request's user, with `settings` (their own entry, or null) and
  // `shared` (everyone's settings from R2, or null: the deploy's)
  const whoIs = async (request, env) => {
    const user = await identify(request, env);
    const { config, players } = await settingsOf(env);
    const settings = Object.keys(players).length ? players[await userHash(user.email)] || null : null;
    return { ...user, settings, shared: config };
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
      if (rel === "js/plugins.js" && request.method === "GET") res = await servePlugins(request, env, res, settingsOf, whoIs);
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

// js/plugins.js with the settings from R2 and the player's own settings in
// RWK_Core's config. res: the toolkit's plugins.js (upgrade), or
// null for the static one.
async function servePlugins(request, env, res, settingsOf, whoIs) {
  const { config, players } = await settingsOf(env);
  if (!config && !Object.keys(players).length) return res; // as deployed
  // Without the browser's conditional headers, so the original always has a body.
  const base = res || (await env.ASSETS.fetch(new Request(request.url)));
  if (!base.ok) return res; // null: left to static assets
  let settings = null;
  if (Object.keys(players).length) {
    try {
      settings = (await whoIs(request, env)).settings;
    } catch {
      // Not signed in (yet): everyone's settings. The API refuses them anyway.
    }
  }
  let body = await base.text();
  if (config) body = patchConfig(body, config);
  if (settings) body = patchConfig(body, settings);
  return new Response(body, {
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
