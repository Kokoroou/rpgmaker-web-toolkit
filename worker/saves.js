// Cloud save API. Save blobs are opaque to the server: the game engine
// adapter decides the format (pako string for MZ, LZString base64 for MV).
//
//   GET    /api/saves          -> { items: [{ name, etag, updatedAt, deviceId, size }] }
//   GET    /api/saves/:name    -> blob (headers: etag, x-rwk-enc, x-rwk-updated, x-rwk-device)
//   PUT    /api/saves/:name    If-Match: <etag> | If-None-Match: *  -> { etag, updatedAt } | 412
//   DELETE /api/saves/:name    If-Match: <etag> (optional)          -> 204 | 412

import { userHash } from "./auth.js";
import { recordPlayer } from "./players.js";

const NAME_RE = /^[A-Za-z0-9_.-]{1,64}$/;
const MAX_SAVE_BYTES = 8 * 1024 * 1024;

export async function handleSaves(request, env, user, name) {
  if (!env.BUCKET) return json({ error: "Cloud save is disabled for this game" }, 501);
  const hash = await userHash(user.email);
  const prefix = `saves/${hash}/${env.GAME_ID}/`;

  if (name === null) {
    if (request.method !== "GET") return json({ error: "Method not allowed" }, 405);
    return json({ items: await listSaves(env.BUCKET, prefix) });
  }
  if (!NAME_RE.test(name)) return json({ error: "Invalid save name" }, 400);
  const key = prefix + name;

  switch (request.method) {
    case "GET":
      return getSave(env.BUCKET, key);
    case "PUT": {
      const res = await putSave(request, env.BUCKET, key);
      if (res.status === 200) await recordPlayer(env, hash);
      return res;
    }
    case "DELETE":
      return deleteSave(request, env.BUCKET, key);
    default:
      return json({ error: "Method not allowed" }, 405);
  }
}

async function listSaves(bucket, prefix) {
  const items = [];
  let cursor;
  do {
    const page = await bucket.list({ prefix, cursor, include: ["customMetadata"] });
    for (const obj of page.objects) items.push(describe(obj, obj.key.slice(prefix.length)));
    cursor = page.truncated ? page.cursor : undefined;
  } while (cursor);
  return items;
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

async function putSave(request, bucket, key) {
  const body = await request.arrayBuffer();
  if (body.byteLength > MAX_SAVE_BYTES) return json({ error: "Save is too large" }, 413);

  const ifMatch = cleanEtag(request.headers.get("if-match"));
  const ifNoneMatch = request.headers.get("if-none-match");
  if (!ifMatch && ifNoneMatch === "*") {
    const existing = await bucket.head(key);
    if (existing) return json({ error: "Conflict", current: describe(existing) }, 412);
  }

  const updatedAt = Date.now();
  const customMetadata = {
    updatedAt: String(updatedAt),
    deviceId: (request.headers.get("x-rwk-device") || "unknown").slice(0, 64),
    enc: request.headers.get("x-rwk-enc") === "utf8" ? "utf8" : "latin1",
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

async function deleteSave(request, bucket, key) {
  const ifMatch = cleanEtag(request.headers.get("if-match"));
  if (ifMatch) {
    const current = await bucket.head(key);
    if (current && current.etag !== ifMatch) {
      return json({ error: "Conflict", current: describe(current) }, 412);
    }
  }
  await bucket.delete(key);
  return new Response(null, { status: 204 });
}

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
