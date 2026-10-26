// The guided editor behind `rwk config`: the same settings as the JSON,
// changed by answering questions. It covers what most creators change (features,
// on-screen buttons, cloud saves, files, cache); the rest stays in the JSON,
// one menu entry away, and keys the questions do not know are left as they are.
//
// io = { ask, confirm, choose } (ui.js); tests pass scripted ones.

import { DEFAULT_PRESET, PRESETS, withPreset } from "./features.js";
import * as ui from "./ui.js";

const isObject = (v) => !!v && typeof v === "object" && !Array.isArray(v);
const yesNo = (on) => (on ? "on" : "off");
const BACK = { label: "Back", value: "back" };

// Feature keys as the config takes them: false = off, absent / true = on with the
// defaults, an object = on with limits. fields: the limits asked about (def = the
// toolkit's default); number: the key takes a plain number instead.
export const FEATURES = [
  {
    key: "fastForward",
    label: "Fast forward",
    fields: [
      { key: "maxSpeed", ask: "Top speed (2 to 4)", int: [2, 4], def: 4 },
      { key: "inBattle", ask: "Allow it in battles?", def: true },
    ],
  },
  {
    key: "messageMode",
    label: "Message modes (Auto, Skip)",
    fields: [
      { key: "auto", ask: "Offer Auto?", def: true },
      { key: "skip", ask: "Offer Skip?", def: true },
    ],
  },
  { key: "alwaysDash", label: "Always dash", fields: [{ key: "on", ask: "Run by default for players who never chose?", def: false }] },
  { key: "backlog", label: "Messages log", number: { ask: "How many messages to keep (10 to 500)", int: [10, 500], def: 100 } },
  { key: "quickSave", label: "Quick save / load", fields: [{ key: "ignoreSaveLock", ask: "Allow it where the game disallows saving?", def: true }] },
  { key: "autoSave", label: "Autosave", fields: [{ key: "minutes", ask: "Save every how many minutes (1 to 60)?", int: [1, 60], def: 5 }] },
  {
    key: "saveHistory",
    label: "Older saves",
    fields: [
      { key: "keep", ask: "Copies kept per save (1 to 50)", int: [1, 50], def: 10 },
      { key: "days", ask: "Days to keep them (1 to 365)", int: [1, 365], def: 30 },
    ],
  },
  {
    key: "saveTools",
    label: "Save export / import / delete (⚙ → Saves)",
    fields: [
      { key: "export", ask: "Let players export their saves?", def: true },
      { key: "import", ask: "Let players import saves?", def: true },
      { key: "delete", ask: "Let players delete saves?", def: true },
    ],
  },
  { key: "itemBatch", label: "Using several items at once", fields: [] },
  {
    key: "cheats",
    label: "Cheats",
    offByDefault: true,
    fields: [
      { key: "party", ask: "Party: heal, god mode, level?", def: true },
      { key: "items", ask: "Gold and items?", def: true },
      { key: "battle", ask: "Win a battle at once?", def: true },
      { key: "switches", ask: "Switches and variables?", def: true },
      { key: "movement", ask: "Walk through walls, teleport?", def: true },
    ],
  },
];

const intCheck = ([min, max]) => (v) => (/^\d+$/.test(v) && +v >= min && +v <= max ? null : `Enter a whole number from ${min} to ${max}`);
const numCheck = (min, max) => (v) => (v !== "" && !Number.isNaN(Number(v)) && +v >= min && +v <= max ? null : `Enter a number from ${min} to ${max}`);

async function askField(io, field, current) {
  if (field.int) return Number(await io.ask(field.ask, String(current), intCheck(field.int)));
  return io.confirm(field.ask, current);
}

// What a feature is set to once the preset is under the config's own keys.
function featureState(cfg, f) {
  const value = withPreset(cfg)[f.key];
  if (value === false) return { on: false, values: {} };
  if (value === undefined) return { on: !f.offByDefault, values: {} };
  if (f.number) return { on: true, values: { value: typeof value === "number" ? value : f.number.def } };
  return { on: true, values: isObject(value) ? value : {} };
}

function describeFeature(cfg, f) {
  const { on, values } = featureState(cfg, f);
  if (!on) return "off";
  const changed = f.number
    ? values.value !== undefined && values.value !== f.number.def ? [`${values.value}`] : []
    : f.fields.filter((x) => values[x.key] !== undefined && values[x.key] !== x.def).map((x) => `${x.key} ${typeof values[x.key] === "boolean" ? yesNo(values[x.key]) : values[x.key]}`);
  return changed.length ? `on (${changed.join(", ")})` : "on";
}

async function editFeature(cfg, f, io) {
  const state = featureState(cfg, f);
  if (!(await io.confirm(`${f.label}: available to players?`, state.on))) {
    cfg[f.key] = false;
    return;
  }
  const presetValue = (PRESETS[cfg.preset] || PRESETS[DEFAULT_PRESET]).values[f.key];
  const keep = isObject(cfg[f.key]) ? { ...cfg[f.key] } : {};
  if (f.number) {
    if (await io.confirm("Change the default?", false)) {
      const n = Number(await io.ask(f.number.ask, String(state.values.value ?? f.number.def), intCheck(f.number.int)));
      if (n === f.number.def) delete cfg[f.key];
      else cfg[f.key] = n;
    } else if (cfg[f.key] === false) delete cfg[f.key];
    return;
  }
  if (f.fields.length && (await io.confirm("Change its details?", false))) {
    for (const field of f.fields) {
      const now = state.values[field.key] ?? field.def;
      const value = await askField(io, field, now);
      // A preset that already sets the field needs the answer written down even when it is the default.
      if (value === field.def && !(isObject(presetValue) && field.key in presetValue)) delete keep[field.key];
      else keep[field.key] = value;
    }
  }
  if (Object.keys(keep).length) cfg[f.key] = keep;
  else if (f.offByDefault) cfg[f.key] = true;
  else delete cfg[f.key];
}

async function featuresMenu(cfg, io) {
  for (;;) {
    const presetNames = Object.keys(PRESETS);
    const preset = PRESETS[cfg.preset] ? cfg.preset : DEFAULT_PRESET;
    const options = [
      { label: `Starting point: ${preset} (${PRESETS[preset].label.split(":")[0]})`, value: "preset" },
      ...FEATURES.map((f) => ({ label: `${f.label}: ${describeFeature(cfg, f)}`, value: f })),
      BACK,
    ];
    const pick = await io.choose("Which feature do you want to change?", options, options.length - 1);
    if (pick === "back") return;
    if (pick === "preset") {
      cfg.preset = await io.choose(
        "Starting point for the features (the choices you make below sit on top of it):",
        presetNames.map((name) => ({ label: PRESETS[name].label, value: name })),
        presetNames.indexOf(preset)
      );
    } else await editFeature(cfg, pick, io);
  }
}

function describeButtons(controls) {
  if (!controls.enabled) return "off";
  const extra = (controls.buttons || []).length;
  return `on, shown on ${controls.showOn || "touch"}${extra ? `, ${extra} extra key button(s)` : ""}`;
}

async function editButtons(controls, io) {
  controls.buttons ||= [];
  for (;;) {
    const options = [
      ...controls.buttons.map((b, i) => ({ label: `${b.label || b.key} (key ${b.key})${b.hint ? ` — ${b.hint}` : ""}`, value: i })),
      { label: "Add a button", value: "add" },
      BACK,
    ];
    const pick = await io.choose("Key buttons in the ⌨ panel (pick one to rename or remove it):", options, options.length - 1);
    if (pick === "back") return;
    if (pick === "add") {
      const key = await io.ask("Key to press (for example Tab, F5, Shift)", "", (v) => (v ? null : "Enter a key name"));
      const label = await io.ask("Button label", key);
      const hint = await io.ask("What is it for? (optional)", "-");
      controls.buttons.push({ key, label, ...(hint !== "-" ? { hint } : {}) });
      continue;
    }
    const button = controls.buttons[pick];
    const action = await io.choose(`${button.label || button.key}:`, [
      { label: "Rename", value: "rename" },
      { label: "Remove", value: "remove" },
      BACK,
    ], 2);
    if (action === "rename") button.label = await io.ask("New label", button.label || button.key);
    else if (action === "remove") controls.buttons.splice(pick, 1);
  }
}

async function controlsMenu(cfg, io) {
  cfg.controls ||= { enabled: false, showOn: "touch", gamepad: true, dpad: true, opacity: 0.35, scale: 1, buttons: [], scannedKeys: [] };
  const controls = cfg.controls;
  for (;;) {
    const options = [
      { label: `On-screen buttons: ${describeButtons(controls)}`, value: "enabled" },
      { label: `Show them on: ${controls.showOn || "touch"}`, value: "showOn" },
      { label: `D-pad: ${yesNo(controls.dpad !== false)}`, value: "dpad" },
      { label: `Opacity: ${controls.opacity ?? 0.35}`, value: "opacity" },
      { label: `Size: ${controls.scale ?? 1}`, value: "scale" },
      { label: `Key buttons (${(controls.buttons || []).length})`, value: "buttons" },
      BACK,
    ];
    const pick = await io.choose("What do you want to change?", options, options.length - 1);
    if (pick === "back") return;
    if (pick === "enabled") controls.enabled = await io.confirm("Show an on-screen gamepad?", !!controls.enabled);
    else if (pick === "showOn") {
      controls.showOn = await io.choose("When are the buttons shown?", [
        { label: "On touch screens only", value: "touch" },
        { label: "Always (also with a mouse)", value: "always" },
        { label: "Never", value: "never" },
      ], ["touch", "always", "never"].indexOf(controls.showOn || "touch"));
    } else if (pick === "dpad") controls.dpad = await io.confirm("Include the D-pad? (No = move by tapping the map only)", controls.dpad !== false);
    else if (pick === "opacity") controls.opacity = Number(await io.ask("Opacity, 0 (invisible) to 1", String(controls.opacity ?? 0.35), numCheck(0, 1)));
    else if (pick === "scale") controls.scale = Number(await io.ask("Size multiplier (0.5 to 3)", String(controls.scale ?? 1), numCheck(0.5, 3)));
    else await editButtons(controls, io);
  }
}

// A list of patterns (exclude / include).
async function editPatterns(cfg, key, text, io) {
  for (;;) {
    const list = cfg[key] || [];
    const options = [...list.map((p, i) => ({ label: `${p}  (remove)`, value: i })), { label: "Add a pattern", value: "add" }, BACK];
    const pick = await io.choose(`${text} (pick one to remove it):`, options, options.length - 1);
    if (pick === "back") return;
    if (pick === "add") {
      const pattern = await io.ask('Pattern, for example "data-tw/**" or "*.txt"', "", (v) => (v ? null : "Enter a pattern"));
      if (!list.includes(pattern)) cfg[key] = [...list, pattern];
    } else cfg[key] = list.filter((_, i) => i !== pick);
  }
}

async function filesMenu(cfg, io) {
  for (;;) {
    const options = [
      { label: `Leave files out: ${(cfg.exclude || []).length} pattern(s)`, value: "exclude" },
      { label: `Publish extra folders / files: ${(cfg.include || []).length} pattern(s)`, value: "include" },
      BACK,
    ];
    const pick = await io.choose("Files in the web build (a new deploy applies the change):", options, 2);
    if (pick === "back") return;
    if (pick === "exclude") await editPatterns(cfg, "exclude", "Files left out", io);
    else await editPatterns(cfg, "include", "Extra folders / files published", io);
  }
}

// -> the edited copy of cfg; null when the person quit without saving.
// editJson: opens the raw JSON (the caller's editor) and returns the new config.
export async function guidedEdit(source, { io = ui, editJson } = {}) {
  let cfg = structuredClone(source);
  const snapshot = () => JSON.stringify(cfg);
  const original = snapshot();
  for (;;) {
    const public_ = cfg.auth && cfg.auth.mode === "none";
    const options = [
      { label: "Features players can use (fast forward, quick save, cheats…)", value: "features" },
      { label: `On-screen buttons for touch screens: ${describeButtons(cfg.controls || {})}`, value: "controls" },
      { label: `Cloud save sync: ${yesNo(!cfg.sync || cfg.sync.enabled !== false)}`, value: "sync" },
      { label: "Files in the web build (leave out, add)", value: "files" },
      { label: `Browser cache of pictures and sounds: ${yesNo(cfg.cache !== false)}`, value: "cache" },
      ...(public_ ? [{ label: `Search engines may list the site: ${yesNo(!!cfg.indexable)}`, value: "indexable" }] : []),
      ...(editJson ? [{ label: "Advanced: edit the JSON in a text editor", value: "json" }] : []),
      { label: "Save and finish", value: "save" },
      { label: "Quit without saving", value: "quit" },
    ];
    const changed = snapshot() !== original;
    const pick = await io.choose("What do you want to change?", options, options.findIndex((o) => o.value === (changed ? "save" : "features")));
    if (pick === "features") await featuresMenu(cfg, io);
    else if (pick === "controls") await controlsMenu(cfg, io);
    else if (pick === "sync") cfg.sync = { ...cfg.sync, enabled: await io.confirm("Sync saves in the cloud (continue on other devices)?", cfg.sync?.enabled !== false) };
    else if (pick === "files") await filesMenu(cfg, io);
    else if (pick === "cache") {
      if (await io.confirm("Let browsers keep the game's pictures and sounds between launches? (faster start)", cfg.cache !== false)) delete cfg.cache;
      else cfg.cache = false;
    } else if (pick === "indexable") cfg.indexable = await io.confirm("Let search engines list the site?", !!cfg.indexable);
    else if (pick === "json") cfg = await editJson(cfg);
    else if (pick === "save") return cfg;
    else if (!changed || (await io.confirm("Quit and lose your changes?", false))) return null;
  }
}
