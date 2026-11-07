// MakerLens share links: the Worker's /_lens routes and the rwk lens command.

import assert from "node:assert/strict";
import { test } from "node:test";
import { createWorker } from "../worker/index.js";
import { LENS_MANIFEST, lensAllowed, lensKey, sha256Hex } from "../worker/lens.js";
import { lensOwnersOf, userHash, workerVars } from "../cli/lib/cloudflare.js";
import { userHash as workerUserHash } from "../worker/auth.js";
import { lensManifest } from "../cli/lib/stage.js";
import { overflowRoutes } from "../cli/lib/cloudflare.js";
import { purgeObjects } from "../cli/commands/site.js";
import { makeEnv } from "./helpers.js";

const BASE = "https://game.example.workers.dev";
const files = { "data/Map001.json": "{}", "img/pictures/a.png_": "PNG", "js/plugins.js": "plugins", "js/rpg_core.js": "core", [LENS_MANIFEST]: JSON.stringify({ files: { "data/Map001.json": 2 } }), "index.html": "<html>" };

function setup(overrides = {}) {
  const worker = createWorker({ overflow: ["img/big.png_"] });
  const env = makeEnv({
    AUTH_MODE: "access",
    ACCESS_TEAM_DOMAIN: "t.cloudflareaccess.com",
    ACCESS_AUD: "aud",
    ASSETS: {
      fetch: async (req) => {
        const rel = decodeURIComponent(new URL(req.url).pathname.slice(1));
        return rel in files ? new Response(files[rel], { headers: { "set-cookie": "x=1" } }) : new Response("nope", { status: 404 });
      },
    },
    ...overrides,
  });
  const call = (path, init) => worker.fetch(new Request(BASE + path, init), env);
  return { env, call };
}

async function issue(env, { exp = Math.floor(Date.now() / 1000) + 3600, id = "aabbccddeeff" } = {}) {
  const secret = "s".repeat(32);
  await env.BUCKET.put(lensKey(env.GAME_ID, id), JSON.stringify({ h: await sha256Hex(secret), exp }));
  return { authorization: `Bearer ${id}.${secret}` };
}

test("lens: only data, img, audio and js/plugins.js, with no way out of them", () => {
  for (const ok of ["data/Map001.json", "img/pictures/a.png_", "audio/bgm/x.ogg_", "js/plugins.js"]) assert.ok(lensAllowed(ok), ok);
  for (const bad of ["index.html", "js/rpg_core.js", "api/saves", "data/../index.html", "data//x", "img/..", "data\\x.json", "rwk-lens.json", "save/file1.rpgsave"]) assert.ok(!lensAllowed(bad), bad);
});

test("lens worker: no token, a wrong one, an expired one, a revoked one", async () => {
  const { env, call } = setup();
  assert.equal((await call("/_lens/ping")).status, 401);
  const good = await issue(env);
  assert.equal((await call("/_lens/ping", { headers: good })).status, 200);
  assert.equal((await call("/_lens/ping", { headers: { authorization: good.authorization.slice(0, -1) + "x" } })).status, 401);
  assert.equal((await call("/_lens/ping", { headers: { authorization: "Bearer aabbccddeeff" } })).status, 401);

  const expired = await issue(env, { exp: Math.floor(Date.now() / 1000) - 5, id: "112233445566" });
  assert.equal((await call("/_lens/ping", { headers: expired })).status, 401);

  const { env: env2, call: call2 } = setup();
  const headers = await issue(env2, { id: "99aa88bb77cc" });
  await env2.BUCKET.delete(lensKey(env2.GAME_ID, "99aa88bb77cc"));
  assert.equal((await call2("/_lens/ping", { headers })).status, 401, "a link that is not in R2 is not valid");
});

test("lens worker: needs the bucket, answers the CORS preflight without a token", async () => {
  const { call } = setup({ BUCKET: undefined });
  assert.equal((await call("/_lens/ping", { headers: { authorization: "Bearer aabbccddeeff." + "s".repeat(32) } })).status, 503);
  const pre = await call("/_lens/file/data/Map001.json", { method: "OPTIONS" });
  assert.equal(pre.status, 204);
  assert.equal(pre.headers.get("access-control-allow-origin"), "*");
  assert.match(pre.headers.get("access-control-allow-headers"), /authorization/);
  assert.ok(!pre.headers.has("access-control-allow-credentials"));
});

test("lens worker: serves allowed files and the manifest, nothing else", async () => {
  const { env, call } = setup();
  const headers = await issue(env);

  let res = await call("/_lens/file/data/Map001.json", { headers });
  assert.equal(res.status, 200);
  assert.equal(await res.text(), "{}");
  assert.equal(res.headers.get("access-control-allow-origin"), "*");
  assert.equal(res.headers.get("x-content-type-options"), "nosniff");
  assert.ok(!res.headers.has("set-cookie"));

  assert.equal(await (await call("/_lens/file/js/plugins.js", { headers })).text(), "plugins");
  for (const bad of ["/_lens/file/index.html", "/_lens/file/js/rpg_core.js", "/_lens/file/data/../index.html", "/_lens/file/data%2F..%2Findex.html", "/_lens/file/rwk-lens.json", "/_lens/file/img/missing.png", "/_lens/other"]) {
    assert.equal((await call(bad, { headers })).status, 404, bad);
  }
  assert.equal((await call("/_lens/file/data/Map001.json", { method: "POST", headers })).status, 405);

  res = await call("/_lens/manifest", { headers });
  assert.deepEqual((await res.json()).files, { "data/Map001.json": 2 });
});

test("lens worker: a token never opens the save API or the game itself", async () => {
  const { env, call } = setup();
  const headers = await issue(env);
  assert.equal((await call("/api/saves", { headers })).status, 401, "the save API still wants the Access login");
  assert.equal((await call("/api/me", { headers })).status, 401);
  assert.equal((await call("/api/lens", { headers })).status, 401, "nor the owner's API");
  assert.equal((await call("/api/lens", { method: "POST", headers: { ...headers, "content-type": "application/json" }, body: "{}" })).status, 401);
});

test("lens worker: large files come from R2 with Range", async () => {
  const { env, call } = setup();
  const headers = await issue(env);
  await env.BUCKET.put(`assets/${env.GAME_ID}/img/big.png_`, "0123456789");
  const res = await call("/_lens/file/img/big.png_", { headers: { ...headers, range: "bytes=2-4" } });
  assert.equal(res.status, 206);
  assert.equal(await res.text(), "234");
  assert.equal(res.headers.get("access-control-allow-origin"), "*");
});

test("lens manifest: names and sizes of the readable files only", () => {
  const out = JSON.parse(
    lensManifest({ title: "G", engine: "MZ" }, [
      { rel: "index.html", size: 1 },
      { rel: "img/pictures/b.png_", size: 5 },
      { rel: "data/System.json", size: 3 },
      { rel: "js/rpg_core.js", size: 9 },
      { rel: "js/plugins.js", size: 2 },
    ])
  );
  assert.deepEqual(Object.keys(out.files), ["data/System.json", "img/pictures/b.png_", "js/plugins.js"]);
  assert.equal(out.title, "G");
});

test("lens routes always go through the Worker", () => {
  assert.ok(overflowRoutes([]).includes("/_lens/*"));
  assert.ok(overflowRoutes(["a/b.bin"]).includes("/_lens/*"));
});


// ---- the owner's side: /api/lens

async function ownerEnv() {
  const owners = JSON.stringify([userHash("me@example.com")]);
  const { env, call } = setup({ RWK_LENS_OWNERS: owners });
  return { env, call };
}

// These call the handler with a user object: the Access JWT check itself is in worker.test.js.
import { handleLensApi, isLensOwner } from "../worker/lens.js";

const as = (email) => ({ email });
const post = (body, type = "application/json") => new Request(BASE + "/api/lens", { method: "POST", headers: { "content-type": type }, body: JSON.stringify(body) });

test("lens api: only the owner's email may use it, and a public game has no owner", async () => {
  const { env } = await ownerEnv();
  assert.equal(await isLensOwner(env, as("me@example.com")), true);
  assert.equal(await isLensOwner(env, as("ME@Example.com ")), true, "case and spaces do not matter");
  assert.equal(await isLensOwner(env, as("friend@example.com")), false);
  const none = makeEnv({ AUTH_MODE: "none", RWK_LENS_OWNERS: JSON.stringify([userHash("me@example.com")]) });
  assert.equal(await isLensOwner(none, as("me@example.com")), false);
  assert.equal(await isLensOwner(makeEnv({ AUTH_MODE: "access" }), as("me@example.com")), false, "no owners set: off");
  assert.equal(userHash("me@example.com"), await workerUserHash("me@example.com"), "the CLI and the Worker hash alike");

  const denied = await handleLensApi(new Request(BASE + "/api/lens"), env, as("friend@example.com"), "");
  assert.equal(denied.status, 403);
  assert.equal((await denied.json()).owner, false);
});

test("lens api: make a link, use it, list it, stop it", async () => {
  const { env, call } = await ownerEnv();
  const owner = as("me@example.com");

  const made = await handleLensApi(post({ hours: 48, label: "  alice  " }), env, owner, "");
  assert.equal(made.status, 200);
  const { id, token, exp, label } = await made.json();
  assert.match(id, /^[0-9a-f]{12}$/);
  assert.match(token, /^[0-9a-f]{12}\.[A-Za-z0-9_-]{32}$/);
  assert.equal(label, "alice");
  assert.ok(Math.abs(exp - (Date.now() / 1000 + 48 * 3600)) < 5);

  const stored = JSON.parse(new TextDecoder().decode(await (await env.BUCKET.get(lensKey(env.GAME_ID, id))).arrayBuffer()));
  assert.equal(stored.h, await sha256Hex(token.split(".")[1]), "only the hash of the secret is kept");
  assert.ok(!JSON.stringify(stored).includes(token.split(".")[1]));

  // The new token opens the game's files through /_lens.
  const ping = await call("/_lens/ping", { headers: { authorization: `Bearer ${token}` } });
  assert.equal(ping.status, 200);

  const listed = await (await handleLensApi(new Request(BASE + "/api/lens"), env, owner, "")).json();
  assert.deepEqual(listed.links.map((l) => [l.id, l.label]), [[id, "alice"]]);
  assert.ok(!JSON.stringify(listed).includes(token), "the list never carries a key");

  const stopped = await handleLensApi(new Request(BASE + `/api/lens/${id}`, { method: "DELETE" }), env, owner, id);
  assert.equal(stopped.status, 204);
  assert.equal((await (await handleLensApi(new Request(BASE + "/api/lens"), env, owner, "")).json()).links.length, 0);
  assert.equal((await call("/_lens/ping", { headers: { authorization: `Bearer ${token}` } })).status, 401, "stopped at once, not after a minute");
});

test("lens api: a player cannot make, list or stop links; bad input is refused", async () => {
  const { env } = await ownerEnv();
  const friend = as("friend@example.com");
  assert.equal((await handleLensApi(post({ hours: 1 }), env, friend, "")).status, 403);
  assert.equal((await handleLensApi(new Request(BASE + "/api/lens/aabbccddeeff", { method: "DELETE" }), env, friend, "aabbccddeeff")).status, 403);

  const owner = as("me@example.com");
  for (const hours of [0, 721, 1.5, "x"]) assert.equal((await handleLensApi(post({ hours }), env, owner, "")).status, 400, String(hours));
  assert.equal((await handleLensApi(post({ hours: 1 }, "text/plain"), env, owner, "")).status, 415, "a form from another site cannot send this");
  assert.equal((await handleLensApi(new Request(BASE + "/api/lens/not-an-id", { method: "DELETE" }), env, owner, "not-an-id")).status, 404);
});

test("lens api: at most 20 links at a time", async () => {
  const { env } = await ownerEnv();
  const owner = as("me@example.com");
  for (let i = 0; i < 20; i++) assert.equal((await handleLensApi(post({ hours: 1 }), env, owner, "")).status, 200);
  assert.equal((await handleLensApi(post({ hours: 1 }), env, owner, "")).status, 409);
});

test("lens owners: the Cloudflare email and lens.owners, off with lens: false", () => {
  assert.deepEqual(lensOwnersOf({}, "Me@Example.com"), [userHash("me@example.com")]);
  assert.equal(lensOwnersOf({ lens: { owners: ["me@example.com", "co@example.com", "nonsense"] } }, "me@example.com").length, 2);
  assert.deepEqual(lensOwnersOf({ lens: false }, "me@example.com"), []);
  assert.deepEqual(lensOwnersOf({}, undefined), []);
  const vars = workerVars({ gameId: "g", auth: { mode: "access" }, locked: false, indexable: false, saveHistory: false, lensOwners: ["abc"] });
  assert.equal(vars.RWK_LENS_OWNERS, '["abc"]');
  assert.ok(!("RWK_LENS_OWNERS" in workerVars({ gameId: "g", auth: {}, locked: false, indexable: false, saveHistory: false })));
});

test("purge removes the link records too", () => {
  const keys = purgeObjects([{ key: "rwk/lens/my-game/aabbccddeeff.json", size: 1 }, { key: "rwk/lens/other/x.json", size: 1 }], "my-game").map((o) => o.key);
  assert.ok(keys.includes("rwk/lens/my-game/aabbccddeeff.json"));
  assert.ok(!keys.includes("rwk/lens/other/x.json"));
});
