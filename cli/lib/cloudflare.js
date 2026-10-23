// Cloudflare operations: account, R2 bucket, overflow assets, Worker deploy,
// Access detection and save import. All through the pinned wrangler.

import crypto from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { choose, log } from "./ui.js";
import { useAccount, wrangler, wranglerOrThrow } from "./wrangler.js";

//---------------------------------------------------------------------------
// Account
//---------------------------------------------------------------------------

export async function ensureLogin(settings) {
  let who = await whoami();
  if (!who.loggedIn) {
    log.info("Chưa đăng nhập Cloudflare: trình duyệt sẽ mở để đăng nhập…");
    await wranglerOrThrow(["login"], { interactive: true });
    who = await whoami();
    if (!who.loggedIn) throw new Error("Đăng nhập Cloudflare không thành công.");
  }
  const accounts = who.accounts || [];
  let account = accounts.find((a) => a.id === settings.accountId);
  if (!account) {
    if (!accounts.length) throw new Error("Tài khoản không có Cloudflare account nào.");
    account =
      accounts.length === 1
        ? accounts[0]
        : await choose(
            "Chọn Cloudflare account dùng để host:",
            accounts.map((a) => ({ label: `${a.name} (${a.id})`, value: a }))
          );
    settings.accountId = account.id;
  }
  useAccount(account.id);
  return { email: who.email, account };
}

async function whoami() {
  const res = await wrangler(["whoami", "--json"], { quiet: true });
  try {
    return JSON.parse(res.stdout.slice(res.stdout.indexOf("{")));
  } catch {
    return { loggedIn: false };
  }
}

//---------------------------------------------------------------------------
// R2
//---------------------------------------------------------------------------

export async function ensureBucket(bucket, accountId) {
  for (;;) {
    const res = await wrangler(["r2", "bucket", "create", bucket], { quiet: true });
    if (res.code === 0 || /already exists|10004/i.test(res.output)) return;
    if (/enable R2|10042|purchase/i.test(res.output)) {
      log.warn("R2 chưa được bật cho account này (cần bật 1 lần, gói miễn phí 10 GB).");
      log.info(`Mở: https://dash.cloudflare.com/${accountId}/r2/overview → bật R2, rồi quay lại đây.`);
      const retry = await choose("Đã bật R2?", [
        { label: "Đã bật, thử lại", value: true },
        { label: "Thoát", value: false },
      ]);
      if (retry) continue;
    }
    throw new Error(`Không tạo được R2 bucket "${bucket}":\n${res.output.trim().split("\n").slice(-5).join("\n")}`);
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
    throw new Error(`Không đọc được R2 ${key}:\n${res.output.trim().split("\n").slice(-5).join("\n")}`);
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

export async function syncOverflow({ bucket, slug, files }) {
  const manifestKey = `assets/${slug}/.rwk-manifest.json`;
  const raw = await r2Get(bucket, manifestKey);
  const remote = raw ? JSON.parse(raw.toString("utf8")) : {};
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
export function overflowRoutes(rels) {
  const MAX_RULES = 100; // wrangler limits
  const MAX_LEN = 100;
  // Both the raw and the percent-encoded spelling, since browsers encode
  // non-ASCII file names in request paths.
  const variants = (p) => [...new Set([`/${p}`, encodeURI(`/${p}`)])];
  const fits = (rules) => rules.length <= MAX_RULES && rules.every((r) => r.length <= MAX_LEN);

  const exact = ["/api/*", ...new Set(rels.flatMap(variants))];
  if (fits(exact)) return exact;

  const dirs = [...new Set(rels.map((rel) => (rel.includes("/") ? rel.slice(0, rel.lastIndexOf("/")) : "")))];
  if (!dirs.includes("")) {
    const byFolder = ["/api/*", ...new Set(dirs.flatMap(variants).map((d) => `${d}/*`))];
    if (fits(byFolder)) return byFolder;
  }
  return true; // last resort: every request goes through the Worker
}

//---------------------------------------------------------------------------
// Worker deploy
//---------------------------------------------------------------------------

export function writeWorkerProject({ buildDir, slug, bucket, overflowRels, auth, locked, toolkitRoot }) {
  // Copied next to the config: the build folder may be on another drive.
  fs.cpSync(path.join(toolkitRoot, "worker"), path.join(buildDir, "worker"), { recursive: true });
  fs.writeFileSync(path.join(buildDir, "overflow.json"), JSON.stringify(overflowRels));
  fs.writeFileSync(
    path.join(buildDir, "worker.js"),
    `// Generated by rpgmaker-web-toolkit. Do not edit.\n` +
      `import { createWorker } from "./worker/index.js";\n` +
      `import overflow from "./overflow.json";\n` +
      `export default createWorker({ overflow });\n`
  );

  const config = {
    name: slug,
    main: "worker.js",
    compatibility_date: "2026-09-01",
    workers_dev: true,
    preview_urls: false, // preview hostnames would sit outside the Access app
    assets: {
      directory: "public",
      binding: "ASSETS",
      not_found_handling: "none",
      run_worker_first: locked ? true : overflowRoutes(overflowRels),
    },
    vars: {
      GAME_ID: slug,
      AUTH_MODE: auth.mode || "locked",
      ACCESS_TEAM_DOMAIN: auth.teamDomain || "",
      ACCESS_AUD: auth.aud || "",
      RWK_LOCKED: locked ? "1" : "0",
    },
    observability: { enabled: false },
  };
  if (bucket) config.r2_buckets = [{ binding: "BUCKET", bucket_name: bucket }];
  const file = path.join(buildDir, "wrangler.json");
  fs.writeFileSync(file, JSON.stringify(config, null, 2));
  return file;
}

export async function deployWorker(configFile) {
  const res = await wrangler(["deploy", "--config", configFile]);
  if (res.code !== 0) {
    if (/workers\.dev subdomain/i.test(res.output)) {
      throw new Error(
        "Account chưa có subdomain workers.dev. Vào https://dash.cloudflare.com → Workers & Pages → đăng ký subdomain (ví dụ tên username), rồi chạy lại."
      );
    }
    throw new Error("wrangler deploy thất bại (xem log phía trên).");
  }
  const m = res.output.match(/https:\/\/[a-z0-9-]+\.[a-z0-9-]+\.workers\.dev/i);
  return m ? m[0] : null;
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
  const ext = engine === "MZ" ? ".rmmzsave" : ".rpgsave";
  return fs
    .readdirSync(saveDir)
    .filter((f) => f.endsWith(ext))
    .map((f) => ({ name: f.slice(0, -ext.length), file: path.join(saveDir, f) }))
    .filter((s) => /^[A-Za-z0-9_.-]{1,64}$/.test(s.name));
}

// Desktop saves are the same strings the browser stores; MZ writes the pako
// binary string as UTF-8, so read as UTF-8 and send one byte per char.
export async function importSaves({ bucket, slug, email, saves }) {
  const prefix = `saves/${userHash(email)}/${slug}/`;
  let count = 0;
  for (const save of saves) {
    const text = fs.readFileSync(save.file, "utf8");
    if ([...text].some((ch) => ch.charCodeAt(0) > 255)) {
      log.warn(`Bỏ qua ${save.name}: định dạng không phải chuỗi nhị phân của engine.`);
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
