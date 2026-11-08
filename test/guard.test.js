// "Hostile game" matrix: a game plugin that cancels the touch, swallows click
// or captures the pointer must not leave the toolkit's buttons and dialogs
// dead, on a desktop or a phone. rwk-guard.js runs before the game's plugins
// and makes their listeners skip events that start on a toolkit element;
// RWK.panel() gives every dialog Esc, Enter, Tab and the focus.
// Both run in a VM over a tiny DOM.

import assert from "node:assert/strict";
import fs from "node:fs";
import test from "node:test";
import vm from "node:vm";

const guardSource = fs.readFileSync(new URL("../runtime/rwk-guard.js", import.meta.url), "utf8");
const coreSource = fs.readFileSync(new URL("../runtime/RWK_Core.js", import.meta.url), "utf8");

//---------------------------------------------------------------------------
// Just enough DOM: EventTarget with capture/bubble, a tree, closest(), focus.
//---------------------------------------------------------------------------

const captureOf = (opts) => (typeof opts === "boolean" ? opts : !!(opts && opts.capture));
const onceOf = (opts) => !!(opts && typeof opts === "object" && opts.once);

let doc;
let win;

class EventTarget {
  constructor() {
    this.listeners = {};
  }
  addEventListener(type, fn, opts) {
    (this.listeners[type] ||= []).push({ fn, capture: captureOf(opts), once: onceOf(opts) });
  }
  removeEventListener(type, fn, opts) {
    const list = this.listeners[type] || [];
    const i = list.findIndex((l) => l.fn === fn && l.capture === captureOf(opts));
    if (i >= 0) list.splice(i, 1);
  }
  dispatchEvent(event) {
    return dispatch(this, event);
  }
}

class Node extends EventTarget {
  constructor(tag = "div") {
    super();
    this.tagName = tag.toUpperCase();
    this.children = [];
    this.parentNode = null;
    this.attrs = {};
    this.style = {};
    this.className = "";
    this.innerHTML = "";
    this.disabled = false;
    this._text = "";
  }
  get textContent() {
    return this._text;
  }
  set textContent(value) {
    this._text = String(value);
    this.children = [];
  }
  append(...nodes) {
    for (const n of nodes) if (n instanceof Node) this.appendChild(n);
  }
  appendChild(n) {
    n.parentNode = this;
    this.children.push(n);
    return n;
  }
  insertBefore(n, before) {
    n.parentNode = this;
    const i = this.children.indexOf(before);
    this.children.splice(i < 0 ? this.children.length : i, 0, n);
    return n;
  }
  remove() {
    if (!this.parentNode) return;
    this.parentNode.children = this.parentNode.children.filter((c) => c !== this);
    this.parentNode = null;
  }
  get isConnected() {
    let n = this;
    while (n.parentNode) n = n.parentNode;
    return n === doc;
  }
  setAttribute(k, v) {
    this.attrs[k] = String(v);
  }
  getAttribute(k) {
    return k in this.attrs ? this.attrs[k] : null;
  }
  hasAttribute(k) {
    return k in this.attrs;
  }
  removeAttribute(k) {
    delete this.attrs[k];
  }
  matches(sel) {
    return sel.split(",").some((s) => {
      s = s.trim();
      const attr = /^\[([\w-]+)\]$/.exec(s);
      if (attr) return attr[1] in this.attrs;
      if (s.startsWith(".")) return this.className.split(" ").includes(s.slice(1));
      return this.tagName === s.toUpperCase();
    });
  }
  closest(sel) {
    for (let n = this; n instanceof Node; n = n.parentNode) if (n.matches(sel)) return n;
    return null;
  }
  querySelector() {
    return null;
  }
  querySelectorAll() {
    return [];
  }
  focus() {
    doc.activeElement = this;
  }
  click() {
    this.dispatchEvent({ type: "click", bubbles: true, cancelable: true });
  }
}

// window, document and the elements all dispatch the same way: capture from
// the top down, then up again, stopping where a listener said so.
function dispatch(target, event) {
  event.target = target;
  if (event.defaultPrevented === undefined) event.defaultPrevented = false;
  let stopped = false;
  event.stopPropagation = () => (stopped = true);
  event.stopImmediatePropagation = () => (stopped = true);
  event.preventDefault = () => {
    if (event.cancelable !== false) event.defaultPrevented = true;
  };
  // The ancestors, nearest first, then the window.
  const up = [];
  for (let n = target; n; n = n.parentNode) up.push(n);
  if (up[up.length - 1] !== win) up.push(win);
  const fire = (node) => {
    for (const l of [...(node.listeners[event.type] || [])]) {
      if (stopped) return;
      if (l.once) node.removeEventListener(event.type, l.fn, l.capture);
      l.fn.call(node, event);
    }
  };
  // Capture: from the window down to the target's parent.
  for (let i = up.length - 1; i > 0; i--) {
    for (const l of [...(up[i].listeners[event.type] || [])]) {
      if (stopped) return !event.defaultPrevented;
      if (!l.capture) continue;
      if (l.once) up[i].removeEventListener(event.type, l.fn, true);
      l.fn.call(up[i], event);
    }
  }
  // The target itself: its capture listeners, then its bubble listeners.
  for (const l of [...(target.listeners[event.type] || [])]) {
    if (stopped) return !event.defaultPrevented;
    if (l.once) target.removeEventListener(event.type, l.fn, l.capture);
    l.fn.call(target, event);
  }
  for (const node of up.slice(1)) {
    if (stopped) break;
    for (const l of [...(node.listeners[event.type] || [])]) {
      if (stopped) break;
      if (l.capture) continue;
      if (l.once) node.removeEventListener(event.type, l.fn, false);
      l.fn.call(node, event);
    }
  }
  return !event.defaultPrevented;
}

// hostile: what the game's plugins do with the events they see. Each one runs
// on window in the capture phase, before anything the toolkit added later.
const HOSTILE = {
  none: () => {},
  "cancel touchend": (e) => e.type === "touchend" && e.preventDefault(),
  "swallow click": (e) => e.type === "click" && e.stopPropagation(),
  "swallow every tap": (e) => /touch|click/.test(e.type) && e.stopPropagation(),
};

// -> { RWK, clicks, keys, TouchInput, game }
function load(hostile = "none") {
  win = new Node("window");
  doc = new Node("#document");
  doc.documentElement = new Node("html");
  doc.head = new Node("head");
  doc.body = new Node("body");
  doc.documentElement.append(doc.head, doc.body);
  doc.documentElement.parentNode = doc;
  doc.body.parentNode = doc.documentElement;
  doc.createElement = (tag) => new Node(tag);
  doc.activeElement = doc.body;
  doc.visibilityState = "visible";

  const seen = [];
  const keys = [];

  const canvas = new Node("canvas");
  doc.body.appendChild(canvas);
  const captured = [];
  Node.prototype.setPointerCapture = function (id) {
    captured.push(id);
    this.captured = id;
  };

  const game = { scene: 0, touches: [] };
  const TouchInput = {
    clear() {},
    _onTouchStart(e) {
      game.touches.push(e.type);
    },
  };
  const SceneManager = {
    updateScene() {
      game.scene++;
    },
  };
  class MouseEvent {
    constructor(type, init = {}) {
      this.type = type;
      Object.assign(this, init);
    }
  }
  class KeyboardEvent {
    constructor(type, init = {}) {
      this.type = type;
      this.key = "";
      this.keyCode = 0;
      this.shiftKey = false;
      Object.assign(this, init);
    }
  }
  Object.assign(win, {
    innerWidth: 800,
    innerHeight: 600,
    isSecureContext: false,
    TouchInput,
    history: { pushState() {}, back() {}, state: null },
    screen: {},
    caches: undefined,
  });
  const context = {
    window: win,
    document: doc,
    EventTarget,
    Element: Node,
    navigator: { userAgent: "test" },
    console: { ...console, info() {} },
    PluginManager: { parameters: () => ({ config: "{}" }) },
    Utils: { RPGMAKER_NAME: "MV", isMobileDevice: () => false },
    Graphics: { _updateRealScale() {}, printError() {} },
    SceneManager,
    TouchInput,
    Input: { keyMapper: {}, clear() {} },
    MouseEvent,
    KeyboardEvent,
    history: win.history,
    screen: win.screen,
    localStorage: { getItem: () => null, setItem() {} },
    setTimeout,
    clearTimeout,
  };
  // The page's scripts, in order: the guard, then the game's plugins (the
  // hostile listeners, which the guard has already wrapped), then the toolkit.
  vm.runInNewContext(guardSource, context);
  win.addEventListener("touchend", HOSTILE[hostile], { capture: true });
  win.addEventListener("click", HOSTILE[hostile], { capture: true });
  // What the game sees, from a listener it added before the toolkit's.
  for (const type of ["click", "touchstart", "touchend", "keydown"]) {
    win.addEventListener(type, () => seen.push(type), { capture: true });
  }
  win.addEventListener("keydown", (e) => keys.push(e.key), { capture: true });
  vm.runInNewContext(coreSource, context);
  return { RWK: win.RWK, game, TouchInput, SceneManager, canvas, captured, seen, keys };
}

const touch = (type, x = 10, y = 10) => ({
  type,
  changedTouches: [{ clientX: x, clientY: y }],
  touches: [{ clientX: x, clientY: y }],
});
const press = (node) => node.dispatchEvent({ type: "pointerdown", pointerId: 1 });
const release = (node) => node.dispatchEvent({ type: "pointerup", pointerId: 1 });
// A key goes to what has the focus, as in a browser.
const key = (name, init = {}) => doc.activeElement.dispatchEvent({ type: "keydown", key: name, ...init });

// The question's box and its buttons.
function question() {
  const overlay = doc.body.children.find((c) => c.className === "rwk-modal");
  const buttons = [];
  const input = [];
  const walk = (n) => {
    if (n.tagName === "BUTTON" || n.tagName === "INPUT") (n.tagName === "BUTTON" ? buttons : input).push(n);
    n.children.forEach(walk);
  };
  if (overlay) walk(overlay);
  return { overlay, buttons, fields: input };
}

//---------------------------------------------------------------------------
// The matrix: the ⚙ menu's buttons, the cheat question and its answer.
//---------------------------------------------------------------------------

for (const hostile of Object.keys(HOSTILE)) {
  test(`guard (${hostile}): a toolkit dialog's buttons still answer, and the game keeps its own events`, async () => {
    const { RWK, seen } = load(hostile);
    const answer = RWK.choose("Use cheats?", "", [
      { label: "Cancel", value: false, cancel: true },
      { label: "Use cheats", value: true, primary: true },
    ]);
    const { buttons, overlay } = question();
    seen.length = 0;

    // A phone tap: the pointer, the touch, then the click the browser sends.
    press(buttons[1]);
    release(buttons[1]);
    buttons[1].dispatchEvent(touch("touchstart"));
    buttons[1].dispatchEvent(touch("touchend"));
    buttons[1].dispatchEvent({ type: "click" });

    assert.equal(await answer, true, "Use cheats answers");
    assert.deepEqual(seen, [], "the game heard none of the dialog's taps");
    assert.equal(overlay.isConnected, false);
  });

  test(`guard (${hostile}): a press the game captures on its canvas does not steal a toolkit button`, async () => {
    const { RWK, captured } = load(hostile);
    const answer = RWK.choose("Download game (ZIP)", "", [
      { label: "Cancel", value: false },
      { label: "Download", value: true, primary: true },
    ]);
    const { buttons } = question();
    // As a game plugin does: its canvas takes every press it sees.
    win.addEventListener("pointerdown", (e) => e.target.setPointerCapture && e.target.setPointerCapture(e.pointerId), { capture: true });
    press(buttons[1]);
    buttons[1].dispatchEvent({ type: "click" });
    assert.equal(await answer, true);
    assert.deepEqual(captured, [], "the game captured nothing");
  });
}

test("guard: a press that starts on the toolkit is never captured by the game's element", () => {
  const { captured, canvas } = load();
  const box = new Node("div");
  box.setAttribute("data-rwk-ui", "");
  const btn = new Node("button");
  box.appendChild(btn);
  doc.body.appendChild(box);
  // The game's canvas takes every pointer it is offered, as a plugin would.
  canvas.addEventListener("pointerdown", (e) => canvas.setPointerCapture(e.pointerId));
  press(btn);
  assert.deepEqual(captured, [], "the toolkit's press is not given to the game");
  canvas.dispatchEvent({ type: "pointerdown", pointerId: 2 });
  assert.equal(canvas.captured, 2, "the game's own press still is");
  release(canvas);
  // Once the toolkit's press is over, the game may capture again.
  press(btn);
  canvas.dispatchEvent({ type: "pointerdown", pointerId: 3 });
  assert.equal(canvas.captured, 3);
});

test("guard: adding the same listener twice, or aborting it, behaves as in the browser", () => {
  const { seen } = load();
  let hits = 0;
  const fn = () => hits++;
  win.addEventListener("click", fn);
  win.addEventListener("click", fn);
  doc.body.dispatchEvent({ type: "click" });
  assert.equal(hits, 1, "the same listener on the same node is one registration");

  const controller = new AbortController();
  const freed = () => hits++;
  win.addEventListener("click", freed, { signal: controller.signal });
  doc.body.dispatchEvent({ type: "click" });
  controller.abort();
  doc.body.dispatchEvent({ type: "click" });
  assert.equal(hits, 4, "the aborted listener stops, the other one keeps counting");
  // And the listener list the guard keeps does not grow without bound.
  for (let i = 0; i < 50; i++) win.addEventListener("keydown", () => {}, { once: true });
  for (let i = 0; i < 50; i++) doc.body.dispatchEvent({ type: "keydown" });
  assert.ok(seen.length > 0);
});

test("guard: a press that starts on the game keeps its release, so its Input never stays down", () => {
  const { seen } = load();
  // A finger starts on the canvas (the game's) and lifts over a toolkit button
  // that opened meanwhile: the game must still hear the touch end.
  const overlay = doc.createElement("div");
  overlay.className = "rwk-modal";
  overlay.setAttribute("data-rwk-ui", "");
  const btn = doc.createElement("button");
  overlay.appendChild(btn);
  doc.body.appendChild(overlay);
  btn.dispatchEvent({ type: "touchstart" });
  const canvas = doc.body.children[0];
  canvas.dispatchEvent({ type: "touchstart" });
  btn.dispatchEvent({ type: "touchend" });
  assert.deepEqual(seen, ["touchstart", "touchend"], "the press that began on the game ended on it");

  // A key held down when a dialog took the focus is released inside it.
  seen.length = 0;
  const heard = [];
  win.addEventListener("keyup", (e) => heard.push(e.key), { capture: true });
  btn.dispatchEvent({ type: "keydown", key: "ArrowLeft", code: "ArrowLeft" });
  btn.dispatchEvent({ type: "keyup", key: "ArrowLeft", code: "ArrowLeft" });
  assert.deepEqual(seen, [], "a key that started in the dialog stays there");
  assert.deepEqual(heard, [], "its release too");
  canvas.dispatchEvent({ type: "keydown", key: "ArrowDown", code: "ArrowDown" });
  btn.dispatchEvent({ type: "keyup", key: "ArrowDown", code: "ArrowDown" });
  assert.deepEqual(seen, ["keydown"], "and the game hears the one it started");
  assert.deepEqual(heard, ["ArrowDown"], "the release included");
});

test("guard: the game's listeners keep removeEventListener and once working", () => {
  const { seen } = load();
  let hits = 0;
  const fn = () => hits++;
  win.addEventListener("click", fn);
  win.removeEventListener("click", fn);
  doc.body.dispatchEvent({ type: "click" });
  assert.equal(hits, 0);
  win.addEventListener("click", () => hits++, { once: true });
  doc.body.dispatchEvent({ type: "click" });
  doc.body.dispatchEvent({ type: "click" });
  assert.equal(hits, 1);
  assert.ok(seen.length >= 2);
});

//---------------------------------------------------------------------------
// One frame for every dialog: pause, Esc, Enter, Tab and the focus.
//---------------------------------------------------------------------------

test("dialog: it pauses the game, focuses the primary button and takes the keys", async () => {
  const { RWK, game, keys, SceneManager } = load();
  SceneManager.updateScene();
  assert.equal(game.scene, 1);
  const answer = RWK.choose("Use cheats?", "", [
    { label: "Cancel", value: false, cancel: true },
    { label: "Use cheats", value: true, primary: true },
  ]);
  const { buttons } = question();
  SceneManager.updateScene();
  assert.equal(game.scene, 1, "paused while a question is open");
  assert.equal(doc.activeElement, buttons[1], "the focus starts on the primary button");

  doc.activeElement = buttons[0];
  key("Tab");
  assert.equal(doc.activeElement, buttons[1], "Tab moves inside the dialog");
  key("Tab");
  assert.equal(doc.activeElement, buttons[0], "and comes back around");
  key("Tab", { shiftKey: true });
  assert.equal(doc.activeElement, buttons[1], "Shift+Tab goes back");

  key("Enter");
  assert.equal(await answer, true, "Enter presses the primary button");
  assert.deepEqual(keys, [], "the game never saw a key");
  SceneManager.updateScene();
  assert.equal(game.scene, 2, "the game runs again");
});

test("dialog: Esc cancels, and the cancel option is the phone's Back too", async () => {
  const { RWK, keys } = load();
  const answer = RWK.choose("Download game (ZIP)", "", [
    { label: "Cancel", value: false, cancel: true },
    { label: "Download", value: true, primary: true },
  ]);
  key("Escape");
  assert.equal(await answer, false);
  assert.deepEqual(keys, [], "the game's own menu does not open behind the dialog");
});

test("dialog: a field keeps its own keys, so Backspace and the arrows work in it", async () => {
  const { RWK, keys, seen } = load();
  const overlay = doc.createElement("div");
  overlay.className = "rwk-modal";
  const box = doc.createElement("div");
  box.className = "rwk-modal-box";
  const input = doc.createElement("input");
  const save = doc.createElement("button");
  save.textContent = "Save";
  box.append(input, save);
  overlay.appendChild(box);
  RWK.panel(overlay, { close: () => overlay.remove() });
  assert.equal(doc.activeElement, input, "the first control gets the focus");
  // The engine prevents the default of these keys on window; the dialog must
  // not let it eat them in its own field.
  win.addEventListener("keydown", (e) => e.preventDefault(), { capture: true });
  const kept = input.dispatchEvent({ type: "keydown", key: "Backspace", cancelable: true });
  assert.equal(kept, true, "the engine did not cancel it in the dialog");
  assert.deepEqual(keys, [], "the game did not see the key either");
  // The control's own listener still runs: MakerLens makes the link on Enter
  // in its note, and the dialog must not cut the key off at the window.
  const typed = [];
  input.addEventListener("keydown", (e) => typed.push(e.key));
  input.dispatchEvent({ type: "keydown", key: "Enter", cancelable: true });
  assert.deepEqual(typed, ["Enter"], "a field's own key listener sees the key");
  assert.deepEqual(keys, [], "and the game still does not");
  // Outside the dialog the game's own keys still reach it.
  key("Enter");
  assert.equal(overlay.isConnected, true, "Enter in a field does not press the buttons");
});

test("dialog: a key pressed after the focus left the dialog still never reaches the game", async () => {
  const { RWK, keys } = load();
  const answer = RWK.choose("Use cheats?", "", [
    { label: "Cancel", value: false, cancel: true },
    { label: "Use cheats", value: true, primary: true },
  ]);
  // The player resized the window or tapped the canvas: the focus left the box.
  const canvas = doc.body.children[0];
  const onCanvas = new EventTarget();
  onCanvas.focus = () => (doc.activeElement = onCanvas);
  onCanvas.closest = () => null;
  onCanvas.focus();
  onCanvas.dispatchEvent({ type: "keydown", key: "Escape", code: "Escape" });
  onCanvas.dispatchEvent({ type: "keyup", key: "Escape", code: "Escape" });
  assert.equal(await answer, false, "the question was still answered with Esc");
  assert.deepEqual(keys, [], "and the game heard no key at all");

  // Once nothing is open, the game has its keys back.
  canvas.dispatchEvent({ type: "keydown", key: "ArrowDown", code: "ArrowDown" });
  assert.deepEqual(keys, ["ArrowDown"]);
});

test("dialog: a panel that must be answered ignores Esc", async () => {
  const { RWK } = load();
  const overlay = doc.createElement("div");
  overlay.className = "rwk-modal";
  const box = doc.createElement("div");
  const ok = doc.createElement("button");
  ok.textContent = "Got it";
  box.appendChild(ok);
  overlay.appendChild(box);
  RWK.panel(overlay, { box });
  key("Escape");
  assert.equal(overlay.isConnected, true);
});

test("dialogs: only the one on top takes Esc, and closing it focuses the one below", () => {
  const { RWK } = load();
  const open = (title) => {
    const overlay = doc.createElement("div");
    overlay.className = "rwk-modal";
    const box = doc.createElement("div");
    const b = doc.createElement("button");
    b.textContent = title;
    box.appendChild(b);
    overlay.appendChild(box);
    const close = () => {
      overlay.remove();
      if (done) done();
    };
    const done = RWK.panel(overlay, { close });
    return { overlay, button: b };
  };
  const first = open("one");
  const second = open("two");
  assert.equal(doc.activeElement, second.button, "the newest dialog has the focus");
  key("Escape");
  assert.equal(second.overlay.isConnected, false);
  assert.equal(first.overlay.isConnected, true, "the one below stays open");
  assert.equal(doc.activeElement, first.button, "and gets the focus back");
});

//---------------------------------------------------------------------------
// The toolkit's layers are over anything the game draws.
//---------------------------------------------------------------------------

test("layers: every toolkit layer sits above a game's own z-index", () => {
  // The z-index of a rule, read from its text: `.rwk-modal{…}` (no regex, so
  // the selector's dots and braces are not special).
  const zIndexOf = (source, selector) => {
    const start = source.indexOf(selector + "{");
    if (start < 0) return 0;
    const rule = source.slice(start, source.indexOf("}", start));
    const at = rule.indexOf("z-index:");
    return at < 0 ? 0 : parseInt(rule.slice(at + 8).trim(), 10);
  };
  const mobile = fs.readFileSync(new URL("../runtime/RWK_MobileControls.js", import.meta.url), "utf8");
  for (const [source, selector] of [
    [coreSource, ".rwk-modal"],
    [coreSource, ".rwk-toast"],
    [coreSource, ".rwk-tools-btn"],
    [mobile, ".rwk-pad"],
  ]) {
    // The layers stack among themselves (pad < tools button < dialogs <
    // toasts); all of them are over any z-index a game plugin would use.
    assert.ok(zIndexOf(source, selector) >= 2147481000, `${selector} is above the game`);
  }
});
