// Inspects an RPG Maker MZ/MV game folder and decides which files make up
// the web build. Never writes into the game folder.

import fs from "node:fs";
import path from "node:path";

// Top-level folders a browser build needs.
const WEB_DIRS = new Set(["audio", "css", "data", "effects", "fonts", "icon", "img", "js", "movies"]);
const WEB_DIR_PATTERNS = [/^data[-_].+/i]; // translated data, e.g. data-en
// NW.js runtime / desktop-only content: skipped without asking.
const RUNTIME_DIRS = new Set(["locales", "swiftshader", "save", "log", "logs", "gameupdate", "node_modules", "www", "lib"]);

export const DEFAULT_EXCLUDES = ["**/.*", "**/Thumbs.db", "**/desktop.ini", "**/*.zip", "**/*.rar", "**/*.7z", "**/*.psd", "**/*.bak", "**/*.log"];

export function analyzeGame(inputPath) {
  const given = path.resolve(inputPath);
  if (!fs.existsSync(given)) throw new Error(`Folder not found: ${given}`);
  const root = [given, path.join(given, "www")].find(
    (dir) => fs.existsSync(path.join(dir, "index.html")) && fs.existsSync(path.join(dir, "js"))
  );
  if (!root) throw new Error(`No index.html + js/ in ${given} (or ${given}\\www). Is this an RPG Maker MZ/MV game?`);

  let engine;
  if (fs.existsSync(path.join(root, "js", "rmmz_core.js"))) engine = "MZ";
  else if (fs.existsSync(path.join(root, "js", "rpg_core.js"))) engine = "MV";
  else throw new Error("Unknown engine (neither js/rmmz_core.js nor js/rpg_core.js found).");

  const system = readJson(path.join(root, "data", "System.json"));
  const title = system.gameTitle || path.basename(given);
  const gameId = system.advanced && system.advanced.gameId;
  const fingerprint = engine === "MZ" && gameId ? `mz:${gameId}` : `${engine.toLowerCase()}:${title}`;

  const unknownDirs = [];
  for (const entry of fs.readdirSync(root, { withFileTypes: true })) {
    if (!entry.isDirectory() || entry.name.startsWith(".")) continue;
    if (isWebDir(entry.name) || RUNTIME_DIRS.has(entry.name.toLowerCase())) continue;
    unknownDirs.push(entry.name);
  }

  return {
    folder: given,
    folderName: path.basename(given),
    root,
    engine,
    title,
    fingerprint,
    unknownDirs,
    saveDir: findSaveDir(given, root, engine),
  };
}

function isWebDir(name) {
  return WEB_DIRS.has(name.toLowerCase()) || WEB_DIR_PATTERNS.some((re) => re.test(name));
}

function findSaveDir(folder, root, engine) {
  const ext = engine === "MZ" ? ".rmmzsave" : ".rpgsave";
  for (const dir of [path.join(root, "save"), path.join(folder, "save")]) {
    if (fs.existsSync(dir) && fs.readdirSync(dir).some((f) => f.endsWith(ext))) return dir;
  }
  return null;
}

export function readJson(file) {
  return JSON.parse(fs.readFileSync(file, "utf8").replace(/^﻿/, ""));
}

// Lists every file of the web build: { rel (posix), abs, size, mtimeMs }.
export function collectFiles(game, { include = [], exclude = [] } = {}) {
  const excluded = compileGlobs([...DEFAULT_EXCLUDES, ...exclude]);
  const included = compileGlobs(include.filter((p) => /[*?]/.test(p)));
  const extraTop = new Set(include.filter((p) => !/[*?/]/.test(p)));
  const files = [];

  const walk = (dirAbs, dirRel) => {
    for (const entry of fs.readdirSync(dirAbs, { withFileTypes: true })) {
      const abs = path.join(dirAbs, entry.name);
      const rel = dirRel ? `${dirRel}/${entry.name}` : entry.name;
      if (entry.isDirectory()) {
        walk(abs, rel);
      } else if (entry.isFile()) {
        if (excluded(rel) && !included(rel)) continue;
        const st = fs.statSync(abs);
        files.push({ rel, abs, size: st.size, mtimeMs: Math.floor(st.mtimeMs) });
      }
    }
  };

  for (const entry of fs.readdirSync(game.root, { withFileTypes: true })) {
    const abs = path.join(game.root, entry.name);
    if (entry.isDirectory()) {
      if (isWebDir(entry.name) || extraTop.has(entry.name)) walk(abs, entry.name);
    } else if (entry.isFile() && (entry.name === "index.html" || extraTop.has(entry.name))) {
      const st = fs.statSync(abs);
      files.push({ rel: entry.name, abs, size: st.size, mtimeMs: Math.floor(st.mtimeMs) });
    }
  }
  return files;
}

// Paths with non-ASCII characters (Chinese, Japanese, accented letters…).
// They often work, but a name saved in another Unicode form or encoded
// differently by a plugin is a common cause of a missing picture or sound.
export function nonAsciiPaths(files) {
  return files.map((f) => f.rel).filter((rel) => /[^\x20-\x7e]/.test(rel));
}

// Minimal glob: "**" crosses folders, "*" and "?" stay within one segment.
// Patterns without "/" match the file name anywhere.
export function compileGlobs(patterns) {
  const regexes = patterns.map((p) => {
    const pattern = p.includes("/") ? p : `**/${p}`;
    let re = "";
    for (let i = 0; i < pattern.length; i++) {
      const ch = pattern[i];
      if (ch === "*" && pattern[i + 1] === "*") {
        re += pattern[i + 2] === "/" ? "(?:.*/)?" : ".*";
        i += pattern[i + 2] === "/" ? 2 : 1;
      } else if (ch === "*") re += "[^/]*";
      else if (ch === "?") re += "[^/]";
      else re += ch.replace(/[.+^${}()|[\]\\]/g, "\\$&");
    }
    // Every metacharacter is escaped above and patterns come from the user's own config.
    // nosemgrep: javascript.lang.security.audit.detect-non-literal-regexp.detect-non-literal-regexp
    return new RegExp(`^${re}$`, "i");
  });
  return (rel) => regexes.some((re) => re.test(rel));
}

export function suggestSlug(game) {
  const base = game.folderName
    .replace(/[([{（【].*?[)\]}）】]/g, " ") // bracketed tags: (Team01), [VH]
    .replace(/\bv?\d+(\.\d+)+\w*\b/gi, " ") // versions: v1.292
    .replace(/\b(VH|Viet ?hoa|eng|english|full|final)\b/gi, " ");
  return toSlug(base) || toSlug(game.title) || "rpg-game";
}

export function toSlug(text) {
  return text
    .normalize("NFKD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/đ/gi, "d")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 40)
    .replace(/-+$/g, "");
}

export function validateSlug(slug) {
  if (!/^[a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?$/.test(slug)) {
    return "Use lowercase a-z, digits and '-' only, not starting or ending with '-' (max 63 characters).";
  }
  return null;
}
