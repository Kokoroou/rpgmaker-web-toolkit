import { test } from "node:test";
import assert from "node:assert/strict";
import { AccessApiError, enableAccess } from "../cli/lib/access-api.js";

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
