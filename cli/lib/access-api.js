// Cloudflare Access for the site's workers.dev hostname, through the Zero
// Trust API instead of the dashboard: a self-hosted application on the
// hostname, with one reusable Allow policy listing the emails that may sign
// in. Everything needs an API token with the "Access" permissions
// (site/reference/commands.md); the browser login's scopes do not include
// them, so callers fall back to the dashboard steps when this throws.

import { log } from "./ui.js";

const BASE = "https://api.cloudflare.com/client/v4";
const NO_ZERO_TRUST = "Zero Trust is not set up in this account yet (it needs a team name and a payment method, once).";

export class AccessApiError extends Error {
  constructor(message, { status = 0, denied = false } = {}) {
    super(message);
    this.name = "AccessApiError";
    this.status = status;
    this.denied = denied;
  }
}

async function call(token, method, route, body) {
  const headers = { authorization: `Bearer ${token}` };
  if (body) headers["content-type"] = "application/json";
  let res;
  try {
    res = await fetch(`${BASE}${route}`, { method, headers, body: body && JSON.stringify(body) });
  } catch (err) {
    throw new AccessApiError(`Could not reach the Cloudflare API: ${err.message}`);
  }
  const json = await res.json().catch(() => ({}));
  if (res.ok && json.success !== false) return json.result;
  const reason = (json.errors || []).map((e) => `${e.message}${e.code ? ` [code: ${e.code}]` : ""}`).join("; ") || `HTTP ${res.status}`;
  throw new AccessApiError(`Cloudflare API ${method} ${route.split("?")[0]}: ${reason}`, {
    status: res.status,
    denied: res.status === 401 || res.status === 403,
  });
}

// The team's login domain, from the Zero Trust organization.
async function teamDomainOf(token, accountId) {
  let org;
  try {
    org = await call(token, "GET", `/accounts/${accountId}/access/organizations`);
  } catch (err) {
    if (err.status === 404) throw new AccessApiError(NO_ZERO_TRUST);
    throw err;
  }
  if (!org || !org.auth_domain) throw new AccessApiError(NO_ZERO_TRUST);
  return org.auth_domain.toLowerCase();
}

// The reusable Allow policy named after the site, with exactly these emails.
async function ensurePolicy(token, accountId, name, emails) {
  const body = { name, decision: "allow", include: emails.map((email) => ({ email: { email } })) };
  const policies = await call(token, "GET", `/accounts/${accountId}/access/policies?per_page=100`);
  const existing = (policies || []).find((p) => p.name === name);
  if (existing) {
    await call(token, "PUT", `/accounts/${accountId}/access/policies/${existing.id}`, body);
    return existing.id;
  }
  return (await call(token, "POST", `/accounts/${accountId}/access/policies`, body)).id;
}

// Protects the hostname of `url` and returns what the Worker verifies logins
// against. Run again, it reuses the application and brings its policy up to date.
// -> { teamDomain, aud, created }
export async function enableAccess({ token, accountId, slug, url, emails }) {
  const host = new URL(url).hostname;
  const teamDomain = await teamDomainOf(token, accountId);
  const policyId = await ensurePolicy(token, accountId, slug, emails);

  const apps = await call(token, "GET", `/accounts/${accountId}/access/apps?per_page=100`);
  const found = (apps || []).find((a) => a.domain === host && (!a.type || a.type === "self_hosted"));
  const body = {
    name: slug,
    domain: host,
    type: "self_hosted",
    session_duration: "720h",
    app_launcher_visible: false,
    policies: [{ id: policyId, precedence: 1 }],
  };
  if (found) {
    const app = await call(token, "PUT", `/accounts/${accountId}/access/apps/${found.id}`, body);
    return { teamDomain, aud: (app && app.aud) || found.aud, created: false };
  }
  const app = await call(token, "POST", `/accounts/${accountId}/access/apps`, body);
  if (!app || !app.aud) throw new AccessApiError("Cloudflare created the Access application but returned no AUD tag.");
  log.ok(`Access application created for ${host}`);
  return { teamDomain, aud: app.aud, created: true };
}
