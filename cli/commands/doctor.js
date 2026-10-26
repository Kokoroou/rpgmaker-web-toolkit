// doctor: is this PC ready to publish? Node.js, wrangler, the Cloudflare login and what the token may do.
// Reads only: nothing is created or changed in the Cloudflare account.

import fs from "node:fs";
import path from "node:path";
import { TOOLKIT_ROOT, loadSettings } from "../lib/config.js";
import { apiToken } from "../lib/cloudflare.js";
import { CliError, log } from "../lib/ui.js";
import { envApiToken } from "../lib/wrangler.js";

const BASE = "https://api.cloudflare.com/client/v4";

// What deploy asks of the token, and what its absence costs.
// access: true for the permissions only a token (CI) needs; the browser login sets Access up in the dashboard.
export const PROBES = [
  { id: "user", label: "User details", route: () => "/user", level: "warn", why: "Without it the email is not suggested for saves import", permission: "User → User Details → Read" },
  { id: "workers", label: "Workers scripts", route: (a) => `/accounts/${a}/workers/scripts`, level: "fail", why: "deploy cannot publish the Worker", permission: "Account → Workers Scripts → Edit" },
  { id: "r2", label: "R2 storage", route: (a) => `/accounts/${a}/r2/buckets`, level: "fail", why: "the game's settings, saves and large files live in R2", permission: "Account → Workers R2 Storage → Edit" },
  { id: "access-apps", label: "Access applications", route: (a) => `/accounts/${a}/access/apps?per_page=1`, level: "warn", access: true, why: "the first deploy cannot protect the site with Access on its own", permission: "Account → Access: Apps and Policies → Edit" },
  { id: "access-org", label: "Access organization", route: (a) => `/accounts/${a}/access/organizations`, level: "warn", access: true, why: "the Zero Trust team's login domain cannot be found", permission: "Account → Access: Organizations, Identity Providers, and Groups → Read" },
];

const check = (status, label, detail, hint) => ({ status, label, detail, hint: hint || null });

// -> [{ status: "ok" | "warn" | "fail", label, detail, hint }]. Everything the checks read comes in as arguments.
export async function runChecks({
  nodeVersion = process.versions.node,
  wranglerVersion = readWranglerVersion(),
  getToken = apiToken,
  usingEnvToken = !!envApiToken(),
  envTokenIgnored = false,
  accountId = process.env.CLOUDFLARE_ACCOUNT_ID || loadSettings().accountId,
  fetchImpl = globalThis.fetch,
} = {}) {
  const checks = [];
  const major = Number(nodeVersion.split(".")[0]);
  checks.push(major >= 22 ? check("ok", "Node.js", nodeVersion) : check("fail", "Node.js", `${nodeVersion}, 22 or newer is required`, "Install the LTS release from https://nodejs.org"));

  if (!wranglerVersion) {
    checks.push(check("fail", "wrangler", "not installed", "Run `npm ci` in the toolkit folder (the one-liner does it for you)"));
    return checks;
  }
  checks.push(check("ok", "wrangler", wranglerVersion));

  if (envTokenIgnored) {
    checks.push(check("warn", "CLOUDFLARE_API_TOKEN", "is set but only read by a run with --yes (or --json, or without a terminal)", "Run `rwk doctor --yes` to check the token instead of the browser login"));
  }
  let token;
  try {
    token = await getToken();
  } catch (err) {
    checks.push(check("fail", "Cloudflare login", `could not read it (${err.message})`));
    return checks;
  }
  if (!token) {
    checks.push(check("warn", "Cloudflare login", "not logged in", "The first deploy opens the browser to log in; in CI set CLOUDFLARE_API_TOKEN"));
    return checks;
  }
  checks.push(check("ok", "Cloudflare login", usingEnvToken ? "API token from CLOUDFLARE_API_TOKEN" : "the toolkit's own login"));

  const call = async (route) => {
    try {
      const res = await fetchImpl(BASE + route, { headers: { authorization: `Bearer ${token}` } });
      const body = await res.json().catch(() => ({}));
      return { status: res.status, ok: res.ok && body.success !== false, body };
    } catch (err) {
      return { status: 0, ok: false, error: err.message };
    }
  };

  const accounts = await call("/accounts?per_page=50");
  if (accounts.status === 0) {
    checks.push(check("fail", "Cloudflare API", `cannot be reached (${accounts.error})`, "Check the network or proxy"));
    return checks;
  }
  if (!accounts.ok) {
    checks.push(check("fail", "Account", `the login cannot list accounts (HTTP ${accounts.status})`, usingEnvToken ? "The token needs Account → Account Settings → Read, and must not be expired" : "Run a deploy in a terminal to log in again"));
    return checks;
  }
  const list = accounts.body.result || [];
  const account = list.find((a) => a.id === accountId) || (list.length === 1 ? list[0] : null);
  if (!list.length) {
    checks.push(check("fail", "Account", "this login reaches no Cloudflare account"));
    return checks;
  }
  if (!account) {
    checks.push(check("warn", "Account", `${list.length} accounts and none chosen: ${list.map((a) => a.name).join(", ")}`, "Set CLOUDFLARE_ACCOUNT_ID to the one to use"));
  }
  const used = account || list[0];
  checks.push(check("ok", "Account", `${used.name} (${used.id})`));

  for (const probe of PROBES) {
    // The browser login cannot reach Access (the dashboard does that step): not a gap to report.
    if (probe.access && !usingEnvToken) continue;
    const res = await call(probe.route(used.id));
    if (res.ok) {
      checks.push(check("ok", probe.label, "allowed"));
    } else if (res.status === 401 || res.status === 403) {
      checks.push(check(probe.level, probe.label, `denied: ${probe.why}`, usingEnvToken ? `Add the token permission ${probe.permission}` : "Log in again to renew the toolkit's permissions"));
    } else if (probe.access && res.status === 400) {
      // Zero Trust not enabled yet: Cloudflare answers the Access routes with an error body.
      checks.push(check("warn", probe.label, "no Zero Trust team yet", "Create one in the dashboard (Zero Trust) before the first Access protection"));
    } else {
      checks.push(check("warn", probe.label, `could not tell (${res.error || `HTTP ${res.status}`})`));
    }
  }
  return checks;
}

function readWranglerVersion() {
  try {
    return JSON.parse(fs.readFileSync(path.join(TOOLKIT_ROOT, "node_modules", "wrangler", "package.json"), "utf8")).version;
  } catch {
    return null;
  }
}

export async function doctor({ envTokenIgnored = false } = {}) {
  log.step("Checking this PC");
  const checks = await runChecks({ envTokenIgnored });
  for (const { status, label, detail, hint } of checks) {
    const line = `${label}: ${detail}`;
    if (status === "ok") log.ok(line);
    else if (status === "warn") log.warn(hint ? `${line}. ${hint}` : line);
    else log.error(line, hint);
  }
  const failed = checks.filter((x) => x.status === "fail");
  if (failed.length) throw new CliError(`${failed.length} check(s) failed: ${failed.map((x) => x.label).join(", ")}.`, { hint: failed[0].hint || undefined });
  return { checks, facts: [["Checks", `${checks.filter((x) => x.status === "ok").length} of ${checks.length} passed`]] };
}
