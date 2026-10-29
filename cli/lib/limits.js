// Cloudflare free plan limits, read from cli/limits.json. The copy on main is
// fetched at each deploy so an older toolkit (a pinned RWK_REF, an old clone)
// follows a change in Cloudflare's free plan; offline, the last fetched copy
// or the bundled one is used. Of the copies that are valid, the newest wins.

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

export const BUNDLED_LIMITS_FILE = path.join(path.dirname(fileURLToPath(import.meta.url)), "..", "limits.json");
export const LIMITS_URL = "https://raw.githubusercontent.com/Kokoroou/rpgmaker-web-toolkit/main/cli/limits.json";
const FETCH_TIMEOUT_MS = 4000;

// Bounds that catch a typo in the file, not Cloudflare's policy.
const FIELDS = {
  maxFiles: [100, 10_000_000],
  maxFileBytes: [1024 ** 2, 10 * 1024 ** 3],
};

// Live translation (worker/translate.js): the model and the characters a day it
// may be sent, kept under the Workers AI free allocation (10,000 Neurons a day).
export const DEFAULT_TRANSLATE = { model: "@cf/meta/m2m100-1.2b", dailyChars: 100000 };
const MODEL_RE = /^@cf\/[\w.-]+\/[\w.-]+$/;

// Returns { assets: { maxFiles, maxFileBytes }, translate: { model, dailyChars }, updated, from: "remote" | "cache" | "bundled",
// newer: true when it replaces the bundled copy with a later one }.
export async function loadLimits({
  url = process.env.RWK_LIMITS_URL || LIMITS_URL,
  cacheFile,
  bundledFile = BUNDLED_LIMITS_FILE,
  fetchFn = globalThis.fetch,
} = {}) {
  const bundled = parseLimits(readJson(bundledFile));
  if (!bundled) throw new Error(`Invalid limits file: ${bundledFile}`);
  const candidates = [{ ...bundled, from: "bundled" }];

  const cached = cacheFile && parseLimits(readJson(cacheFile));
  if (cached) candidates.push({ ...cached, from: "cache" });

  if (url && url !== "off") {
    const remote = parseLimits(await fetchJson(url, fetchFn));
    if (remote) {
      candidates.push({ ...remote, from: "remote" });
      if (cacheFile) writeJson(cacheFile, remote);
    }
  }
  // Later candidates win ties: a fresh download over the cache over the bundled file.
  const best = candidates.reduce((a, b) => (b.updated >= a.updated ? b : a));
  return { ...best, newer: best.updated > bundled.updated };
}

// Keeps only the known fields; null when one is missing or out of bounds.
export function parseLimits(data) {
  if (!data || typeof data !== "object" || !data.assets) return null;
  if (typeof data.updated !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(data.updated)) return null;
  const assets = {};
  for (const [key, [min, max]] of Object.entries(FIELDS)) {
    const value = data.assets[key];
    if (!Number.isInteger(value) || value < min || value > max) return null;
    assets[key] = value;
  }
  // Optional, so a copy written before it existed still counts.
  const t = data.translate;
  const translate =
    t && typeof t === "object" && MODEL_RE.test(String(t.model)) && Number.isInteger(t.dailyChars) && t.dailyChars >= 0 && t.dailyChars <= 100_000_000
      ? { model: t.model, dailyChars: t.dailyChars }
      : { ...DEFAULT_TRANSLATE };
  return { updated: data.updated, assets, translate };
}

async function fetchJson(url, fetchFn) {
  try {
    const res = await fetchFn(url, { signal: AbortSignal.timeout(FETCH_TIMEOUT_MS), headers: { "cache-control": "no-cache" } });
    return res.ok ? await res.json() : null;
  } catch {
    return null; // Offline or blocked: the cached or bundled copy is enough.
  }
}

function readJson(file) {
  try {
    return JSON.parse(fs.readFileSync(file, "utf8"));
  } catch {
    return null;
  }
}

function writeJson(file, data) {
  try {
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(file, JSON.stringify(data, null, 2) + "\n");
  } catch {
    // Only a cache for the next offline run.
  }
}
