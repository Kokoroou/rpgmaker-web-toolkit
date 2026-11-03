// Toolkit dialogs over the game (RWK_Core.js: shield, choose): a tap on them
// must work and must not reach the game, even when a game plugin listens on
// window before the toolkit. RWK_Core runs in a VM over a tiny DOM.

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

function load() {
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
    history: { pushState() {}, back() {}, state: null },
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
    history: win.history,
    screen: win.screen,
    localStorage: { getItem: () => null, setItem() {} },
    setTimeout,
    clearTimeout,
  };
  vm.runInNewContext(source, context);
  return { RWK: win.RWK, game, TouchInput, SceneManager };
}

const touch = (type, x = 10, y = 10, touches = 1) => ({ type, changedTouches: [{ clientX: x, clientY: y }], touches: Array(touches).fill({}) });

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

test("shield: taps on a toolkit dialog never reach the document", async () => {
  const { RWK } = load();
  const seen = [];
  for (const type of ["mousedown", "touchstart", "pointerdown", "click"]) doc.addEventListener(type, (e) => seen.push(e.type));
  const answer = RWK.choose("Use cheats?", "", [{ label: "Cancel", value: false }, { label: "Use cheats", value: true }]);
  const { buttons } = question();
  for (const type of ["pointerdown", "mousedown", "touchstart"]) buttons[1].dispatchEvent({ type, changedTouches: [], touches: [] });
  buttons[1].dispatchEvent({ type: "click" });
  assert.deepEqual(seen, []);
  assert.equal(await answer, true);
});

test("shield: a touch a game plugin cancelled on window still presses the button, once", async () => {
  const { RWK } = load();
  // Like a touch plugin: window, capture phase, preventDefault (no click follows).
  win.addEventListener("touchstart", (e) => e.preventDefault(), { capture: true });
  const answer = RWK.choose("Use cheats?", "", [{ label: "Cancel", value: false }, { label: "Use cheats", value: true }]);
  const { buttons } = question();
  let clicks = 0;
  buttons[1].addEventListener("click", () => clicks++);
  buttons[1].dispatchEvent(touch("touchstart"));
  buttons[1].dispatchEvent(touch("touchend"));
  assert.equal(clicks, 1);
  assert.equal(await answer, true);
});

test("shield: a cancelled touch that scrolls, or a normal one, is not turned into a click", () => {
  load();
  const box = new Node("div");
  const b = new Node("button");
  box.appendChild(b);
  doc.body.appendChild(box);
  win.RWK.shield(box);
  let clicks = 0;
  b.addEventListener("click", () => clicks++);
  win.addEventListener("touchstart", (e) => e.target.cancel && e.preventDefault(), { capture: true });
  b.cancel = true;
  b.dispatchEvent(touch("touchstart", 10, 10));
  b.dispatchEvent(touch("touchmove", 10, 60));
  b.dispatchEvent(touch("touchend", 10, 60));
  assert.equal(clicks, 0, "a drag");
  b.cancel = false;
  b.dispatchEvent(touch("touchstart"));
  b.dispatchEvent(touch("touchend"));
  assert.equal(clicks, 0, "the browser sends the click itself");
  b.cancel = true;
  b.disabled = true;
  b.dispatchEvent(touch("touchstart"));
  b.dispatchEvent(touch("touchend"));
  assert.equal(clicks, 0, "a disabled button");
});

test("choose: the game waits for the answer and forgets the taps", async () => {
  const { RWK, game, TouchInput, SceneManager } = load();
  SceneManager.updateScene();
  assert.equal(game.scene, 1);
  const answer = RWK.choose("Use cheats?", "", [{ label: "OK", value: 1 }]);
  SceneManager.updateScene();
  assert.equal(game.scene, 1, "paused while the question is open");
  const cleared = TouchInput.cleared;
  question().buttons[0].dispatchEvent({ type: "click" });
  assert.equal(await answer, 1);
  assert.ok(TouchInput.cleared > cleared);
  SceneManager.updateScene();
  assert.equal(game.scene, 2);
});

test("TouchInput ignores presses that start on the toolkit, whoever hands them over", () => {
  const { TouchInput, game } = load();
  const box = new Node("div");
  const inside = new Node("button");
  box.appendChild(inside);
  doc.body.appendChild(box);
  win.RWK.shield(box);
  const canvas = doc.body.appendChild(new Node("canvas"));
  TouchInput._onTouchStart({ type: "touchstart", target: inside });
  TouchInput._onMouseDown({ type: "mousedown", target: inside });
  assert.deepEqual(game.touches, []);
  TouchInput._onTouchStart({ type: "touchstart", target: canvas });
  assert.deepEqual(game.touches, ["touchstart"]);
});
