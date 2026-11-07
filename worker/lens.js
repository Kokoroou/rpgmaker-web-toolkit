// Read-only access for MakerLens (the Assets and Events viewers) with a share
// token, so a game can be looked at without making it public.
//
//   GET /_lens/ping            { ok, gameId, expires }
//   GET /_lens/manifest        { title, engine, files: { "img/x.png": size } }  (rwk-lens.json, made at deploy)
//   GET /_lens/file/<path>     one file of data/, img/, audio/ or js/plugins.js (Range works)
//
// A token is `<id>.<secret>`, sent as `Authorization: Bearer <token>`. The
// CLI (`rwk lens`) keeps a record in R2 under rwk/lens/<GAME_ID>/<id>.json
// with the SHA-256 of the secret and the expiry; deleting the record revokes
// the token (this Worker remembers a valid one for CACHE_MS at most).
//
// These paths sit outside Cloudflare Access (a Bypass application for /_lens),
// so this file is the only check in front of them: it never serves
// /api/ (saves), the player's login, or any file outside LENS_PATH.
//
// CORS is `*` without credentials on purpose: no cookie is involved, so the
// token is the control, not the caller's origin.

import { userHash } from "./auth.js";

export const LENS_PREFIX = "/_lens/";
export const LENS_MANIFEST = "rwk-lens.json";
export const LENS_MAX_HOURS = 30 * 24;
export const LENS_DEFAULT_HOURS = 24;

// Files MakerLens may read: the game's data, pictures, audio and plugin list.
const LENS_PATH = /^(?:(?:data|img|audio)\/.+|js\/plugins\.js)$/;
const CACHE_MS = 60 * 1000;
const cache = new Map(); // `${GAME_ID}/${id}` -> { at, secretHash, exp }

export const lensKey = (gameId, id) => `rwk/lens/${gameId}/${id}.json`;
export const LENS_MAX_LINKS = 20;

// Whether a path of the web build may be read through a lens token.
export function lensAllowed(rel) {
  if (!LENS_PATH.test(rel)) return false;
  return !rel.split("/").some((part) => part === "" || part === "." || part === ".." || part.includes("\\"));
}

export async function sha256Hex(text) {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(text));
  return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, "0")).join("");
}

function sameText(a, b) {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

const CORS = {
  "access-control-allow-origin": "*",
  "access-control-allow-methods": "GET, HEAD, OPTIONS",
  "access-control-allow-headers": "authorization, range, if-none-match",
  "access-control-expose-headers": "content-length, content-range, accept-ranges, etag",
  "access-control-max-age": "86400",
};

function reply(body, status = 200, extra = {}) {
  return new Response(body, {
    status,
    headers: { ...CORS, "x-content-type-options": "nosniff", "x-robots-tag": "noindex, nofollow", ...extra },
  });
}

const fail = (error, status) => reply(JSON.stringify({ error }), status, { "content-type": "application/json", "cache-control": "no-store" });

// -> { id, exp } for a valid token, or null
async function check(request, env) {
  if (!env.BUCKET) return null;
  const header = request.headers.get("authorization") || "";
  const token = /^Bearer ([A-Za-z0-9_-]{4,64})\.([A-Za-z0-9_-]{16,128})$/.exec(header);
  if (!token) return null;
  const [, id, secret] = token;
  const now = Date.now();
  const memo = `${env.GAME_ID}/${id}`;
  let record = cache.get(memo);
  if (!record || now - record.at > CACHE_MS) {
    let data = null;
    try {
      const obj = await env.BUCKET.get(lensKey(env.GAME_ID, id));
      if (obj) data = JSON.parse(new TextDecoder().decode(await obj.arrayBuffer()));
    } catch {
      data = null;
    }
    record = data && typeof data.h === "string" && typeof data.exp === "number" ? { at: now, secretHash: data.h, exp: data.exp } : { at: now, secretHash: "", exp: 0 };
    cache.set(memo, record);
  }
  if (!record.secretHash || record.exp * 1000 <= now) return null;
  if (!sameText(record.secretHash, await sha256Hex(secret))) return null;
  return { id, exp: record.exp };
}

// serveOverflow: index.js's, for files kept in R2. overflowSet: their paths.
export async function handleLens(request, env, path, { overflowSet, serveOverflow }) {
  if (request.method === "OPTIONS") return reply(null, 204);
  if (request.method !== "GET" && request.method !== "HEAD") return fail("Method not allowed", 405);
  if (!env.BUCKET) return fail("Sharing for MakerLens needs the R2 bucket", 503);

  const session = await check(request, env);
  if (!session) return fail("Invalid or expired link", 401);

  const rest = path.slice(LENS_PREFIX.length);
  if (rest === "ping") {
    return reply(JSON.stringify({ ok: true, gameId: env.GAME_ID, expires: session.exp }), 200, { "content-type": "application/json", "cache-control": "no-store" });
  }

  if (rest === "manifest") {
    const res = await env.ASSETS.fetch(new Request(new URL(`/${LENS_MANIFEST}`, request.url)));
    if (!res.ok) return fail("This game was published before MakerLens links: run rwk deploy again", 404);
    return reply(request.method === "HEAD" ? null : await res.text(), 200, { "content-type": "application/json", "cache-control": "no-cache" });
  }

  if (rest.startsWith("file/")) {
    const rel = rest.slice("file/".length);
    if (!lensAllowed(rel)) return fail("Not found", 404);
    let res = null;
    if (overflowSet.has(rel)) res = await serveOverflow(request, env, rel);
    if (!res) {
      const headers = new Headers();
      for (const name of ["range", "if-none-match"]) if (request.headers.has(name)) headers.set(name, request.headers.get(name));
      res = await env.ASSETS.fetch(new Request(new URL("/" + rel.split("/").map(encodeURIComponent).join("/"), request.url), { method: request.method, headers }));
    }
    if (res.status === 404) return fail("Not found", 404);
    const out = new Response(res.body, res);
    for (const [name, value] of Object.entries({ ...CORS, "x-content-type-options": "nosniff", "x-robots-tag": "noindex, nofollow" })) out.headers.set(name, value);
    out.headers.set("cache-control", "private, max-age=3600");
    out.headers.delete("set-cookie");
    return out;
  }

  return fail("Not found", 404);
}

//---------------------------------------------------------------------------
// The owner's side: /api/lens, behind Access like the rest of /api/. Only the
// emails in RWK_LENS_OWNERS (hashes, set at deploy: the creator and `lens.owners`)
// may make, list or stop links, so a player who was invited to play cannot hand
// the game to someone who was not.
//
//   GET    /api/lens          { owner: true, links: [{ id, label, exp, created }] }  (403 for others)
//   POST   /api/lens          { hours, label } -> { id, token, exp }  (the token is shown once)
//   DELETE /api/lens/<id>     stops a link
//---------------------------------------------------------------------------

const ID = /^[0-9a-f]{12}$/;

export async function isLensOwner(env, user) {
  if (env.AUTH_MODE !== "access" || !env.BUCKET) return false;
  let owners = [];
  try {
    owners = JSON.parse(env.RWK_LENS_OWNERS || "[]");
  } catch {
    owners = [];
  }
  return Array.isArray(owners) && owners.includes(await userHash(user.email));
}

const jsonReply = (data, status = 200) =>
  new Response(JSON.stringify(data), { status, headers: { "content-type": "application/json", "cache-control": "no-store" } });

function randomText(bytes) {
  const raw = crypto.getRandomValues(new Uint8Array(bytes));
  return btoa(String.fromCharCode(...raw)).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

async function records(env) {
  const prefix = `rwk/lens/${env.GAME_ID}/`;
  const listed = await env.BUCKET.list({ prefix });
  const out = [];
  for (const object of listed.objects) {
    const id = object.key.slice(prefix.length).replace(/\.json$/, "");
    if (!ID.test(id)) continue;
    try {
      const obj = await env.BUCKET.get(object.key);
      const data = obj && JSON.parse(new TextDecoder().decode(await obj.arrayBuffer()));
      if (data && typeof data.exp === "number") out.push({ id, label: String(data.label || ""), exp: data.exp, created: data.created || 0 });
    } catch {
      // An unreadable record is not a link.
    }
  }
  return out.sort((a, b) => b.created - a.created);
}

export async function handleLensApi(request, env, user, rest) {
  if (!(await isLensOwner(env, user))) return jsonReply({ owner: false, error: "Only the game's owner can share it" }, 403);
  const now = Math.floor(Date.now() / 1000);

  if (rest === "" && request.method === "GET") {
    const links = (await records(env)).filter((l) => l.exp > now);
    return jsonReply({ owner: true, links, maxHours: LENS_MAX_HOURS, defaultHours: LENS_DEFAULT_HOURS });
  }

  if (rest === "" && request.method === "POST") {
    if (!(request.headers.get("content-type") || "").includes("application/json")) return jsonReply({ error: "Send JSON" }, 415);
    let body = {};
    try {
      body = await request.json();
    } catch {
      return jsonReply({ error: "Send JSON" }, 400);
    }
    const hours = body.hours === undefined ? LENS_DEFAULT_HOURS : Number(body.hours);
    if (!Number.isInteger(hours) || hours < 1 || hours > LENS_MAX_HOURS) return jsonReply({ error: `hours must be 1 to ${LENS_MAX_HOURS}` }, 400);
    if ((await records(env)).filter((l) => l.exp > now).length >= LENS_MAX_LINKS) {
      return jsonReply({ error: `At most ${LENS_MAX_LINKS} links at a time: stop one first` }, 409);
    }
    const id = [...crypto.getRandomValues(new Uint8Array(6))].map((b) => b.toString(16).padStart(2, "0")).join("");
    const secret = randomText(24);
    const exp = now + hours * 3600;
    const label = typeof body.label === "string" ? body.label.trim().slice(0, 60) : "";
    await env.BUCKET.put(lensKey(env.GAME_ID, id), JSON.stringify({ h: await sha256Hex(secret), exp, label, created: now }), { httpMetadata: { contentType: "application/json" } });
    return jsonReply({ id, token: `${id}.${secret}`, exp, label });
  }

  if (ID.test(rest) && request.method === "DELETE") {
    await env.BUCKET.delete(lensKey(env.GAME_ID, rest));
    cache.delete(`${env.GAME_ID}/${rest}`);
    return new Response(null, { status: 204 });
  }

  return jsonReply({ error: "Not found" }, 404);
}
