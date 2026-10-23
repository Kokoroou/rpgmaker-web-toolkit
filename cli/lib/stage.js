// Builds .build/<slug>/public: hard links to the game's files (falls back to
// copies across drives) plus generated files. Generated files are always
// written after unlinking the destination so a hard link can never write
// through to the original game folder.

import fs from "node:fs";
import path from "node:path";
import { TOOLKIT_ROOT } from "./config.js";

export const RUNTIME_PLUGINS = ["RWK_Core", "RWK_SaveSync", "RWK_MobileControls"];

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

// Files the toolkit adds to / overrides in the web build.
export function generatedFiles(game, gameConfig) {
  const out = new Map();
  const runtimeConfig = {
    gameId: gameConfig.slug,
    engine: game.engine,
    sync: { enabled: !!(gameConfig.sync && gameConfig.sync.enabled) },
    controls: gameConfig.controls || null,
  };

  for (const name of RUNTIME_PLUGINS) {
    out.set(`js/plugins/${name}.js`, fs.readFileSync(path.join(TOOLKIT_ROOT, "runtime", `${name}.js`)));
  }

  const pluginsJs = fs.readFileSync(path.join(game.root, "js", "plugins.js"), "utf8");
  const entries = RUNTIME_PLUGINS.map((name) => ({
    name,
    status: true,
    description: "[rpgmaker-web-toolkit]",
    parameters: name === "RWK_Core" ? { config: JSON.stringify(runtimeConfig) } : {},
  }));
  out.set(
    "js/plugins.js",
    `${pluginsJs.replace(/\s*$/, "")}\n\n// ---- rpgmaker-web-toolkit (web build only) ----\n` +
      entries.map((e) => `$plugins.push(${JSON.stringify(e)});`).join("\n") +
      "\n"
  );

  const indexHtml = fs.readFileSync(path.join(game.root, "index.html"), "utf8");
  if (!indexHtml.includes("rwk.webmanifest")) {
    const head =
      '<link rel="manifest" href="rwk.webmanifest">\n' +
      '<meta name="mobile-web-app-capable" content="yes">\n' +
      '<meta name="theme-color" content="#000000">\n';
    out.set("index.html", indexHtml.replace(/<\/head>/i, `${head}</head>`));
  }
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
