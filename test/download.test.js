// Tests for the host-download-zip feature: GET /api/download

import assert from "node:assert/strict";
import { test } from "node:test";
import { createWorker } from "../worker/index.js";
import { handleDownload, isDownloadOwner } from "../worker/download.js";
import { userHash as workerUserHash } from "../worker/auth.js";
import { userHash, downloadOwnersOf, downloadOwnersForUpgrade, workerVars } from "../cli/lib/cloudflare.js";
import { RUNTIME_PLUGINS } from "../cli/lib/stage.js";
import fs from "node:fs";
import path from "node:path";
import { makeEnv } from "./helpers.js";
import { LENS_MANIFEST } from "../worker/lens.js";

const BASE = "https://game.example.workers.dev";

// Minimal lens manifest and R2 overflow manifest for the tests.
const LENS_FILES = { "data/Map001.json": 10, "img/pictures/a.png_": 5, "js/plugins.js": 20 };
const OVERFLOW_MANIFEST = { "img/big.png_": { sha256: "abc", size: 100 } };

// Assets binding: serves the lens manifest and static files.
function makeAssets(extraFiles = {}) {
  const files = {
    [LENS_MANIFEST]: JSON.stringify({ v: 1, title: "Test", engine: "MZ", files: LENS_FILES }),
    "data/Map001.json": "{}",
    "img/pictures/a.png_": "PNG",
    "js/plugins.js": "plugins",
    ...extraFiles,
  };
  return {
    fetch: async (req) => {
      const rel = decodeURIComponent(new URL(req.url).pathname.slice(1));
      return rel in files ? new Response(files[rel]) : new Response("nf", { status: 404 });
    },
  };
}

function ownerEnv(overrides = {}) {
  const hash = userHash("host@example.com");
  return makeEnv({
    AUTH_MODE: "access",
    RWK_DOWNLOAD_OWNERS: JSON.stringify([hash]),
    ASSETS: makeAssets(),
    ...overrides,
  });
}

const as = (email) => ({ email });

// ---------------------------------------------------------------------------
// isDownloadOwner
// ---------------------------------------------------------------------------

test("download: isDownloadOwner recognises the right email hashes", async () => {
  const env = ownerEnv();
  assert.ok(await isDownloadOwner(env, as("host@example.com")));
  assert.ok(await isDownloadOwner(env, as("HOST@Example.com ")), "case and spaces do not matter");
  assert.ok(!(await isDownloadOwner(env, as("other@example.com"))));
});

test("download: isDownloadOwner is off when BUCKET is missing or AUTH_MODE is not access", async () => {
  assert.ok(!(await isDownloadOwner(makeEnv({ AUTH_MODE: "none", RWK_DOWNLOAD_OWNERS: JSON.stringify([userHash("host@example.com")]) }), as("host@example.com"))));
  assert.ok(!(await isDownloadOwner(makeEnv({ AUTH_MODE: "access", BUCKET: undefined, RWK_DOWNLOAD_OWNERS: JSON.stringify([userHash("host@example.com")]) }), as("host@example.com"))));
  assert.ok(!(await isDownloadOwner(makeEnv({ AUTH_MODE: "access" }), as("host@example.com"))), "no owners var: off");
});

// ---------------------------------------------------------------------------
// handleDownload – gate checks
// ---------------------------------------------------------------------------

test("download: non-owner gets 403", async () => {
  const env = ownerEnv();
  const res = await handleDownload(new Request(BASE + "/api/download"), env, as("player@example.com"));
  assert.equal(res.status, 403);
  assert.equal((await res.json()).error, "Only the game's owner can download it");
});

test("download: without a bucket returns 503", async () => {
  const hash = userHash("host@example.com");
  const env = makeEnv({ AUTH_MODE: "access", RWK_DOWNLOAD_OWNERS: JSON.stringify([hash]), BUCKET: undefined, ASSETS: makeAssets() });
  const res = await handleDownload(new Request(BASE + "/api/download"), env, as("host@example.com"));
  assert.equal(res.status, 503);
});

test("download: only GET and HEAD are allowed", async () => {
  const env = ownerEnv();
  const post = await handleDownload(new Request(BASE + "/api/download", { method: "POST" }), env, as("host@example.com"));
  assert.equal(post.status, 405);
  const head = await handleDownload(new Request(BASE + "/api/download", { method: "HEAD" }), env, as("host@example.com"));
  assert.equal(head.status, 200);
});

test("download: ?check=1 returns owner status without streaming zip", async () => {
  const env = ownerEnv();
  const res = await handleDownload(new Request(BASE + "/api/download?check=1"), env, as("host@example.com"));
  assert.equal(res.status, 200);
  const body = await res.json();
  assert.equal(body.owner, true);
  assert.equal(body.gameId, "test-game");
});

// ---------------------------------------------------------------------------
// handleDownload – ZIP content
// ---------------------------------------------------------------------------

test("download: returns a valid ZIP for the owner, static files only", async () => {
  const env = ownerEnv();
  const res = await handleDownload(new Request(BASE + "/api/download"), env, as("host@example.com"));
  assert.equal(res.status, 200);
  assert.match(res.headers.get("content-type"), /zip/);
  assert.match(res.headers.get("content-disposition"), /attachment/);
  assert.match(res.headers.get("content-disposition"), /game-test-game\.zip/);
  assert.equal(res.headers.get("cache-control"), "no-store");

  const bytes = new Uint8Array(await res.arrayBuffer());
  // ZIP local file header signature: PK\x03\x04
  assert.equal(bytes[0], 0x50);
  assert.equal(bytes[1], 0x4b);
  assert.equal(bytes[2], 0x03);
  assert.equal(bytes[3], 0x04);
  // End of central directory signature somewhere near the end: PK\x05\x06
  const eocd = findSignature(bytes, [0x50, 0x4b, 0x05, 0x06]);
  assert.ok(eocd >= 0, "EOCD signature found");
});

test("download: ZIP includes overflow files from R2", async () => {
  const env = ownerEnv();
  // Put the overflow manifest and the actual overflow file in R2.
  await env.BUCKET.put(`assets/test-game/.rwk-manifest.json`, JSON.stringify(OVERFLOW_MANIFEST));
  await env.BUCKET.put(`assets/test-game/img/big.png_`, "BIGPNG");

  const res = await handleDownload(new Request(BASE + "/api/download"), env, as("host@example.com"));
  assert.equal(res.status, 200);
  const bytes = new Uint8Array(await res.arrayBuffer());

  // Check that "img/big.png_" appears in the ZIP as a file name.
  const str = new TextDecoder("latin1").decode(bytes);
  assert.ok(str.includes("img/big.png_"), "overflow file name appears in ZIP");
});

test("download: ZIP skips files not in the lens manifest and handles missing files gracefully", async () => {
  // Lens manifest references a file that ASSETS cannot serve (simulates a missing file).
  const badAssets = {
    fetch: async (req) => {
      const rel = decodeURIComponent(new URL(req.url).pathname.slice(1));
      if (rel === LENS_MANIFEST) return new Response(JSON.stringify({ v: 1, files: { "data/ok.json": 3, "data/missing.json": 5 } }));
      if (rel === "data/ok.json") return new Response("{}");
      return new Response("nope", { status: 404 });
    },
  };
  const hash = userHash("host@example.com");
  const env = makeEnv({ AUTH_MODE: "access", RWK_DOWNLOAD_OWNERS: JSON.stringify([hash]), ASSETS: badAssets });
  const res = await handleDownload(new Request(BASE + "/api/download"), env, as("host@example.com"));
  assert.equal(res.status, 200);
  const bytes = new Uint8Array(await res.arrayBuffer());
  const str = new TextDecoder("latin1").decode(bytes);
  assert.ok(str.includes("data/ok.json"), "present file is in ZIP");
  // "data/missing.json" is skipped but no error is thrown.
  assert.equal(findSignature(bytes, [0x50, 0x4b, 0x05, 0x06]) >= 0, true, "ZIP ends correctly");
});

test("download: without a lens manifest the ZIP is empty but valid", async () => {
  const hash = userHash("host@example.com");
  const noManifestAssets = { fetch: async () => new Response("nope", { status: 404 }) };
  const env = makeEnv({ AUTH_MODE: "access", RWK_DOWNLOAD_OWNERS: JSON.stringify([hash]), ASSETS: noManifestAssets });
  const res = await handleDownload(new Request(BASE + "/api/download"), env, as("host@example.com"));
  assert.equal(res.status, 200);
  const bytes = new Uint8Array(await res.arrayBuffer());
  // An empty ZIP is just EOCD (22 bytes: PK\x05\x06 + 18 bytes of zeroes).
  assert.equal(findSignature(bytes, [0x50, 0x4b, 0x05, 0x06]), 0);
});

// ---------------------------------------------------------------------------
// Through the full Worker
// ---------------------------------------------------------------------------

test("download: worker routes /api/download to the handler", async () => {
  const hash = userHash("host@example.com");
  const env = makeEnv({
    AUTH_MODE: "none", // AUTH_MODE none -> user is "public", not the owner
    RWK_DOWNLOAD_OWNERS: JSON.stringify([hash]),
    ASSETS: makeAssets(),
  });
  const worker = createWorker();
  const res = await worker.fetch(new Request(BASE + "/api/download"), env);
  // "public" is not in download owners -> 403
  assert.equal(res.status, 403);
});

// ---------------------------------------------------------------------------
// CLI helpers: downloadOwnersOf / downloadOwnersForUpgrade / workerVars
// ---------------------------------------------------------------------------

test("download owners: downloadOwnersOf derives hashes from the account email and owners list", () => {
  assert.deepEqual(downloadOwnersOf({}, "Host@Example.com"), [userHash("host@example.com")]);
  assert.equal(
    downloadOwnersOf({ download: { owners: ["host@example.com", "co@example.com", "bad"] } }, "host@example.com").length,
    2,
    "deduplicated, invalid dropped"
  );
  assert.deepEqual(downloadOwnersOf({ download: false }, "host@example.com"), []);
  assert.deepEqual(downloadOwnersOf({}, undefined), []);
});

test("download owners: downloadOwnersForUpgrade keeps stored list or falls back to current account", () => {
  assert.deepEqual(downloadOwnersForUpgrade({}, "host@example.com"), [userHash("host@example.com")], "nothing stored: use the account");
  assert.deepEqual(downloadOwnersForUpgrade({ downloadOwners: ["abc"] }, "other@example.com"), ["abc"], "what the deploy stored is kept");
  assert.deepEqual(downloadOwnersForUpgrade({ download: false }, "host@example.com"), [], "switched off stays off");
  assert.deepEqual(downloadOwnersForUpgrade({ downloadOwners: [] }, "host@example.com"), [], "a stored empty list (off) is not overridden");
});

test("download owners: workerVars includes RWK_DOWNLOAD_OWNERS when non-empty, omits it otherwise", () => {
  const base = { gameId: "g", auth: {}, locked: false, indexable: false, saveHistory: false };
  const withOwners = workerVars({ ...base, downloadOwners: ["abc"] });
  assert.equal(withOwners.RWK_DOWNLOAD_OWNERS, '["abc"]');
  assert.ok(!("RWK_DOWNLOAD_OWNERS" in workerVars(base)));
});

test("download plugin: RWK_Download is included in RUNTIME_PLUGINS and registers under share group", () => {
  assert.ok(RUNTIME_PLUGINS.includes("RWK_Download"));
  const code = fs.readFileSync(path.join(import.meta.dirname, "..", "runtime", "RWK_Download.js"), "utf8");
  assert.ok(code.includes('group: "share"'));
  assert.ok(code.includes("/api/download"));
});

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function findSignature(bytes, sig) {
  outer: for (let i = 0; i <= bytes.length - sig.length; i++) {
    for (let j = 0; j < sig.length; j++) if (bytes[i + j] !== sig[j]) continue outer;
    return i;
  }
  return -1;
}
