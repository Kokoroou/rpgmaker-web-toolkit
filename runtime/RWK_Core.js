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
      // Keep taps inside the dialog away from the game's TouchInput.
      for (const type of ["mousedown", "mouseup", "mousemove", "touchstart", "touchmove", "touchend", "wheel"]) {
        overlay.addEventListener(type, (e) => e.stopPropagation(), { passive: true });
      }
      document.body.appendChild(overlay);
    });
  }

  window.RWK = {
    config,
    engine: Utils.RPGMAKER_NAME === "MZ" ? "MZ" : "MV",
    deviceId: deviceId(),
    storage,
    toast,
    choose,
  };
})();
