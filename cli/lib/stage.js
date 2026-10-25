// Builds <build dir>/public: hard links to the game's files (falls back to
// copies across drives) plus generated files. Generated files are always
// written after unlinking the destination so a hard link can never write
// through to the original game folder.

import fs from "node:fs";
import path from "node:path";
import { TOOLKIT_ROOT } from "./config.js";
import { mobileOnlyMissing, storageIdOf } from "./game.js";
import { isIndexable } from "./policy.js";
import { appendToolkit } from "../../worker/toolkit.js";

export const RUNTIME_PLUGINS = ["RWK_Core", "RWK_SaveSync", "RWK_MobileControls", "RWK_SafeSaves", "RWK_Speed", "RWK_Message", "RWK_Dash", "RWK_SaveTools", "RWK_SaveHistory", "RWK_ItemBatch", "RWK_Report"];

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

// saveHistory: false | true | { keep, days } -> false | { keep: 1..50, default 10; days: 1..365, default 30 }
// The Worker enforces it (RWK_SAVE_HISTORY); the ⚙ menu only shows the entry.
export function saveHistoryConfig(value) {
  if (value === false) return false;
  const keep = Math.round(Number(value && value.keep));
  const days = Math.round(Number(value && value.days));
  return { keep: keep >= 1 ? Math.min(50, keep) : 10, days: days >= 1 ? Math.min(365, days) : 30 };
}

// RWK_Core's config. engine: "MZ" | "MV"; gameConfig: after applyPolicy().
// Without the game's files (update-from-link) MV's `media` is left out: the
// Worker keeps the deployed build's.
export function runtimeConfigOf(engine, gameConfig) {
  return {
    version: TOOLKIT_VERSION,
    gameId: storageIdOf(gameConfig),
    engine,
    sync: { enabled: !!(gameConfig.sync && gameConfig.sync.enabled) },
    controls: gameConfig.controls || null,
    saveTools: gameConfig.saveTools !== false,
    itemBatch: gameConfig.itemBatch !== false,
    fastForward: gameConfig.fastForward !== false,
    messageMode: gameConfig.messageMode !== false,
    alwaysDash: gameConfig.alwaysDash !== false,
    quickSave: quickSaveConfig(gameConfig.quickSave),
    autoSave: autoSaveConfig(gameConfig.autoSave),
    saveHistory: saveHistoryConfig(gameConfig.saveHistory),
  };
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

  const pluginsJs = fs.readFileSync(path.join(game.root, "js", "plugins.js"), "utf8");
  out.set("js/plugins.js", appendToolkit(pluginsJs, RUNTIME_PLUGINS, runtimeConfig));

  // Lets the game's creator, and anyone reading a bug report, tell this
  // build apart from an official release.
  const indexable = isIndexable(gameConfig);
  const indexHtml = fs.readFileSync(path.join(game.root, "index.html"), "utf8");
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
  const iconExists = fs.existsSync(path.join(game.root, "icon", "icon.png"));
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
