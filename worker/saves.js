// Cloud save API. Save blobs are opaque to the server: the game engine
// adapter decides the format (pako string for MZ, LZString base64 for MV).
//
//   GET    /api/saves          -> { items: [{ name, etag, updatedAt, deviceId, size }] }
//   GET    /api/saves/:name    -> blob (headers: etag, x-rwk-enc, x-rwk-updated, x-rwk-device)
//   PUT    /api/saves/:name    If-Match: <etag> | If-None-Match: *  -> { etag, updatedAt } | 412
//   DELETE /api/saves/:name    If-Match: <etag> (optional)          -> 204 | 412
//
// Save history: before a save is overwritten or deleted, the old copy is kept
// so the player can bring it back (a broken save, the wrong pick in a
// conflict, an overwrite by mistake).
//
//   GET    /api/history                -> { items: [{ name, id, updatedAt, deviceId, size }] }, newest first
//   POST   /api/history/:name/:id      makes that copy the current save again -> { etag, updatedAt }
//
// To spare R2 writes a save keeps at most one copy per SNAPSHOT_MS, unless
// another device or a delete replaces it. config and global get none: the
// engine rewrites them with every save and they are not progress.

import { userHash } from "./auth.js";
import { recordPlayer } from "./players.js";

const NAME_RE = /^[A-Za-z0-9_.-]{1,64}$/;
const MAX_SAVE_BYTES = 8 * 1024 * 1024;
const VERSION_RE = /^\d{13}$/;
const SNAPSHOT_MS = 15 * 60 * 1000;
const DAY_MS = 24 * 60 * 60 * 1000;
const NO_HISTORY = new Set(["config", "global"]);

// RWK_SAVE_HISTORY, written by the CLI: "off" | '{"keep":10,"days":30}'.
// A player's own settings (players.js) replace it.
export function historySettings(env, user = {}) {
  const own = user.settings ? user.settings.saveHistory : undefined;
  if (own !== undefined) return own ? { keep: Number(own.keep) || 10, days: Number(own.days) || 30 } : null;
  const raw = env.RWK_SAVE_HISTORY;
  if (raw === "off") return null;
  let value = {};
  try {
    value = JSON.parse(raw || "{}") || {};
  } catch {
    // keep the defaults
  }
  return { keep: Number(value.keep) || 10, days: Number(value.days) || 30 };
}

// Where one player's saves of this game, and their older copies, live.
async function context(env, user, name) {
  const hash = await userHash(user.email);
  const history = historySettings(env, user);
  return {
    bucket: env.BUCKET,
    prefix: `saves/${hash}/${env.GAME_ID}/`,
    historyPrefix: `history/${hash}/${env.GAME_ID}/`,
    // null: no copies of this save are kept
    history: name !== null && NO_HISTORY.has(name) ? null : history,
    hash,
  };
}

export async function handleSaves(request, env, user, name) {
  if (!env.BUCKET) return json({ error: "Cloud save is disabled for this game" }, 501);
  if (name !== null && !NAME_RE.test(name)) return json({ error: "Invalid save name" }, 400);
  const ctx = await context(env, user, name);

  if (name === null) {
    if (request.method !== "GET") return json({ error: "Method not allowed" }, 405);
    return json({ items: await listSaves(ctx.bucket, ctx.prefix) });
  }

  switch (request.method) {
    case "GET":
      return getSave(ctx.bucket, ctx.prefix + name);
    case "PUT": {
      const res = await putSave(request, ctx, name);
      if (res.status === 200) await recordPlayer(env, ctx.hash);
      return res;
    }
    case "DELETE":
      return deleteSave(request, ctx, name);
    default:
      return json({ error: "Method not allowed" }, 405);
  }
}

// rest: "" (the list) or "<name>/<id>" (restore)
export async function handleHistory(request, env, user, rest) {
  if (!env.BUCKET) return json({ error: "Cloud save is disabled for this game" }, 501);
  if (!historySettings(env, user)) return json({ error: "Save history is off for this game" }, 404);
  if (!rest) {
    if (request.method !== "GET") return json({ error: "Method not allowed" }, 405);
    const ctx = await context(env, user, null);
    return json({ items: await listHistory(ctx) });
  }
  const [name, id, extra] = rest.split("/");
  if (extra !== undefined || !NAME_RE.test(name) || NO_HISTORY.has(name) || !VERSION_RE.test(id || "")) {
    return json({ error: "Invalid save version" }, 400);
  }
  if (request.method !== "POST") return json({ error: "Method not allowed" }, 405);
  return restoreVersion(request, await context(env, user, name), name, id);
}

async function listSaves(bucket, prefix) {
  return (await listObjects(bucket, prefix)).map((obj) => describe(obj, obj.key.slice(prefix.length)));
}

async function getSave(bucket, key) {
  const obj = await bucket.get(key);
  if (!obj) return json({ error: "Not found" }, 404);
  const info = describe(obj);
  return new Response(obj.body, {
    headers: {
      "content-type": "application/octet-stream",
      "cache-control": "no-store",
      etag: info.etag,
      "x-rwk-enc": info.enc,
      "x-rwk-updated": String(info.updatedAt),
      "x-rwk-device": info.deviceId,
    },
  });
}

async function putSave(request, ctx, name) {
  const { bucket } = ctx;
  const key = ctx.prefix + name;
  const body = await request.arrayBuffer();
  if (body.byteLength > MAX_SAVE_BYTES) return json({ error: "Save is too large" }, 413);

  const ifMatch = cleanEtag(request.headers.get("if-match"));
  const ifNoneMatch = request.headers.get("if-none-match");
  const current = await bucket.head(key);
  if (current && (ifMatch ? current.etag !== ifMatch : ifNoneMatch === "*")) {
    return json({ error: "Conflict", current: describe(current) }, 412);
  }

  const updatedAt = Date.now();
  const deviceId = deviceOf(request);
  // "0" on a new save: its first overwrite keeps the original.
  let snapshotAt = (current && current.customMetadata && current.customMetadata.snapshotAt) || "0";
  if (current && ctx.history && (updatedAt - Number(snapshotAt) >= SNAPSHOT_MS || describe(current).deviceId !== deviceId)) {
    await keepCopy(ctx, name, updatedAt);
    snapshotAt = String(updatedAt);
  }
  const customMetadata = {
    updatedAt: String(updatedAt),
    deviceId,
    enc: request.headers.get("x-rwk-enc") === "utf8" ? "utf8" : "latin1",
    snapshotAt,
  };
  const options = { customMetadata };
  if (ifMatch) options.onlyIf = { etagMatches: ifMatch };

  const result = await bucket.put(key, body, options);
  if (!result) {
    const current = await bucket.head(key);
    return json({ error: "Conflict", current: current ? describe(current) : null }, 412);
  }
  return json({ etag: result.etag, updatedAt });
}

async function deleteSave(request, ctx, name) {
  const { bucket } = ctx;
  const key = ctx.prefix + name;
  const ifMatch = cleanEtag(request.headers.get("if-match"));
  const current = await bucket.head(key);
  if (current && ifMatch && current.etag !== ifMatch) {
    return json({ error: "Conflict", current: describe(current) }, 412);
  }
  if (current && ctx.history) await keepCopy(ctx, name, Date.now());
  await bucket.delete(key);
  return new Response(null, { status: 204 });
}

//---------------------------------------------------------------------------
// History: history/<userHash>/<GAME_ID>/<name>/<id>, id = the copy's own
// save time as 13 digits, so a copy kept twice lands on the same key.
//---------------------------------------------------------------------------

// Copies the current save into the history, then drops what is past the limits.
async function keepCopy(ctx, name, now) {
  const obj = await ctx.bucket.get(ctx.prefix + name);
  if (!obj) return;
  const info = describe(obj);
  await ctx.bucket.put(ctx.historyPrefix + name + "/" + versionId(info.updatedAt), await obj.arrayBuffer(), {
    customMetadata: { updatedAt: String(info.updatedAt), deviceId: info.deviceId, enc: info.enc },
  });
  await prune(ctx.bucket, await listObjects(ctx.bucket, ctx.historyPrefix + name + "/"), ctx.history, now);
}

// objects: one save's copies. Keeps the newest `keep` from the last `days`;
// returns them, newest first.
async function prune(bucket, objects, limits, now) {
  const newest = [...objects].sort((a, b) => (a.key < b.key ? 1 : -1));
  const cutoff = now - limits.days * DAY_MS;
  const kept = newest.filter((obj, i) => i < limits.keep && describe(obj).updatedAt >= cutoff);
  const old = newest.filter((obj) => !kept.includes(obj)).map((obj) => obj.key);
  if (old.length) await bucket.delete(old);
  return kept;
}

async function listHistory(ctx) {
  const byName = new Map();
  for (const obj of await listObjects(ctx.bucket, ctx.historyPrefix)) {
    const [name, id] = obj.key.slice(ctx.historyPrefix.length).split("/");
    if (!VERSION_RE.test(id || "")) continue;
    if (!byName.has(name)) byName.set(name, []);
    byName.get(name).push(obj);
  }
  const items = [];
  const now = Date.now();
  for (const [name, objects] of byName) {
    // Copies of saves no longer written expire here.
    for (const obj of await prune(ctx.bucket, objects, ctx.history, now)) {
      const { size, updatedAt, deviceId } = describe(obj);
      items.push({ name, id: obj.key.slice(obj.key.lastIndexOf("/") + 1), updatedAt, deviceId, size });
    }
  }
  return items.sort((a, b) => b.updatedAt - a.updatedAt);
}

// The save being replaced is kept too, so a restore can be undone.
async function restoreVersion(request, ctx, name, id) {
  const copy = await ctx.bucket.get(ctx.historyPrefix + name + "/" + id);
  if (!copy) return json({ error: "Not found" }, 404);
  const body = await copy.arrayBuffer();
  const updatedAt = Date.now();
  const current = await ctx.bucket.head(ctx.prefix + name);
  if (current && versionId(describe(current).updatedAt) !== id) await keepCopy(ctx, name, updatedAt);
  const result = await ctx.bucket.put(ctx.prefix + name, body, {
    customMetadata: {
      updatedAt: String(updatedAt),
      deviceId: deviceOf(request),
      enc: describe(copy).enc,
      snapshotAt: String(updatedAt),
    },
  });
  return json({ etag: result.etag, updatedAt });
}

async function listObjects(bucket, prefix) {
  const objects = [];
  let cursor;
  do {
    const page = await bucket.list({ prefix, cursor, include: ["customMetadata"] });
    objects.push(...page.objects);
    cursor = page.truncated ? page.cursor : undefined;
  } while (cursor);
  return objects;
}

const versionId = (ms) => String(ms).padStart(13, "0");
const deviceOf = (request) => (request.headers.get("x-rwk-device") || "unknown").slice(0, 64);

function describe(obj, name) {
  const meta = obj.customMetadata || {};
  return {
    ...(name !== undefined && { name }),
    etag: obj.etag,
    size: obj.size,
    // Saves uploaded by the CLI (import) carry no custom metadata.
    updatedAt: Number(meta.updatedAt) || new Date(obj.uploaded).getTime(),
    deviceId: meta.deviceId || "import",
    enc: meta.enc || "latin1",
  };
}

function cleanEtag(value) {
  if (!value || value === "*") return null;
  return value.replace(/^W\//, "").replace(/"/g, "");
}

export function json(data, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { "content-type": "application/json; charset=utf-8", "cache-control": "no-store" },
  });
}
