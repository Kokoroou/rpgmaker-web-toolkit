// Cloudflare operations: account, R2 bucket, overflow assets, Worker deploy,
// Access detection and save import. All through the pinned wrangler, except
// upgrade (workers-api.js).

import crypto from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import LZString from "lz-string";
import { engineOf } from "./engines.js";
import { CliError, NeedsAnswer, choose, formatBytes, isUnattended, log, progressLine, sym } from "./ui.js";
import { settingsKey } from "../../worker/settings.js";
import { DEFAULT_PROFILE, activeProfile, loadState } from "./config.js";
import { SCOPES, envApiToken, useAccount, wrangler, wranglerOrThrow, wranglerProfile } from "./wrangler.js";
import { writeZip } from "./zip.js";

//---------------------------------------------------------------------------
// Account
//---------------------------------------------------------------------------

// CI without a login: what to set instead.
const TOKEN_HINT =
  "Set CLOUDFLARE_API_TOKEN (and CLOUDFLARE_ACCOUNT_ID, or --account) for a non-interactive run, or run the command once in a terminal to log in.";

// --account for this run (an ID or a name): wins over CLOUDFLARE_ACCOUNT_ID and the saved choice.
let accountFlag = null;
export function setAccountFlag(value) {
  accountFlag = value || null;
}

const ACCOUNT_HINT = "Pass --account <ID or name>, or set CLOUDFLARE_ACCOUNT_ID to the account's ID.";
// An account under another email is not one this login reaches: it takes its own login profile.
const OTHER_LOGIN_HINT = "An account of another Cloudflare login (another email) needs its own profile: rwk login --profile <name>, then add --profile <name>.";

// The account a run asked for by name, before the saved choice: --account, then
// CLOUDFLARE_ACCOUNT_ID (read only by an unattended run, like the API token). -> { value, from } | null
export function askedAccount({ flag = accountFlag, env = process.env, unattended = isUnattended() } = {}) {
  if (flag) return { value: flag, from: "--account" };
  if (unattended && env.CLOUDFLARE_ACCOUNT_ID) return { value: env.CLOUDFLARE_ACCOUNT_ID, from: "CLOUDFLARE_ACCOUNT_ID" };
  return null;
}

// accounts [{ id, name }], an ID or a name -> { account } | { error }. The ID first, then the name without regard to case.
export function matchAccount(accounts, wanted) {
  const byId = accounts.find((a) => a.id === wanted);
  if (byId) return { account: byId };
  const named = accounts.filter((a) => (a.name || "").toLowerCase() === String(wanted).toLowerCase());
  if (named.length === 1) return { account: named[0] };
  const all = accounts.map((a) => `${a.name} (${a.id})`).join(", ");
  if (named.length > 1) return { error: `Several accounts are named "${wanted}": ${named.map((a) => a.id).join(", ")}. Give the ID instead.` };
  return { error: `This login has no Cloudflare account "${wanted}"${all ? `. It has: ${all}` : ""}.` };
}

export async function ensureLogin(settings, { profile = activeProfile(), known = !!loadState().profiles[profile.name], readLogin = whoami, browserLogin = logIn } = {}) {
  let who = await readLogin();
  // A profile nobody made is a typo more often than a wish to log in: rwk login makes it.
  if (!who.loggedIn && !envApiToken() && profile.name !== DEFAULT_PROFILE && !known) {
    throw new CliError(`No login profile "${profile.name}" on this PC.`, { hint: `Make it (opens the browser): rwk login --profile ${profile.name}. List the profiles: rwk profiles` });
  }
  if (!who.loggedIn && isUnattended()) throw new NeedsAnswer(`Not logged in to Cloudflare. ${TOKEN_HINT}`);
  if (!who.loggedIn) {
    log.info("Not logged in to Cloudflare: a browser window will open to log in…");
    who = await browserLogin();
  }
  const account = await pickAccount(who.accounts || [], settings);
  useAccount(account.id);
  return { email: who.email, account };
}

// Opens the browser to log in to the run's profile (a new one, or again in an existing one,
// which may then be another Cloudflare login) -> whoami()
export async function logIn(name = activeProfile().name, { run = wranglerOrThrow, readLogin = whoami } = {}) {
  log.info(`The toolkit only asks for: ${SCOPES.join(", ")}.`);
  await run(["auth", "create", wranglerProfile(name), "--scopes", ...SCOPES], { interactive: true });
  const who = await readLogin();
  if (!who.loggedIn) throw new Error("Cloudflare login failed.");
  return who;
}

// Logs the profile out (Cloudflare revokes its token) and removes it from wrangler.
// -> false when wrangler had no such profile
export async function logOut(name = activeProfile().name, { run = wrangler } = {}) {
  const res = await run(["auth", "delete", wranglerProfile(name)], { quiet: true });
  if (res.code === 0) return true;
  if (/does not exist/i.test(res.output)) return false;
  const tail = res.output.trim().split("\n").slice(-4).join("\n");
  throw new Error(`wrangler auth delete failed (exit code ${res.code})\n${tail}`);
}

// The account to work in: the one asked for (an unknown one is an error, never a fallback),
// else the saved choice, else the only one, else a question (exit code 2 without a terminal).
// Only an answer to the question is saved, so --account stays for one run.
export async function pickAccount(accounts, settings, asked = askedAccount()) {
  if (!accounts.length) throw new Error("This login has no Cloudflare account.");
  if (asked) {
    const { account, error } = matchAccount(accounts, asked.value);
    if (error) {
      const fix = asked.from === "--account" ? "Use one of the IDs or names above." : "Set CLOUDFLARE_ACCOUNT_ID to one of the IDs above.";
      throw new CliError(`${asked.from}: ${error}`, { hint: envApiToken() ? fix : `${fix} ${OTHER_LOGIN_HINT}` });
    }
    return account;
  }
  const saved = accounts.find((a) => a.id === settings.accountId);
  if (saved) return saved;
  const account =
    accounts.length === 1
      ? accounts[0]
      : await choose(
          "Choose the Cloudflare account to host on:",
          accounts.map((a) => ({ label: `${a.name} (${a.id})`, value: a })),
          0,
          { whenUnattended: null, hint: ACCOUNT_HINT }
        );
  settings.accountId = account.id;
  return account;
}

// `wrangler whoami` only reads the default profile, so ask the API with the
// toolkit profile's token (wrangler refreshes it when expired).
export async function whoami() {
  const token = await apiToken();
  if (!token) return { loggedIn: false };
  // An API token may lack "User Details: Read": the email is only a default answer.
  const user = envApiToken() ? cfApi(token, "/user").catch(() => ({})) : cfApi(token, "/user");
  const [{ email }, accounts] = await Promise.all([user, cfApi(token, "/accounts?per_page=50")]);
  return { loggedIn: true, email, accounts: accounts.map((a) => ({ id: a.id, name: a.name })) };
}

// -> the toolkit profile's API token, or null when not logged in
export async function apiToken() {
  if (envApiToken()) return envApiToken();
  const res = await wrangler(["auth", "token", "--json", "--profile", wranglerProfile()], { quiet: true });
  try {
    return JSON.parse(res.stdout.slice(res.stdout.indexOf("{"))).token || null;
  } catch {
    return null; // Not logged in (no profile yet, or the refresh token was revoked).
  }
}

async function cfApi(token, route) {
  const res = await fetch(`https://api.cloudflare.com/client/v4${route}`, {
    headers: { authorization: `Bearer ${token}` },
  });
  const body = await res.json().catch(() => ({}));
  if (!res.ok || !body.success) {
    const reason = body.errors?.map((e) => e.message).join("; ") || `HTTP ${res.status}`;
    throw new Error(`Cloudflare API ${route.split("?")[0]} failed: ${reason}`);
  }
  return body.result;
}

//---------------------------------------------------------------------------
// R2
//---------------------------------------------------------------------------

export async function ensureBucket(bucket, accountId) {
  for (;;) {
    const res = await wrangler(["r2", "bucket", "create", bucket], { quiet: true });
    if (res.code === 0 || /already exists|10004/i.test(res.output)) return;
    if (/enable R2|10042|purchase/i.test(res.output)) {
      log.warn("R2 is not enabled for this account (a one-time step; the free tier has 10 GB).");
      log.info(`Open https://dash.cloudflare.com/${accountId}/r2/overview, enable R2, then come back here.`);
      const retry = await choose(
        "Is R2 enabled now?",
        [
          { label: "Yes, try again", value: true },
          { label: "Quit", value: false },
        ],
        0,
        { whenUnattended: 1 }
      );
      if (retry) continue;
    }
    throw new Error(`Could not create R2 bucket "${bucket}":\n${res.output.trim().split("\n").slice(-5).join("\n")}`);
  }
}

// null only when the key is missing; any other failure throws, so a network
// error is never mistaken for "no config yet".
async function r2Get(bucket, key) {
  const tmp = path.join(os.tmpdir(), `rwk-${crypto.randomUUID()}`);
  const res = await wrangler(["r2", "object", "get", `${bucket}/${key}`, "--remote", "--file", tmp], { quiet: true });
  if (res.code !== 0) {
    fs.rmSync(tmp, { force: true });
    if (/specified key does not exist/i.test(res.output)) return null;
    throw new Error(`Could not read R2 object ${key}:\n${res.output.trim().split("\n").slice(-5).join("\n")}`);
  }
  try {
    return fs.readFileSync(tmp);
  } finally {
    fs.rmSync(tmp, { force: true });
  }
}

async function r2Put(bucket, key, file, contentType) {
  await wranglerOrThrow(
    ["r2", "object", "put", `${bucket}/${key}`, "--remote", "--file", file, "--content-type", contentType],
    { quiet: true }
  );
}

async function r2PutJson(bucket, key, data) {
  const tmp = path.join(os.tmpdir(), `rwk-${crypto.randomUUID()}.json`);
  fs.writeFileSync(tmp, JSON.stringify(data, null, 2));
  try {
    await r2Put(bucket, key, tmp, "application/json");
  } finally {
    fs.rmSync(tmp, { force: true });
  }
}

async function r2Delete(bucket, key) {
  await wrangler(["r2", "object", "delete", `${bucket}/${key}`, "--remote"], { quiet: true });
}

//---------------------------------------------------------------------------
// Game configs: one JSON in the bucket, { [fingerprint]: cfg }, so any machine
// that can log in to the account redeploys with the same answers.
//---------------------------------------------------------------------------

const CONFIGS_KEY = "rwk/games.json";

export async function loadGameConfigs(bucket) {
  const raw = await r2Get(bucket, CONFIGS_KEY);
  return raw ? JSON.parse(raw.toString("utf8")) : {};
}

export async function saveGameConfigs(bucket, configs) {
  await r2PutJson(bucket, CONFIGS_KEY, configs);
}

// The settings the Worker applies without a redeploy (worker/settings.js).
// settings: from liveSettingsOf() (stage.js)
export async function saveLiveSettings(bucket, gameId, settings) {
  await r2PutJson(bucket, settingsKey(gameId), settings);
}

// { [sha256(email)]: first save time }, kept by the Worker (worker/players.js).
export async function loadPlayers(bucket, slug) {
  const raw = await r2Get(bucket, `rwk/players/${slug}.json`);
  return raw ? JSON.parse(raw.toString("utf8")) : {};
}

//---------------------------------------------------------------------------
// Overflow assets (> 25 MiB) mirrored to R2, only when their hash changes
//---------------------------------------------------------------------------

const CONTENT_TYPES = {
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".webp": "image/webp",
  ".ogg": "audio/ogg",
  ".m4a": "audio/mp4",
  ".mp4": "video/mp4",
  ".webm": "video/webm",
  ".json": "application/json",
  ".js": "text/javascript",
  ".wasm": "application/wasm",
};

export function contentTypeOf(rel) {
  return CONTENT_TYPES[path.extname(rel).toLowerCase()] || "application/octet-stream";
}

const manifestKeyOf = (slug) => `assets/${slug}/.rwk-manifest.json`;

// { [rel]: { sha256, size } } of the files already on R2
async function loadOverflowManifest(bucket, slug) {
  const raw = await r2Get(bucket, manifestKeyOf(slug));
  return raw ? JSON.parse(raw.toString("utf8")) : {};
}

export async function loadOverflowRels(bucket, slug) {
  return Object.keys(await loadOverflowManifest(bucket, slug));
}

// io: the R2 calls and the progress line, replaced in tests.
export async function syncOverflow({ bucket, slug, files, io = {} }) {
  const { load = loadOverflowManifest, put = r2Put, remove = r2Delete, putJson = r2PutJson, bar = progressLine() } = io;
  const manifestKey = manifestKeyOf(slug);
  const remote = await load(bucket, slug);
  const next = {};
  let uploaded = 0;

  // On a terminal one line shows the file and the bytes done so far (checking a file
  // that has not changed counts too); elsewhere a line per uploaded file.
  const totalBytes = files.reduce((sum, f) => sum + f.size, 0);
  let doneBytes = 0;
  for (const [i, file] of files.entries()) {
    const count = `${i + 1}/${files.length}`;
    if (bar.live) bar.update(`${sym.up} R2 ${count} · ${formatBytes(doneBytes)} of ${formatBytes(totalBytes)} · ${file.rel}`);
    const sha256 = await hashFile(file.abs);
    next[file.rel] = { sha256, size: file.size };
    if (!(remote[file.rel] && remote[file.rel].sha256 === sha256)) {
      if (!bar.live) bar.update(`${sym.up} R2 [${count}] ${file.rel} (${(file.size / 1024 / 1024).toFixed(1)} MB)`);
      await put(bucket, `assets/${slug}/${file.rel}`, file.abs, contentTypeOf(file.rel));
      uploaded++;
    }
    doneBytes += file.size;
  }
  bar.end();

  let removed = 0;
  for (const rel of Object.keys(remote)) {
    if (next[rel]) continue;
    await remove(bucket, `assets/${slug}/${rel}`);
    removed++;
  }

  if (uploaded || removed || Object.keys(remote).length !== Object.keys(next).length) {
    await putJson(bucket, manifestKey, next);
  }
  return { uploaded, removed, unchanged: files.length - uploaded };
}

function hashFile(file) {
  return new Promise((resolve, reject) => {
    const hash = crypto.createHash("sha256");
    fs.createReadStream(file)
      .on("data", (d) => hash.update(d))
      .on("error", reject)
      .on("end", () => resolve(hash.digest("hex")));
  });
}

//---------------------------------------------------------------------------
// The build as one ZIP, for the host's "Download game" (worker/download.js).
// It is made here and uploaded, instead of streamed file by file by the Worker:
// a game has thousands of files and the free plan allows few subrequests.
//---------------------------------------------------------------------------

const BUILD_ZIP_KEY = (slug) => `assets/${slug}/rwk.zip`;
// What the current archive holds, so a later deploy can skip making and
// uploading a 1.5 GB archive for the same build.
const BUILD_ZIP_META_KEY = (slug) => `assets/${slug}/rwk.zip.json`;

// What the archive would hold: every file's path, size and date. A deploy that
// changes nothing else gets the same signature, and keeps the archive it made.
export function zipSignature(entries) {
  const hash = crypto.createHash("sha256");
  for (const entry of entries) {
    const st = fs.statSync(entry.abs);
    hash.update(`${entry.rel}\0${st.size}\0${Math.floor(st.mtimeMs)}\n`);
  }
  return hash.digest("hex");
}

// What the archive holds: what the site serves as static assets (assets), plus
// the large files kept in R2 (overflow). Generated files (js/plugins.js, the
// toolkit's plugins) are in `assets` at their staged path.
// -> [{ rel, abs }], the order the archive keeps (sorted by path).
export function zipEntries(publicDir, assets, overflow = []) {
  const entries = new Map();
  for (const file of assets) entries.set(file.rel, path.join(publicDir, ...file.rel.split("/")));
  // The toolkit's own generated files are not in `assets`: take them from the build.
  for (const rel of walkBuild(publicDir)) if (!entries.has(rel)) entries.set(rel, path.join(publicDir, ...rel.split("/")));
  for (const file of overflow) entries.set(file.rel, file.abs);
  return [...entries]
    .map(([rel, abs]) => ({ rel, abs }))
    .sort((a, b) => (a.rel < b.rel ? -1 : a.rel > b.rel ? 1 : 0));
}

function walkBuild(dir, rel = "") {
  const out = [];
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const next = rel ? `${rel}/${entry.name}` : entry.name;
    if (entry.isDirectory()) out.push(...walkBuild(path.join(dir, entry.name), next));
    else out.push(next);
  }
  return out;
}

// Removes the build's ZIP and its record from R2, for a deploy whose config no
// longer asks for one ("download": { "zip": true } was turned off), so the space
// it took is freed. A game that never had one costs a single small read.
// -> true when there was an archive to remove.
export async function deleteBuildZip({ bucket, slug, io = {} }) {
  const { get = r2Get, remove = r2Delete } = io;
  let record = null;
  try {
    record = await get(bucket, BUILD_ZIP_META_KEY(slug));
  } catch {
    return false; // R2 unreachable: the next deploy tries again
  }
  if (!record) return false;
  await remove(bucket, BUILD_ZIP_KEY(slug));
  await remove(bucket, BUILD_ZIP_META_KEY(slug));
  return true;
}

// Makes assets/<slug>/rwk.zip from `entries` and uploads it, unless the archive
// in R2 was made from the same files (then nothing is made or uploaded).
// zipPath: where to write it, next to the build; it is deleted after the upload.
// -> { bytes, entries, uploaded }
export async function uploadBuildZip({ bucket, slug, entries, zipPath, io = {} }) {
  const { make = writeZip, put = r2Put, putJson = r2PutJson, get = r2Get, bar = progressLine() } = io;
  const signature = zipSignature(entries);
  let previous = null;
  try {
    const raw = await get(bucket, BUILD_ZIP_META_KEY(slug));
    previous = raw ? JSON.parse(raw.toString("utf8")) : null;
  } catch {
    previous = null; // an unreadable record only costs a new upload
  }
  if (previous && previous.signature === signature && previous.bytes) {
    bar.end();
    return { ...previous, uploaded: false };
  }

  if (bar.live) bar.update(`${sym.up} ZIP · ${entries.length} files`);
  const made = await make(zipPath, entries);
  bar.end();
  await put(bucket, BUILD_ZIP_KEY(slug), zipPath, "application/zip");
  await putJson(bucket, BUILD_ZIP_META_KEY(slug), { signature, ...made });
  return { ...made, uploaded: true };
}

// run_worker_first rules: exact paths when they fit, else the parent folder.
// The Worker falls through to static assets for anything not in R2.
// extra: other exact paths the Worker serves (toolkitRoutes()).
export function overflowRoutes(rels, extra = []) {
  const MAX_RULES = 100; // wrangler limits
  const MAX_LEN = 100;
  // Both the raw and the percent-encoded spelling, since browsers encode
  // non-ASCII file names in request paths.
  const variants = (p) => [...new Set([`/${p}`, encodeURI(`/${p}`)])];
  const fits = (rules) => rules.length <= MAX_RULES && rules.every((r) => r.length <= MAX_LEN);

  const always = ["/api/*", "/_lens/*", ...extra];
  const exact = [...always, ...new Set(rels.flatMap(variants))];
  if (fits(exact)) return exact;

  const dirs = [...new Set(rels.map((rel) => (rel.includes("/") ? rel.slice(0, rel.lastIndexOf("/")) : "")))];
  if (!dirs.includes("")) {
    const byFolder = [...always, ...new Set(dirs.flatMap(variants).map((d) => `${d}/*`))];
    if (fits(byFolder)) return byFolder;
  }
  return true; // last resort: every request goes through the Worker
}

//---------------------------------------------------------------------------
// Worker deploy
//---------------------------------------------------------------------------

export const COMPATIBILITY_DATE = "2026-09-01";

// The Worker's environment variables (worker/index.js reads them).
// saveHistory: from saveHistoryConfig() (stage.js); translate: null (no
// Workers AI binding) or { model, dailyChars, on } (limits.js, worker/translate.js)
export function workerVars({ gameId, auth, locked, indexable, saveHistory, translate = null, lensOwners = [], downloadOwners = [] }) {
  const vars = {
    GAME_ID: gameId,
    AUTH_MODE: auth.mode || "locked",
    ACCESS_TEAM_DOMAIN: auth.teamDomain || "",
    ACCESS_AUD: auth.aud || "",
    RWK_LOCKED: locked ? "1" : "0",
    RWK_INDEXABLE: indexable ? "1" : "0",
    RWK_SAVE_HISTORY: saveHistory ? JSON.stringify(saveHistory) : "off",
  };
  if (translate) vars.RWK_TRANSLATE = JSON.stringify(translate);
  // Who may make MakerLens links from the game (worker/lens.js): hashes of emails.
  if (lensOwners.length) vars.RWK_LENS_OWNERS = JSON.stringify(lensOwners);
  // Who may download the web build as a ZIP (worker/download.js): hashes of emails.
  if (downloadOwners.length) vars.RWK_DOWNLOAD_OWNERS = JSON.stringify(downloadOwners);
  return vars;
}

// playerSettings: from playerOverrides() (stage.js). With a bucket or any
// player settings, the Worker also serves js/plugins.js, to put the settings
// from R2 (worker/settings.js) and each player's own in it.
export function writeWorkerProject({ buildDir, slug, gameId = slug, bucket, overflowRels, auth, locked, toolkitRoot, indexable = false, saveHistory = false, playerSettings = {}, translate = null, lensOwners = [], downloadOwners = [] }) {
  // Copied next to the config: the build folder may be on another drive.
  fs.cpSync(path.join(toolkitRoot, "worker"), path.join(buildDir, "worker"), { recursive: true });
  fs.writeFileSync(path.join(buildDir, "overflow.json"), JSON.stringify(overflowRels));
  fs.writeFileSync(path.join(buildDir, "player-settings.json"), JSON.stringify(playerSettings));
  fs.writeFileSync(
    path.join(buildDir, "worker.js"),
    `// Generated by rpgmaker-web-toolkit. Do not edit.\n` +
      `import { createWorker } from "./worker/index.js";\n` +
      `import overflow from "./overflow.json";\n` +
      `import playerSettings from "./player-settings.json";\n` +
      `export default createWorker({ overflow, playerSettings });\n`
  );

  const config = {
    name: slug,
    main: "worker.js",
    compatibility_date: COMPATIBILITY_DATE,
    workers_dev: true,
    preview_urls: false, // preview hostnames would sit outside the Access app
    assets: {
      directory: "public",
      binding: "ASSETS",
      not_found_handling: "none",
      run_worker_first: locked ? true : overflowRoutes(overflowRels, bucket || Object.keys(playerSettings).length ? ["/js/plugins.js"] : []),
    },
    vars: workerVars({ gameId, auth, locked, indexable, saveHistory, translate, lensOwners, downloadOwners }),
    observability: { enabled: false },
  };
  if (bucket) config.r2_buckets = [{ binding: "BUCKET", bucket_name: bucket }];
  // Translations are kept in R2, so no bucket, no translation.
  if (translate && bucket) config.ai = { binding: "AI" };
  const file = path.join(buildDir, "wrangler.json");
  fs.writeFileSync(file, JSON.stringify(config, null, 2));
  return file;
}

export async function deployWorker(configFile) {
  const res = await wrangler(["deploy", "--config", configFile], { progress: true });
  if (res.code !== 0) {
    if (/workers\.dev subdomain/i.test(res.output)) {
      throw new Error(
        "The account has no workers.dev subdomain yet. Go to https://dash.cloudflare.com → Workers & Pages, register a subdomain (e.g. your username), then run again."
      );
    }
    throw new Error("wrangler deploy failed (see the log above).");
  }
  const m = res.output.match(/https:\/\/[a-z0-9-]+\.[a-z0-9-]+\.workers\.dev/i);
  return m ? m[0] : null;
}

// Deletes a Worker, so its site stops working; the caller asks first.
// -> true when it is gone, also if it was already deleted.
export async function deleteWorker(name) {
  // --force skips wrangler's own prompt (and the check for Workers bound to it: none).
  const res = await wrangler(["delete", name, "--force"], { quiet: true });
  if (res.code === 0) return true;
  return /\[code: 10007\]|does not exist|not found/i.test(res.output);
}

//---------------------------------------------------------------------------
// Cloudflare Access detection: an Access-protected hostname redirects to
// https://<team>.cloudflareaccess.com/cdn-cgi/access/login/<host>?kid=<AUD>
//---------------------------------------------------------------------------

export async function probeAccess(url) {
  try {
    const res = await fetch(url, { redirect: "manual", headers: { "cache-control": "no-cache" } });
    const location = res.headers.get("location");
    if (location) {
      const target = new URL(location, url);
      if (target.hostname.endsWith(".cloudflareaccess.com")) {
        return { protected: true, teamDomain: target.hostname, aud: target.searchParams.get("kid") };
      }
    }
    return { protected: false, locked: res.headers.get("x-rwk-locked") === "1", status: res.status };
  } catch (err) {
    return { protected: false, error: err.message };
  }
}

// Whether /_lens gets past Access: the Worker answers a request without a token
// itself (401 + JSON), where Access would redirect to its login page.
export async function probeLensBypass(url) {
  try {
    const res = await fetch(new URL("/_lens/ping", url), { redirect: "manual", headers: { "cache-control": "no-cache" } });
    const location = res.headers.get("location");
    if (location) return { open: false, status: res.status };
    return { open: res.status === 401 && (res.headers.get("content-type") || "").includes("json"), status: res.status };
  } catch (err) {
    return { open: false, error: err.message };
  }
}

// The dashboard steps for the /_lens bypass, as plain lines (the values to type are
// in the lines, so each can be copied). Cloudflare's application form cannot be
// filled in from a link, so the link opens the empty "Create new self-hosted
// application" form and the values are listed in order instead.
export function lensBypassSteps({ host, slug }) {
  return {
    page: (accountId) => `https://dash.cloudflare.com/${accountId}/one/access-controls/apps/self-hosted/add`,
    lines: [
      ["Public hostnames", `click "Switch to custom input", then type ${host}/_lens (the path goes in the same box)`],
      ["Access policies", "click Create new policy"],
      ["Policy rules (left) → Include → Selector", "Everyone"],
      ["Policy details (right) → Policy Name", `${slug}-lens-bypass`],
      ["Policy details (right) → Action", "Bypass"],
      ["Then", "Save policy"],
      ["Back on the application page → Details → Name", `${slug}-lens (the automatic name is the whole address, too long)`],
      ["Then", "leave Session duration (24 hours) as it is and click Create at the bottom"],
    ],
  };
}

//---------------------------------------------------------------------------
// Save import (desktop save files -> cloud)
//---------------------------------------------------------------------------

export function userHash(email) {
  return crypto.createHash("sha256").update(email.trim().toLowerCase()).digest("hex").slice(0, 32);
}

// Who may make MakerLens links from the game (⚙ → Share): the Cloudflare account's
// email and `lens.owners`; "lens": false turns the feature off. -> hashes (worker/lens.js)
export function lensOwnersOf(cfg, email) {
  if (cfg.lens === false) return [];
  const extra = cfg.lens && Array.isArray(cfg.lens.owners) ? cfg.lens.owners : [];
  const emails = [email, ...extra].filter((e) => typeof e === "string" && /^[^@\s]+@[^@\s]+$/.test(e.trim()));
  return [...new Set(emails.map(userHash))];
}

// The owners for rwk upgrade: what the last deploy stored, or, when it stored none
// (a game deployed before MakerLens links, or one whose links were off and that
// "lens" now turns back on), worked out from the account that runs the upgrade:
// so links can come back with rwk config + rwk upgrade, without the game folder.
export function lensOwnersForUpgrade(cfg, email) {
  if (cfg.lens === false) return [];
  if (Array.isArray(cfg.lensOwners) && cfg.lensOwners.length) return cfg.lensOwners;
  return lensOwnersOf(cfg, email);
}

// Who may download the web build, as a ZIP or into a folder (⚙ → Share →
// Download game; GET /api/download and /api/download/list): the Cloudflare
// account's email and `download.owners`; "download": false turns both off.
// -> hashes (worker/download.js)
export function downloadOwnersOf(cfg, email) {
  if (cfg.download === false) return [];
  const extra = cfg.download && Array.isArray(cfg.download.owners) ? cfg.download.owners : [];
  const emails = [email, ...extra].filter((e) => typeof e === "string" && /^[^@\s]+@[^@\s]+$/.test(e.trim()));
  return [...new Set(emails.map(userHash))];
}

// Whether a deploy also makes the ZIP in R2: only when the config asks for it
// ("download": { "zip": true }). Downloading into a folder needs no archive and
// no R2 space, so it is the default; the ZIP costs as much as the build.
export function downloadZipOf(cfg) {
  return !!(cfg.download !== false && cfg.download && typeof cfg.download === "object" && cfg.download.zip === true);
}

// The owners for rwk upgrade: what the last deploy stored, or derived from the
// account that runs the upgrade (same logic as lens).
export function downloadOwnersForUpgrade(cfg, email) {
  if (Array.isArray(cfg.downloadOwners)) return cfg.downloadOwners;
  return downloadOwnersOf(cfg, email);
}

// What a deploy does about the download ZIP: "make" when a deployer may
// download (owners) and the config asks for the archive ("download": { "zip":
// true }); "remove" when no ZIP is wanted but an earlier deploy left one
// (cfg.downloadZip, recorded by the deploy that made it); "skip" otherwise.
// The folder download needs neither, so it is unaffected.
export function downloadPlan(cfg, owners) {
  if (owners.length && downloadZipOf(cfg)) return "make";
  if (cfg.downloadZip !== false) return "remove";
  return "skip";
}

export function listSaveFiles(saveDir, engine) {
  const ext = engineOf(engine).saveExtension;
  return fs
    .readdirSync(saveDir)
    .filter((f) => f.endsWith(ext))
    .map((f) => ({ name: f.slice(0, -ext.length), file: path.join(saveDir, f) }))
    .filter((s) => /^[A-Za-z0-9_.-]{1,64}$/.test(s.name));
}

// In a browser MV only lists a save whose title in global matches the game's
// current title (the desktop game does not check), so saves made before an
// update that renamed the game ("Ambrosia v1.05" -> "v1.07") cannot be
// continued. Gives every slot the current title.
// -> { text, fixed: number of slots changed }
export function retitleMvGlobal(text, gameTitle) {
  const json = LZString.decompressFromBase64(text.trim());
  let info;
  try {
    info = JSON.parse(json);
  } catch {
    return { text, fixed: 0 };
  }
  if (!Array.isArray(info)) return { text, fixed: 0 };
  let fixed = 0;
  for (const slot of info) {
    if (slot && typeof slot === "object" && slot.title !== gameTitle) {
      slot.title = gameTitle;
      fixed++;
    }
  }
  return fixed ? { text: LZString.compressToBase64(JSON.stringify(info)), fixed } : { text, fixed };
}

// Desktop saves are the same strings the browser stores; MZ writes the pako
// binary string as UTF-8, so read as UTF-8 and send one byte per char.
// The files in the game folder are never changed.
export async function importSaves({ bucket, slug, email, saves, engine, gameTitle }) {
  const prefix = `saves/${userHash(email)}/${slug}/`;
  let count = 0;
  for (const save of saves) {
    let text = fs.readFileSync(save.file, "utf8");
    if (engineOf(engine).retitlesGlobal && save.name === "global") {
      const result = retitleMvGlobal(text, gameTitle);
      if (result.fixed) log.info(`global: ${result.fixed} save(s) made under an older game title now show "${gameTitle}"`);
      text = result.text;
    }
    if ([...text].some((ch) => ch.charCodeAt(0) > 255)) {
      log.warn(`Skipping ${save.name}: not in the engine's binary string format.`);
      continue;
    }
    const tmp = path.join(os.tmpdir(), `rwk-save-${crypto.randomUUID()}`);
    fs.writeFileSync(tmp, Buffer.from(text, "latin1"));
    try {
      await r2Put(bucket, prefix + save.name, tmp, "application/octet-stream");
      log.ok(`${save.name}`);
      count++;
    } finally {
      fs.rmSync(tmp, { force: true });
    }
  }
  return count;
}
