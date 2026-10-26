// Builds <build dir>/public: hard links to the game's files (falls back to
// copies across drives) plus generated files. Generated files are always
// written after unlinking the destination so a hard link can never write
// through to the original game folder.

import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { TOOLKIT_ROOT } from "./config.js";
import { mobileOnlyMissing, resolveCI, storageIdOf } from "./game.js";
import { userHash } from "./cloudflare.js";
import { FEATURE_KEYS, playerEmails, withPlayer, withPreset } from "./features.js";
import { applyPolicy, isIndexable } from "./policy.js";
import { appendToolkit } from "../../worker/toolkit.js";

export const RUNTIME_PLUGINS = ["RWK_Core", "RWK_SaveSync", "RWK_MobileControls", "RWK_SafeSaves", "RWK_Speed", "RWK_Message", "RWK_Backlog", "RWK_Dash", "RWK_SaveTools", "RWK_SaveHistory", "RWK_ItemBatch", "RWK_Cheats", "RWK_Report"];

// Shown in the in-game problem report (RWK_Report).
export const TOOLKIT_VERSION = JSON.parse(fs.readFileSync(path.join(TOOLKIT_ROOT, "package.json"), "utf8")).version;

// files: from collectFiles(); generated: Map<rel, string|Buffer>
// -> { linked, copied, unchanged, removed }
export function syncPublicDir(publicDir, files, generated) {
  fs.mkdirSync(publicDir, { recursive: true });
  const stats = { linked: 0, copied: 0, unchanged: 0, removed: 0 };
  const wanted = new Set([...files.map((f) => f.rel), ...generated.keys()]);

  for (const file of files) {
    if (generated.has(file.rel)) continue;
    const dest = path.join(publicDir, ...file.rel.split("/"));
    const st = statOrNull(dest);
    if (st && st.size === file.size && Math.floor(st.mtimeMs) === file.mtimeMs) {
      stats.unchanged++;
      continue;
    }
    if (st) fs.unlinkSync(dest);
    fs.mkdirSync(path.dirname(dest), { recursive: true });
    try {
      fs.linkSync(file.abs, dest);
      stats.linked++;
    } catch {
      fs.copyFileSync(file.abs, dest);
      const mtime = new Date(file.mtimeMs);
      fs.utimesSync(dest, mtime, mtime);
      stats.copied++;
    }
  }

  for (const [rel, content] of generated) {
    const dest = path.join(publicDir, ...rel.split("/"));
    fs.mkdirSync(path.dirname(dest), { recursive: true });
    if (statOrNull(dest)) fs.unlinkSync(dest);
    fs.writeFileSync(dest, content);
  }

  stats.removed = removeExtraneous(publicDir, "", wanted);
  return stats;
}

function removeExtraneous(dirAbs, dirRel, wanted) {
  let removed = 0;
  for (const entry of fs.readdirSync(dirAbs, { withFileTypes: true })) {
    const abs = path.join(dirAbs, entry.name);
    const rel = dirRel ? `${dirRel}/${entry.name}` : entry.name;
    if (entry.isDirectory()) {
      removed += removeExtraneous(abs, rel, wanted);
      if (fs.readdirSync(abs).length === 0) fs.rmdirSync(abs);
    } else if (!wanted.has(rel)) {
      fs.unlinkSync(abs);
      removed++;
    }
  }
  return removed;
}

function statOrNull(p) {
  try {
    return fs.statSync(p);
  } catch {
    return null;
  }
}

// quickSave: false | true | { ignoreSaveLock } -> false | { ignoreSaveLock }
function quickSaveConfig(value) {
  if (value === false) return false;
  return { ignoreSaveLock: !(value && value.ignoreSaveLock === false) };
}

// autoSave: false | true | { minutes } -> false | { minutes: 1..60, default 5 }
function autoSaveConfig(value) {
  if (value === false) return false;
  const minutes = Math.round(Number(value && value.minutes));
  return { minutes: minutes >= 1 ? Math.min(60, minutes) : 5 };
}

// backlog: false | true | { max } | max -> false | { max: 10..500, default 100 }
export function backlogConfig(value) {
  if (value === false) return false;
  const max = Math.round(Number(value && typeof value === "object" ? value.max : value));
  return { max: max >= 10 ? Math.min(500, max) : 100 };
}

// saveHistory: false | true | { keep, days } -> false | { keep: 1..50, default 10; days: 1..365, default 30 }
// The Worker enforces it (RWK_SAVE_HISTORY); the ⚙ menu only shows the entry.
export function saveHistoryConfig(value) {
  if (value === false) return false;
  const keep = Math.round(Number(value && value.keep));
  const days = Math.round(Number(value && value.days));
  return { keep: keep >= 1 ? Math.min(50, keep) : 10, days: days >= 1 ? Math.min(365, days) : 30 };
}

const bool = (v, fallback) => (typeof v === "boolean" ? v : fallback);

const CHEAT_GROUPS = ["party", "items", "battle", "switches", "movement"];

// cheats: false (default) | true | { party, items, battle, switches, movement }
// -> false | { party, items, battle, switches, movement } (each default true once cheats are on)
export function cheatsConfig(value) {
  if (!value) return false;
  const v = typeof value === "object" ? value : {};
  const out = Object.fromEntries(CHEAT_GROUPS.map((group) => [group, bool(v[group], true)]));
  return CHEAT_GROUPS.some((group) => out[group]) ? out : false;
}
const clampInt = (v, min, max, fallback) => {
  const n = Math.round(Number(v));
  return n >= min ? Math.min(max, n) : fallback;
};

// fastForward: false | true | { maxSpeed, speed, inBattle, lock }
// -> false | { maxSpeed: 2..4, default 4; speed: the starting speed, 2..maxSpeed; inBattle; lock: the player cannot change the speed }
export function fastForwardConfig(value) {
  if (value === false) return false;
  const v = value && typeof value === "object" ? value : {};
  const maxSpeed = clampInt(v.maxSpeed, 2, 4, 4);
  const speed = Math.min(maxSpeed, clampInt(v.speed, 2, 4, 2));
  return { maxSpeed, speed, inBattle: bool(v.inBattle, true), lock: bool(v.lock, false) };
}

const AUTO_SPEEDS = ["slow", "normal", "fast"];

// messageMode: false | true | { auto, skip, mode, autoSpeed, lock }
// -> false | { auto, skip; mode: "normal" | "auto" at the start; autoSpeed; lock: the player keeps mode and autoSpeed }
export function messageModeConfig(value) {
  if (value === false) return false;
  const v = value && typeof value === "object" ? value : {};
  const auto = bool(v.auto, true);
  return {
    auto,
    skip: bool(v.skip, true),
    mode: auto && v.mode === "auto" ? "auto" : "normal",
    autoSpeed: AUTO_SPEEDS.includes(v.autoSpeed) ? v.autoSpeed : "normal",
    lock: bool(v.lock, false),
  };
}

// alwaysDash: false | true | { on, lock }
// -> false | { on: true | false | null (the game's own default), lock: keeps it at `on` }
export function alwaysDashConfig(value) {
  if (value === false) return false;
  const v = value && typeof value === "object" ? value : {};
  const on = typeof v.on === "boolean" ? v.on : null;
  return { on, lock: on !== null && v.lock === true };
}

// saveTools: false | true | { export, import, delete } -> false | { export, import, delete }
export function saveToolsConfig(value) {
  if (value === false) return false;
  const v = value && typeof value === "object" ? value : {};
  const out = { export: bool(v.export, true), import: bool(v.import, true), delete: bool(v.delete, true) };
  return out.export || out.import || out.delete ? out : false;
}

// RWK_Core's config. engine: "MZ" | "MV"; gameConfig: after applyPolicy().
// Without the game's files (update-from-link) MV's `media` is left out: the
// Worker keeps the deployed build's. Never holds the players' emails.
export function runtimeConfigOf(engine, gameConfig) {
  gameConfig = withPreset(gameConfig);
  return {
    version: TOOLKIT_VERSION,
    gameId: storageIdOf(gameConfig),
    engine,
    sync: { enabled: !!(gameConfig.sync && gameConfig.sync.enabled) },
    controls: gameConfig.controls || null,
    saveTools: saveToolsConfig(gameConfig.saveTools),
    itemBatch: gameConfig.itemBatch !== false,
    fastForward: fastForwardConfig(gameConfig.fastForward),
    messageMode: messageModeConfig(gameConfig.messageMode),
    alwaysDash: alwaysDashConfig(gameConfig.alwaysDash),
    backlog: backlogConfig(gameConfig.backlog),
    quickSave: quickSaveConfig(gameConfig.quickSave),
    autoSave: autoSaveConfig(gameConfig.autoSave),
    saveHistory: saveHistoryConfig(gameConfig.saveHistory),
    cheats: cheatsConfig(gameConfig.cheats),
    cache: gameConfig.cache !== false,
  };
}

// Per-player settings for the Worker: { [userHash(email)]: { key: runtime value } },
// only the keys that differ from everyone's. cfg: as stored; policy: readPolicy()'s.
export function playerOverrides(engine, cfg, policy) {
  const base = runtimeConfigOf(engine, applyPolicy(cfg, policy));
  const out = {};
  for (const email of playerEmails(cfg)) {
    const mine = runtimeConfigOf(engine, applyPolicy(withPlayer(cfg, email), policy));
    const diff = {};
    for (const key of FEATURE_KEYS) if (JSON.stringify(mine[key]) !== JSON.stringify(base[key])) diff[key] = mine[key];
    if (Object.keys(diff).length) out[userHash(email)] = diff;
  }
  return out;
}

// Folders whose files the Service Worker keeps, and the biggest file it keeps
// (iOS limits what a site may store).
const CACHED_DIRS = /^(img|audio|effects|data|fonts|movies|js)\//;
export const CACHE_MAX_FILE_BYTES = 25 * 1024 * 1024;

// rwk-sw.js with the list of cacheable files; a file's version changes
// whenever its size or modified time does. generated: rels the toolkit writes
// itself (js/plugins.js…), whose version is not the game file's.
export function serviceWorkerSource(files, generated = new Set()) {
  const manifest = {};
  for (const f of [...files].sort((a, b) => (a.rel < b.rel ? -1 : 1))) {
    if (CACHED_DIRS.test(f.rel) && !generated.has(f.rel) && f.size <= CACHE_MAX_FILE_BYTES) manifest[f.rel] = `${f.size}-${f.mtimeMs}`;
  }
  const json = JSON.stringify(manifest);
  const buildId = crypto.createHash("sha256").update(json).digest("hex").slice(0, 12);
  return fs
    .readFileSync(path.join(TOOLKIT_ROOT, "runtime", "rwk-sw.js"), "utf8")
    .replace("/*RWK_MANIFEST*/ {}", () => json)
    .replace("/*RWK_BUILD_ID*/", buildId);
}

// The runtime plugins' sources: { name: source }
export function runtimeSources() {
  return Object.fromEntries(RUNTIME_PLUGINS.map((name) => [name, fs.readFileSync(path.join(TOOLKIT_ROOT, "runtime", `${name}.js`), "utf8")]));
}

// Files the toolkit adds to / overrides in the web build.
// files: from collectFiles(), for the MV phone audio / movie check.
export function generatedFiles(game, gameConfig, files = []) {
  const out = new Map();
  const runtimeConfig = runtimeConfigOf(game.engine, gameConfig);
  if (game.engine === "MV") {
    const missing = mobileOnlyMissing(files);
    runtimeConfig.media = { oggOnly: missing.audio > 0, webmOnly: missing.movies > 0 };
  }

  for (const [name, source] of Object.entries(runtimeSources())) out.set(`js/plugins/${name}.js`, source);

  const pluginsJs = fs.readFileSync(resolveCI(game.root, "js", "plugins.js"), "utf8");
  out.set("js/plugins.js", appendToolkit(pluginsJs, RUNTIME_PLUGINS, runtimeConfig));

  if (runtimeConfig.cache) out.set("rwk-sw.js", serviceWorkerSource(files, new Set(out.keys())));

  // Lets the game's creator, and anyone reading a bug report, tell this
  // build apart from an official release.
  const indexable = isIndexable(gameConfig);
  const indexHtml = fs.readFileSync(resolveCI(game.root, "index.html"), "utf8");
  if (!indexHtml.includes("rwk.webmanifest")) {
    const head =
      '<link rel="manifest" href="rwk.webmanifest">\n' +
      '<meta name="mobile-web-app-capable" content="yes">\n' +
      '<meta name="theme-color" content="#000000">\n' +
      '<meta name="generator" content="rpgmaker-web-toolkit">\n' +
      (indexable ? "" : '<meta name="robots" content="noindex, nofollow">\n');
    out.set("index.html", indexHtml.replace(/<\/head>/i, `${head}</head>`));
  }
  // Static asset responses never reach the Worker, so the header comes from
  // the assets' _headers file.
  out.set("robots.txt", indexable ? "User-agent: *\nAllow: /\n" : "User-agent: *\nDisallow: /\n");
  if (!indexable) out.set("_headers", "/*\n  X-Robots-Tag: noindex, nofollow\n");
  const iconExists = fs.existsSync(resolveCI(game.root, "icon", "icon.png"));
  out.set(
    "rwk.webmanifest",
    JSON.stringify(
      {
        name: game.title,
        short_name: game.title.slice(0, 24),
        start_url: "./",
        display: "fullscreen",
        orientation: "landscape",
        background_color: "#000000",
        theme_color: "#000000",
        icons: iconExists ? [{ src: "icon/icon.png", sizes: "any", type: "image/png" }] : [],
      },
      null,
      2
    )
  );
  return out;
}
