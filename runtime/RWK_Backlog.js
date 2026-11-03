//=============================================================================
// RWK_Backlog.js - rpgmaker-web-toolkit
// Required Notice: Copyright 2026 Trương Tuấn Anh (https://github.com/Kokoroou)
// License: PolyForm Noncommercial 1.0.0 with the Game Creators permission,
// https://github.com/Kokoroou/rpgmaker-web-toolkit/blob/main/LICENSE
// Message backlog: the last messages of the game (speaker and text, control
// codes removed) in ⚙ → Messages log, or the L key, to reread what was
// skipped. Kept in memory only, in a list with a fixed size; nothing runs
// per frame (one hook when a message starts).
//=============================================================================
/*:
 * @target MZ MV
 * @plugindesc [rpgmaker-web-toolkit] Message backlog: reread past messages. Requires RWK_Core.
 * @author rpgmaker-web-toolkit
 */

(() => {
  "use strict";

  const RWK = window.RWK;
  if (!RWK || !RWK.config.backlog) return;

  const MAX = Math.min(500, Math.max(10, Math.round(Number(RWK.config.backlog.max)) || 100));
  const LOG_KEY = 76; // L

  //---------------------------------------------------------------------------
  // The log: a bounded list, oldest dropped first.
  //---------------------------------------------------------------------------

  const entries = [];

  // Text after the engine's convertEscapeCharacters (\V[1] and \N[1] are
  // already replaced): drop the codes that remain (colors, icons, waits...),
  // the same shapes Window_Base.obtainEscapeCode reads.
  const CODE = /\x1b(?:[$.|^!><{}\\]|[A-Za-z]+(?:\[\d+\])?)/g;
  const clean = (text) =>
    String(text == null ? "" : text)
      .replace(CODE, "")
      .replace(/[ \t]+\n/g, "\n")
      .trim();

  function add(speaker, text) {
    text = clean(text);
    if (!text) return;
    entries.push({ speaker: clean(speaker), text });
    if (entries.length > MAX) entries.splice(0, entries.length - MAX);
  }

  // A new game or a loaded save is another story: start the log over.
  const clear = () => (entries.length = 0);

  //---------------------------------------------------------------------------
  // Hooks (same names in MZ and MV)
  //---------------------------------------------------------------------------

  const _startMessage = Window_Message.prototype.startMessage;
  Window_Message.prototype.startMessage = function () {
    try {
      const speaker = typeof $gameMessage.speakerName === "function" ? $gameMessage.speakerName() : "";
      add(this.convertEscapeCharacters(speaker || ""), this.convertEscapeCharacters($gameMessage.allText()));
    } catch (e) {
      console.warn("[RWK] backlog could not read a message", e);
    }
    return _startMessage.apply(this, arguments);
  };

  for (const name of ["setupNewGame", "extractSaveContents"]) {
    const original = DataManager[name];
    DataManager[name] = function () {
      clear();
      return original.apply(this, arguments);
    };
  }

  //---------------------------------------------------------------------------
  // Panel. The game is paused while it is open (the scene update is swapped
  // out only for that time), so Auto does not turn pages behind it.
  //---------------------------------------------------------------------------

  let overlay = null;
  let restoreUpdate = null;

  function injectStyle() {
    if (document.getElementById("rwk-backlog-style")) return;
    const style = document.createElement("style");
    style.id = "rwk-backlog-style";
    style.textContent = `
.rwk-backlog{max-width:560px;display:flex;flex-direction:column;max-height:min(86vh,720px)}
.rwk-backlog-list{flex:1;min-height:0;overflow:auto;margin:0 0 14px;border-top:1px solid #333;outline:none;
  -webkit-overflow-scrolling:touch;overscroll-behavior:contain}
.rwk-backlog-list > p.rwk-backlog-empty{margin:12px 0;opacity:.75}
.rwk-backlog-row{padding:9px 0;border-bottom:1px solid #333}
.rwk-backlog-row b{display:block;font-size:13px;opacity:.8;margin-bottom:2px}
.rwk-backlog-row div{white-space:pre-wrap;overflow-wrap:anywhere;line-height:1.4}
`;
    document.head.appendChild(style);
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
    box.className = "rwk-modal-box rwk-backlog";
    box.setAttribute("role", "dialog");
    box.setAttribute("aria-label", "Messages log");
    const h = document.createElement("h2");
    h.textContent = "Messages log";
    const list = document.createElement("div");
    list.className = "rwk-backlog-list";
    list.tabIndex = 0;
    if (!entries.length) {
      const empty = document.createElement("p");
      empty.className = "rwk-backlog-empty";
      empty.textContent = "No messages yet.";
      list.appendChild(empty);
    }
    for (const item of entries) {
      const row = document.createElement("div");
      row.className = "rwk-backlog-row";
      if (item.speaker) {
        const who = document.createElement("b");
        who.textContent = item.speaker;
        row.appendChild(who);
      }
      const text = document.createElement("div");
      text.textContent = item.text;
      row.appendChild(text);
      list.appendChild(row);
    }
    const actions = document.createElement("div");
    actions.className = "rwk-modal-actions";
    const closeBtn = document.createElement("button");
    closeBtn.textContent = "Close";
    closeBtn.addEventListener("click", close);
    actions.appendChild(closeBtn);
    box.append(h, list, actions);
    overlay.appendChild(box);
    overlay.addEventListener("click", (e) => e.target === overlay && close());
    RWK.shield(overlay);
    document.body.appendChild(overlay);
    list.scrollTop = list.scrollHeight; // newest at the bottom
    list.focus({ preventScroll: true });

    const _updateScene = SceneManager.updateScene;
    SceneManager.updateScene = function () {};
    restoreUpdate = () => (SceneManager.updateScene = _updateScene);
  }

  function close() {
    if (!overlay) return;
    overlay.remove();
    overlay = null;
    if (restoreUpdate) restoreUpdate();
    restoreUpdate = null;
    Input.clear();
    if (window.TouchInput) TouchInput.clear();
  }

  // While open the keys belong to the panel: Esc or L close it, arrows and
  // Page Up / Down scroll its list; the game sees none of them.
  window.addEventListener(
    "keydown",
    (e) => {
      if (overlay) {
        if (e.key === "Escape" || e.keyCode === LOG_KEY) {
          e.preventDefault();
          close();
        }
        e.stopPropagation();
      } else if (e.keyCode === LOG_KEY && !e.ctrlKey && !e.altKey && !e.metaKey && !Input.keyMapper[LOG_KEY] && !RWK.tools.isOpen()) {
        const tag = document.activeElement && document.activeElement.tagName;
        if (tag === "INPUT" || tag === "TEXTAREA") return;
        e.preventDefault();
        open();
      }
    },
    true
  );

  RWK.tools.add({
    icon: RWK.icons.list,
    group: "messages",
    label: "Messages log",
    detail: () => `Reread the last messages${RWK.controls ? "" : " · L key"}`,
    onSelect: open,
  });

  RWK.backlog = { add, clear, clean, entries: () => entries.slice(), max: MAX };
})();
