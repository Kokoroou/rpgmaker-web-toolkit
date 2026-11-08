//=============================================================================
// rwk-guard.js - rpgmaker-web-toolkit
// Required Notice: Copyright 2026 Trương Tuấn Anh (https://github.com/Kokoroou)
// License: PolyForm Noncommercial 1.0.0 with the Game Creators permission,
// https://github.com/Kokoroou/rpgmaker-web-toolkit/blob/main/LICENSE
//
// Runs before every game plugin (the CLI puts it in index.html, before
// js/plugins.js). A game plugin that cancels a touch (preventDefault on
// touchend), swallows click, or captures the pointer on its canvas leaves the
// toolkit's buttons dead, and the player cannot even close a dialog. From
// here on, the game's listeners on window, document and body skip a press
// that starts on a toolkit element ([data-rwk-ui]) and everything that press
// goes on to send, its release included; a press that starts elsewhere keeps
// its release, so the game's Input cannot stay down. The game works as before
// everywhere else. Toolkit listeners that do want those events mark
// themselves with `fn.__rwkUI = true`.
//
// It also gives the page the `process` object a browser lacks, which NW.js
// (Game.exe) always has. A game plugin that reads `process.versions` at the top
// level then throws in a browser, and the rest of that file never runs: the
// plugins after it on the same file are gone. With the object here they load
// as they do on the desktop. It is deliberately NOT a Node.js process: no
// `require`, and an empty `versions` without `node-webkit`, so the engine's
// `Utils.isNwjs()` and every `if (!Utils.isNwjs()) return` branch still see a
// browser (a plugin that thought otherwise would call `require('fs')`).
//=============================================================================

(() => {
  "use strict";

  // Before the game's plugins are read: they run at load time.
  if (typeof window.process === "undefined") {
    window.process = {
      versions: {}, // no "node-webkit": NW.js-only branches stay off
      platform: "",
      arch: "",
      env: {},
      argv: [],
      browser: true,
      title: "browser",
      version: "",
      cwd: () => "/",
      nextTick: (fn, ...args) => setTimeout(() => fn(...args), 0),
    };
  }

  const MARK = "[data-rwk-ui]";

  // The events a game plugin can use to take a tap or a key away from the
  // toolkit. A key's target is the focused control, which is inside the
  // toolkit while one of its dialogs is open.
  const UI_EVENTS = new Set([
    "mousedown", "mouseup", "mousemove",
    "touchstart", "touchmove", "touchend", "touchcancel",
    "pointerdown", "pointerup", "pointermove", "pointercancel",
    "click", "dblclick", "auxclick", "contextmenu", "wheel",
    "dragstart", "selectstart",
    "keydown", "keypress", "keyup",
  ]);

  const fromToolkit = (event) => {
    const target = event && event.target;
    return !!(target && typeof target.closest === "function" && target.closest(MARK));
  };

  // While a toolkit dialog is open (RWK_Core: panel() sets this on <html>),
  // its own key handling owns the keyboard: the game hears no key at all,
  // even one pressed after the focus went elsewhere (the canvas was tapped).
  // The game is paused behind the dialog, so nothing waits for those keys.
  const DIALOG = "data-rwk-dialog";
  const dialogOpen = () => {
    const root = document.documentElement;
    return !!(root && typeof root.hasAttribute === "function" && root.hasAttribute(DIALOG));
  };
  const isKey = (type) => type === "keydown" || type === "keypress" || type === "keyup";

  // A press is followed by the toolkit's own downs, moves and up; the press
  // itself is tracked by a token, one per kind of press, so its release is
  // dropped too (a game plugin cancelling touchend stops the button's click).
  // A press that began elsewhere keeps its release: with the release gone,
  // the game's Input would stay down for good (a finger that started on the
  // canvas and lifted over a dialog, a key released after a dialog took the
  // focus).
  const TOKENS = {
    mousedown: () => "mouse", mouseup: () => "mouse",
    touchstart: () => "touch", touchend: () => "touch", touchcancel: () => "touch",
    pointerdown: (e) => "p" + e.pointerId, pointerup: (e) => "p" + e.pointerId, pointercancel: (e) => "p" + e.pointerId,
    pointermove: (e) => "p" + e.pointerId,
    keydown: (e) => "k" + (e.code || e.key), keypress: (e) => "k" + (e.code || e.key), keyup: (e) => "k" + (e.code || e.key),
  };
  // A release is not a start: its own target says nothing (the pointer or the
  // focus may have moved onto the toolkit since), only the token does.
  const STARTS = new Set(["mousedown", "touchstart", "pointerdown", "keydown"]);
  const onUI = new Set(); // tokens of the presses that began on the toolkit

  // A listener on its own element only ever sees that element's events, so
  // only the ones on window, document and body can take the toolkit's away.
  const onGlobal = (node) => node === window || node === document || node === document.body;

  const captureOf = (options) => (typeof options === "boolean" ? options : !!(options && options.capture));

  const add = EventTarget.prototype.addEventListener;
  const remove = EventTarget.prototype.removeEventListener;
  const wrapped = new WeakMap(); // the listener -> [{ target, type, capture, fn }]

  // A function, or an object with handleEvent(), as addEventListener allows.
  const handlerOf = (listener) =>
    typeof listener === "function" ? listener : listener && typeof listener.handleEvent === "function" ? listener.handleEvent : null;

  EventTarget.prototype.addEventListener = function (type, listener, options) {
    const handler = handlerOf(listener);
    if (!handler || !UI_EVENTS.has(type) || !onGlobal(this)) {
      return add.call(this, type, listener, options);
    }
    const list = wrapped.get(listener) || [];
    const capture = captureOf(options);
    const signal = options && typeof options === "object" ? options.signal : null;
    if (signal && signal.aborted) return; // the browser adds nothing either
    // The same listener twice on the same node is one registration; the
    // browser cannot tell, since each one got a wrapper of its own.
    if (list.some((w) => w.target === this && w.type === type && w.capture === capture)) return;
    const record = { target: this, type, capture, fn: null };
    const forget = () => {
      const i = list.indexOf(record);
      if (i >= 0) list.splice(i, 1);
    };
    const fn = function (event) {
      // Removed, { once } fired, or the { signal } aborted: the browser may
      // still have this wrapper queued, so it stays quiet and keeps the list
      // honest (that is the browser's own job, where it does it already).
      if (record.aborted) return;
      if (record.once) forget();
      // This listener is the toolkit's own: it sees everything.
      if (listener.__rwkUI || handler.__rwkUI) {
        return typeof listener === "function" ? listener.call(this, event) : listener.handleEvent(event);
      }
      // A dialog on screen takes every key, wherever the focus went.
      if (isKey(type) && dialogOpen()) return;
      // A press that starts on the toolkit is the toolkit's, and so is
      // everything it goes on to send, up to the release (the monitor below
      // has already marked it, since it runs first).
      const token = TOKENS[type] && TOKENS[type](event || {});
      if (token ? onUI.has(token) : fromToolkit(event)) return;
      // The listener's own this: the object itself when it has handleEvent().
      return typeof listener === "function" ? listener.call(this, event) : listener.handleEvent(event);
    };
    record.fn = fn;
    record.once = !!(options && typeof options === "object" && options.once);
    if (signal && typeof signal.addEventListener === "function") {
      signal.addEventListener("abort", () => ((record.aborted = true), forget()));
    }
    // removeEventListener(the listener) must still find it.
    list.push(record);
    wrapped.set(listener, list);
    return add.call(this, type, fn, options);
  };

  EventTarget.prototype.removeEventListener = function (type, listener, options) {
    const list = handlerOf(listener) && wrapped.get(listener);
    if (list) {
      const capture = captureOf(options);
      const i = list.findIndex((w) => w.target === this && w.type === type && w.capture === capture);
      if (i >= 0) {
        const [w] = list.splice(i, 1);
        w.aborted = true; // a later dispatch of a copy already queued finds it gone
        return remove.call(this, type, w.fn, options);
      }
    }
    return remove.call(this, type, listener, options);
  };

  // Which presses are the toolkit's. This runs in the capture phase on the
  // window, before any listener the game adds later. A press keeps its mark
  // until the next start of its kind, so its moves and its release carry it
  // too; a start on the game clears it.
  for (const type of STARTS) {
    add.call(
      window,
      type,
      (event) => {
        const token = TOKENS[type](event || {});
        if (!token) return;
        if (fromToolkit(event)) onUI.add(token);
        else onUI.delete(token);
      },
      true
    );
  }

  // A press that starts on a toolkit button belongs to the toolkit: a game
  // that captures it on the canvas would otherwise get every later move and
  // the button would never be clicked.
  const held = new Set();
  const releaseHeld = (event) => event && held.delete(event.pointerId);
  add.call(window, "pointerdown", (event) => {
    if (!event || event.pointerId === undefined) return;
    if (fromToolkit(event)) held.add(event.pointerId);
    else held.delete(event.pointerId);
  }, true);
  add.call(window, "pointerup", releaseHeld, true);
  add.call(window, "pointercancel", releaseHeld, true);

  if (typeof Element !== "undefined" && Element.prototype.setPointerCapture) {
    const capture = Element.prototype.setPointerCapture;
    Element.prototype.setPointerCapture = function (pointerId) {
      if (held.has(pointerId) && !(this.closest && this.closest(MARK))) return;
      return capture.apply(this, arguments);
    };
  }

  window.__rwkGuard = true;
})();
