// Host-only endpoint: stream the entire web build as a ZIP archive.
//
//   GET /api/download   -> game-<GAME_ID>.zip  (401/403 for non-owners, 503 without a bucket)
//
// Only emails listed in RWK_DOWNLOAD_OWNERS (hashes, set at deploy like
// RWK_LENS_OWNERS) may call this. It is off when that var is empty or missing.
//
// The ZIP is built as a stream of STORED (uncompressed) entries so the Worker
// never has to hold the whole archive in memory. Files are read in two passes:
//
//   1. Static assets from ASSETS.fetch (the Cloudflare assets binding), using
//      the rwk-lens manifest (rwk-lens.json) to discover lensAllowed() files.
//   2. Overflow files from R2 (assets/<GAME_ID>/<rel>), listed from the
//      overflow manifest (.rwk-manifest.json).
//
// ZIP spec references: APPNOTE.TXT §4.3

import { userHash } from "./auth.js";
import { LENS_MANIFEST, lensAllowed } from "./lens.js";

// Who may download the build: hashes of their emails, set at deploy.
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
    return new Response(request.method === "HEAD" ? null : JSON.stringify({ owner: true, gameId: env.GAME_ID }), {
      status: 200,
      headers: {
        "content-type": "application/json",
        "cache-control": "no-store",
      },
    });
  }

  // 1. Discover static files via the lens manifest (already deployed to ASSETS).
  let lensFiles = {}; // rel -> size
  try {
    const res = await env.ASSETS.fetch(new Request(new URL(`/${LENS_MANIFEST}`, request.url)));
    if (res.ok) {
      const data = await res.json();
      if (data && typeof data.files === "object") lensFiles = data.files;
    }
  } catch {
    // Manifest missing or unreadable: fall through with empty list.
  }

  // 2. Discover overflow files from R2 (.rwk-manifest.json written by the CLI).
  let overflowFiles = {}; // rel -> { sha256, size }
  try {
    const obj = await env.BUCKET.get(`assets/${env.GAME_ID}/.rwk-manifest.json`);
    if (obj) {
      const data = JSON.parse(new TextDecoder().decode(await obj.arrayBuffer()));
      if (data && typeof data === "object") overflowFiles = data;
    }
  } catch {
    // No manifest or unreadable: no overflow files in the ZIP.
  }

  // Build the entry list (static first, then overflow that is not already in static).
  // rel -> { source: "asset" | "overflow", size }
  const entries = [];
  for (const [rel, size] of Object.entries(lensFiles)) {
    if (lensAllowed(rel)) entries.push({ rel, source: "asset", size });
  }
  const overflowRels = new Set(entries.map((e) => e.rel));
  for (const [rel, info] of Object.entries(overflowFiles)) {
    if (!overflowRels.has(rel)) entries.push({ rel, source: "overflow", size: info.size });
  }

  const filename = `game-${env.GAME_ID}.zip`;
  const { readable, writable } = new TransformStream();
  const writer = writable.getWriter();
  buildZip(writer, entries, env, request.url).catch(() => writer.abort());

  return new Response(readable, {
    headers: {
      "content-type": "application/zip",
      "content-disposition": `attachment; filename="${filename}"`,
      "cache-control": "no-store",
      "x-robots-tag": "noindex, nofollow",
    },
  });
}

// ---------------------------------------------------------------------------
// ZIP streaming (STORED, no compression)
// ---------------------------------------------------------------------------

// Writes all entries to `writer`, then writes the central directory and closes.
async function buildZip(writer, entries, env, baseUrl) {
  const centralDir = []; // { localOffset, header, name }
  let offset = 0;

  for (const entry of entries) {
    const name = encodeUtf8(entry.rel);
    const body = await fetchEntry(entry, env, baseUrl);
    if (!body) continue; // skip unreadable files

    const data = new Uint8Array(await body.arrayBuffer());
    const crc = crc32(data);
    const size = data.byteLength;

    const localHeader = localFileHeader(name, size, crc);
    centralDir.push({ localOffset: offset, header: centralDirHeader(name, size, crc, offset), name });
    await writer.write(localHeader);
    await writer.write(data);
    offset += localHeader.byteLength + size;
  }

  // Central directory
  let cdOffset = offset;
  let cdSize = 0;
  for (const { header } of centralDir) {
    await writer.write(header);
    cdSize += header.byteLength;
  }

  await writer.write(endOfCentralDir(centralDir.length, cdSize, cdOffset));
  await writer.close();
}

async function fetchEntry(entry, env, baseUrl) {
  if (entry.source === "overflow") {
    const obj = await env.BUCKET.get(`assets/${env.GAME_ID}/${entry.rel}`);
    return obj || null;
  }
  // Static asset
  const encoded = entry.rel.split("/").map(encodeURIComponent).join("/");
  const res = await env.ASSETS.fetch(new Request(new URL(`/${encoded}`, baseUrl)));
  return res.ok ? res : null;
}

// ---------------------------------------------------------------------------
// ZIP binary helpers (little-endian)
// ---------------------------------------------------------------------------

function u16(n) {
  const b = new Uint8Array(2);
  new DataView(b.buffer).setUint16(0, n, true);
  return b;
}
function u32(n) {
  const b = new Uint8Array(4);
  new DataView(b.buffer).setUint32(0, n >>> 0, true);
  return b;
}

function localFileHeader(name, size, crc) {
  // Signature 0x04034b50, version 20, GP flag 0x0800 (UTF-8), method 0 (STORED)
  return concat(
    new Uint8Array([0x50, 0x4b, 0x03, 0x04]), // local file header sig
    u16(20),          // version needed
    u16(0x0800),      // general purpose bit flag: UTF-8
    u16(0),           // compression method: STORED
    u16(0), u16(0),   // last mod time / date (zeroed)
    u32(crc),
    u32(size),        // compressed size
    u32(size),        // uncompressed size
    u16(name.byteLength),
    u16(0),           // extra field length
    name
  );
}

function centralDirHeader(name, size, crc, localOffset) {
  return concat(
    new Uint8Array([0x50, 0x4b, 0x01, 0x02]), // central dir sig
    u16(20), u16(20),  // version made by / needed
    u16(0x0800),       // GP flag: UTF-8
    u16(0),            // STORED
    u16(0), u16(0),    // mod time / date
    u32(crc),
    u32(size),
    u32(size),
    u16(name.byteLength),
    u16(0), u16(0),    // extra / comment length
    u16(0),            // disk number start
    u16(0), u32(0),    // internal / external attributes
    u32(localOffset),
    name
  );
}

function endOfCentralDir(count, cdSize, cdOffset) {
  return concat(
    new Uint8Array([0x50, 0x4b, 0x05, 0x06]), // EOCD sig
    u16(0), u16(0),    // disk number / disk with CD
    u16(count), u16(count),
    u32(cdSize),
    u32(cdOffset),
    u16(0)             // comment length
  );
}

function concat(...arrays) {
  const total = arrays.reduce((s, a) => s + a.byteLength, 0);
  const out = new Uint8Array(total);
  let pos = 0;
  for (const a of arrays) {
    out.set(a, pos);
    pos += a.byteLength;
  }
  return out;
}

function encodeUtf8(str) {
  return new TextEncoder().encode(str);
}

// CRC-32 (ISO 3309 / ZIP)
const CRC_TABLE = (() => {
  const t = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    t[n] = c;
  }
  return t;
})();

function crc32(data) {
  let crc = 0xffffffff;
  for (let i = 0; i < data.length; i++) crc = CRC_TABLE[(crc ^ data[i]) & 0xff] ^ (crc >>> 8);
  return (crc ^ 0xffffffff) >>> 0;
}

function jsonErr(error, status) {
  return new Response(JSON.stringify({ error }), {
    status,
    headers: { "content-type": "application/json", "cache-control": "no-store" },
  });
}
