import assert from "node:assert/strict";
import crypto from "node:crypto";
import { test } from "node:test";
import { createWorker } from "../worker/index.js";
import { verifyAccessJwt } from "../worker/auth.js";
import { makeEnv } from "./helpers.js";

const BASE = "https://game.example.workers.dev";
const worker = createWorker({ overflow: ["img/parallaxes/大图.png_"] });
const call = (env, path, init) => worker.fetch(new Request(BASE + path, init), env);

test("locked mode blocks everything", async () => {
  const env = makeEnv({ RWK_LOCKED: "1" });
  const res = await call(env, "/index.html");
  assert.equal(res.status, 503);
  assert.equal(res.headers.get("x-rwk-locked"), "1");
  assert.equal(res.headers.get("x-robots-tag"), "noindex, nofollow");
  assert.equal((await call(env, "/api/saves")).status, 503);
});

test("API refuses when auth is not configured", async () => {
  const res = await call(makeEnv({ AUTH_MODE: undefined }), "/api/saves");
  assert.equal(res.status, 503);
});

test("save lifecycle with optimistic concurrency", async () => {
  const env = makeEnv();
  const blob = new Uint8Array([0x78, 0x01, 0xed, 0x5d, 0xff]);

  let res = await call(env, "/api/saves/file1", { method: "PUT", body: blob, headers: { "if-none-match": "*", "x-rwk-device": "pc" } });
  assert.equal(res.status, 200);
  const { etag } = await res.json();

  res = await call(env, "/api/saves/file1", { method: "PUT", body: blob, headers: { "if-none-match": "*" } });
  assert.equal(res.status, 412, "create-only must fail when the save exists");

  res = await call(env, "/api/saves/file1", { method: "PUT", body: blob, headers: { "if-match": "stale" } });
  assert.equal(res.status, 412, "stale etag must conflict");
  assert.equal((await res.json()).current.etag, etag);

  res = await call(env, "/api/saves/file1", { method: "PUT", body: blob, headers: { "if-match": `"${etag}"` } });
  assert.equal(res.status, 200);
  const etag2 = (await res.json()).etag;
  assert.notEqual(etag2, etag);

  res = await call(env, "/api/saves");
  const { items } = await res.json();
  assert.deepEqual(items.map((i) => [i.name, i.etag, i.deviceId]), [["file1", etag2, "unknown"]]);

  res = await call(env, "/api/saves/file1");
  assert.equal(res.headers.get("x-rwk-enc"), "latin1");
  assert.deepEqual(new Uint8Array(await res.arrayBuffer()), blob);

  res = await call(env, "/api/saves/file1", { method: "DELETE", headers: { "if-match": etag } });
  assert.equal(res.status, 412);
  res = await call(env, "/api/saves/file1", { method: "DELETE", headers: { "if-match": etag2 } });
  assert.equal(res.status, 204);
  assert.equal((await call(env, "/api/saves/file1")).status, 404);
});

test("saves are isolated per game and validated by name", async () => {
  const env = makeEnv();
  await call(env, "/api/saves/global", { method: "PUT", body: "x", headers: { "if-none-match": "*" } });
  const other = { ...env, GAME_ID: "other-game" };
  assert.deepEqual((await (await call(other, "/api/saves")).json()).items, []);
  assert.equal((await call(env, "/api/saves/..%2Fescape")).status, 400);
});

test("overflow files come from R2 with range support, others from assets", async () => {
  const env = makeEnv();
  await env.BUCKET.put("assets/test-game/img/parallaxes/大图.png_", new TextEncoder().encode("0123456789").buffer, {
    httpMetadata: { contentType: "application/octet-stream" },
  });

  let res = await call(env, "/img/parallaxes/%E5%A4%A7%E5%9B%BE.png_");
  assert.equal(res.status, 200);
  assert.equal(await res.text(), "0123456789");
  assert.equal(res.headers.get("x-robots-tag"), "noindex, nofollow");
  res = await call({ ...env, RWK_INDEXABLE: "1" }, "/img/parallaxes/%E5%A4%A7%E5%9B%BE.png_");
  assert.equal(res.headers.get("x-robots-tag"), null);

  res = await call(env, "/img/parallaxes/%E5%A4%A7%E5%9B%BE.png_", { headers: { range: "bytes=2-5" } });
  assert.equal(res.status, 206);
  assert.equal(res.headers.get("content-range"), "bytes 2-5/10");
  assert.equal(await res.text(), "2345");

  res = await call(env, "/img/other.png_");
  assert.equal(await res.text(), "static");
});

test("Access JWT verification checks signature, audience and expiry", async () => {
  const { publicKey, privateKey } = crypto.generateKeyPairSync("rsa", { modulusLength: 2048 });
  const jwk = { ...publicKey.export({ format: "jwk" }), kid: "k1", alg: "RS256" };
  const team = "team.cloudflareaccess.com";
  const realFetch = globalThis.fetch;
  globalThis.fetch = async (url) => {
    assert.equal(String(url), `https://${team}/cdn-cgi/access/certs`);
    return new Response(JSON.stringify({ keys: [jwk] }));
  };
  const sign = (payload) => {
    const enc = (o) => Buffer.from(JSON.stringify(o)).toString("base64url");
    const head = enc({ alg: "RS256", kid: "k1" });
    const body = enc(payload);
    const sig = crypto.sign("RSA-SHA256", Buffer.from(`${head}.${body}`), privateKey).toString("base64url");
    return `${head}.${body}.${sig}`;
  };
  const now = Math.floor(Date.now() / 1000);
  try {
    const ok = await verifyAccessJwt(sign({ aud: ["aud1"], email: "a@b.c", exp: now + 60, iss: `https://${team}` }), team, "aud1");
    assert.equal(ok.email, "a@b.c");
    await assert.rejects(verifyAccessJwt(sign({ aud: ["other"], exp: now + 60 }), team, "aud1"), /audience/);
    await assert.rejects(verifyAccessJwt(sign({ aud: ["aud1"], exp: now - 10 }), team, "aud1"), /expired/);
    const forged = sign({ aud: ["aud1"], exp: now + 60 }).replace(/\.[^.]+$/, ".AAAA");
    await assert.rejects(verifyAccessJwt(forged, team, "aud1"), /signature/);
  } finally {
    globalThis.fetch = realFetch;
  }
});

test("the Worker counts the emails that save, once each", async () => {
  const env = makeEnv({ GAME_ID: "count-game" });
  const players = async () => {
    const obj = await env.BUCKET.get("rwk/players/count-game.json");
    return obj ? JSON.parse(new TextDecoder().decode(await obj.arrayBuffer())) : {};
  };
  await call(env, "/api/saves/file1", { method: "PUT", body: "x", headers: { "if-none-match": "*" } });
  await call(env, "/api/saves/file2", { method: "PUT", body: "x", headers: { "if-none-match": "*" } });
  assert.equal(Object.keys(await players()).length, 1);
  // A rejected save does not count.
  await call({ ...env, GAME_ID: "other-count" }, "/api/saves/file1", { method: "PUT", body: "x", headers: { "if-match": "stale" } });
  assert.equal(await env.BUCKET.get("rwk/players/other-count.json"), null);
});

test("save history: copies before overwrites and deletes, restore, limits", async () => {
  const env = makeEnv({ RWK_SAVE_HISTORY: JSON.stringify({ keep: 3, days: 30 }) });
  const realNow = Date.now;
  let clock = Date.UTC(2026, 9, 1);
  Date.now = () => clock;
  const MIN = 60 * 1000;
  const put = (name, body, etag, device = "pc") =>
    call(env, "/api/saves/" + name, {
      method: "PUT",
      body,
      headers: { "x-rwk-device": device, ...(etag ? { "if-match": etag } : { "if-none-match": "*" }) },
    }).then((res) => res.json());
  const history = async () => (await (await call(env, "/api/history")).json()).items;
  try {
    let { etag } = await put("file1", "v1");
    assert.deepEqual(await history(), [], "a new save has no older copy");

    clock += MIN;
    ({ etag } = await put("file1", "v2", etag));
    let items = await history();
    assert.equal(items.length, 1, "the first overwrite keeps the original");
    assert.deepEqual([items[0].name, items[0].deviceId, items[0].size], ["file1", "pc", 2]);
    assert.match(items[0].id, /^\d{13}$/);

    clock += MIN;
    ({ etag } = await put("file1", "v3", etag));
    assert.equal((await history()).length, 1, "same device within 15 minutes: no new copy");

    clock += MIN;
    ({ etag } = await put("file1", "v4", etag, "phone"));
    assert.equal((await history()).length, 2, "another device replacing the save: a copy");

    clock += 16 * MIN;
    ({ etag } = await put("file1", "v5", etag, "phone"));
    items = await history();
    assert.equal(items.length, 3, "15 minutes later: a copy");
    assert.ok(items[0].updatedAt > items[1].updatedAt && items[1].updatedAt > items[2].updatedAt, "newest first");

    // config and global get no history.
    let g = await put("global", "g1");
    clock += 20 * MIN;
    g = await put("global", "g2", g.etag);
    assert.ok((await history()).every((i) => i.name === "file1"));
    assert.equal((await call(env, "/api/history/global/" + items[0].id, { method: "POST" })).status, 400);

    // Restore the oldest copy (v1): the save being replaced (v5) is kept, the oldest copy past `keep` goes.
    clock += MIN;
    const oldest = items[2];
    let res = await call(env, `/api/history/file1/${oldest.id}`, { method: "POST", headers: { "x-rwk-device": "tablet" } });
    assert.equal(res.status, 200);
    const restored = await res.json();
    res = await call(env, "/api/saves/file1");
    assert.equal(await res.text(), "v1");
    assert.equal(res.headers.get("etag"), restored.etag);
    assert.equal(res.headers.get("x-rwk-device"), "tablet");
    items = await history();
    assert.equal(items.length, 3, "keep: 3");
    assert.equal(items[0].deviceId, "phone", "the replaced save is the newest copy");
    assert.ok(!items.some((i) => i.id === oldest.id), "the oldest copy was pruned");

    // Deleting keeps a copy; the copy can bring the save back.
    clock += MIN;
    assert.equal((await call(env, "/api/saves/file1", { method: "DELETE" })).status, 204);
    items = await history();
    assert.equal(items[0].deviceId, "tablet");
    assert.equal((await call(env, `/api/history/file1/${items[0].id}`, { method: "POST" })).status, 200);
    assert.equal(await (await call(env, "/api/saves/file1")).text(), "v1");

    // Copies older than `days` expire.
    clock += 31 * 24 * 60 * MIN;
    assert.deepEqual(await history(), []);

    assert.equal((await call(env, "/api/history/file1/0000000000001", { method: "POST" })).status, 404);
    assert.equal((await call(env, "/api/history/file1/abc", { method: "POST" })).status, 400);
    assert.equal((await call(env, "/api/history/file1/0000000000001/x", { method: "POST" })).status, 400);
    assert.equal((await call(env, "/api/history/file1/0000000000001")).status, 405);
    assert.equal((await call(env, "/api/history", { method: "POST" })).status, 405);
  } finally {
    Date.now = realNow;
  }
});

test("save history can be turned off", async () => {
  const env = makeEnv({ RWK_SAVE_HISTORY: "off" });
  let res = await call(env, "/api/saves/file1", { method: "PUT", body: "a", headers: { "if-none-match": "*" } });
  const { etag } = await res.json();
  await call(env, "/api/saves/file1", { method: "PUT", body: "b", headers: { "if-match": etag } });
  await call(env, "/api/saves/file1", { method: "DELETE" });
  assert.equal([...env.BUCKET.objects.keys()].filter((k) => k.startsWith("history/")).length, 0);
  res = await call(env, "/api/history");
  assert.equal(res.status, 404);
  assert.equal((await call({ ...env, BUCKET: undefined }, "/api/history")).status, 501);
  // Without the setting (or with a broken one) the defaults apply.
  assert.equal((await call(makeEnv(), "/api/history")).status, 200);
  assert.equal((await call(makeEnv({ RWK_SAVE_HISTORY: "{" }), "/api/history")).status, 200);
});
