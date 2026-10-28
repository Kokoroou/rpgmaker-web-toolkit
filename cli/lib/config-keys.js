// One setting at a time, for scripts: `rwk config <target> --get <key>` and
// `--set <key>=<value>`. A key is a dotted path into the game's config
// ("cheats", "fastForward.maxSpeed", "controls.opacity"); a value is JSON when
// it reads as JSON (false, 3, {"skip":false}, null) and text otherwise.

import { UsageError } from "./ui.js";

// What the toolkit writes itself; neither --set nor the guided editor changes them.
export const IDENTITY_KEYS = ["slug", "fingerprint", "storageId", "retiredWorkers", "policy", "liveSettings", "toolkitVersion"];

const isObject = (v) => !!v && typeof v === "object" && !Array.isArray(v);

export function splitKey(key) {
  const parts = String(key ?? "").split(".");
  if (!key || parts.some((p) => !p)) throw new UsageError(`"${key ?? ""}" is not a setting name.`, { hint: 'Use a key such as cheats or fastForward.maxSpeed (dots go into an object).' });
  if (parts.some((p) => p === "__proto__" || p === "constructor" || p === "prototype")) throw new UsageError(`"${key}" is not a setting name.`);
  return parts;
}

// -> the value at key, or undefined when nothing is set there.
export function getSetting(cfg, key) {
  let node = cfg;
  for (const part of splitKey(key)) {
    // A list is read by position ("controls.buttons.0"), an object by name.
    if (Array.isArray(node) ? !/^\d+$/.test(part) : !isObject(node)) return undefined;
    if (!Object.hasOwn(node, part)) return undefined;
    node = node[part];
  }
  return node;
}

export function parseValue(text) {
  try {
    return JSON.parse(text);
  } catch {
    return text;
  }
}

// "key=value" -> [key, value]
export function parseAssignment(text) {
  const at = String(text).indexOf("=");
  if (at < 1) throw new UsageError(`--set needs key=value, got "${text}".`, { hint: "For example: --set cheats=false or --set fastForward.maxSpeed=3" });
  return [text.slice(0, at).trim(), parseValue(text.slice(at + 1))];
}

// A copy of cfg with value at key; null as the value removes the key (back to the default).
export function setSetting(cfg, key, value) {
  const parts = splitKey(key);
  if (IDENTITY_KEYS.includes(parts[0])) {
    throw new UsageError(`"${parts[0]}" is written by the toolkit and cannot be set.`, { hint: parts[0] === "slug" ? 'To change the site name: rwk rename "<game folder>" --to <new name>' : undefined });
  }
  const out = structuredClone(cfg);
  let node = out;
  for (const [i, part] of parts.slice(0, -1).entries()) {
    if (node[part] === undefined || node[part] === null || node[part] === true) {
      // true means "on with the defaults": an object of limits keeps it on.
      if (value === null) return out;
      node[part] = {};
    } else if (!isObject(node[part])) {
      throw new UsageError(`"${parts.slice(0, i + 1).join(".")}" is ${JSON.stringify(node[part])}, not an object, so "${key}" cannot be set.`, {
        hint: `Set "${parts.slice(0, i + 1).join(".")}" itself, e.g. --set ${parts.slice(0, i + 1).join(".")}='{"${parts[i + 1]}":…}'`,
      });
    }
    node = node[part];
  }
  const last = parts[parts.length - 1];
  if (value === null) delete node[last];
  else node[last] = value;
  return out;
}
