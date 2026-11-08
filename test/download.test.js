// Tests for the host-download-zip feature: GET /api/download
//
// The ZIP is made at deploy (cli/lib/zip.js) and kept in R2; the Worker only
// serves that one object, with Range, because a game has far more files than
// the free plan allows subrequests.

import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { test } from "node:test";
import { createWorker } from "../worker/index.js";
import { handleDownload, isDownloadOwner } from "../worker/download.js";
import { userHash as workerUserHash } from "../worker/auth.js";
import { userHash, downloadOwnersOf, downloadOwnersForUpgrade, uploadBuildZip, zipEntries, workerVars } from "../cli/lib/cloudflare.js";
import { writeZip } from "../cli/lib/zip.js";
import { RUNTIME_PLUGINS } from "../cli/lib/stage.js";
import { makeEnv } from "./helpers.js";

const BASE = "https://game.example.workers.dev";
const ZIP_KEY = "assets/test-game/rwk.zip";

function ownerEnv(overrides = {}) {
  const hash = userHash("host@example.com");
  return makeEnv({
    AUTH_MODE: "access",
    RWK_DOWNLOAD_OWNERS: JSON.stringify([hash]),
    ...overrides,
  });
}

const as = (email) => ({ email });

// A real, small archive in the env's bucket.
async function putZip(env, files = { "data/Map001.json": "{}", "index.html": "<html>" }) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "rwk-dl-"));
  try {
    const entries = Object.entries(files).map(([rel, text]) => {
      const abs = path.join(dir, rel.replace(/\//g, "_"));
      fs.writeFileSync(abs, text);
      return { rel, abs };
    });
    const out = path.join(dir, "build.zip");
    await writeZip(out, entries);
    const bytes = fs.readFileSync(out);
    // The in-memory bucket keeps an ArrayBuffer as it is (a Buffer would be
    // turned into its text).
    await env.BUCKET.put(ZIP_KEY, bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength));
    return bytes;
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
}

// The names in a ZIP's local file headers.
function namesOf(bytes) {
  const text = new TextDecoder("latin1").decode(bytes);
  return [...text.matchAll(/PK\x03\x04/g)].length;
}

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
  const env = makeEnv({ AUTH_MODE: "access", RWK_DOWNLOAD_OWNERS: JSON.stringify([hash]), BUCKET: undefined });
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

test("download: ?check=1 says whether the archive is there, without sending it", async () => {
  const env = ownerEnv();
  const before = await handleDownload(new Request(BASE + "/api/download?check=1"), env, as("host@example.com"));
  assert.equal(before.status, 200);
  assert.deepEqual(await before.json(), { owner: true, gameId: "test-game", ready: false }, "a game deployed before the archive existed");

  await putZip(env);
  const after = await handleDownload(new Request(BASE + "/api/download?check=1"), env, as("host@example.com"));
  assert.equal((await after.json()).ready, true);
});

// ---------------------------------------------------------------------------
// handleDownload – the archive
// ---------------------------------------------------------------------------

test("download: serves the deploy's ZIP as one file", async () => {
  const env = ownerEnv();
  const zip = await putZip(env);
  const res = await handleDownload(new Request(BASE + "/api/download"), env, as("host@example.com"));
  assert.equal(res.status, 200);
  assert.equal(res.headers.get("content-type"), "application/zip");
  assert.match(res.headers.get("content-disposition"), /attachment; filename="game-test-game\.zip"/);
  assert.equal(res.headers.get("cache-control"), "no-store");
  assert.equal(res.headers.get("accept-ranges"), "bytes");
  assert.equal(Number(res.headers.get("content-length")), zip.length);

  const bytes = new Uint8Array(await res.arrayBuffer());
  assert.deepEqual([...bytes], [...zip], "the archive is sent byte for byte");
  assert.equal(namesOf(bytes), 2, "both entries");
});

test("download: a Range request resumes instead of starting over", async () => {
  const env = ownerEnv();
  const zip = await putZip(env);
  const res = await handleDownload(new Request(BASE + "/api/download", { headers: { range: "bytes=10-19" } }), env, as("host@example.com"));
  assert.equal(res.status, 206);
  assert.equal(res.headers.get("content-range"), `bytes 10-19/${zip.length}`);
  const part = new Uint8Array(await res.arrayBuffer());
  assert.deepEqual([...part], [...zip.subarray(10, 20)]);
});

test("download: an unchanged copy answers 304", async () => {
  const env = ownerEnv();
  await putZip(env);
  const first = await handleDownload(new Request(BASE + "/api/download"), env, as("host@example.com"));
  const etag = first.headers.get("etag");
  assert.ok(etag);
  const second = await handleDownload(new Request(BASE + "/api/download", { headers: { "if-none-match": etag } }), env, as("host@example.com"));
  assert.equal(second.status, 304);
});

test("download: a build without an archive says how to make one", async () => {
  const env = ownerEnv();
  const res = await handleDownload(new Request(BASE + "/api/download"), env, as("host@example.com"));
  assert.equal(res.status, 404);
  assert.match((await res.json()).error, /rwk deploy/);
});

// ---------------------------------------------------------------------------
// Through the full Worker
// ---------------------------------------------------------------------------

test("download: worker routes /api/download to the handler", async () => {
  const hash = userHash("host@example.com");
  const env = makeEnv({ AUTH_MODE: "none", RWK_DOWNLOAD_OWNERS: JSON.stringify([hash]) });
  const res = await createWorker().fetch(new Request(BASE + "/api/download"), env);
  assert.equal(res.status, 403, "\"public\" is not in download owners");
});

// ---------------------------------------------------------------------------
// What the archive holds
// ---------------------------------------------------------------------------

test("zipEntries: the build's files, the toolkit's generated ones, and the R2 overflow", () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "rwk-entries-"));
  try {
    for (const rel of ["index.html", "js/plugins.js", "js/plugins/RWK_Core.js", "img/a.png"]) {
      fs.mkdirSync(path.dirname(path.join(dir, rel)), { recursive: true });
      fs.writeFileSync(path.join(dir, rel), "x");
    }
    const overflow = [{ rel: "movies/all.webm", abs: "C:/game/www/movies/all.webm" }];
    // `assets` is the list handed to the assets binding: the game's files and the
    // generated ones (stage.js), which are already in the build folder.
    const assets = [{ rel: "index.html" }, { rel: "img/a.png" }, { rel: "js/plugins.js" }, { rel: "js/plugins/RWK_Core.js" }];
    const entries = zipEntries(dir, assets, overflow);
    assert.deepEqual(entries.map((e) => e.rel), ["img/a.png", "index.html", "js/plugins.js", "js/plugins/RWK_Core.js", "movies/all.webm"]);
    assert.equal(entries[0].abs, path.join(dir, "img", "a.png"), "POSIX paths become the local ones");
    assert.equal(entries[4].abs, overflow[0].abs, "the R2 file keeps its own path");
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test("zipEntries: a file the staging left out is not invented", () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "rwk-entries-"));
  try {
    fs.writeFileSync(path.join(dir, "index.html"), "x");
    const entries = zipEntries(dir, [{ rel: "index.html" }], []);
    assert.deepEqual(entries.map((e) => e.rel), ["index.html"]);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test("build zip: made and uploaded once, then kept while the build is the same", async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "rwk-upload-"));
  try {
    fs.writeFileSync(path.join(dir, "index.html"), "one");
    const entries = zipEntries(dir, [{ rel: "index.html" }]);
    const r2 = new Map();
    let made = 0;
    const io = {
      make: async (out, list) => {
        made++;
        await writeZip(out, list);
        return { entries: list.length, bytes: 123 };
      },
      put: async (bucket, key, file) => r2.set(key, fs.readFileSync(file)),
      putJson: async (bucket, key, data) => r2.set(key, JSON.stringify(data)),
      get: async (bucket, key) => (r2.has(key) ? Buffer.from(r2.get(key)) : null),
      bar: { update() {}, end() {} },
    };
    const zipPath = path.join(dir, "build.zip");

    const first = await uploadBuildZip({ bucket: "b", slug: "g", entries, zipPath, io });
    assert.equal(first.uploaded, true);
    assert.ok(r2.has("assets/g/rwk.zip"), "the archive is in R2");
    assert.ok(r2.has("assets/g/rwk.zip.json"), "and a record of what it holds");

    const second = await uploadBuildZip({ bucket: "b", slug: "g", entries, zipPath, io });
    assert.equal(second.uploaded, false, "the same build is not uploaded again");
    assert.equal(second.entries, 1);
    assert.equal(made, 1, "the archive was made once");

    fs.writeFileSync(path.join(dir, "index.html"), "two");
    const third = await uploadBuildZip({ bucket: "b", slug: "g", entries: zipEntries(dir, [{ rel: "index.html" }]), zipPath, io });
    assert.equal(third.uploaded, true, "a changed file makes a new archive");
    assert.equal(made, 2);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

// ---------------------------------------------------------------------------
// CLI helpers: owners, worker vars, plugin
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
