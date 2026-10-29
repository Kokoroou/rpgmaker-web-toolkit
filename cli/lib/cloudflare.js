// Cloudflare operations: account, R2 bucket, overflow assets, Worker deploy,
// Access detection and save import. All through the pinned wrangler, except
// upgrade (workers-api.js).

import crypto from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import LZString from "lz-string";
import { engineOf } from "./engines.js";
import { NeedsAnswer, choose, isUnattended, log } from "./ui.js";
import { settingsKey } from "../../worker/settings.js";
import { PROFILE, SCOPES, envApiToken, useAccount, wrangler, wranglerOrThrow } from "./wrangler.js";

//---------------------------------------------------------------------------
// Account
//---------------------------------------------------------------------------

// CI without a login: what to set instead.
const TOKEN_HINT =
  "Set CLOUDFLARE_API_TOKEN (and CLOUDFLARE_ACCOUNT_ID) for a non-interactive run, or run the command once in a terminal to log in.";

export async function ensureLogin(settings) {
  let who = await whoami();
  if (!who.loggedIn && isUnattended()) throw new NeedsAnswer(`Not logged in to Cloudflare. ${TOKEN_HINT}`);
  if (!who.loggedIn) {
    log.info("Not logged in to Cloudflare: a browser window will open to log in…");
    log.info(`The toolkit only asks for: ${SCOPES.join(", ")}.`);
    await wranglerOrThrow(["auth", "create", PROFILE, "--scopes", ...SCOPES], { interactive: true });
    who = await whoami();
    if (!who.loggedIn) throw new Error("Cloudflare login failed.");
  }
  const accounts = who.accounts || [];
  const wanted = (isUnattended() && process.env.CLOUDFLARE_ACCOUNT_ID) || settings.accountId;
  let account = accounts.find((a) => a.id === wanted);
  if (!account) {
    if (!accounts.length) throw new Error("This login has no Cloudflare account.");
    account =
      accounts.length === 1
        ? accounts[0]
        : await choose(
            "Choose the Cloudflare account to host on:",
            accounts.map((a) => ({ label: `${a.name} (${a.id})`, value: a })),
            0,
            { whenUnattended: null, hint: "Set CLOUDFLARE_ACCOUNT_ID to the account's ID." }
          );
    settings.accountId = account.id;
  }
  useAccount(account.id);
  return { email: who.email, account };
}

// `wrangler whoami` only reads the default profile, so ask the API with the
// toolkit profile's token (wrangler refreshes it when expired).
async function whoami() {
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
  const res = await wrangler(["auth", "token", "--json", "--profile", PROFILE], { quiet: true });
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

export async function syncOverflow({ bucket, slug, files }) {
  const manifestKey = manifestKeyOf(slug);
  const remote = await loadOverflowManifest(bucket, slug);
  const next = {};
  let uploaded = 0;

  for (const file of files) {
    const sha256 = await hashFile(file.abs);
    next[file.rel] = { sha256, size: file.size };
    if (remote[file.rel] && remote[file.rel].sha256 === sha256) continue;
    log.info(`↑ R2: ${file.rel} (${(file.size / 1024 / 1024).toFixed(1)} MB)`);
    await r2Put(bucket, `assets/${slug}/${file.rel}`, file.abs, contentTypeOf(file.rel));
    uploaded++;
  }

  let removed = 0;
  for (const rel of Object.keys(remote)) {
    if (next[rel]) continue;
    await r2Delete(bucket, `assets/${slug}/${rel}`);
    removed++;
  }

  if (uploaded || removed || Object.keys(remote).length !== Object.keys(next).length) {
    await r2PutJson(bucket, manifestKey, next);
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

  const always = ["/api/*", ...extra];
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
export function workerVars({ gameId, auth, locked, indexable, saveHistory, translate = null }) {
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
  return vars;
}

// playerSettings: from playerOverrides() (stage.js). With a bucket or any
// player settings, the Worker also serves js/plugins.js, to put the settings
// from R2 (worker/settings.js) and each player's own in it.
export function writeWorkerProject({ buildDir, slug, gameId = slug, bucket, overflowRels, auth, locked, toolkitRoot, indexable = false, saveHistory = false, playerSettings = {}, translate = null }) {
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
    vars: workerVars({ gameId, auth, locked, indexable, saveHistory, translate }),
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
  const res = await wrangler(["deploy", "--config", configFile]);
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

//---------------------------------------------------------------------------
// Save import (desktop save files -> cloud)
//---------------------------------------------------------------------------

export function userHash(email) {
  return crypto.createHash("sha256").update(email.trim().toLowerCase()).digest("hex").slice(0, 32);
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
