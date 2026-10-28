//=============================================================================
// RWK_Message.js - rpgmaker-web-toolkit
// Required Notice: Copyright 2026 Trương Tuấn Anh (https://github.com/Kokoroou)
// License: PolyForm Noncommercial 1.0.0 with the Game Creators permission,
// https://github.com/Kokoroou/rpgmaker-web-toolkit/blob/main/LICENSE
// Message modes: a tap shows the rest of the page at once, waits included;
// Auto turns the page after a delay that grows with its length; Skip goes
// through messages until a choice, a number input or an item to pick.
//=============================================================================
/*:
 * @target MZ MV
 * @plugindesc [rpgmaker-web-toolkit] Message modes: tap to finish, Auto, Skip. Requires RWK_Core.
 * @author rpgmaker-web-toolkit
 */

(() => {
  "use strict";

  const RWK = window.RWK;
  if (!RWK || RWK.config.messageMode === false) return;

  // The deployer's limits (cli/lib/stage.js: messageModeConfig).
  const cfg = typeof RWK.config.messageMode === "object" ? RWK.config.messageMode : {};
  const MODES = ["normal"].concat(cfg.auto === false ? [] : ["auto"], cfg.skip === false ? [] : ["skip"]);
  const LOCKED = !!cfg.lock;
  const MODE_NAMES = { normal: "Normal", auto: "Auto", skip: "Skip" };
  // Auto waits (BASE + PER_CHAR × characters on the page) × the speed's factor, in frames.
  const AUTO_SPEEDS = { slow: 1.6, normal: 1, fast: 0.6 };
  const AUTO_NAMES = { slow: "Slow", normal: "Normal", fast: "Fast" };
  const BASE = 60;
  const PER_CHAR = 3;
  const MODE_KEY = "rwk.messageMode." + RWK.config.gameId;
  const AUTO_KEY = "rwk.autoSpeed." + RWK.config.gameId;

  // Auto is remembered in this browser; Skip always starts off. Locked: the
  // deployer's mode and speed, whatever the browser remembers.
  const hasAuto = MODES.includes("auto");
  const startMode = hasAuto && cfg.mode === "auto" ? "auto" : "normal";
  const startSpeed = AUTO_SPEEDS[cfg.autoSpeed] ? cfg.autoSpeed : "normal";
  const storedMode = LOCKED ? null : RWK.storage.get(MODE_KEY);
  const storedSpeed = LOCKED ? null : RWK.storage.get(AUTO_KEY);
  let mode = storedMode === null ? startMode : storedMode === "auto" && hasAuto ? "auto" : "normal";
  let autoSpeed = AUTO_SPEEDS[storedSpeed] ? storedSpeed : startSpeed;
  let ctrlHeld = false; // Ctrl skips only while held
  const skipping = () => mode === "skip" || ctrlHeld;

  function setMode(value, note) {
    mode = value;
    if (value !== "skip") RWK.storage.set(MODE_KEY, value);
    RWK.toast(note || `Messages: ${MODE_NAMES[value]}`, "info", 1500);
  }

  //---------------------------------------------------------------------------
  // Window_Message, same names in MZ and MV. Every mode works through
  // isTriggered (the OK / tap check of the message window only), so choices,
  // number input and item selection are never answered for the player.
  //---------------------------------------------------------------------------

  const _newPage = Window_Message.prototype.newPage;
  Window_Message.prototype.newPage = function (textState) {
    _newPage.apply(this, arguments);
    this._rwkPage = { state: textState, start: textState.index };
  };

  // Characters shown since the page started or the last pause (\! in the text).
  function pageLength(win) {
    const page = win._rwkPage;
    if (!page) return 0;
    const length = Math.max(0, page.state.index - page.start);
    page.start = page.state.index;
    return length;
  }

  const _update = Window_Message.prototype.update;
  Window_Message.prototype.update = function () {
    if (mode === "skip" && this.isAnySubWindowActive()) setMode("normal", "Skip stopped: your turn to choose");
    // A wait in the text (\. \|) ends on a tap, or at once while skipping.
    if (this._waitCount > 0 && this._textState && (skipping() || this.isTriggered())) {
      this._waitCount = 0;
      this._showFast = true;
    }
    if (mode === "auto" && this.pause) {
      if (!this._rwkAuto) this._rwkAuto = { frames: 0, delay: (BASE + PER_CHAR * pageLength(this)) * AUTO_SPEEDS[autoSpeed] };
      this._rwkAuto.frames++;
    } else this._rwkAuto = null;
    _update.apply(this, arguments);
  };

  const _isTriggered = Window_Message.prototype.isTriggered;
  Window_Message.prototype.isTriggered = function () {
    if (_isTriggered.apply(this, arguments) || skipping()) return true;
    const auto = this._rwkAuto;
    return !!(this.pause && auto && auto.frames >= auto.delay);
  };

  // Scrolling text runs at its fast speed while skipping, unless the event forbids it.
  const _isFastForward = Window_ScrollText.prototype.isFastForward;
  Window_ScrollText.prototype.isFastForward = function () {
    return _isFastForward.apply(this, arguments) || (skipping() && !$gameMessage.scrollNoFast());
  };

  //---------------------------------------------------------------------------
  // Controls: the mode and the Auto speed in the ⚙ menu, held Ctrl on a keyboard.
  //---------------------------------------------------------------------------

  const next = (list, item) => list[(list.indexOf(item) + 1) % list.length];
  const speeds = Object.keys(AUTO_SPEEDS);

  const canSkip = !LOCKED && MODES.includes("skip");
  if (!LOCKED && MODES.length > 1) {
    RWK.tools.add({
      icon: RWK.icons.message,
      group: "messages",
      label: () => `Messages: ${MODE_NAMES[mode]}`,
      summary: () => MODE_NAMES[mode],
      detail: () => `Tap for ${MODE_NAMES[next(MODES, mode)]}` + (RWK.controls || !canSkip ? "" : " · hold Ctrl to skip"),
      keepOpen: true,
      onSelect: () => setMode(next(MODES, mode)),
    });
  }
  if (!LOCKED && hasAuto) {
    RWK.tools.add({
      icon: RWK.icons.timer,
      group: "messages",
      label: () => `Auto speed: ${AUTO_NAMES[autoSpeed]}`,
      summary: () => (mode === "auto" ? `${AUTO_NAMES[autoSpeed]} auto` : ""),
      detail: () => `Tap for ${AUTO_NAMES[next(speeds, autoSpeed)]}`,
      keepOpen: true,
      onSelect: () => {
        autoSpeed = next(speeds, autoSpeed);
        RWK.storage.set(AUTO_KEY, autoSpeed);
      },
    });
  }

  // Held Ctrl skips, unless Skip is off or the game's plugins use the key for something else.
  const free = canSkip && (!Input.keyMapper[17] || Input.keyMapper[17] === "control");
  const releaseCtrl = () => (ctrlHeld = false);
  window.addEventListener("keydown", (e) => {
    if (free && e.keyCode === 17 && !RWK.tools.isOpen()) ctrlHeld = true;
  });
  window.addEventListener("keyup", (e) => e.keyCode === 17 && releaseCtrl());
  window.addEventListener("blur", releaseCtrl);
})();
