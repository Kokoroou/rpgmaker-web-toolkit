// Per-game config lives in games/<slug>.json (commit it so other machines
// reuse the same answers). Per-machine settings live in .rwk/settings.json.

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

export const TOOLKIT_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..");
export const GAMES_DIR = path.join(TOOLKIT_ROOT, "games");
export const BUILD_DIR = path.join(TOOLKIT_ROOT, ".build");
const SETTINGS_FILE = path.join(TOOLKIT_ROOT, ".rwk", "settings.json");

export const DEFAULT_BUCKET = "rpgmaker-web-toolkit";

export function findGameConfig(fingerprint) {
  if (!fs.existsSync(GAMES_DIR)) return null;
  for (const file of fs.readdirSync(GAMES_DIR)) {
    if (!file.endsWith(".json")) continue;
    const cfg = readJsonFile(path.join(GAMES_DIR, file));
    if (cfg && cfg.fingerprint === fingerprint) return cfg;
  }
  return null;
}

export function gameConfigExists(slug) {
  return fs.existsSync(gameConfigPath(slug));
}

export function gameConfigPath(slug) {
  return path.join(GAMES_DIR, `${slug}.json`);
}

export function saveGameConfig(cfg) {
  writeJsonFile(gameConfigPath(cfg.slug), cfg);
}

export function loadSettings() {
  return readJsonFile(SETTINGS_FILE) || {};
}

export function saveSettings(settings) {
  writeJsonFile(SETTINGS_FILE, settings);
}

function readJsonFile(file) {
  try {
    return JSON.parse(fs.readFileSync(file, "utf8"));
  } catch {
    return null;
  }
}

function writeJsonFile(file, data) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, JSON.stringify(data, null, 2) + "\n");
}
