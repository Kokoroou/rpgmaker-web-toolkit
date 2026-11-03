// The phone's Back key and back swipe on toolkit windows (RWK_Core.js: onBack,
// choose): Back closes the window on top instead of leaving the game.
// RWK_Core runs in a VM over a tiny DOM.

import assert from "node:assert/strict";
import fs from "node:fs";
import test from "node:test";
import vm from "node:vm";

const source = fs.readFileSync(new URL("../runtime/RWK_Core.js", import.meta.url), "utf8");

// Just enough DOM: a tree, attributes, closest(), and events that bubble to
// window (capture listeners on window run first, as in a browser).
class Node {
  constructor(tag = "div") {
    this.tagName = tag.toUpperCase();
    this.children = [];
    this.parentNode = null;
    this.attrs = {};
    this.listeners = {};
    this.style = {};
    this.className = "";
    this.textContent = "";
    this.innerHTML = "";
    this.disabled = false;
  }
  append(...nodes) {
    for (const n of nodes) if (n instanceof Node) this.appendChild(n);
  }
  appendChild(n) {
    n.parentNode = this;
    this.children.push(n);
    return n;
  }
  remove() {
    if (!this.parentNode) return;
    this.parentNode.children = this.parentNode.children.filter((c) => c !== this);
    this.parentNode = null;
    for (const fn of observers) queueMicrotask(fn);
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
  addEventListener(type, fn, opts) {
    (this.listeners[type] ||= []).push({ fn, capture: opts === true || !!(opts && opts.capture) });
  }
  dispatchEvent(event) {
    return dispatch(this, event);
  }
}

let doc;
let win;
let observers = [];
class MutationObserver {
  constructor(fn) {
    this.fn = fn;
  }
  observe() {
    observers.push(this.fn);
  }
}

function dispatch(target, event) {
  event.target = target;
  let stopped = false;
  event.stopPropagation = () => (stopped = true);
  event.preventDefault = () => (event.defaultPrevented = true);
  event.defaultPrevented = false;
  const run = (node, capture) => {
    for (const l of node.listeners[event.type] || []) if (l.capture === capture || node === target) l.fn.call(node, event);
  };
  run(win, true);
  if (stopped) return !event.defaultPrevented;
  const path = [];
  for (let n = target; n; n = n.parentNode) path.push(n);
  path.push(win);
  for (const node of path) {
    run(node, false);
    if (stopped) break;
  }
  return !event.defaultPrevented;
}

// history with real async back(): popstate comes later, as in a browser.
function fakeHistory() {
  const w = win; // a back() still pending when the test ends must not reach the next one's window
  const h = {
    entries: [null],
    get state() {
      return this.entries[this.entries.length - 1];
    },
    pushState(state) {
      this.entries.push(state);
    },
    back() {
      setTimeout(() => this.pop(), 0);
    },
    // The player's Back key (or our back() landing).
    pop() {
      if (this.entries.length > 1) this.entries.pop();
      for (const l of w.listeners.popstate || []) l.fn({ type: "popstate" });
    },
  };
  return h;
}
const tick = () => new Promise((r) => setTimeout(r, 5));

function load() {
  observers = [];
  win = new Node("window");
  doc = new Node("#document");
  doc.documentElement = new Node("html");
  doc.head = new Node("head");
  doc.body = new Node("body");
  doc.documentElement.append(doc.head, doc.body);
  doc.createElement = (tag) => new Node(tag);
  doc.documentElement.parentNode = doc; // the document sits between <html> and window

  const game = { scene: 0, touches: [] };
  const TouchInput = {
    cleared: 0,
    clear() {
      this.cleared++;
    },
    _onTouchStart(e) {
      game.touches.push(e.type);
    },
    _onMouseDown(e) {
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
  Object.assign(win, {
    innerWidth: 800,
    innerHeight: 600,
    isSecureContext: false,
    TouchInput,
    MutationObserver,
    history: fakeHistory(),
    screen: {},
    caches: undefined,
  });
  const context = {
    window: win,
    document: doc,
    navigator: { userAgent: "test" },
    console: { ...console, info() {} },
    PluginManager: { parameters: () => ({ config: "{}" }) },
    Utils: { RPGMAKER_NAME: "MV", isMobileDevice: () => false },
    Graphics: { _updateRealScale() {} },
    SceneManager,
    TouchInput,
    Input: { keyMapper: {}, clear() {} },
    MouseEvent,
    MutationObserver,
    history: win.history,
    screen: win.screen,
    localStorage: { getItem: () => null, setItem() {} },
    setTimeout,
    clearTimeout,
  };
  vm.runInNewContext(source, context);
  return { RWK: win.RWK, game, TouchInput, SceneManager };
}

// The question's buttons, once choose() put it on the page.
function question() {
  const overlay = doc.body.children.find((c) => c.className === "rwk-modal");
  const buttons = [];
  const walk = (n) => {
    if (n.tagName === "BUTTON") buttons.push(n);
    n.children.forEach(walk);
  };
  walk(overlay);
  return { overlay, buttons };
}

test("Back closes the window on top: a question with a cancel, then the panel under it", async () => {
  const { RWK } = load();
  const h = win.history;
  const panel = doc.body.appendChild(new Node("div"));
  let closed = 0;
  RWK.onBack(panel, () => (closed++, panel.remove()));
  assert.equal(h.entries.length, 2, "one history entry while a window is open");
  const answer = RWK.choose("Use cheats?", "", [{ label: "Cancel", value: false, cancel: true }, { label: "Use cheats", value: true }]);
  assert.equal(h.entries.length, 2, "still one entry for two windows");
  h.pop(); // the player swipes back
  assert.equal(await answer, false, "the question is cancelled");
  assert.equal(closed, 0, "the panel under it stays");
  assert.equal(h.entries.length, 2, "and keeps an entry for the next Back");
  h.pop();
  assert.equal(closed, 1);
  assert.equal(h.entries.length, 1, "no entry left: the next Back leaves the game as usual");
});

test("Back does not answer a real choice, and closing a window by hand drops its entry", async () => {
  const { RWK } = load();
  const h = win.history;
  let picked = null;
  RWK.choose("Saves differ", "", [{ label: "Keep this device's", value: "local" }, { label: "Use the cloud's", value: "cloud" }]).then((v) => (picked = v));
  h.pop();
  await tick();
  assert.equal(picked, null, "still asking");
  assert.equal(h.entries.length, 2, "the entry is back");
  question().buttons[1].dispatchEvent({ type: "click" });
  await tick();
  assert.equal(picked, "cloud");
  assert.equal(h.entries.length, 1, "answered: its entry is gone (history.back)");

  // A panel closed by its own button: the entry goes with it.
  const panel = doc.body.appendChild(new Node("div"));
  RWK.onBack(panel, () => panel.remove());
  assert.equal(h.entries.length, 2);
  panel.remove();
  await tick();
  assert.equal(h.entries.length, 1, "closed by hand: its entry is gone");

  // A question that opens right after the ⚙ menu closed, before that back() lands.
  const menu = doc.body.appendChild(new Node("div"));
  RWK.onBack(menu, () => menu.remove());
  menu.remove();
  await Promise.resolve(); // the observer ran: back() is on its way
  RWK.choose("OK?", "", [{ label: "OK", value: 1 }]);
  await tick();
  assert.equal(h.entries.length, 2, "the question has its own entry once our back() went through");
  h.pop();
  await tick();
  assert.equal(doc.body.children.some((c) => c.className === "rwk-modal"), false, "Back answers a question with one button");
});

test("Back on a question lets the game run again, like a tap on its button", async () => {
  const { RWK, game, TouchInput, SceneManager } = load();
  const answer = RWK.choose("Use cheats?", "", [{ label: "Cancel", value: false, cancel: true }, { label: "Use cheats", value: true }]);
  SceneManager.updateScene();
  assert.equal(game.scene, 0, "paused while the question is open");
  const cleared = TouchInput.cleared;
  win.history.pop();
  assert.equal(await answer, false);
  assert.ok(TouchInput.cleared > cleared, "the taps read meanwhile are dropped");
  SceneManager.updateScene();
  assert.equal(game.scene, 1);
});
