//=============================================================================
// RWK_MobileControls.js - rpgmaker-web-toolkit
// On-screen buttons for keys a touch screen cannot press. Works on MZ and MV
// by driving Input._currentState, the same state the keyboard handler sets.
//=============================================================================
/*:
 * @target MZ MV
 * @plugindesc [rpgmaker-web-toolkit] Configurable touch buttons. Requires RWK_Core.
 * @author rpgmaker-web-toolkit
 */

(() => {
  "use strict";

  const RWK = window.RWK;
  const cfg = RWK && RWK.config.controls;
  if (!cfg || cfg.enabled === false || !cfg.buttons) return;

  const isTouch = window.matchMedia("(pointer: coarse)").matches || "ontouchstart" in window;
  if (cfg.showOn === "never" || (cfg.showOn !== "always" && !isTouch)) return;

  const LAYOUT_KEY = "rwk.layout." + RWK.config.gameId;
  const HIDDEN_KEY = "rwk.controlsHidden." + RWK.config.gameId;

  //---------------------------------------------------------------------------
  // Input injection
  //---------------------------------------------------------------------------

  // key -> { count, seen }. A press is held until Input.update has seen it at
  // least once, so a tap shorter than one frame still registers.
  const held = new Map();

  function keyName(key) {
    if (typeof key === "number") return Input.keyMapper[key] || "key" + key;
    return String(key);
  }

  function press(key) {
    const name = keyName(key);
    const h = held.get(name) || { count: 0, seen: false };
    h.count++;
    h.seen = false;
    held.set(name, h);
    Input._currentState[name] = true;
  }

  function release(key) {
    const name = keyName(key);
    const h = held.get(name);
    if (!h) return;
    h.count = Math.max(0, h.count - 1);
    if (h.count === 0 && h.seen) {
      Input._currentState[name] = false;
      held.delete(name);
    }
  }

  const _update = Input.update;
  Input.update = function () {
    _update.apply(this, arguments);
    for (const [name, h] of held) {
      h.seen = true;
      if (h.count === 0) {
        this._currentState[name] = false;
        held.delete(name);
      }
    }
  };

  const _clear = Input.clear;
  Input.clear = function () {
    _clear.apply(this, arguments);
    held.clear();
  };

  //---------------------------------------------------------------------------
  // DOM
  //---------------------------------------------------------------------------

  const scale = Number(cfg.scale) || 1;
  const style = document.createElement("style");
  style.textContent = `
.rwk-pad{position:fixed;inset:0;z-index:50;pointer-events:none;
  --rwk-size:calc(clamp(40px,11vmin,72px)*${scale});font:600 12px/1.1 system-ui,sans-serif;
  -webkit-user-select:none;user-select:none;-webkit-touch-callout:none}
.rwk-pad.hidden .rwk-btn:not(.rwk-tool-toggle),.rwk-pad.hidden .rwk-group-items{display:none}
.rwk-btn{position:absolute;pointer-events:auto;touch-action:none;box-sizing:border-box;
  width:var(--rwk-size);height:var(--rwk-size);border-radius:50%;
  display:flex;align-items:center;justify-content:center;text-align:center;padding:4px;overflow:hidden;
  color:#fff;background:rgba(20,20,28,${cfg.opacity ?? 0.5});border:2px solid rgba(255,255,255,.35);
  text-shadow:0 1px 2px #000;transform:translate(-50%,-50%);transition:background .08s}
.rwk-btn.on{background:rgba(90,140,255,.75);border-color:#fff}
.rwk-btn.rwk-tool{width:calc(var(--rwk-size)*.62);height:calc(var(--rwk-size)*.62);font-size:15px}
.rwk-pad.editing .rwk-btn{outline:2px dashed #ffd54a;outline-offset:2px}
.rwk-group-items{position:absolute;display:none;gap:8px;pointer-events:none}
.rwk-group-items.open{display:flex}
.rwk-group-items .rwk-btn{position:relative;transform:none}
`;
  document.head.appendChild(style);

  const pad = document.createElement("div");
  pad.className = "rwk-pad";
  // Stop every event from reaching the engine's document-level TouchInput.
  for (const type of ["touchstart", "touchmove", "touchend", "touchcancel", "mousedown", "mousemove", "mouseup", "click", "wheel", "contextmenu"]) {
    pad.addEventListener(
      type,
      (e) => {
        e.stopPropagation();
        if (type === "touchstart" || type === "contextmenu") e.preventDefault();
      },
      { passive: false }
    );
  }

  const saved = RWK.storage.get(LAYOUT_KEY, {});
  let editing = false;
  const positioned = []; // { el, id, def: {x,y} }

  function makeButton(label, extraClass) {
    const el = document.createElement("div");
    el.className = "rwk-btn" + (extraClass ? " " + extraClass : "");
    el.textContent = label;
    return el;
  }

  // Calls onDown/onUp for each pointer; in edit mode drags the button instead.
  function bindPointer(el, id, onDown, onUp) {
    const pointers = new Set();
    let drag = null;
    el.addEventListener("pointerdown", (e) => {
      e.preventDefault();
      e.stopPropagation();
      try {
        el.setPointerCapture(e.pointerId);
      } catch (err) {
        // Pointer already gone (very short taps): the press still counts.
      }
      if (editing && id) {
        drag = { pointerId: e.pointerId };
        return;
      }
      pointers.add(e.pointerId);
      el.classList.add("on");
      onDown();
    });
    el.addEventListener("pointermove", (e) => {
      if (!drag || drag.pointerId !== e.pointerId) return;
      place(el, { x: e.clientX / window.innerWidth, y: e.clientY / window.innerHeight });
    });
    const end = (e) => {
      if (drag && drag.pointerId === e.pointerId) {
        saved[id] = { x: e.clientX / window.innerWidth, y: e.clientY / window.innerHeight };
        drag = null;
        return;
      }
      if (!pointers.delete(e.pointerId)) return;
      if (!pointers.size) el.classList.remove("on");
      onUp();
    };
    el.addEventListener("pointerup", end);
    el.addEventListener("pointercancel", end);
    el.addEventListener("lostpointercapture", end);
  }

  function place(el, pos) {
    el.style.left = (pos.x * 100).toFixed(2) + "%";
    el.style.top = (pos.y * 100).toFixed(2) + "%";
  }

  // def may be a function so default slots follow viewport resizes.
  const resolve = (def) => (typeof def === "function" ? def() : def);

  function addPositioned(el, id, def) {
    positioned.push({ el, id, def });
    place(el, saved[id] || resolve(def));
    pad.appendChild(el);
  }

  //---------------------------------------------------------------------------
  // Default layout: a column of buttons along the right edge, bottom-up,
  // wrapping into further columns; optional d-pad bottom-left.
  //---------------------------------------------------------------------------

  const vw = () => window.innerWidth;
  const vh = () => window.innerHeight;
  const sizePx = () => Math.min(Math.max(40, Math.min(vw(), vh()) * 0.11), 72) * scale;

  function slot(index) {
    const s = sizePx() * 1.18;
    const perColumn = Math.max(1, Math.floor((vh() * 0.78) / s));
    const col = Math.floor(index / perColumn);
    const row = index % perColumn;
    return { x: (vw() - s * (0.62 + col)) / vw(), y: (vh() - s * (0.62 + row)) / vh() };
  }

  cfg.buttons.forEach((b, index) => {
    const id = b.id || (b.keys ? "group:" + (b.label || index) : "key:" + b.key);
    if (b.keys) {
      addGroup(b, id, index);
      return;
    }
    const el = makeButton(b.label || String(b.key).toUpperCase());
    bindPointer(el, id, () => press(b.key), () => release(b.key));
    addPositioned(el, id, b.pos || (() => slot(index)));
  });

  function addGroup(group, id, index) {
    const toggle = makeButton(group.label || "…", "rwk-group");
    const items = document.createElement("div");
    items.className = "rwk-group-items";
    for (const sub of group.keys) {
      const k = typeof sub === "object" ? sub.key : sub;
      const label = typeof sub === "object" && sub.label ? sub.label : String(k).toUpperCase();
      const el = makeButton(label);
      bindPointer(el, null, () => press(k), () => {
        release(k);
        if (group.closeOnPress !== false) items.classList.remove("open");
      });
      items.appendChild(el);
    }
    bindPointer(toggle, id, () => {}, () => {
      items.classList.toggle("open");
      positionGroup(toggle, items);
    });
    addPositioned(toggle, id, group.pos || (() => slot(index)));
    pad.appendChild(items);
  }

  function positionGroup(toggle, items) {
    const r = toggle.getBoundingClientRect();
    const left = r.left - 8 - items.offsetWidth;
    items.style.top = r.top + "px";
    items.style.left = Math.max(4, left) + "px";
  }

  if (cfg.dpad) {
    const s = sizePx() * 1.05;
    const cx = s * 1.6;
    const cy = vh() - s * 1.6;
    const dirs = [
      ["up", "▲", 0, -1],
      ["down", "▼", 0, 1],
      ["left", "◀", -1, 0],
      ["right", "▶", 1, 0],
    ];
    for (const [key, label, dx, dy] of dirs) {
      const el = makeButton(label);
      bindPointer(el, "dpad:" + key, () => press(key), () => release(key));
      addPositioned(el, "dpad:" + key, { x: (cx + dx * s) / vw(), y: (cy + dy * s) / vh() });
    }
  }

  //---------------------------------------------------------------------------
  // Toolbar (top-left): hide/show, fullscreen, edit layout
  //---------------------------------------------------------------------------

  const tools = [];
  function addTool(label, extraClass, onTap) {
    const el = makeButton(label, "rwk-tool " + extraClass);
    bindPointer(el, null, () => {}, onTap);
    tools.push(el);
    pad.appendChild(el);
    return el;
  }

  addTool("◐", "rwk-tool-toggle", () => {
    pad.classList.toggle("hidden");
    RWK.storage.set(HIDDEN_KEY, pad.classList.contains("hidden"));
  });
  if ((cfg.extras || ["fullscreen", "editLayout"]).includes("fullscreen")) {
    addTool("⛶", "rwk-tool-fs", toggleFullscreen);
  }
  if ((cfg.extras || ["fullscreen", "editLayout"]).includes("editLayout")) {
    const editBtn = addTool("✥", "rwk-tool-edit", () => {
      editing = !editing;
      pad.classList.toggle("editing", editing);
      editBtn.textContent = editing ? "✓" : "✥";
      if (!editing) {
        RWK.storage.set(LAYOUT_KEY, saved);
        RWK.toast("Button layout saved", "info", 1500);
      } else {
        RWK.toast("Drag buttons to move them. ↺ resets to default, ✓ saves.", "info", 4000);
      }
      resetBtn.style.display = editing ? "" : "none";
    });
    const resetBtn = addTool("↺", "rwk-tool-reset", () => {
      for (const key of Object.keys(saved)) delete saved[key];
      for (const p of positioned) place(p.el, resolve(p.def));
    });
    resetBtn.style.display = "none";
  }

  function layoutTools() {
    const s = sizePx() * 0.62;
    tools.forEach((el, i) => {
      el.style.left = s * 0.75 + i * (s + 8) + "px";
      el.style.top = s * 0.75 + "px";
    });
  }

  function toggleFullscreen() {
    const doc = document;
    const el = doc.documentElement;
    if (doc.fullscreenElement || doc.webkitFullscreenElement) {
      (doc.exitFullscreen || doc.webkitExitFullscreen).call(doc);
      return;
    }
    const request = el.requestFullscreen || el.webkitRequestFullscreen;
    if (!request) {
      RWK.toast("This browser has no fullscreen support. Use “Add to Home Screen” instead.", "warn", 4000);
      return;
    }
    Promise.resolve(request.call(el))
      .then(() => screen.orientation && screen.orientation.lock && screen.orientation.lock("landscape"))
      .catch(() => {});
  }

  if (RWK.storage.get(HIDDEN_KEY, false)) pad.classList.add("hidden");
  layoutTools();
  window.addEventListener("resize", () => {
    layoutTools();
    for (const p of positioned) if (!saved[p.id]) place(p.el, resolve(p.def));
  });

  document.body.appendChild(pad);
})();
