// Finds keyboard keys used by the game's enabled plugins that a phone cannot
// press, to suggest on-screen buttons.

import fs from "node:fs";
import path from "node:path";

// Already reachable by touch in MZ/MV (tap, two-finger cancel, built-in buttons).
const TOUCH_COVERED = new Set(["ok", "cancel", "up", "down", "left", "right", "menu", "debug", "control", "tab", "shift"]);

// Pressed by the on-screen gamepad in RWK_MobileControls (A/B/X/Y, L/R).
export const GAMEPAD_KEYS = new Set(["ok", "cancel", "escape", "menu", "shift", "pageup", "pagedown"]);

export function readPlugins(root) {
  const file = path.join(root, "js", "plugins.js");
  const src = fs.readFileSync(file, "utf8");
  const start = src.indexOf("[");
  const end = src.lastIndexOf("]");
  if (start < 0 || end < start) throw new Error("Could not parse js/plugins.js");
  return JSON.parse(src.slice(start, end + 1));
}

// -> [{ key, plugins: [names], hint, count }] sorted by usage
export function scanKeys(root) {
  const found = new Map();
  for (const plugin of readPlugins(root)) {
    if (!plugin.status) continue;
    const file = path.join(root, "js", "plugins", `${plugin.name}.js`);
    if (!fs.existsSync(file)) continue;
    const code = stripComments(fs.readFileSync(file, "utf8"));
    const patterns = [
      /Input\.is(?:Triggered|Pressed|Repeated|LongPressed)\(\s*['"]([A-Za-z0-9_]+)['"]\s*\)/g,
      /Input\.keyMapper\[\s*\d+\s*\]\s*=\s*['"]([A-Za-z0-9_]+)['"]/g,
    ];
    for (const re of patterns) {
      for (const m of code.matchAll(re)) {
        const key = m[1];
        if (TOUCH_COVERED.has(key.toLowerCase())) continue;
        const item = found.get(key) || { key, plugins: new Set(), hint: pluginHint(plugin), count: 0 };
        item.plugins.add(plugin.name);
        item.count++;
        found.set(key, item);
      }
    }
  }
  return [...found.values()]
    .map((i) => ({ ...i, plugins: [...i.plugins] }))
    .sort((a, b) => b.count - a.count || a.key.localeCompare(b.key));
}

export function stripComments(code) {
  // Good enough for plugin sources: drops /* */ blocks and // line comments
  // that are not part of a URL ("http://").
  return code.replace(/\/\*[\s\S]*?\*\//g, "").replace(/(^|[^:\\'"])\/\/.*$/gm, "$1");
}

// What a key is for, as far as we can tell: the description of the plugin
// that reads it, else the plugin's name.
export function pluginHint(plugin) {
  const hint = cleanHint(plugin.description) || plugin.name;
  return hint.length > 32 ? hint.slice(0, 31) + "…" : hint;
}

// Drops the version and author around a plugin description: "[v1.2] Quest
// journal", "v1.0.0 FlyCat-<Quest journal>" -> "Quest journal".
export function cleanHint(text) {
  const s = String(text || "")
    .replace(/^\s*(?:[[【(（][^\]】)）]*[\]】)）]\s*)+/, "")
    .replace(/^\s*v?\d+(?:\.\d+)+\s*/i, "")
    .trim();
  const wrapped = s.match(/^[^<>]*<([^<>]+)>$/);
  return wrapped ? wrapped[1].trim() : s;
}

export function defaultLabel(key) {
  const known = { escape: "Back", pageup: "Prev page", pagedown: "Next page" };
  return known[key.toLowerCase()] || key.toUpperCase();
}
