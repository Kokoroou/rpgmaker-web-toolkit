// Two tiers of settings for the toolkit's in-game features. The deployer
// picks, per feature, false (off), true (on, toolkit defaults) or an object
// (on, with their own limits and defaults; "lock": true leaves the player no
// choice). Players then choose within those bounds, in their browser.
//
//   preset   a starting point picked at the first deploy; the keys written
//            in the config sit on top of it
//   players  { "<email>": { <key>: value } }: the same keys for one player,
//            on top of everything else (the creator's policy still wins)

export const PRESETS = {
  comfortable: {
    label: "Comfortable: every convenience on (playing alone or with family)",
    values: {},
  },
  original: {
    label: "Original experience: no fast forward in battles, no Skip, no quick save where the game disallows saving, no save import",
    values: {
      fastForward: { inBattle: false },
      messageMode: { skip: false },
      quickSave: { ignoreSaveLock: false },
      saveTools: { import: false },
    },
  },
  shared: {
    label: "Shared with others: no save export / import, no download for offline, fewer older saves (saves R2 space)",
    values: {
      saveTools: { export: false, import: false },
      offline: false,
      saveHistory: { keep: 5, days: 14 },
    },
  },
};
export const DEFAULT_PRESET = "comfortable";

// A game's config with the first-deploy defaults. Deploy asks for slug, include, sync and preset;
// the dry run takes the defaults as they are.
export function baseConfig(game, { slug, include = [], syncEnabled = true, preset = DEFAULT_PRESET } = {}) {
  return {
    slug,
    title: game.title,
    engine: game.engine,
    fingerprint: game.fingerprint,
    include,
    exclude: [],
    sync: { enabled: syncEnabled },
    preset,
    auth: {},
    controls: {
      enabled: false,
      showOn: "touch",
      gamepad: true,
      shoulder: false,
      dpad: true,
      opacity: 0.2,
      scale: 1,
      buttons: [],
      scannedKeys: [],
    },
  };
}

// Keys a preset or a player's entry may set.
export const FEATURE_KEYS = ["fastForward", "messageMode", "alwaysDash", "backlog", "remap", "quickSave", "autoSave", "saveHistory", "saveTools", "itemBatch", "cheats", "offline", "translate"];

const isObject = (v) => !!v && typeof v === "object" && !Array.isArray(v);

// An object on top of an object adds to it; anything else replaces it.
export function mergeSetting(base, over) {
  if (over === undefined) return base;
  return isObject(base) && isObject(over) ? { ...base, ...over } : over;
}

// cfg with its preset underneath the keys it sets itself.
export function withPreset(cfg) {
  const preset = PRESETS[cfg.preset] || PRESETS[DEFAULT_PRESET];
  const out = { ...cfg };
  for (const [key, value] of Object.entries(preset.values)) out[key] = mergeSetting(value, cfg[key]);
  return out;
}

const normalizeEmail = (email) => String(email).trim().toLowerCase();

// The players entry for one email (case does not matter), or null.
export function playerEntry(cfg, email) {
  if (!isObject(cfg.players)) return null;
  const wanted = normalizeEmail(email);
  const found = Object.entries(cfg.players).find(([key]) => normalizeEmail(key) === wanted);
  return found && isObject(found[1]) ? found[1] : null;
}

// cfg as one player gets it, before the creator's policy is applied.
export function withPlayer(cfg, email) {
  const entry = playerEntry(cfg, email);
  if (!entry) return cfg;
  const base = withPreset(cfg);
  const out = { ...base };
  for (const key of FEATURE_KEYS) out[key] = mergeSetting(base[key], entry[key]);
  return out;
}

export const playerEmails = (cfg) => (isObject(cfg.players) ? Object.keys(cfg.players) : []);

// -> problems with preset / players, worded for the deploy log
export function checkFeatureConfig(cfg) {
  const problems = [];
  if (cfg.preset !== undefined && !PRESETS[cfg.preset]) {
    problems.push(`Unknown "preset" ${JSON.stringify(cfg.preset)} (use ${Object.keys(PRESETS).map((p) => `"${p}"`).join(", ")}); using "${DEFAULT_PRESET}".`);
  }
  if (cfg.players === undefined) return problems;
  if (!isObject(cfg.players)) return [...problems, `"players" must be an object of { "<email>": { … } }; ignored.`];
  for (const [email, entry] of Object.entries(cfg.players)) {
    if (!/^[^@\s]+@[^@\s]+$/.test(email.trim())) problems.push(`"players": "${email}" is not an email address; ignored.`);
    else if (!isObject(entry)) problems.push(`"players": the settings for ${email} must be an object; ignored.`);
    else {
      const unknown = Object.keys(entry).filter((key) => !FEATURE_KEYS.includes(key));
      if (unknown.length) problems.push(`"players": ${unknown.join(", ")} cannot be set per player (${email}); ignored. Per player: ${FEATURE_KEYS.join(", ")}.`);
    }
  }
  return problems;
}
