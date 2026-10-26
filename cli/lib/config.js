// Per-game configs live in R2 (see loadGameConfigs in cloudflare.js), so the
// toolkit itself can run from a throwaway folder. The only local state is the
// chosen Cloudflare account, kept next to wrangler's own login in the profile,
// and the last downloaded free plan limits (see limits.js).

import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { stateDir } from "./platform.js";

export const TOOLKIT_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..");
const STATE_DIR = stateDir({ home: os.homedir() });
const SETTINGS_FILE = path.join(STATE_DIR, "settings.json");
export const LIMITS_CACHE_FILE = path.join(STATE_DIR, "limits.json");

export const DEFAULT_BUCKET = "rpgmaker-web-toolkit";

export function loadSettings() {
  return readJsonFile(SETTINGS_FILE) || {};
}

export function saveSettings(settings) {
  writeJsonFile(SETTINGS_FILE, settings);
}

// A fresh staging folder per run, removed on exit. It must sit on the game's
// drive so the 8k+ game files can be hard-linked instead of copied.
export function createBuildDir(gameRoot, slug) {
  const tmp = os.tmpdir();
  const gameDrive = path.parse(path.resolve(gameRoot)).root.toLowerCase();
  const bases = path.parse(tmp).root.toLowerCase() === gameDrive ? [tmp] : [path.join(gameDrive, ".rwk-build"), tmp];
  for (const base of bases) {
    try {
      fs.mkdirSync(base, { recursive: true });
      const dir = fs.mkdtempSync(path.join(base, `${slug}-`));
      process.on("exit", () => removeBuildDir(dir, base !== tmp ? base : null));
      return dir;
    } catch {
      // Drive root not writable: fall back to the temp folder (copies).
    }
  }
  throw new Error("Could not create a temporary build folder.");
}

function removeBuildDir(dir, base) {
  try {
    // Only unlinks the hard links; the game's own files stay untouched.
    fs.rmSync(dir, { recursive: true, force: true, maxRetries: 3 });
    if (base && !fs.readdirSync(base).length) fs.rmdirSync(base);
  } catch {
    // Best effort; a locked file (e.g. workerd on Ctrl+C) leaves a temp folder.
  }
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
