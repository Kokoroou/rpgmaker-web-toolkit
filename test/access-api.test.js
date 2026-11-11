import { test } from "node:test";
import assert from "node:assert/strict";
import { AccessApiError, enableAccess, enableLensBypass } from "../cli/lib/access-api.js";

// A fake Cloudflare API: routes "METHOD /path" to a result (or { fail: [status, errors] }).
function fakeApi(routes) {
  const calls = [];
  const original = globalThis.fetch;
  globalThis.fetch = async (url, init = {}) => {
    const route = `${init.method || "GET"} ${new URL(url).pathname}`;
    const body = init.body ? JSON.parse(init.body) : undefined;
    calls.push({ route, body, auth: init.headers.authorization });
    const hit = routes[route];
    if (hit === undefined) return Response.json({ success: false, errors: [{ message: "no route" }] }, { status: 404 });
    if (hit.fail) return Response.json({ success: false, errors: hit.fail[1] }, { status: hit.fail[0] });
    return Response.json({ success: true, result: typeof hit === "function" ? hit(body) : hit });
  };
  return { calls, restore: () => (globalThis.fetch = original) };
}

const args = { token: "tok", accountId: "acc", slug: "my-game", url: "https://my-game.alice.workers.dev", emails: ["a@x.com", "b@x.com"] };

test("enableAccess creates the policy and the application", async () => {
  const api = fakeApi({
    "GET /client/v4/accounts/acc/access/organizations": { auth_domain: "Team.cloudflareaccess.com" },
    "GET /client/v4/accounts/acc/access/policies": [],
    "POST /client/v4/accounts/acc/access/policies": { id: "pol1" },
    "GET /client/v4/accounts/acc/access/apps": [],
    "POST /client/v4/accounts/acc/access/apps": { aud: "a".repeat(64) },
  });
  try {
    const result = await enableAccess(args);
    assert.deepEqual(result, { teamDomain: "team.cloudflareaccess.com", aud: "a".repeat(64), created: true });
    const policy = api.calls.find((c) => c.route.startsWith("POST") && c.route.endsWith("/policies")).body;
    assert.equal(policy.decision, "allow");
    assert.deepEqual(policy.include, [{ email: { email: "a@x.com" } }, { email: { email: "b@x.com" } }]);
    const app = api.calls.find((c) => c.route.startsWith("POST") && c.route.endsWith("/apps")).body;
    assert.equal(app.domain, "my-game.alice.workers.dev");
    assert.equal(app.type, "self_hosted");
    assert.deepEqual(app.policies, [{ id: "pol1", precedence: 1 }]);
    assert.ok(api.calls.every((c) => c.auth === "Bearer tok"));
  } finally {
    api.restore();
  }
});

test("enableAccess reuses the policy and the application on a second run", async () => {
  const api = fakeApi({
    "GET /client/v4/accounts/acc/access/organizations": { auth_domain: "team.cloudflareaccess.com" },
    "GET /client/v4/accounts/acc/access/policies": [{ id: "pol1", name: "my-game" }, { id: "pol2", name: "other" }],
    "PUT /client/v4/accounts/acc/access/policies/pol1": { id: "pol1" },
    "GET /client/v4/accounts/acc/access/apps": [{ id: "app1", domain: "my-game.alice.workers.dev", type: "self_hosted", aud: "b".repeat(64) }],
    "PUT /client/v4/accounts/acc/access/apps/app1": { aud: "b".repeat(64) },
  });
  try {
    const result = await enableAccess(args);
    assert.equal(result.created, false);
    assert.equal(result.aud, "b".repeat(64));
    assert.ok(!api.calls.some((c) => c.route.startsWith("POST")), "nothing is created twice");
  } finally {
    api.restore();
  }
});

test("enableAccess says when Zero Trust is not set up", async () => {
  const api = fakeApi({ "GET /client/v4/accounts/acc/access/organizations": { fail: [404, [{ message: "access.api.error.not_enabled", code: 9999 }]] } });
  try {
    await assert.rejects(enableAccess(args), (err) => err instanceof AccessApiError && /Zero Trust is not set up/.test(err.message));
  } finally {
    api.restore();
  }
});

test("enableAccess flags a token without the Access permissions", async () => {
  const api = fakeApi({ "GET /client/v4/accounts/acc/access/organizations": { fail: [403, [{ message: "Authentication error", code: 10000 }]] } });
  try {
    await assert.rejects(enableAccess(args), (err) => err instanceof AccessApiError && err.denied && /10000/.test(err.message));
  } finally {
    api.restore();
  }
});

test("enableLensBypass makes a Bypass policy and an application on <host>/_lens, and reuses them", async () => {
  const lens = { token: "tok", accountId: "acc", slug: "my-game", url: "https://my-game.alice.workers.dev/some/path" };
  const first = fakeApi({
    "GET /client/v4/accounts/acc/access/policies": [{ id: "pol1", name: "my-game" }],
    "POST /client/v4/accounts/acc/access/policies": { id: "polL" },
    "GET /client/v4/accounts/acc/access/apps": [{ id: "app1", domain: "my-game.alice.workers.dev", type: "self_hosted" }],
    "POST /client/v4/accounts/acc/access/apps": { id: "appL" },
  });
  try {
    assert.deepEqual(await enableLensBypass(lens), { created: true });
    const policy = first.calls.find((c) => c.route.startsWith("POST") && c.route.endsWith("/policies")).body;
    assert.deepEqual([policy.name, policy.decision, policy.include], ["my-game-lens", "bypass", [{ everyone: {} }]]);
    const app = first.calls.find((c) => c.route.startsWith("POST") && c.route.endsWith("/apps")).body;
    assert.deepEqual([app.domain, app.type, app.policies], ["my-game.alice.workers.dev/_lens", "self_hosted", [{ id: "polL", precedence: 1 }]]);
    assert.ok(!first.calls.some((c) => c.route.startsWith("PUT")), "the game's own application is left alone");
  } finally {
    first.restore();
  }

  const again = fakeApi({
    "GET /client/v4/accounts/acc/access/policies": [{ id: "polL", name: "my-game-lens" }],
    "PUT /client/v4/accounts/acc/access/policies/polL": { id: "polL" },
    "GET /client/v4/accounts/acc/access/apps": [{ id: "appL", domain: "my-game.alice.workers.dev/_lens" }],
    "PUT /client/v4/accounts/acc/access/apps/appL": { id: "appL" },
  });
  try {
    assert.deepEqual(await enableLensBypass(lens), { created: false });
    assert.ok(!again.calls.some((c) => c.route.startsWith("POST")), "nothing is created twice");
  } finally {
    again.restore();
  }

  const denied = fakeApi({ "GET /client/v4/accounts/acc/access/policies": { fail: [403, [{ message: "no" }]] } });
  try {
    await assert.rejects(enableLensBypass(lens), (err) => err instanceof AccessApiError && err.denied);
  } finally {
    denied.restore();
  }
});

test("probeLensBypass tells the Worker's answer from Access's login redirect", async () => {
  const { probeLensBypass, lensBypassSteps } = await import("../cli/lib/cloudflare.js");
  const original = globalThis.fetch;
  try {
    globalThis.fetch = async () => new Response('{"error":"Invalid or expired link"}', { status: 401, headers: { "content-type": "application/json" } });
    assert.equal((await probeLensBypass("https://g.a.workers.dev")).open, true);
    globalThis.fetch = async () => new Response(null, { status: 302, headers: { location: "https://t.cloudflareaccess.com/cdn-cgi/access/login/g" } });
    assert.equal((await probeLensBypass("https://g.a.workers.dev")).open, false);
    globalThis.fetch = async () => {
      throw new Error("offline");
    };
    assert.deepEqual(await probeLensBypass("https://g.a.workers.dev"), { open: false, error: "offline" });
  } finally {
    globalThis.fetch = original;
  }
  const steps = lensBypassSteps({ host: "g.a.workers.dev", slug: "g" });
  assert.equal(steps.page("acc"), "https://dash.cloudflare.com/acc/one/access-controls/apps/self-hosted/add");
  assert.ok(steps.lines.some(([what, value]) => what === "Details → Name" && value === "g-lens"));
  assert.ok(steps.lines.some(([, value]) => value.includes("g.a.workers.dev")));
});
