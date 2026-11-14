// doctor: is this PC ready to publish? Node.js, wrangler, the Cloudflare login, what the token may do,
// and what the account needs before a first deploy (R2 switched on, a workers.dev subdomain).
// With a game (its link or site name), also that game: it is in the account, its Worker exists,
// the site answers, Access protects it when it should, and the toolkit it runs.
// Reads only: nothing is created or changed in the Cloudflare account.

import fs from "node:fs";
import path from "node:path";
import { DEFAULT_BUCKET, DEFAULT_PROFILE, TOOLKIT_ROOT, activeProfile, loadSettings } from "../lib/config.js";
import { CONFIGS_KEY, apiToken, askedAccount, matchAccount, probeAccess } from "../lib/cloudflare.js";
import { findGameBySite } from "../lib/game.js";
import { getObject } from "../lib/r2-api.js";
import { TOOLKIT_VERSION } from "../lib/stage.js";
import { classifyTarget, siteNameOf } from "../lib/target.js";
import { CliError, UsageError, log } from "../lib/ui.js";
import { compareVersions } from "./site.js";
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
// Cloudflare's error codes: 10042 R2 not switched on for the account, 10006 no such bucket, 10007 no workers.dev subdomain.
const hasCode = (res, code) => (res.body?.errors || []).some((e) => e.code === code);

// -> [{ status: "ok" | "warn" | "fail", label, detail, hint }]. Everything the checks read comes in as arguments.
// site: a site name, to check that game too (the "Game" check then carries its site and url).
export async function runChecks({ site = null, readObject = getObject, probe = probeAccess, cliVersion = TOOLKIT_VERSION, ...options } = {}) {
  const checks = [];
  const reached = await accountChecks(checks, options);
  if (site) {
    if (reached) checks.push(...(await gameChecks(site, reached, { readObject, probe, cliVersion })));
    else checks.push(check("fail", "Game", `${site}: not checked, the checks above must pass first`, checks.find((x) => x.status !== "ok" && x.hint)?.hint));
  }
  return checks;
}

// The checks of the PC and the account, pushed into `checks`.
// -> what the game checks need ({ token, accountId, allowed, answers, bucketFound }), or null when they stopped early.
async function accountChecks(checks, {
  nodeVersion = process.versions.node,
  wranglerVersion = readWranglerVersion(),
  getToken = apiToken,
  usingEnvToken = !!envApiToken(),
  envTokenIgnored = false,
  // The account a deploy would use: --account, else CLOUDFLARE_ACCOUNT_ID, else the saved choice.
  asked = askedAccount({ unattended: true }),
  savedAccountId = loadSettings().accountId,
  profile = activeProfile(),
  fetchImpl = globalThis.fetch,
} = {}) {
  const major = Number(nodeVersion.split(".")[0]);
  checks.push(major >= 22 ? check("ok", "Node.js", nodeVersion) : check("fail", "Node.js", `${nodeVersion}, 22 or newer is required`, "Install the LTS release from https://nodejs.org"));

  if (!wranglerVersion) {
    checks.push(check("fail", "wrangler", "not installed", "Run `npm ci` in the toolkit folder (the one-liner does it for you)"));
    return null;
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
    return null;
  }
  const named = profile.name !== DEFAULT_PROFILE;
  const loginOf = `the toolkit's own login${named ? `, profile ${profile.name}` : ""}`;
  if (!token) {
    const hint = named ? `Log in to it: rwk login --profile ${profile.name}` : "Log in with rwk login (the first deploy does it too); in CI set CLOUDFLARE_API_TOKEN";
    checks.push(check("warn", "Cloudflare login", `not logged in${named ? ` (profile ${profile.name})` : ""}`, hint));
    return null;
  }
  checks.push(check("ok", "Cloudflare login", usingEnvToken ? "API token from CLOUDFLARE_API_TOKEN" : loginOf));

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
    return null;
  }
  if (!accounts.ok) {
    checks.push(check("fail", "Account", `the login cannot list accounts (HTTP ${accounts.status})`, usingEnvToken ? "The token needs Account → Account Settings → Read, and must not be expired" : "Run a deploy in a terminal to log in again"));
    return null;
  }
  const list = accounts.body.result || [];
  if (!list.length) {
    checks.push(check("fail", "Account", "this login reaches no Cloudflare account"));
    return null;
  }
  let account = null;
  let from = "";
  if (asked) {
    const match = matchAccount(list, asked.value);
    if (match.error) {
      const other = usingEnvToken ? "" : "; an account under another email needs its own login: rwk login --profile <name>";
      checks.push(check("fail", "Account", `${asked.from}: ${match.error}`, `Use one of these IDs or names with ${asked.from}${other}`));
      return null;
    }
    account = match.account;
    from = `, from ${asked.from}`;
  } else {
    account = list.find((a) => a.id === savedAccountId) || (list.length === 1 ? list[0] : null);
    if (account && list.length > 1) from = ", the one chosen last time";
  }
  if (!account) {
    checks.push(check("warn", "Account", `${list.length} accounts and none chosen: ${list.map((a) => `${a.name} (${a.id})`).join(", ")}`, "Pass --account <ID or name>, or set CLOUDFLARE_ACCOUNT_ID, to choose one; the checks below use the first"));
  }
  const used = account || list[0];
  checks.push(check("ok", "Account", `${used.name} (${used.id})${from}`));

  const allowed = new Set();
  const answers = {};
  const enableR2 = `Open https://dash.cloudflare.com/${used.id}/r2/overview and enable R2 (the free plan asks for a payment method, nothing is charged within it)`;
  for (const probe of PROBES) {
    // The browser login cannot reach Access (the dashboard does that step): not a gap to report.
    if (probe.access && !usingEnvToken) continue;
    const res = await call(probe.route(used.id));
    answers[probe.id] = res;
    if (res.ok) {
      allowed.add(probe.id);
      checks.push(check("ok", probe.label, "allowed"));
    } else if (probe.id === "r2" && hasCode(res, 10042)) {
      checks.push(check("fail", probe.label, "R2 is not enabled on this account", enableR2));
    } else if (res.status === 401 || res.status === 403) {
      checks.push(check(probe.level, probe.label, `denied: ${probe.why}`, usingEnvToken ? `Add the token permission ${probe.permission}` : "Log in again to renew the toolkit's permissions"));
    } else if (probe.access && res.status === 400) {
      // Zero Trust not enabled yet: Cloudflare answers the Access routes with an error body.
      checks.push(check("warn", probe.label, "no Zero Trust team yet", "Create one in the dashboard (Zero Trust) before the first Access protection"));
    } else {
      checks.push(check("warn", probe.label, `could not tell (${res.error || `HTTP ${res.status}`})`));
    }
  }

  // What the account itself needs, asked only where the token may look.
  if (allowed.has("workers")) {
    const res = await call(`/accounts/${used.id}/workers/subdomain`);
    if (res.ok && res.body.result?.subdomain) checks.push(check("ok", "workers.dev subdomain", `${res.body.result.subdomain}.workers.dev`));
    else if (res.status === 404 || hasCode(res, 10007)) {
      checks.push(check("fail", "workers.dev subdomain", "none registered yet: deploy cannot publish the site", "Go to https://dash.cloudflare.com → Workers & Pages and register a subdomain (e.g. your username)"));
    } else checks.push(check("warn", "workers.dev subdomain", `could not tell (${res.error || `HTTP ${res.status}`})`));
  }
  let bucketFound = null;
  if (allowed.has("r2")) {
    const res = await call(`/accounts/${used.id}/r2/buckets/${DEFAULT_BUCKET}`);
    bucketFound = res.ok ? true : res.status === 404 || hasCode(res, 10006) ? false : null;
    if (res.ok) checks.push(check("ok", "R2 bucket", `${DEFAULT_BUCKET} found`));
    else if (res.status === 404 || hasCode(res, 10006)) checks.push(check("ok", "R2 bucket", `${DEFAULT_BUCKET} not created yet: the first deploy creates it`));
    else if (hasCode(res, 10042)) checks.push(check("fail", "R2 bucket", "R2 is not enabled on this account", enableR2));
    else checks.push(check("warn", "R2 bucket", `could not tell (${res.error || `HTTP ${res.status}`})`));
  }
  return { token, accountId: used.id, allowed, answers, bucketFound, fetchImpl };
}

// One deployed game: its config in R2, its Worker, the site itself, Access and the toolkit version.
// A check that cannot be made is a failure: the game was asked about.
async function gameChecks(site, { token, accountId, allowed, answers, bucketFound, fetchImpl }, { readObject, probe, cliVersion }) {
  if (!allowed.has("r2")) return [check("fail", "Game", `${site}: not checked, the games list in R2 cannot be read`, "Fix the R2 storage check above first")];
  if (bucketFound === false) return [check("fail", "Game", `No game in this Cloudflare account was deployed as "${site}": it has no games yet.`, 'Publish it from its folder: rwk deploy "<game folder>"')];
  let cfg;
  try {
    const raw = await readObject({ token, accountId, bucket: DEFAULT_BUCKET, key: CONFIGS_KEY, fetchImpl });
    cfg = findGameBySite(raw ? JSON.parse(raw.toString("utf8")) : {}, site)[1];
  } catch (err) {
    return [check("fail", "Game", err.message, "rwk list shows the games of this account; --account or --profile checks another one")];
  }
  const checks = [{ ...check("ok", "Game", `${cfg.title} (${cfg.engine}), site ${cfg.slug}`), site: cfg.slug, url: cfg.url || null }];
  const redeploy = 'Publish it again from the game folder: rwk deploy "<game folder>" (the saves stay in R2)';

  // The Workers list was read by the permission check above.
  const scripts = allowed.has("workers") ? answers.workers?.body?.result : null;
  if (Array.isArray(scripts)) {
    if (scripts.some((s) => s.id === cfg.slug)) checks.push(check("ok", "Worker", cfg.slug));
    else checks.push(check("fail", "Worker", `${cfg.slug} is not in the account: the site is gone`, redeploy));
  }

  if (!cfg.url) {
    checks.push(check("warn", "Site", "no link recorded", redeploy));
  } else {
    const res = await probe(cfg.url);
    const logs = `rwk logs ${cfg.slug} shows the Worker's requests and errors`;
    if (res.error) checks.push(check("fail", "Site", `${cfg.url} cannot be reached (${res.error})`, `Check the network; ${logs}`));
    else if (res.locked) checks.push(check("fail", "Site", `${cfg.url} is locked: its access protection was never finished`, 'Finish the first deploy in a terminal: rwk deploy "<game folder>"'));
    else if (res.protected) checks.push(check("ok", "Site", `${cfg.url} is up, behind Cloudflare Access`));
    else if (res.status >= 200 && res.status < 400) checks.push(check("ok", "Site", `${cfg.url} is up (HTTP ${res.status})`));
    else checks.push(check("fail", "Site", `${cfg.url} answers HTTP ${res.status}`, logs));

    const mode = cfg.auth && cfg.auth.mode;
    if (!res.error && !res.locked) {
      if (mode === "access" && !res.protected) {
        checks.push(check("fail", "Access", "set up, but NOT protecting the site: anyone with the link can play", "Check the dashboard: Workers & Pages → the Worker → Settings → Domains & Routes → Cloudflare Access"));
      } else if (mode === "access") checks.push(check("ok", "Access", "Cloudflare Access (sign-in by email)"));
      else if (mode === "none") checks.push(check("ok", "Access", "none: anyone with the link can play"));
    }
  }

  const version = cfg.toolkitVersion;
  const upgrade = `rwk upgrade ${cfg.slug} brings the site to it`;
  const order = version ? compareVersions(version, cliVersion) : null;
  if (!version) checks.push(check("warn", "Toolkit", `not recorded (deployed before it was); this CLI is ${cliVersion}`, upgrade));
  else if (order < 0) checks.push(check("warn", "Toolkit", `${version}, older than this CLI (${cliVersion})`, upgrade));
  else if (order > 0) checks.push(check("warn", "Toolkit", `${version}, newer than this CLI (${cliVersion})`, "Update the toolkit before rwk upgrade"));
  else checks.push(check("ok", "Toolkit", `${version}, the same as this CLI`));
  return checks;
}

// The site name a doctor target stands for: a link or a site name (a folder is analyze's). -> name, or null for none.
export function doctorSite(input) {
  if (input === undefined || input === null || input === "") return null;
  const target = classifyTarget(input);
  if (target.kind === "folder") {
    throw new UsageError(`"${target.value}" is a game folder, but doctor checks a deployed game by its link or site name.`, { hint: `To check a game folder: rwk analyze "${target.value}"` });
  }
  return siteNameOf(target);
}

function readWranglerVersion() {
  try {
    return JSON.parse(fs.readFileSync(path.join(TOOLKIT_ROOT, "node_modules", "wrangler", "package.json"), "utf8")).version;
  } catch {
    return null;
  }
}

export async function doctor({ site = null, envTokenIgnored = false, run = runChecks } = {}) {
  log.step(site ? `Checking this PC and the game ${site}` : "Checking this PC");
  const checks = await run({ site, envTokenIgnored });
  for (const { status, label, detail, hint } of checks) {
    const line = `${label}: ${detail}`;
    if (status === "ok") log.ok(line);
    else if (status === "warn") log.warn(hint ? `${line}. ${hint}` : line);
    else log.error(line, hint);
  }
  const failed = checks.filter((x) => x.status === "fail");
  if (failed.length) throw new CliError(`${failed.length} check(s) failed: ${failed.map((x) => x.label).join(", ")}.`, { hint: failed[0].hint || undefined });
  const game = checks.find((x) => x.label === "Game" && x.site);
  return { ...(game ? { site: game.site, url: game.url } : {}), checks, facts: [["Checks", `${checks.filter((x) => x.status === "ok").length} of ${checks.length} passed`]] };
}
