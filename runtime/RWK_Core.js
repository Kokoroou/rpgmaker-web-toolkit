//=============================================================================
// RWK_Core.js - rpgmaker-web-toolkit
// Required Notice: Copyright 2026 Trương Tuấn Anh (https://github.com/Kokoroou)
// License: PolyForm Noncommercial 1.0.0 with the Game Creators permission,
// https://github.com/Kokoroou/rpgmaker-web-toolkit/blob/main/LICENSE
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

  //---------------------------------------------------------------------------
  // On phones MV asks for .m4a audio and .mp4 movies, even when the browser
  // can play Ogg / WebM, so a game that ships only .ogg / .webm has no sound
  // or movies there. Use the Ogg / WebM files when the build lacks the twins
  // (checked by the CLI: config.media) and the browser can play them.
  //---------------------------------------------------------------------------

  const media = config.media || {};
  if (Utils.RPGMAKER_NAME !== "MZ" && Utils.isMobileDevice()) {
    if (media.oggOnly) {
      const _audioFileExt = AudioManager.audioFileExt;
      AudioManager.audioFileExt = function () {
        return WebAudio.canPlayOgg() ? ".ogg" : _audioFileExt.apply(this, arguments);
      };
    }
    if (media.webmOnly) {
      const _videoFileExt = Game_Interpreter.prototype.videoFileExt;
      Game_Interpreter.prototype.videoFileExt = function () {
        return Graphics.canPlayVideoType("video/webm") ? ".webm" : _videoFileExt.apply(this, arguments);
      };
    }
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
  // ⏸ menu: the toolkit's options sit behind one button so they don't crowd
  // the screen, and the game pauses while the menu is open. The touch toolbar
  // hosts the button when it is shown (tools.mount); otherwise it is a faint
  // button in the top-left corner, also opened with F1. On phones the menu is
  // a bottom sheet in portrait and a panel on the left in landscape.
  //---------------------------------------------------------------------------

  const toolsStyle = document.createElement("style");
  toolsStyle.textContent = `
.rwk-modal-box.rwk-menu{display:flex;flex-direction:column;max-height:100%;padding:0;overflow:hidden}
.rwk-menu-head{display:flex;align-items:center;gap:8px;padding:8px 8px 4px 20px}
.rwk-menu-head h2{flex:1;margin:0}
.rwk-menu-head button{display:flex;align-items:center;justify-content:center;width:44px;height:44px;padding:0;
  border:0;border-radius:50%;background:none;color:inherit;cursor:pointer}
.rwk-menu-head svg{width:22px;height:22px}
.rwk-menu-body{overflow:auto;overscroll-behavior:contain;padding:4px 16px 16px}
.rwk-quick{display:grid;grid-template-columns:repeat(auto-fill,minmax(84px,1fr));gap:8px}
.rwk-quick button{display:flex;flex-direction:column;align-items:center;justify-content:center;gap:6px;min-height:64px;
  padding:10px 6px;font:inherit;font-size:13px;line-height:1.2;border-radius:12px;border:1px solid #444;
  background:#2c2c33;color:#eee;cursor:pointer}
.rwk-quick svg{width:22px;height:22px}
.rwk-tools-list{display:flex;flex-direction:column;gap:6px}
.rwk-tools-list h3{margin:12px 0 0;font-size:12px;font-weight:600;letter-spacing:.06em;text-transform:uppercase;opacity:.6}
.rwk-tools-list button{display:flex;align-items:center;gap:12px;width:100%;min-height:44px;padding:10px 12px;
  text-align:left;font:inherit;border-radius:10px;border:1px solid #444;background:#2c2c33;color:#eee;cursor:pointer}
.rwk-tools-list b{display:flex;width:24px;justify-content:center}
.rwk-tools-list svg{width:20px;height:20px}
.rwk-tools-list span{flex:1;min-width:0}
.rwk-tools-list small{display:block;opacity:.65;font-size:12px}
.rwk-tools-btn{position:fixed;left:6px;top:6px;z-index:55;display:flex;align-items:center;justify-content:center;
  width:30px;height:30px;padding:0;border-radius:50%;
  border:1px solid rgba(255,255,255,.3);background:rgba(20,20,28,.5);color:#fff;font-size:15px;cursor:pointer;
  opacity:.2;transition:opacity .2s}
.rwk-tools-btn:hover{opacity:1}
.rwk-tools-btn svg{width:17px;height:17px}
@media (pointer:coarse) and (orientation:portrait){
  .rwk-menu-overlay{align-items:flex-end;padding:0}
  .rwk-modal-box.rwk-menu{max-width:none;max-height:85%;border-radius:16px 16px 0 0;
    padding-bottom:env(safe-area-inset-bottom)}
}
@media (pointer:coarse) and (orientation:landscape){
  .rwk-menu-overlay{justify-content:flex-start;align-items:stretch;padding:0}
  .rwk-modal-box.rwk-menu{max-width:400px;border-radius:0 16px 16px 0;padding-left:env(safe-area-inset-left)}
}
`;
  document.head.appendChild(toolsStyle);

  // Toolbar and menu icons: monochrome line drawings in the text color, never
  // color emoji (only the A/B/X/Y buttons have color).
  const svg = (paths) =>
    '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" ' +
    'stroke-linejoin="round" aria-hidden="true">' + paths + "</svg>";
  const EYE = '<path d="M2 12s3.5-7 10-7 10 7 10 7-3.5 7-10 7S2 12 2 12z"/><circle cx="12" cy="12" r="3"/>';
  const icons = {
    gear: svg(
      '<path d="M12.22 2h-.44a2 2 0 0 0-2 2v.18a2 2 0 0 1-1 1.73l-.43.25a2 2 0 0 1-2 0l-.15-.08a2 2 0 0 0-2.73.73l-.22.38' +
        'a2 2 0 0 0 .73 2.73l.15.1a2 2 0 0 1 1 1.72v.51a2 2 0 0 1-1 1.74l-.15.09a2 2 0 0 0-.73 2.73l.22.38a2 2 0 0 0 2.73.73' +
        'l.15-.08a2 2 0 0 1 2 0l.43.25a2 2 0 0 1 1 1.73V20a2 2 0 0 0 2 2h.44a2 2 0 0 0 2-2v-.18a2 2 0 0 1 1-1.73l.43-.25' +
        'a2 2 0 0 1 2 0l.15.08a2 2 0 0 0 2.73-.73l.22-.39a2 2 0 0 0-.73-2.73l-.15-.08a2 2 0 0 1-1-1.74v-.5a2 2 0 0 1 1-1.74' +
        'l.15-.09a2 2 0 0 0 .73-2.73l-.22-.38a2 2 0 0 0-2.73-.73l-.15.08a2 2 0 0 1-2 0l-.43-.25a2 2 0 0 1-1-1.73V4a2 2 0 0 0-2-2z"/>' +
        '<circle cx="12" cy="12" r="3"/>'
    ),
    keys: svg('<rect x="2" y="6" width="20" height="12" rx="2"/><path d="M6 10h.01M10 10h.01M14 10h.01M18 10h.01M7 14h10"/>'),
    pause: svg('<rect x="6" y="4" width="4" height="16" rx="1"/><rect x="14" y="4" width="4" height="16" rx="1"/>'),
    close: svg('<path d="M18 6L6 18M6 6l12 12"/>'),
    fullscreen: svg('<path d="M3 8V3h5M16 3h5v5M21 16v5h-5M8 21H3v-5"/>'),
    minimize: svg('<path d="M8 3v5H3M16 3v5h5M21 16h-5v5M3 16h5v5"/>'),
    eye: svg(EYE),
    eyeOff: svg(EYE + '<path d="M3 3l18 18"/>'),
    move: svg('<path d="M12 2v20M2 12h20M9 5l3-3 3 3M9 19l3 3 3-3M5 9l-3 3 3 3M19 9l3 3-3 3"/>'),
    check: svg('<path d="M5 12l5 5L20 7"/>'),
    reset: svg('<path d="M3 12a9 9 0 1 0 3-6.7L3 8"/><path d="M3 3v5h5"/>'),
    save: svg('<path d="M5 3h11l5 5v11a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2z"/><path d="M7 3v5h8V3M7 21v-7h10v7"/>'),
    fastForward: svg('<path d="M13 19l9-7-9-7zM2 19l9-7-9-7z"/>'),
    gauge: svg('<path d="M12 14l4-4"/><path d="M3.34 19a10 10 0 1 1 17.32 0"/>'),
    items: svg('<path d="M12 2l10 5-10 5L2 7z"/><path d="M2 12l10 5 10-5M2 17l10 5 10-5"/>'),
    bug: svg(
      '<path d="M8 2l1.9 1.9M14.1 3.9L16 2M9 7.1v-1a3 3 0 1 1 6 0v1"/>' +
        '<path d="M12 20c-3.3 0-6-2.7-6-6v-3a4 4 0 0 1 4-4h4a4 4 0 0 1 4 4v3c0 3.3-2.7 6-6 6zM12 20v-9"/>' +
        '<path d="M6.5 9C4.6 8.8 3 7.1 3 5M6 13H2M3 21c0-2.1 1.7-3.9 3.8-4M21 5c0 2.1-1.6 3.8-3.5 4M22 13h-4M17.2 17c2.1.1 3.8 1.9 3.8 4"/>'
    ),
  };

  const toolList = [];
  let mountEntry = null; // (icon, onTap) -> element, set by the touch toolbar
  let entry = null;
  let menu = null; // the open menu's overlay

  // Menu sections, in this order. Tools with no known group go last, under "More".
  const GROUPS = { play: "Play", save: "Saves", controls: "Controls", display: "Display", help: "Help" };
  const value = (v) => (typeof v === "function" ? v() : v);

  function cornerEntry() {
    const btn = document.createElement("button");
    btn.className = "rwk-tools-btn";
    btn.innerHTML = icons.pause;
    btn.title = "Pause menu (F1)";
    btn.setAttribute("aria-label", "Pause menu");
    btn.addEventListener("click", openTools);
    shield(btn);
    document.body.appendChild(btn);
    return btn;
  }

  // tool: { icon (RWK.icons entry), label, detail: string | () => string, onSelect, keepOpen,
  //         group: a GROUPS key, quick: a tile in the menu's top row (short label, no detail) }
  // icon and label may be functions too. keepOpen redraws the menu after
  // onSelect instead of closing it (toggles).
  function addTool(tool) {
    toolList.push(tool);
    if (!entry) entry = mountEntry ? mountEntry(icons.pause, openTools) : cornerEntry();
  }

  function mount(fn) {
    mountEntry = fn;
    if (entry) {
      entry.remove();
      entry = fn(icons.pause, openTools);
    }
  }

  // Paused: the scene stops updating (keys and taps read meanwhile are
  // dropped), and sound and movies stop until the menu closes.
  let pausedAudio = null;
  let pausedVideo = null;
  const _updateScene = SceneManager.updateScene;
  SceneManager.updateScene = function () {
    if (!menu) _updateScene.apply(this, arguments);
  };

  function pause() {
    const context = window.WebAudio && WebAudio._context;
    pausedAudio = context && context.state === "running" ? context : null;
    if (pausedAudio) Promise.resolve(pausedAudio.suspend()).catch(() => {});
    const video = document.querySelector("video");
    pausedVideo = video && !video.paused ? video : null;
    if (pausedVideo) pausedVideo.pause();
  }

  function resume() {
    if (pausedAudio) Promise.resolve(pausedAudio.resume()).catch(() => {});
    if (pausedVideo) Promise.resolve(pausedVideo.play()).catch(() => {});
    pausedAudio = pausedVideo = null;
    Input.clear();
    if (window.TouchInput) TouchInput.clear();
  }

  function closeTools() {
    if (!menu) return;
    menu.remove();
    menu = null;
    resume();
  }

  function openTools() {
    if (menu) return;
    const overlay = (menu = document.createElement("div"));
    overlay.className = "rwk-modal rwk-menu-overlay";
    const box = document.createElement("div");
    box.className = "rwk-modal-box rwk-menu";
    box.setAttribute("role", "dialog");
    box.setAttribute("aria-label", "Paused");
    const head = document.createElement("div");
    head.className = "rwk-menu-head";
    const h = document.createElement("h2");
    h.textContent = "Paused";
    const closeBtn = document.createElement("button");
    closeBtn.innerHTML = icons.close;
    closeBtn.title = "Resume (Esc)";
    closeBtn.setAttribute("aria-label", "Resume");
    closeBtn.addEventListener("click", closeTools);
    head.append(h, closeBtn);
    const body = document.createElement("div");
    body.className = "rwk-menu-body";
    const quick = document.createElement("div");
    quick.className = "rwk-quick";
    const list = document.createElement("div");
    list.className = "rwk-tools-list";
    body.append(quick, list);

    const button = (tool) => {
      const b = document.createElement("button");
      const icon = document.createElement("b");
      icon.innerHTML = value(tool.icon);
      const label = document.createElement("span");
      label.textContent = value(tool.label);
      const detail = !tool.quick && value(tool.detail);
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
          closeTools();
          tool.onSelect();
        }
      });
      return b;
    };

    const fill = () => {
      quick.textContent = list.textContent = "";
      const groups = new Map();
      for (const tool of toolList) {
        if (tool.quick) {
          quick.appendChild(button(tool));
          continue;
        }
        const key = GROUPS[tool.group] ? tool.group : "";
        if (!groups.has(key)) groups.set(key, []);
        groups.get(key).push(tool);
      }
      quick.hidden = !quick.childElementCount;
      for (const key of [...Object.keys(GROUPS), ""]) {
        if (!groups.has(key)) continue;
        const title = document.createElement("h3");
        title.textContent = GROUPS[key] || "More";
        list.appendChild(title);
        for (const tool of groups.get(key)) list.appendChild(button(tool));
      }
    };
    fill();

    box.append(head, body);
    overlay.appendChild(box);
    overlay.addEventListener("click", (e) => e.target === overlay && closeTools());
    shield(overlay);
    pause();
    document.body.appendChild(overlay);
  }

  // F1 opens the menu (unless one of the game's plugins uses that key). While
  // it is open, keys go to the menu instead of the game, and Esc closes it.
  window.addEventListener(
    "keydown",
    (e) => {
      if (menu) {
        e.stopPropagation();
        if (e.key === "Escape" || e.key === "F1") {
          e.preventDefault();
          closeTools();
        }
      } else if (e.key === "F1" && entry && !Input.keyMapper[112]) {
        e.preventDefault();
        openTools();
      }
    },
    true
  );

  //---------------------------------------------------------------------------
  // Full screen, a tile in the menu's top row. Fullscreen is also what allows
  // locking the orientation: it turns a landscape game sideways.
  //---------------------------------------------------------------------------

  const isFullscreen = () => !!(document.fullscreenElement || document.webkitFullscreenElement);

  function toggleFullscreen() {
    const doc = document;
    const root = doc.documentElement;
    if (isFullscreen()) {
      (doc.exitFullscreen || doc.webkitExitFullscreen).call(doc);
      return;
    }
    const request = root.requestFullscreen || root.webkitRequestFullscreen;
    if (!request) {
      toast("This browser has no fullscreen support. Use “Add to Home Screen” instead.", "warn", 4000);
      return;
    }
    Promise.resolve(request.call(root))
      .then(() => {
        const o = screen.orientation;
        if (o && o.lock && Graphics.width >= Graphics.height) return o.lock("landscape");
      })
      .catch(() => {});
  }

  if (((config.controls && config.controls.extras) || ["fullscreen"]).includes("fullscreen")) {
    addTool({
      quick: true,
      icon: () => (isFullscreen() ? icons.minimize : icons.fullscreen),
      label: () => (isFullscreen() ? "Exit full screen" : "Full screen"),
      onSelect: toggleFullscreen,
    });
  }

  //---------------------------------------------------------------------------
  // Say this is a player-made web build, so a bug in the toolkit's plugins is
  // not reported to the game's creator as a bug in their game.
  //---------------------------------------------------------------------------

  const ISSUES_URL = "https://github.com/Kokoroou/rpgmaker-web-toolkit/issues";
  console.info(
    "[rpgmaker-web-toolkit] This is a web build made with rpgmaker-web-toolkit, not an official release of the game. " +
      `Problems with the touch controls, cloud saves or other toolkit features: ${ISSUES_URL}`
  );

  const _printError = Graphics.printError;
  Graphics.printError = function () {
    _printError.apply(this, arguments);
    const printer = this._errorPrinter;
    if (!printer || printer.querySelector(".rwk-error-note")) return;
    const note = document.createElement("div");
    note.className = "rwk-error-note";
    note.style.cssText = "margin-top:16px;font:13px/1.4 system-ui,sans-serif;color:#bbb;text-shadow:none";
    note.textContent =
      "This copy runs in a browser through rpgmaker-web-toolkit, not the official release. " +
      "Before reporting this error to the game's creator, check that it also happens in the desktop version. " +
      `Otherwise report it at ${ISSUES_URL}`;
    printer.appendChild(note);
  };

  window.RWK = {
    config,
    engine: Utils.RPGMAKER_NAME === "MZ" ? "MZ" : "MV",
    deviceId: deviceId(),
    storage,
    toast,
    choose,
    shield,
    icons,
    tools: { add: addTool, mount, open: openTools, close: closeTools, isOpen: () => !!menu },
  };
})();
