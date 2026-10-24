// The game creator's wishes about web hosting, read from an optional
// `rwk-policy.json` the creator ships with the game. The toolkit honours it;
// it is a courtesy between the creator and the player, not DRM.
//
//   {
//     "hosting": "personal" | "shared" | "public" | "none",
//     "features": { "saveTools": false, "itemBatch": false, "fastForward": false, "sync": false },
//     "message": "Shown to whoever publishes the game",
//     "contact": "https://example.com/contact"
//   }

import fs from "node:fs";
import path from "node:path";

export const POLICY_FILE = "rwk-policy.json";
export const HOSTING_LEVELS = ["none", "personal", "shared", "public"];
// Features a policy can force off, mapped to how the game config spells them.
const FEATURE_KEYS = ["saveTools", "itemBatch", "fastForward", "sync"];

// -> null (no policy file) | { hosting, features, message, contact, file, problems }
export function readPolicy(game) {
  const file = [game.root, game.folder].map((dir) => path.join(dir, POLICY_FILE)).find((f) => fs.existsSync(f));
  if (!file) return null;
  let raw;
  try {
    raw = JSON.parse(fs.readFileSync(file, "utf8").replace(/^﻿/, ""));
  } catch (err) {
    // The creator clearly meant to say something: assume the strictest level
    // that still lets the owner play.
    return { hosting: "personal", features: {}, message: "", contact: "", file, problems: [`invalid JSON (${err.message})`] };
  }
  return parsePolicy(raw, file);
}

export function parsePolicy(raw, file = POLICY_FILE) {
  const problems = [];
  const obj = raw && typeof raw === "object" && !Array.isArray(raw) ? raw : {};
  let hosting = obj.hosting;
  if (!HOSTING_LEVELS.includes(hosting)) {
    problems.push(hosting === undefined ? `"hosting" is missing` : `unknown "hosting" value ${JSON.stringify(hosting)}`);
    hosting = "personal";
  }
  const features = {};
  for (const [key, value] of Object.entries(obj.features || {})) {
    if (FEATURE_KEYS.includes(key) && value === false) features[key] = false;
  }
  return {
    hosting,
    features,
    message: typeof obj.message === "string" ? obj.message.trim() : "",
    contact: typeof obj.contact === "string" ? obj.contact.trim() : "",
    file,
    problems,
  };
}

// No policy: the deployer answers for themselves.
export function allowsPublic(policy) {
  return !policy || policy.hosting === "public";
}

// The config the build uses: the creator's "false" always wins over the
// deployer's settings, so edit-config cannot turn a feature back on.
export function applyPolicy(cfg, policy) {
  if (!policy) return cfg;
  const out = { ...cfg };
  if (policy.features.saveTools === false) out.saveTools = false;
  if (policy.features.itemBatch === false) out.itemBatch = false;
  if (policy.features.fastForward === false) out.fastForward = false;
  if (policy.features.sync === false) out.sync = { ...cfg.sync, enabled: false };
  return out;
}

// Search engines may list the site only when it is public for a stated
// reason and the deployer asked for it.
export function isIndexable(cfg) {
  return !!(cfg.auth && cfg.auth.mode === "none" && cfg.auth.basis && cfg.indexable === true);
}

export function describeHosting(hosting) {
  return {
    none: "does not allow publishing this game as a website",
    personal: "allows a web copy for your own use only (do not invite other people)",
    shared: "allows a web copy you share with a few people you invite",
    public: "allows publishing this game as a public website",
  }[hosting];
}
