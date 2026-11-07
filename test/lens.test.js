// MakerLens share links: the Worker's /_lens routes and the rwk lens command.

import assert from "node:assert/strict";
import { test } from "node:test";
import { createWorker } from "../worker/index.js";
import { LENS_MANIFEST, lensAllowed, lensKey, sha256Hex } from "../worker/lens.js";
import { lens, newToken, parseHours, probeLens, viewerLinks } from "../cli/commands/lens.js";
import { COMMANDS, parseCommandLine } from "../cli/lib/args.js";
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

test("rwk lens: arguments and links", () => {
  assert.ok(COMMANDS.some((cmd) => cmd.name === "lens"));
  const cli = parseCommandLine(["lens", "my-game", "--hours", "72", "--label", "alice"], { stdinIsTTY: true });
  assert.deepEqual([cli.spec.name, cli.target, cli.flags.hours, cli.flags.label], ["lens", "my-game", "72", "alice"]);
  assert.equal(parseCommandLine(["lens", "my-game", "--list"], { stdinIsTTY: true }).flags.list, true);
  assert.throws(() => parseCommandLine(["status", "my-game", "--hours", "2"], { stdinIsTTY: true }), (err) => err.exitCode === 64);
  assert.throws(() => parseCommandLine(["status", "my-game", "--list"], { stdinIsTTY: true }), (err) => err.exitCode === 64);

  assert.equal(parseHours(undefined), 24);
  assert.equal(parseHours("720"), 720);
  for (const bad of ["0", "721", "1.5", "abc"]) assert.throws(() => parseHours(bad), /--hours/);

  const { id, secret } = newToken();
  assert.match(id, /^[0-9a-f]{12}$/);
  assert.ok(secret.length >= 32);
  const links = viewerLinks("https://my-game.alice.workers.dev/some/path", `${id}.${secret}`);
  assert.equal(links.assets, `https://makerlens.kokoroou.workers.dev/assets/#game=https%3A%2F%2Fmy-game.alice.workers.dev&t=${id}.${secret}`);
  assert.ok(links.events.startsWith("https://makerlens.kokoroou.workers.dev/events/#game="));
  assert.ok(!links.assets.includes("?"), "nothing in the query: the token stays in the fragment");
});

test("probeLens tells what is wrong", async () => {
  const reply = (...statuses) => async () => new Response("", { status: statuses.shift() });
  assert.equal(await probeLens("https://g.workers.dev", "t", reply(200, 200)), "ok");
  assert.equal(await probeLens("https://g.workers.dev", "t", reply(200, 404)), "manifest");
  assert.equal(await probeLens("https://g.workers.dev", "t", reply(302)), "access");
  assert.equal(await probeLens("https://g.workers.dev", "t", reply(404)), "old");
  assert.match(await probeLens("https://g.workers.dev", "t", async () => Promise.reject(new Error("boom"))), /error: boom/);
});

function fakeDeps(over = {}) {
  const store = new Map();
  const calls = { bypass: 0 };
  return {
    store,
    calls,
    deps: {
      connect: async () => ({ account: { id: "acc", name: "A" } }),
      loadSettings: () => ({}),
      findSite: async () => ({ slug: "my-game", url: "https://my-game.a.workers.dev", title: "G", engine: "MZ", auth: { mode: "access" } }),
      apiToken: async () => "tok",
      saveLensToken: async (bucket, gameId, id, record) => store.set(lensKey(gameId, id), record),
      enableLensBypass: async () => void calls.bypass++,
      probeLens: async () => "ok",
      listObjects: async ({ prefix }) => [...store.keys()].filter((k) => k.startsWith(prefix)).map((key) => ({ key, size: 1 })),
      getObject: async ({ key }) => Buffer.from(JSON.stringify(store.get(key))),
      deleteObject: async ({ key }) => void store.delete(key),
      now: () => 1_700_000_000_000,
      ...over,
    },
  };
}

test("rwk lens: creates a link, lists it, revokes it", async () => {
  const { store, calls, deps } = fakeDeps();
  const made = await lens("my-game", { hours: "48", label: "alice" }, deps);
  assert.equal(calls.bypass, 1, "Access gets its bypass for /_lens");
  assert.equal(store.size, 1);
  const [key, record] = [...store][0];
  assert.match(key, /^rwk\/lens\/my-game\/[0-9a-f]{12}\.json$/);
  assert.equal(record.exp, 1_700_000_000 + 48 * 3600);
  assert.equal(record.label, "alice");
  const token = made.links.assets.split("&t=")[1];
  assert.equal(record.h, await sha256Hex(token.split(".")[1]), "only the hash of the secret is stored");
  assert.ok(!JSON.stringify(record).includes(token.split(".")[1]));

  const listed = await lens("my-game", { list: true }, deps);
  assert.deepEqual(listed.links.map((l) => [l.id, l.label, l.expired]), [[made.linkId, "alice", false]]);

  await assert.rejects(lens("my-game", { revoke: "ffffffffffff" }, deps), /No link ffffffffffff/);
  await assert.rejects(lens("my-game", { revoke: "nope" }, deps), /not a link id/);
  await lens("my-game", { revoke: made.linkId }, deps);
  assert.equal(store.size, 0);
});

test("rwk lens: a public game needs no bypass; an Access failure only warns", async () => {
  const open = fakeDeps({ findSite: async () => ({ slug: "g", url: "https://g.a.workers.dev", auth: { mode: "none" } }) });
  await lens("g", {}, open.deps);
  assert.equal(open.calls.bypass, 0);

  const { AccessApiError } = await import("../cli/lib/access-api.js");
  const denied = fakeDeps({ enableLensBypass: async () => Promise.reject(new AccessApiError("no permission", { denied: true })) });
  const made = await lens("my-game", {}, denied.deps);
  assert.ok(made.links.events, "the link is still made");
});

test("purge removes the link records too", () => {
  const keys = purgeObjects([{ key: "rwk/lens/my-game/aabbccddeeff.json", size: 1 }, { key: "rwk/lens/other/x.json", size: 1 }], "my-game").map((o) => o.key);
  assert.ok(keys.includes("rwk/lens/my-game/aabbccddeeff.json"));
  assert.ok(!keys.includes("rwk/lens/other/x.json"));
});
