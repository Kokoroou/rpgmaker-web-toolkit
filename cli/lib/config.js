// Per-game configs live in R2 (see loadGameConfigs in cloudflare.js), so the
// toolkit itself can run from a throwaway folder. The only local state is the
// login profiles (each a wrangler auth profile with the account chosen in it),
// and the last downloaded free plan limits (see limits.js).
//
// settings.json:
//   { "profile": "work",                       the profile runs use without --profile
//     "profiles": {
//       "default": { "accountId": "…", "accountName": "…", "email": "…" },
//       "work":    { … } } }
// (before profiles it was { "accountId": "…" }: read as the default profile's)

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

//---------------------------------------------------------------------------
// Login profiles
//---------------------------------------------------------------------------

// The profile of a first run, and of every run that names none: the login made before profiles existed.
export const DEFAULT_PROFILE = "default";

export function validateProfileName(name) {
  if (!/^[a-z0-9]([a-z0-9-]{0,30}[a-z0-9])?$/.test(String(name))) {
    return "Use lowercase a-z, digits and '-' only, not starting or ending with '-' (max 32 characters).";
  }
  return null;
}

// The wrangler auth profile behind a toolkit profile. The default one keeps the
// name it had before profiles, so an existing login stays logged in.
export const wranglerProfileOf = (name) => (name === DEFAULT_PROFILE ? "rpgmaker-web-toolkit" : `rpgmaker-web-toolkit-${name}`);

// Any content of settings.json (null when missing) -> { profile, profiles }
export function normalizeState(raw) {
  const state = { profile: DEFAULT_PROFILE, profiles: {} };
  if (!raw || typeof raw !== "object") return state;
  if (raw.profiles && typeof raw.profiles === "object") {
    for (const [name, entry] of Object.entries(raw.profiles)) {
      if (!validateProfileName(name) && entry && typeof entry === "object") state.profiles[name] = { ...entry };
    }
  } else if (raw.accountId) {
    state.profiles[DEFAULT_PROFILE] = { accountId: raw.accountId };
  }
  if (typeof raw.profile === "string" && state.profiles[raw.profile]) state.profile = raw.profile;
  return state;
}

export const loadState = (file = SETTINGS_FILE) => normalizeState(readJsonFile(file));
export const saveState = (state, file = SETTINGS_FILE) => writeJsonFile(file, state);

// --profile for this run: wins over the saved choice, and is not saved.
let profileFlag = null;
export function setProfileFlag(value) {
  profileFlag = value || null;
}

// The profile this run uses -> { name, from: "--profile" | "saved" | "default" }
export function activeProfile({ flag = profileFlag, state } = {}) {
  if (flag) return { name: flag, from: "--profile" };
  const { profile } = state || loadState();
  return profile === DEFAULT_PROFILE ? { name: DEFAULT_PROFILE, from: "default" } : { name: profile, from: "saved" };
}

// The settings of the profile this run uses ({ accountId, accountName, email }, each may be missing).
export function loadSettings(name = activeProfile().name, file = SETTINGS_FILE) {
  return { ...(loadState(file).profiles[name] || {}) };
}

// Merges into that profile's settings; the other profiles stay as they are.
export function saveSettings(settings, name = activeProfile().name, file = SETTINGS_FILE) {
  const state = loadState(file);
  state.profiles[name] = { ...(state.profiles[name] || {}), ...settings };
  saveState(state, file);
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
