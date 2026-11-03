//=============================================================================
// RWK_Remap.js - rpgmaker-web-toolkit
// Required Notice: Copyright 2026 Trương Tuấn Anh (https://github.com/Kokoroou)
// License: PolyForm Noncommercial 1.0.0 with the Game Creators permission,
// https://github.com/Kokoroou/rpgmaker-web-toolkit/blob/main/LICENSE
// Remap keys and gamepad buttons (⚙ → Keys and buttons). The engine's own
// maps (Input.keyMapper, Input.gamepadMapper) are edited in place, so the
// game and its plugins see the new keys like any other. The player's choices
// are kept on this device; Reset puts back what the game started with.
// Nothing runs per frame outside the panel.
//=============================================================================
/*:
 * @target MZ MV
 * @plugindesc [rpgmaker-web-toolkit] Remap keyboard keys and gamepad buttons. Requires RWK_Core.
 * @author rpgmaker-web-toolkit
 */

(() => {
  "use strict";

  const RWK = window.RWK;
  if (!RWK || !RWK.config.remap) return;

  // The deployer's choice (cli/lib/stage.js: remapConfig).
  const cfg = RWK.config.remap;
  const DEVICES = [cfg.keyboard !== false && "key", cfg.gamepad !== false && "pad"].filter(Boolean);
  if (!DEVICES.length) return;

  // What a key or button can do. A keyboard's Esc is both cancel and menu.
  const ACTIONS = {
    key: [
      ["ok", "OK / confirm"],
      ["escape", "Cancel / menu"],
      ["shift", "Dash"],
      ["pageup", "Previous page"],
      ["pagedown", "Next page"],
    ],
    pad: [
      ["ok", "OK / confirm"],
      ["cancel", "Cancel / back"],
      ["menu", "Menu"],
      ["shift", "Dash"],
      ["pageup", "Previous page (L)"],
      ["pagedown", "Next page (R)"],
    ],
  };
  const MAPPERS = { key: () => Input.keyMapper, pad: () => Input.gamepadMapper };
  const STORE_KEY = "rwk.remap." + RWK.config.gameId;
  const DIRECTIONS = ["up", "down", "left", "right"];
  const F1 = 112; // opens the ⚙ menu

  //---------------------------------------------------------------------------
  // Pure part: overrides ({ action: code | null }) on top of the game's map.
  // null = the action has no key. A code goes to one action only.
  //---------------------------------------------------------------------------

  function buildMap(defaults, overrides) {
    const map = { ...defaults };
    const wanted = Object.entries(overrides || {});
    for (const [action] of wanted) for (const code of Object.keys(map)) if (map[code] === action) delete map[code];
    for (const [action, code] of wanted) if (code !== null && code !== undefined) map[code] = action;
    return map;
  }

  // overrides after `action` takes `code`: another action holding it loses it.
  function assign(overrides, action, code) {
    const out = { ...overrides };
    for (const other of Object.keys(out)) if (out[other] === code) out[other] = null;
    out[action] = code;
    return out;
  }

  // Keys a player may not take: whatever the game maps to a direction, and
  // F1 (the ⚙ menu).
  function isReserved(device, code, defaults) {
    if (device === "key" && code === F1) return true;
    return DIRECTIONS.includes(defaults[code]);
  }

  // Only what this site lets the player change, and only known actions.
  function clean(raw) {
    const out = {};
    for (const device of DEVICES) {
      const mine = raw && raw[device] && typeof raw[device] === "object" ? raw[device] : {};
      out[device] = {};
      for (const [action] of ACTIONS[device]) {
        const code = mine[action];
        if (code === null || (Number.isInteger(code) && code >= 0 && code < 256)) out[device][action] = code;
      }
    }
    return out;
  }

  const KEY_NAMES = {
    8: "Backspace", 9: "Tab", 13: "Enter", 16: "Shift", 17: "Ctrl", 18: "Alt", 19: "Pause", 20: "Caps Lock", 27: "Esc", 32: "Space",
    33: "Page Up", 34: "Page Down", 35: "End", 36: "Home", 37: "Left", 38: "Up", 39: "Right", 40: "Down", 45: "Insert", 46: "Delete",
    186: ";", 187: "=", 188: ",", 189: "-", 190: ".", 191: "/", 192: "`", 219: "[", 220: "\\", 221: "]", 222: "'",
  };
  const PAD_NAMES = ["A", "B", "X", "Y", "LB", "RB", "LT", "RT", "Back", "Start", "L3", "R3"];

  function label(device, code) {
    if (device === "pad") return `Button ${code}${PAD_NAMES[code] ? ` (${PAD_NAMES[code]})` : ""}`;
    if (KEY_NAMES[code]) return KEY_NAMES[code];
    if ((code >= 48 && code <= 57) || (code >= 65 && code <= 90)) return String.fromCharCode(code);
    if (code >= 96 && code <= 105) return "Numpad " + (code - 96);
    if (code >= 112 && code <= 123) return "F" + (code - 111);
    return "Key " + code;
  }

  //---------------------------------------------------------------------------
  // State: the game's own maps (taken now, after its plugins) and the choices.
  //---------------------------------------------------------------------------

  const defaults = { key: { ...Input.keyMapper }, pad: { ...Input.gamepadMapper } };
  let overrides = clean(RWK.storage.get(STORE_KEY));

  function apply() {
    for (const device of DEVICES) {
      const target = MAPPERS[device]();
      for (const code of Object.keys(target)) delete target[code];
      Object.assign(target, buildMap(defaults[device], overrides[device]));
    }
    Input.clear();
  }

  function save() {
    RWK.storage.set(STORE_KEY, overrides);
    apply();
  }

  // The codes an action answers to now, e.g. [13, 32, 90] for OK.
  const codesOf = (device, action) =>
    Object.keys(MAPPERS[device]())
      .filter((code) => MAPPERS[device]()[code] === action)
      .map(Number);
  const customized = () => DEVICES.some((d) => Object.keys(overrides[d]).length);

  apply();

  //---------------------------------------------------------------------------
  // Panel. The game is paused while it is open, as for the messages log.
  //---------------------------------------------------------------------------

  let overlay = null;
  let restoreUpdate = null;
  let capturing = null; // { stop }

  function injectStyle() {
    if (document.getElementById("rwk-remap-style")) return;
    const style = document.createElement("style");
    style.id = "rwk-remap-style";
    style.textContent = `
.rwk-remap{max-width:520px;display:flex;flex-direction:column;max-height:min(90vh,720px)}
.rwk-remap-body{flex:1;min-height:0;overflow:auto;margin:0 0 14px;-webkit-overflow-scrolling:touch;overscroll-behavior:contain}
.rwk-remap h3{margin:12px 0 4px;font-size:14px;opacity:.8}
.rwk-remap-row{display:flex;align-items:center;gap:10px;min-height:44px;border-bottom:1px solid #333}
.rwk-remap-row span{flex:1}
.rwk-remap-row small{display:block;opacity:.7}
.rwk-remap-row button{font:inherit;min-height:40px;min-width:100px;padding:6px 12px;border-radius:8px;border:1px solid #555;background:#2b2b31;color:#eee;cursor:pointer}
.rwk-remap-row.rwk-listening button{background:#3b6fd8;border-color:#fff}
.rwk-remap-row.rwk-none small{color:#ff9a9a;opacity:1}
.rwk-remap-note{margin:10px 0 0;font-size:13px;opacity:.75;white-space:normal}
`;
    document.head.appendChild(style);
  }

  function describe(device, action) {
    const codes = codesOf(device, action);
    return codes.length ? codes.map((c) => label(device, c)).join(", ") : "none";
  }

  function stopCapture() {
    if (capturing) capturing.stop();
    capturing = null;
  }

  function startCapture(device, action) {
    stopCapture();
    const done = (code) => {
      stopCapture();
      if (code !== null) {
        if (isReserved(device, code, defaults[device])) {
          RWK.toast(`${label(device, code)} cannot be used here.`, "warn", 2500);
        } else {
          overrides[device] = assign(overrides[device], action, code);
          save();
        }
      }
      render();
    };
    if (device === "key") {
      const onKey = (e) => {
        e.preventDefault();
        e.stopPropagation();
        if (e.repeat || ["Shift", "Control", "Alt", "Meta"].includes(e.key)) return;
        done(e.key === "Escape" ? null : e.keyCode);
      };
      window.addEventListener("keydown", onKey, true);
      capturing = { stop: () => window.removeEventListener("keydown", onKey, true) };
    } else {
      // The first button that goes down after the panel started listening.
      const pressed = () => {
        const pads = (navigator.getGamepads && navigator.getGamepads()) || [];
        const set = new Set();
        for (const pad of pads) if (pad && pad.connected) pad.buttons.forEach((b, i) => b.pressed && set.add(i));
        return set;
      };
      let before = pressed();
      let raf = 0;
      const tick = () => {
        const now = pressed();
        const fresh = [...now].find((i) => !before.has(i));
        before = now;
        if (fresh !== undefined) done(fresh);
        else raf = requestAnimationFrame(tick);
      };
      raf = requestAnimationFrame(tick);
      capturing = { stop: () => cancelAnimationFrame(raf) };
    }
    render(device, action);
  }

  function render(listenDevice, listenAction) {
    if (!overlay) return;
    const box = overlay.firstChild;
    box.textContent = "";
    const h = document.createElement("h2");
    h.textContent = "Keys and buttons";
    const body = document.createElement("div");
    body.className = "rwk-remap-body";
    for (const device of DEVICES) {
      const title = document.createElement("h3");
      title.textContent = device === "key" ? "Keyboard" : "Gamepad";
      body.appendChild(title);
      for (const [action, text] of ACTIONS[device]) {
        const listening = listenDevice === device && listenAction === action;
        const now = describe(device, action);
        const row = document.createElement("div");
        row.className = "rwk-remap-row" + (listening ? " rwk-listening" : "") + (now === "none" ? " rwk-none" : "");
        const name = document.createElement("span");
        name.textContent = text;
        const small = document.createElement("small");
        small.textContent = listening ? (device === "key" ? "Press a key (Esc to cancel)" : "Press a button on the gamepad") : now === "none" ? "No key: change it or reset" : now;
        name.appendChild(small);
        const change = document.createElement("button");
        change.textContent = listening ? "Cancel" : "Change";
        change.addEventListener("click", () => {
          if (listening) {
            stopCapture();
            render();
          } else startCapture(device, action);
        });
        row.append(name, change);
        body.appendChild(row);
      }
    }
    const note = document.createElement("p");
    note.className = "rwk-remap-note";
    note.textContent = "A key or button does one thing. The arrows and F1 stay as they are. Kept on this device.";
    body.appendChild(note);
    const actions = document.createElement("div");
    actions.className = "rwk-modal-actions";
    const reset = document.createElement("button");
    reset.textContent = "Reset to defaults";
    reset.disabled = !customized();
    reset.addEventListener("click", () => {
      stopCapture();
      overrides = clean(null);
      save();
      render();
    });
    const closeBtn = document.createElement("button");
    closeBtn.className = "primary";
    closeBtn.textContent = "Close";
    closeBtn.addEventListener("click", close);
    actions.append(reset, closeBtn);
    box.append(h, body, actions);
  }

  function isReady() {
    const scene = SceneManager._scene;
    return DataManager.isDatabaseLoaded() && scene && !(scene instanceof Scene_Boot);
  }

  function open() {
    if (overlay) return;
    if (!isReady()) {
      RWK.toast("Wait until the game has finished loading.", "warn", 2500);
      return;
    }
    injectStyle();
    overlay = document.createElement("div");
    overlay.className = "rwk-modal";
    const box = document.createElement("div");
    box.className = "rwk-modal-box rwk-remap";
    box.setAttribute("role", "dialog");
    box.setAttribute("aria-label", "Keys and buttons");
    overlay.appendChild(box);
    overlay.addEventListener("click", (e) => e.target === overlay && close());
    RWK.shield(overlay);
    document.body.appendChild(overlay);
    render();

    const _updateScene = SceneManager.updateScene;
    SceneManager.updateScene = function () {};
    restoreUpdate = () => (SceneManager.updateScene = _updateScene);
  }

  function close() {
    if (!overlay) return;
    stopCapture();
    overlay.remove();
    overlay = null;
    if (restoreUpdate) restoreUpdate();
    restoreUpdate = null;
    Input.clear();
    if (window.TouchInput) TouchInput.clear();
  }

  // While open (and not listening) the keys belong to the panel; Esc closes it.
  window.addEventListener(
    "keydown",
    (e) => {
      if (!overlay || capturing) return;
      if (e.key === "Escape") {
        e.preventDefault();
        close();
      }
      e.stopPropagation();
    },
    true
  );

  RWK.tools.add({
    icon: RWK.icons.keys,
    group: "controls",
    label: "Keys and buttons",
    detail: () => (customized() ? "Changed from the game's defaults" : "Choose which key or button does what"),
    onSelect: open,
  });

  RWK.remap = { buildMap, assign, clean, label, isReserved, overrides: () => JSON.parse(JSON.stringify(overrides)), open, close };
})();
