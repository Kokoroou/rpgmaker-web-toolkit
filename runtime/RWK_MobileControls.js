//=============================================================================
// RWK_MobileControls.js - rpgmaker-web-toolkit
// On-screen gamepad (D-pad, A/B/X/Y, L/R) plus a panel of extra keys the
// game's plugins use. Works on MZ and MV by driving Input._currentState, the
// same state the keyboard handler sets.
//=============================================================================
/*:
 * @target MZ MV
 * @plugindesc [rpgmaker-web-toolkit] Configurable touch gamepad. Requires RWK_Core.
 * @author rpgmaker-web-toolkit
 */

(() => {
  "use strict";

  const RWK = window.RWK;
  const cfg = RWK && RWK.config.controls;
  if (!cfg || cfg.enabled === false) return;

  const isTouch = window.matchMedia("(pointer: coarse)").matches || "ontouchstart" in window;
  if (cfg.showOn === "never" || (cfg.showOn !== "always" && !isTouch)) return;

  // v2: positions are anchored to the nearest corner and kept per orientation.
  const LAYOUT_KEY = "rwk.layout2." + RWK.config.gameId;
  const HIDDEN_KEY = "rwk.controlsHidden." + RWK.config.gameId;
  // Ids of single buttons the player hid in edit mode (e.g. an unused L/R).
  const OFF_KEY = "rwk.controlsOff." + RWK.config.gameId;

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
  // Buttons. The gamepad uses the logical keys RPG Maker itself maps a real
  // controller to (Input.gamepadMapper), so it behaves like one.
  //---------------------------------------------------------------------------

  const gamepadOn = cfg.gamepad !== false;
  const dpadOn = cfg.dpad !== false;
  const FACE = [
    { key: "ok", label: "A", hint: "OK", color: "#7ddc7d", dx: 0, dy: 1 },
    { key: "cancel", label: "B", hint: "Back", color: "#ff7b7b", dx: 1, dy: 0 },
    { key: "shift", label: "X", hint: "Dash", color: "#7fb0ff", dx: -1, dy: 0 },
    { key: "menu", label: "Y", hint: "Menu", color: "#ffd76a", dx: 0, dy: -1 },
  ];
  const SHOULDER = [
    { id: "shoulder:l", key: "pageup", label: "L", hint: "Prev", side: "l" },
    { id: "shoulder:r", key: "pagedown", label: "R", hint: "Next", side: "r" },
  ];
  // Keys the gamepad already presses; extra buttons for them would be duplicates.
  const GAMEPAD_KEYS = new Set(["ok", "cancel", "escape", "menu", "shift", "pageup", "pagedown"]);
  const extras = (cfg.buttons || []).filter((b) => b.keys || !gamepadOn || !GAMEPAD_KEYS.has(keyName(b.key)));
  // Plugin keys go in the ⌨ panel so they don't crowd the screen; groups,
  // pinned buttons, and every button when there is no gamepad stay on screen.
  const onScreen = (b) => b.keys || b.pin || b.pos || !gamepadOn;
  const panelKeys = extras.filter((b) => !onScreen(b));

  //---------------------------------------------------------------------------
  // DOM
  //---------------------------------------------------------------------------

  const scale = Number(cfg.scale) || 1;
  const opacity = cfg.opacity ?? 0.35;
  const style = document.createElement("style");
  style.textContent = `
.rwk-pad{position:fixed;inset:0;z-index:50;pointer-events:none;--u:48px;--bg:rgba(20,20,28,${opacity});
  color:rgba(255,255,255,.85);font:600 calc(var(--u)*.3)/1 system-ui,sans-serif;text-shadow:0 1px 2px #000;
  -webkit-user-select:none;user-select:none;-webkit-touch-callout:none;-webkit-tap-highlight-color:transparent}
.rwk-pad *{box-sizing:border-box}
.rwk-pad.hidden>:not(.rwk-tools),.rwk-pad.hidden .rwk-tool:not(.rwk-tool-toggle):not(.rwk-tool-more){display:none}
.rwk-item{position:absolute;transform:translate(-50%,-50%);transition:opacity .4s}
.rwk-pad.idle:not(.editing) .rwk-item,.rwk-pad.idle:not(.editing) .rwk-tools{opacity:.45}
.rwk-hit{pointer-events:auto;touch-action:none}
.rwk-btn{display:flex;align-items:center;justify-content:center;gap:.15em;text-align:center;overflow:hidden;
  background:var(--bg);border:2px solid rgba(255,255,255,.25);transition:background .08s}
.rwk-btn.on,.rwk-arm.on{background:rgba(90,140,255,.8);border-color:#fff}
.rwk-btn small{font-size:calc(var(--u)*.2);font-weight:500;opacity:.9}
.rwk-face{width:calc(var(--u)*3.32);height:calc(var(--u)*3.32)}
.rwk-face .rwk-btn{position:absolute;left:50%;top:50%;width:calc(var(--u)*1.12);height:calc(var(--u)*1.12);
  border-radius:50%;flex-direction:column;gap:1px}
.rwk-face .rwk-btn b{font-size:calc(var(--u)*.44)}
.rwk-shoulder{width:calc(var(--u)*1.8);height:calc(var(--u)*.82);border-radius:calc(var(--u)*.41)}
.rwk-shoulder b{font-size:calc(var(--u)*.36)}
.rwk-key{min-width:calc(var(--u)*1.2);height:calc(var(--u)*.9);padding:0 calc(var(--u)*.25);
  border-radius:calc(var(--u)*.2);white-space:nowrap;border-bottom-width:4px}
.rwk-dpad{width:calc(var(--u)*3);height:calc(var(--u)*3);border-radius:50%;background:rgba(20,20,28,${opacity * 0.45})}
.rwk-arm{position:absolute;width:34%;height:34%;display:flex;align-items:center;justify-content:center;
  background:var(--bg);border:2px solid rgba(255,255,255,.25);font-size:calc(var(--u)*.38)}
.rwk-arm.up{left:33%;top:3%;border-radius:22% 22% 0 0;border-bottom:0}
.rwk-arm.down{left:33%;bottom:3%;border-radius:0 0 22% 22%;border-top:0}
.rwk-arm.left{top:33%;left:3%;border-radius:22% 0 0 22%;border-right:0}
.rwk-arm.right{top:33%;right:3%;border-radius:0 22% 22% 0;border-left:0}
.rwk-arm.mid{left:33%;top:33%;border:0;width:34%;height:34%}
.rwk-tools{position:absolute;display:flex;gap:8px;transform:translate(-50%,-50%);transition:opacity .4s}
.rwk-tool{width:calc(var(--u)*.66);height:calc(var(--u)*.66);border-radius:50%;font-size:calc(var(--u)*.3)}
.rwk-tool svg{width:1.4em;height:1.4em;pointer-events:none}
.rwk-pad.editing .rwk-item{outline:2px dashed #ffd54a;outline-offset:3px}
.rwk-group-items{position:absolute;display:none;gap:8px;pointer-events:none}
.rwk-group-items.open{display:flex}
.rwk-panel{position:absolute;display:none;flex-direction:column;gap:8px;padding:10px;overflow:auto;
  width:max-content;max-width:calc(100vw - 16px);transform:translateX(-50%);pointer-events:auto;
  background:rgba(20,20,28,.88);border:1px solid rgba(255,255,255,.3);border-radius:12px}
.rwk-panel.open,.rwk-backdrop.open{display:flex}
.rwk-backdrop{position:absolute;inset:0;display:none;pointer-events:auto}
.rwk-panel-title{font-size:calc(var(--u)*.24);font-weight:500;opacity:.75;text-align:center}
.rwk-pad:not(.editing) .rwk-off{display:none}
.rwk-pad.editing .rwk-off{opacity:.35}
.rwk-badge{position:absolute;display:none;width:calc(var(--u)*.5);height:calc(var(--u)*.5);transform:translate(-50%,-50%);
  align-items:center;justify-content:center;border-radius:50%;background:#ffd54a;color:#000;text-shadow:none;
  font-size:calc(var(--u)*.36);line-height:1}
.rwk-pad.editing .rwk-badge{display:flex}
.rwk-panel-keys{display:flex;flex-wrap:wrap;gap:8px;justify-content:center}
.rwk-panel .rwk-key{flex-direction:column;height:auto;min-height:calc(var(--u)*1.1);max-width:calc(var(--u)*3);
  padding:calc(var(--u)*.12) calc(var(--u)*.2)}
.rwk-panel .rwk-key b{font-size:calc(var(--u)*.36)}
.rwk-panel .rwk-key small{white-space:normal;line-height:1.15;display:-webkit-box;-webkit-line-clamp:2;-webkit-box-orient:vertical}
@media (orientation:portrait){
  body.rwk-ctl #gameCanvas,body.rwk-ctl #gameVideo,body.rwk-ctl #UpperCanvas{bottom:var(--rwk-game-bottom,0px)!important}
}
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

  const vw = () => window.innerWidth;
  const vh = () => window.innerHeight;
  const orientation = () => (vh() > vw() ? "portrait" : "landscape");
  const clamp = (v, lo, hi) => Math.min(Math.max(v, lo), hi);
  const unit = () => clamp(Math.min(vw(), vh()) * (orientation() === "portrait" ? 0.13 : 0.14), 40, 72) * scale;

  const saved = RWK.storage.get(LAYOUT_KEY, {});
  const off = new Set(RWK.storage.get(OFF_KEY, []));
  let editing = false;
  const items = []; // { id, el, def: () => pos }; pos = { h: "l"|"r", x, v: "t"|"b", y } in px from that corner

  function el(tag, className, html) {
    const node = document.createElement(tag);
    node.className = className;
    if (html !== undefined) node.innerHTML = html;
    return node;
  }

  function text(value) {
    const span = document.createElement("span");
    span.textContent = value;
    return span.innerHTML;
  }

  function addItem(id, node, def) {
    node.classList.add("rwk-item");
    const item = { id, el: node, def };
    // In edit mode: − hides the button, + brings it back.
    item.badge = el("div", "rwk-badge");
    bindPress(item.badge, null, () => {}, () => {
      if (off.has(id)) off.delete(id);
      else off.add(id);
      layout();
    });
    items.push(item);
    pad.appendChild(node);
    pad.appendChild(item.badge);
    return item;
  }

  // On the item's top-right corner, kept on screen.
  function placeBadge(item) {
    const r = unit() * 0.25;
    const x = parseFloat(item.el.style.left) + item.el.offsetWidth / 2;
    const y = parseFloat(item.el.style.top) - item.el.offsetHeight / 2;
    item.badge.style.left = clamp(x, r, vw() - r) + "px";
    item.badge.style.top = clamp(y, r, vh() - r) + "px";
  }

  function place(node, pos) {
    const halfW = node.offsetWidth / 2;
    const halfH = node.offsetHeight / 2;
    const x = pos.h === "r" ? vw() - pos.x : pos.x;
    const y = pos.v === "b" ? vh() - pos.y : pos.y;
    node.style.left = clamp(x, halfW, vw() - halfW) + "px";
    node.style.top = clamp(y, halfH, vh() - halfH) + "px";
  }

  function toAnchor(x, y) {
    const h = x < vw() / 2 ? "l" : "r";
    const v = y < vh() / 2 ? "t" : "b";
    return { h, x: h === "l" ? x : vw() - x, v, y: v === "t" ? y : vh() - y };
  }

  // Press/release on each pointer; in edit mode drags `item` instead.
  function bindPress(node, item, onDown, onUp, onMove) {
    const pointers = new Set();
    let drag = null;
    node.classList.add("rwk-hit");
    node.addEventListener("pointerdown", (e) => {
      e.preventDefault();
      e.stopPropagation();
      try {
        node.setPointerCapture(e.pointerId);
      } catch (err) {
        // Pointer already gone (very short taps): the press still counts.
      }
      if (editing && item) {
        const r = item.el.getBoundingClientRect();
        drag = { pointerId: e.pointerId, dx: r.left + r.width / 2 - e.clientX, dy: r.top + r.height / 2 - e.clientY };
        return;
      }
      pointers.add(e.pointerId);
      node.classList.add("on");
      onDown(e);
    });
    node.addEventListener("pointermove", (e) => {
      if (drag && drag.pointerId === e.pointerId) {
        item.el.style.left = e.clientX + drag.dx + "px";
        item.el.style.top = e.clientY + drag.dy + "px";
        placeBadge(item);
        return;
      }
      if (onMove && pointers.has(e.pointerId)) onMove(e);
    });
    const end = (e) => {
      if (drag && drag.pointerId === e.pointerId) {
        const layout = (saved[orientation()] = saved[orientation()] || {});
        layout[item.id] = toAnchor(e.clientX + drag.dx, e.clientY + drag.dy);
        place(item.el, layout[item.id]);
        placeBadge(item);
        fitGame();
        drag = null;
        return;
      }
      if (!pointers.delete(e.pointerId)) return;
      if (!pointers.size) node.classList.remove("on");
      onUp(e);
    };
    node.addEventListener("pointerup", end);
    node.addEventListener("pointercancel", end);
    node.addEventListener("lostpointercapture", end);
  }

  //---------------------------------------------------------------------------
  // Default layout (px, recomputed on every resize):
  //   D-pad bottom-left, A/B/X/Y bottom-right, L/R above them.
  //   On-screen extra keys: portrait - centered rows above L/R; landscape -
  //   columns down the right edge.
  //---------------------------------------------------------------------------

  const margin = () => unit() * 0.3 + 8;
  const clusterHeight = () => Math.max(dpadOn ? unit() * 3 : 0, gamepadOn ? unit() * 3.32 : 0);
  const shoulderY = () => margin() + clusterHeight() + unit() * 0.75;

  //--- D-pad: one touch area, so a thumb can slide between directions.
  if (dpadOn) {
    const dpad = el(
      "div",
      "rwk-dpad",
      '<div class="rwk-arm up">▲</div><div class="rwk-arm down">▼</div><div class="rwk-arm left">◀</div>' +
        '<div class="rwk-arm right">▶</div><div class="rwk-arm mid"></div>'
    );
    const item = addItem("dpad", dpad, () => ({ h: "l", x: margin() + unit() * 1.5, v: "b", y: margin() + unit() * 1.5 }));
    let current = null;
    const setDir = (dir) => {
      if (dir === current) return;
      if (current) {
        release(current);
        dpad.querySelector(".rwk-arm." + current).classList.remove("on");
      }
      current = dir;
      if (dir) {
        press(dir);
        dpad.querySelector(".rwk-arm." + dir).classList.add("on");
      }
    };
    const dirAt = (e) => {
      const r = dpad.getBoundingClientRect();
      const dx = e.clientX - (r.left + r.width / 2);
      const dy = e.clientY - (r.top + r.height / 2);
      if (Math.hypot(dx, dy) < r.width * 0.12) return null;
      if (Math.abs(dx) > Math.abs(dy)) return dx > 0 ? "right" : "left";
      return dy > 0 ? "down" : "up";
    };
    bindPress(dpad, item, (e) => setDir(dirAt(e)), () => setDir(null), (e) => setDir(dirAt(e)));
  }

  //--- A/B/X/Y diamond
  if (gamepadOn) {
    const face = el("div", "rwk-face");
    const item = addItem("face", face, () => ({ h: "r", x: margin() + unit() * 1.66, v: "b", y: margin() + unit() * 1.66 }));
    face.style.pointerEvents = "none";
    for (const f of FACE) {
      const btn = el("div", "rwk-btn", `<b style="color:${f.color}">${f.label}</b><small>${f.hint}</small>`);
      btn.style.transform = `translate(calc(-50% + var(--u) * ${f.dx * 1.1}), calc(-50% + var(--u) * ${f.dy * 1.1}))`;
      bindPress(btn, item, () => press(f.key), () => release(f.key));
      face.appendChild(btn);
    }
    for (const s of SHOULDER) {
      const btn = el("div", "rwk-btn rwk-shoulder", `<b>${s.label}</b><small>${s.hint}</small>`);
      const sItem = addItem(s.id, btn, () => ({ h: s.side, x: margin() + unit() * 0.9, v: "b", y: shoulderY() }));
      bindPress(btn, sItem, () => press(s.key), () => release(s.key));
    }
  }

  //--- Extra keys (game-specific, from the config)
  const extraItems = [];
  extras.forEach((b, index) => {
    if (!onScreen(b)) return; // in the ⌨ panel instead
    const id = b.id || (b.keys ? "group:" + (b.label || index) : "key:" + b.key);
    const label = b.label || String(b.key).toUpperCase();
    const btn = el("div", "rwk-btn rwk-key", text(b.keys ? label + " ▾" : label));
    const item = addItem(id, btn, () => extraSlots.get(item) || { h: "r", x: 0, v: "t", y: 0 });
    item.pos = b.pos ? { h: "l", x: b.pos.x * vw(), v: "t", y: b.pos.y * vh() } : null;
    extraItems.push(item);
    if (b.keys) bindGroup(b, btn, item);
    else bindPress(btn, item, () => press(b.key), () => release(b.key));
  });

  function bindGroup(group, toggle, item) {
    const list = el("div", "rwk-group-items");
    for (const sub of group.keys) {
      const k = typeof sub === "object" ? sub.key : sub;
      const label = typeof sub === "object" && sub.label ? sub.label : String(k).toUpperCase();
      const btn = el("div", "rwk-btn rwk-key", text(label));
      bindPress(btn, null, () => press(k), () => {
        release(k);
        if (group.closeOnPress !== false) list.classList.remove("open");
      });
      list.appendChild(btn);
    }
    bindPress(toggle, item, () => {}, () => {
      list.classList.toggle("open");
      positionGroup(toggle, list);
    });
    pad.appendChild(list);
  }

  // Opens above the toggle in the lower half of the screen, below it otherwise.
  function positionGroup(toggle, list) {
    const r = toggle.getBoundingClientRect();
    const left = r.left + r.width / 2 - list.offsetWidth / 2;
    const top = r.top > vh() / 2 ? r.top - 8 - list.offsetHeight : r.bottom + 8;
    list.style.left = clamp(left, 4, vw() - list.offsetWidth - 4) + "px";
    list.style.top = clamp(top, 4, vh() - list.offsetHeight - 4) + "px";
  }

  const extraSlots = new Map();
  function layoutExtras() {
    extraSlots.clear();
    const gap = 8;
    const m = margin();
    const flow = extraItems.filter((item) => !item.pos && (editing || !off.has(item.id)));
    for (const item of extraItems) if (item.pos) extraSlots.set(item, item.pos);
    if (orientation() === "portrait") {
      // Rows centered above the L/R line, bottom-up.
      let y = (gamepadOn ? shoulderY() + unit() * 0.41 : m + clusterHeight()) + gap + unit() * 0.45;
      let row = [];
      let width = 0;
      const flush = () => {
        let x = (vw() - width + gap) / 2;
        for (const item of row) {
          extraSlots.set(item, { h: "l", x: x + item.el.offsetWidth / 2, v: "b", y });
          x += item.el.offsetWidth + gap;
        }
        y += unit() * 0.9 + gap;
        row = [];
        width = 0;
      };
      for (const item of flow) {
        const w = item.el.offsetWidth + gap;
        if (row.length && width + w > vw() - 2 * m) flush();
        row.push(item);
        width += w;
      }
      if (row.length) flush();
    } else {
      // Columns down the right edge, between the toolbar row and R.
      const top = m + unit() * 0.66 + gap;
      const bottom = vh() - (gamepadOn ? shoulderY() + unit() * 0.41 : margin() + clusterHeight()) - gap;
      let x = m;
      let y = top;
      let colWidth = 0;
      for (const item of flow) {
        const h = item.el.offsetHeight;
        if (y > top && y + h > bottom) {
          x += colWidth + gap;
          y = top;
          colWidth = 0;
        }
        extraSlots.set(item, { h: "r", x: x + item.el.offsetWidth / 2, v: "t", y: y + h / 2 });
        colWidth = Math.max(colWidth, item.el.offsetWidth);
        y += h + gap;
      }
    }
  }

  //---------------------------------------------------------------------------
  // Toolbar, in two groups: ⚙ tools and ⌨ game keys on the left, fullscreen
  // and show/hide on the right. Top corners in landscape; in portrait both
  // groups sit on the L/R line, next to L and R.
  //---------------------------------------------------------------------------

  const toolbarLeft = el("div", "rwk-tools");
  const toolbarRight = el("div", "rwk-tools");
  pad.append(toolbarLeft, toolbarRight);
  function addTool(label, extraClass, onTap, group = toolbarLeft) {
    const btn = el("div", "rwk-btn rwk-tool " + extraClass, label);
    bindPress(btn, null, () => {}, onTap);
    group.appendChild(btn);
    return btn;
  }

  const { icons } = RWK;
  const eyeIcon = (open) => (open ? icons.eye : icons.eyeOff);
  let toggleBtn = null;

  // The eye shows the current state: open while the controls are shown.
  function setHidden(hidden) {
    pad.classList.toggle("hidden", hidden);
    document.body.classList.toggle("rwk-ctl", !hidden && (gamepadOn || dpadOn));
    toggleBtn.innerHTML = eyeIcon(!hidden);
    RWK.storage.set(HIDDEN_KEY, hidden);
    layout();
  }
  let panel = null;
  let backdrop = null;
  if (panelKeys.length) {
    // Tapping anywhere outside the panel (⌨ included) closes it without
    // reaching the game.
    backdrop = el("div", "rwk-backdrop");
    backdrop.addEventListener("pointerdown", (e) => {
      e.preventDefault();
      setPanel(false);
    });
    pad.appendChild(backdrop);
    panel = el("div", "rwk-panel", '<div class="rwk-panel-title">Game keys</div>');
    const grid = el("div", "rwk-panel-keys");
    // A hint shared by several keys (one plugin, many keys) tells them apart
    // no better than the label, so only unique hints are shown.
    const hintCount = {};
    for (const b of panelKeys) if (b.hint) hintCount[b.hint] = (hintCount[b.hint] || 0) + 1;
    for (const b of panelKeys) {
      const label = b.label || String(b.key).toUpperCase();
      const hint = hintCount[b.hint] === 1 ? b.hint : "";
      const btn = el("div", "rwk-btn rwk-key", `<b>${text(label)}</b>` + (hint ? `<small>${text(hint)}</small>` : ""));
      bindPress(btn, null, () => press(b.key), () => {
        release(b.key);
        if (b.closeOnPress !== false) setPanel(false);
      });
      grid.appendChild(btn);
    }
    panel.appendChild(grid);
    pad.appendChild(panel);
    addTool(icons.keys, "rwk-tool-keys", () => setPanel(!panel.classList.contains("open")));
  }

  function setPanel(open) {
    panel.classList.toggle("open", open);
    backdrop.classList.toggle("open", open);
    layoutPanel();
  }

  const extrasTools = cfg.extras || ["fullscreen", "editLayout"];
  if (extrasTools.includes("fullscreen")) addTool(icons.fullscreen, "rwk-tool-fs", toggleFullscreen, toolbarRight);
  toggleBtn = addTool(eyeIcon(true), "rwk-tool-toggle", () => setHidden(!pad.classList.contains("hidden")), toolbarRight);

  // The ⚙ tools menu opens from the toolbar (RWK_Core adds the button with
  // the first tool), first on the left.
  let ready = false;
  RWK.tools.mount((label, onTap) => {
    const btn = addTool(label, "rwk-tool-more", onTap);
    toolbarLeft.prepend(btn);
    if (ready) layout();
    return btn;
  });

  if (extrasTools.includes("editLayout")) {
    // Started from the tools menu; ✓ and ↺ show in the toolbar while editing.
    const setEditing = (on) => {
      editing = on;
      pad.classList.toggle("editing", editing);
      if (!editing) {
        RWK.storage.set(LAYOUT_KEY, saved);
        RWK.storage.set(OFF_KEY, [...off]);
        RWK.toast("Button layout saved", "info", 1500);
      } else {
        RWK.toast("Drag buttons to move them, − hides one, + shows it again. ↺ resets positions, ✓ saves.", "info", 5000);
      }
      doneBtn.style.display = resetBtn.style.display = editing ? "" : "none";
      layout(); // hidden buttons show up dimmed while editing
    };
    RWK.tools.add({
      icon: icons.move,
      label: "Edit button layout",
      detail: "Move the on-screen buttons, or hide the ones you never use",
      onSelect: () => {
        if (pad.classList.contains("hidden")) setHidden(false); // nothing to edit otherwise
        setEditing(true);
      },
    });
    const doneBtn = addTool(icons.check, "rwk-tool-edit", () => setEditing(false));
    const resetBtn = addTool(icons.reset, "rwk-tool-reset", () => {
      delete saved[orientation()];
      layout();
    });
    doneBtn.style.display = resetBtn.style.display = "none";
  }

  // Portrait with a gamepad: the game sits above the controls.
  const docked = () => orientation() === "portrait" && !pad.classList.contains("hidden") && (gamepadOn || dpadOn);

  function layoutTools() {
    const h = toolbarLeft.offsetHeight || toolbarRight.offsetHeight;
    // Docked: next to L and R (their outer edge is margin + 1.8u from the side).
    const inset = docked() ? margin() + (gamepadOn ? unit() * 1.8 + 8 : 0) : margin();
    const top = docked() ? vh() - (gamepadOn ? shoulderY() : margin() + clusterHeight() + h) : margin() + h / 2;
    toolbarLeft.style.left = inset + toolbarLeft.offsetWidth / 2 + "px";
    toolbarRight.style.left = vw() - inset - toolbarRight.offsetWidth / 2 + "px";
    toolbarLeft.style.top = toolbarRight.style.top = top + "px";
  }

  // Above the controls when docked, under the toolbar otherwise.
  function layoutPanel() {
    if (!panel || !panel.classList.contains("open")) return;
    panel.style.left = vw() / 2 + "px";
    if (docked()) {
      const bottom = vh() - controlsTop() + 8;
      panel.style.top = "";
      panel.style.bottom = bottom + "px";
      panel.style.maxHeight = vh() - bottom - 8 + "px";
    } else {
      const top = toolbarLeft.offsetTop + toolbarLeft.offsetHeight / 2 + 8;
      panel.style.bottom = "";
      panel.style.top = top + "px";
      panel.style.maxHeight = vh() - top - 8 + "px";
    }
  }

  // Top edge of the controls in the lower half of the screen.
  function controlsTop() {
    let top = vh();
    for (const node of [toolbarLeft, toolbarRight, ...items.map((i) => i.el)]) {
      if (!node.offsetWidth || node.offsetTop < vh() / 2) continue; // hidden, or moved to the top
      top = Math.min(top, node.offsetTop - node.offsetHeight / 2); // offsetTop is the center (translate -50%)
    }
    return top;
  }

  // In portrait, center the game in the space above the controls instead of
  // the whole screen; it may cover them only when it doesn't fit otherwise.
  function fitGame() {
    const canvas = document.getElementById("gameCanvas");
    let bottom = 0;
    if (canvas && docked()) bottom = clamp(vh() - controlsTop() + 8, 0, Math.max(0, vh() - canvas.offsetHeight));
    document.body.style.setProperty("--rwk-game-bottom", bottom + "px");
  }

  // The engine resizes the canvas after our resize handler runs.
  const _updateAllElements = Graphics._updateAllElements;
  Graphics._updateAllElements = function () {
    _updateAllElements.apply(this, arguments);
    fitGame();
  };

  function toggleFullscreen() {
    const doc = document;
    const root = doc.documentElement;
    if (doc.fullscreenElement || doc.webkitFullscreenElement) {
      (doc.exitFullscreen || doc.webkitExitFullscreen).call(doc);
      return;
    }
    const request = root.requestFullscreen || root.webkitRequestFullscreen;
    if (!request) {
      RWK.toast("This browser has no fullscreen support. Use “Add to Home Screen” instead.", "warn", 4000);
      return;
    }
    // Fullscreen is what allows locking the orientation: turn a landscape game sideways.
    Promise.resolve(request.call(root))
      .then(() => {
        const o = screen.orientation;
        if (o && o.lock && Graphics.width >= Graphics.height) return o.lock("landscape");
      })
      .catch(() => {});
  }

  //---------------------------------------------------------------------------

  function layout() {
    pad.style.setProperty("--u", unit().toFixed(1) + "px");
    for (const item of items) {
      item.el.classList.toggle("rwk-off", off.has(item.id));
      item.badge.textContent = off.has(item.id) ? "+" : "−";
    }
    layoutExtras();
    const own = saved[orientation()] || {};
    for (const item of items) {
      place(item.el, own[item.id] || item.def());
      placeBadge(item);
    }
    layoutTools();
    layoutPanel();
    fitGame();
  }

  // Mobile browsers report the final size a little after rotating or
  // entering fullscreen, sometimes with no resize event: lay out again then,
  // and let the engine resize the game too.
  let settle = [];
  function relayout() {
    layout();
    for (const t of settle) clearTimeout(t);
    settle = [150, 500].map((ms) =>
      setTimeout(() => {
        if (Graphics._canvas) Graphics._updateAllElements();
        layout();
      }, ms)
    );
  }

  // Fade the controls while the player only watches (dialogue, cutscenes);
  // the first touch brings them back.
  const IDLE_MS = 4000;
  let idleTimer = 0;
  const wake = () => {
    pad.classList.remove("idle");
    clearTimeout(idleTimer);
    idleTimer = setTimeout(() => pad.classList.add("idle"), IDLE_MS);
  };
  window.addEventListener("pointerdown", wake, true);
  wake();

  if (RWK.storage.get(HIDDEN_KEY, false)) {
    pad.classList.add("hidden");
    toggleBtn.innerHTML = eyeIcon(false);
  } else if (gamepadOn || dpadOn) document.body.classList.add("rwk-ctl");
  document.body.appendChild(pad);
  ready = true;
  layout();
  // The engine creates the canvas after plugins load.
  const waitCanvas = () => (document.getElementById("gameCanvas") ? fitGame() : requestAnimationFrame(waitCanvas));
  waitCanvas();
  window.addEventListener("resize", relayout);
  window.addEventListener("orientationchange", relayout);
  document.addEventListener("fullscreenchange", relayout);
  document.addEventListener("webkitfullscreenchange", relayout);
  if (screen.orientation && screen.orientation.addEventListener) screen.orientation.addEventListener("change", relayout);

  // Lets later plugins add buttons to the toolbar (advanced tools go in RWK.tools instead).
  RWK.controls = {
    addTool(label, extraClass, onTap) {
      const btn = addTool(label, extraClass, onTap);
      layout();
      return btn;
    },
  };
})();
