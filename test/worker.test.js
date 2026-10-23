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
