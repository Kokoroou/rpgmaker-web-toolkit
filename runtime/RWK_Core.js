//=============================================================================
// RWK_Core.js - rpgmaker-web-toolkit
// Generated into the web build by the CLI. Do not add to the original game.
//=============================================================================
/*:
 * @target MZ MV
 * @plugindesc [rpgmaker-web-toolkit] Shared runtime: config, device id, toast & dialog UI.
 * @author rpgmaker-web-toolkit
 *
 * @param config
 * @text Config (JSON)
 * @desc Written by the CLI at build time.
 * @default {}
 */

(() => {
  "use strict";

  let config = {};
  try {
    config = JSON.parse(PluginManager.parameters("RWK_Core").config || "{}");
  } catch (e) {
    console.error("[RWK] Invalid config", e);
  }

  const storage = {
    get(key, fallback = null) {
      try {
        const raw = localStorage.getItem(key);
        return raw === null ? fallback : JSON.parse(raw);
      } catch (e) {
        return fallback;
      }
    },
    set(key, value) {
      try {
        localStorage.setItem(key, JSON.stringify(value));
      } catch (e) {
        console.warn("[RWK] localStorage write failed", e);
      }
    },
  };

  function deviceId() {
    let id = storage.get("rwk.deviceId");
    if (!id) {
      const rand = window.crypto && crypto.randomUUID ? crypto.randomUUID() : String(Math.random()).slice(2);
      id = (navigator.userAgent.match(/Android|iPhone|iPad|Windows|Mac|Linux/) || ["web"])[0] + "-" + rand.slice(0, 8);
      storage.set("rwk.deviceId", id);
    }
    return id;
  }

  //---------------------------------------------------------------------------
  // UI helpers (plain DOM, above the game canvas)
  //---------------------------------------------------------------------------

  const style = document.createElement("style");
  style.textContent = `
.rwk-toast{position:fixed;left:12px;bottom:12px;z-index:60;max-width:min(80vw,420px);padding:6px 12px;
  border-radius:999px;background:rgba(0,0,0,.72);color:#fff;font:13px/1.4 system-ui,sans-serif;
  pointer-events:none;opacity:0;transition:opacity .25s}
.rwk-toast.show{opacity:1}
.rwk-toast.warn{background:rgba(150,90,0,.9)}
.rwk-toast.error{background:rgba(160,20,20,.92)}
.rwk-modal{position:fixed;inset:0;z-index:70;display:flex;align-items:center;justify-content:center;
  background:rgba(0,0,0,.6);padding:16px;font:15px/1.5 system-ui,sans-serif}
.rwk-modal-box{background:#1d1d22;color:#eee;border-radius:12px;padding:18px 20px;max-width:440px;width:100%;
  box-shadow:0 10px 40px rgba(0,0,0,.5)}
.rwk-modal-box h2{margin:0 0 8px;font-size:17px}
.rwk-modal-box p{margin:0 0 14px;white-space:pre-line}
.rwk-modal-actions{display:flex;flex-wrap:wrap;gap:8px;justify-content:flex-end}
.rwk-modal-actions button{font:inherit;padding:8px 14px;border-radius:8px;border:1px solid #555;
  background:#2c2c33;color:#eee;cursor:pointer}
.rwk-modal-actions button.primary{background:#3b6fd8;border-color:#3b6fd8;color:#fff}
`;
  document.head.appendChild(style);

  //---------------------------------------------------------------------------
  // Fit the game in the window. Desktop browsers draw it at 1x (only NW.js and
  // phones stretch), so a game bigger than the window gets cut off behind a
  // scrollbar. Shrink it to fit; never enlarge.
  //---------------------------------------------------------------------------

  document.documentElement.style.overflow = "hidden";
  const _updateRealScale = Graphics._updateRealScale;
  Graphics._updateRealScale = function () {
    _updateRealScale.apply(this, arguments);
    if (this._width > 0 && this._height > 0) {
      const fit = Math.min(window.innerWidth / this._width, window.innerHeight / this._height);
      if (fit < this._realScale) this._realScale = fit;
    }
  };

  //---------------------------------------------------------------------------
  // Images bigger than the GPU's MAX_TEXTURE_SIZE (often 4096 on phones) fail
  // to upload and draw nothing, e.g. a 5472px world map parallax. Upload a copy
  // shrunk to fit instead, with resolution < 1 so the texture keeps the image's
  // full size in game coordinates. Devices that can hold the image are untouched.
  //---------------------------------------------------------------------------

  let maxTextureSize = 0;
  function getMaxTextureSize() {
    if (!maxTextureSize) {
      const renderer = Graphics._app && Graphics._app.renderer;
      const gl = renderer && renderer.gl;
      if (gl) maxTextureSize = gl.getParameter(gl.MAX_TEXTURE_SIZE) || 0;
    }
    return maxTextureSize;
  }

  if (Utils.RPGMAKER_NAME === "MZ") {
    const _createBaseTexture = Bitmap.prototype._createBaseTexture;
    Bitmap.prototype._createBaseTexture = function (source) {
      const max = getMaxTextureSize();
      if (!max || (source.width <= max && source.height <= max)) {
        _createBaseTexture.apply(this, arguments);
        return;
      }
      const copy = document.createElement("canvas");
      const fit = () => {
        const scale = Math.min(1, max / Math.max(source.width, source.height, 1));
        // Same rounding as BaseTexture.realWidth, so the copy matches the GL texture.
        copy.width = Math.max(1, Math.ceil(source.width * scale - 1e-4));
        copy.height = Math.max(1, Math.ceil(source.height * scale - 1e-4));
        copy.getContext("2d").drawImage(source, 0, 0, copy.width, copy.height);
        return scale;
      };
      const scale = fit();
      _createBaseTexture.call(this, copy);
      const baseTexture = this._baseTexture;
      baseTexture.resolution = scale;
      baseTexture.width = source.width;
      baseTexture.height = source.height;
      console.warn(`[RWK] ${this._url || "bitmap"} is ${source.width}x${source.height}, ` +
        `over this GPU's ${max}px limit; drawing it at ${Math.round(scale * 100)}%.`);
      // Bitmaps drawn on at runtime update their canvas; copy it again first.
      if (source instanceof HTMLCanvasElement) {
        const update = baseTexture.update;
        baseTexture.update = function () {
          this.resolution = fit();
          return update.apply(this, arguments);
        };
      }
    };
  }

  let toastEl = null;
  let toastTimer = 0;
  function toast(message, kind = "info", ms = 2500) {
    if (!toastEl) {
      toastEl = document.createElement("div");
      toastEl.className = "rwk-toast";
      document.body.appendChild(toastEl);
    }
    toastEl.textContent = message;
    toastEl.className = "rwk-toast show " + kind;
    clearTimeout(toastTimer);
    if (ms > 0) toastTimer = setTimeout(() => toastEl.classList.remove("show"), ms);
  }

  // options: [{ label, value, primary }] -> Promise<value>
  function choose(title, message, options) {
    return new Promise((resolve) => {
      const overlay = document.createElement("div");
      overlay.className = "rwk-modal";
      const box = document.createElement("div");
      box.className = "rwk-modal-box";
      const h = document.createElement("h2");
      h.textContent = title;
      const p = document.createElement("p");
      p.textContent = message;
      const actions = document.createElement("div");
      actions.className = "rwk-modal-actions";
      for (const opt of options) {
        const b = document.createElement("button");
        b.textContent = opt.label;
        if (opt.primary) b.className = "primary";
        b.addEventListener("click", () => {
          overlay.remove();
          resolve(opt.value);
        });
        actions.appendChild(b);
      }
      box.append(h, p, actions);
      overlay.appendChild(box);
      shield(overlay);
      document.body.appendChild(overlay);
    });
  }

  // Keeps taps on a toolkit element away from the game's TouchInput.
  function shield(node) {
    for (const type of ["mousedown", "mouseup", "mousemove", "touchstart", "touchmove", "touchend", "wheel"]) {
      node.addEventListener(type, (e) => e.stopPropagation(), { passive: true });
    }
  }

  //---------------------------------------------------------------------------
  // Tools menu: advanced tools (saves, layout editing, item options) sit
  // behind one ⚙ button so they don't crowd the screen. The touch toolbar
  // hosts the button when it is shown (tools.mount); otherwise it is a faint
  // button in the top-left corner.
  //---------------------------------------------------------------------------

  const toolsStyle = document.createElement("style");
  toolsStyle.textContent = `
.rwk-tools-list{display:flex;flex-direction:column;gap:6px;margin:0 0 14px}
.rwk-tools-list button{display:flex;align-items:center;gap:12px;width:100%;padding:10px 12px;text-align:left;
  font:inherit;border-radius:10px;border:1px solid #444;background:#2c2c33;color:#eee;cursor:pointer}
.rwk-tools-list b{width:24px;font-size:18px;text-align:center}
.rwk-tools-list span{flex:1;min-width:0}
.rwk-tools-list small{display:block;opacity:.65;font-size:12px}
.rwk-tools-btn{position:fixed;left:6px;top:6px;z-index:55;width:30px;height:30px;padding:0;border-radius:50%;
  border:1px solid rgba(255,255,255,.3);background:rgba(20,20,28,.5);color:#fff;font-size:15px;cursor:pointer;
  opacity:.2;transition:opacity .2s}
.rwk-tools-btn:hover{opacity:1}
`;
  document.head.appendChild(toolsStyle);

  const toolList = [];
  let mountEntry = null; // (label, onTap) -> element, set by the touch toolbar
  let entry = null;

  function cornerEntry() {
    const btn = document.createElement("button");
    btn.className = "rwk-tools-btn";
    btn.textContent = "⚙";
    btn.title = "Tools";
    btn.addEventListener("click", openTools);
    shield(btn);
    document.body.appendChild(btn);
    return btn;
  }

  // tool: { icon, label, detail: string | () => string, onSelect, keepOpen }
  // keepOpen redraws the menu after onSelect instead of closing it (toggles).
  function addTool(tool) {
    toolList.push(tool);
    if (!entry) entry = mountEntry ? mountEntry("⚙", openTools) : cornerEntry();
  }

  function mount(fn) {
    mountEntry = fn;
    if (entry) {
      entry.remove();
      entry = fn("⚙", openTools);
    }
  }

  function openTools() {
    if (document.querySelector(".rwk-tools-list")) return;
    const overlay = document.createElement("div");
    overlay.className = "rwk-modal";
    const box = document.createElement("div");
    box.className = "rwk-modal-box";
    const h = document.createElement("h2");
    h.textContent = "Tools";
    const list = document.createElement("div");
    list.className = "rwk-tools-list";
    const close = () => overlay.remove();

    const fill = () => {
      list.textContent = "";
      for (const tool of toolList) {
        const b = document.createElement("button");
        const icon = document.createElement("b");
        icon.textContent = tool.icon;
        const label = document.createElement("span");
        label.textContent = tool.label;
        const detail = typeof tool.detail === "function" ? tool.detail() : tool.detail;
        if (detail) {
          const small = document.createElement("small");
          small.textContent = detail;
          label.appendChild(small);
        }
        b.append(icon, label);
        b.addEventListener("click", () => {
          if (tool.keepOpen) {
            tool.onSelect();
            fill();
          } else {
            close();
            tool.onSelect();
          }
        });
        list.appendChild(b);
      }
    };
    fill();

    const actions = document.createElement("div");
    actions.className = "rwk-modal-actions";
    const closeBtn = document.createElement("button");
    closeBtn.textContent = "Close";
    closeBtn.addEventListener("click", close);
    actions.appendChild(closeBtn);
    box.append(h, list, actions);
    overlay.appendChild(box);
    overlay.addEventListener("click", (e) => e.target === overlay && close());
    shield(overlay);
    document.body.appendChild(overlay);
  }

  window.RWK = {
    config,
    engine: Utils.RPGMAKER_NAME === "MZ" ? "MZ" : "MV",
    deviceId: deviceId(),
    storage,
    toast,
    choose,
    shield,
    tools: { add: addTool, mount, open: openTools },
  };
})();
