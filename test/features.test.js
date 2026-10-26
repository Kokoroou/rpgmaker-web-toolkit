// The deployer's feature settings as the runtime plugins read them. Each
// plugin runs in a VM with the few engine globals it touches at load time.

import assert from "node:assert/strict";
import fs from "node:fs";
import test from "node:test";
import vm from "node:vm";

const source = (name) => fs.readFileSync(new URL(`../runtime/${name}.js`, import.meta.url), "utf8");

function load(name, config, { stored = {}, globals = {} } = {}) {
  const tools = [];
  const window = {
    RWK: {
      config: { gameId: "g", ...config },
      engine: "MZ",
      storage: { get: (key, fallback = null) => (key in stored ? stored[key] : fallback), set: (key, value) => (stored[key] = value) },
      tools: { add: (t) => tools.push(t), isOpen: () => false },
      toast() {},
      icons: {},
    },
    addEventListener() {},
  };
  const element = () => ({ textContent: "", appendChild() {} });
  const context = {
    window,
    console,
    document: { createElement: element, head: element() },
    Input: { keyMapper: {} },
    SceneManager: { updateScene() {} },
    ...globals,
  };
  vm.runInNewContext(source(name), context);
  const labels = () => tools.map((t) => (typeof t.label === "function" ? t.label() : t.label));
  return { tools, labels, context, stored };
}

const value = (v) => (typeof v === "function" ? v() : v);

test("fast forward: top speed, starting speed, lock", () => {
  const free = load("RWK_Speed", { fastForward: { maxSpeed: 4, speed: 3, inBattle: true, lock: false } });
  assert.deepEqual(free.labels(), ["Fast forward", "Fast-forward speed: ×3"]);
  const speed = free.tools[1];
  speed.onSelect();
  assert.equal(value(speed.label), "Fast-forward speed: ×4");
  speed.onSelect();
  assert.equal(value(speed.label), "Fast-forward speed: ×2", "wraps around");

  const capped = load("RWK_Speed", { fastForward: { maxSpeed: 3 } }, { stored: { "rwk.speed.g": 4 } });
  assert.equal(value(capped.tools[1].label), "Fast-forward speed: ×2", "a remembered speed over the limit is dropped");

  const locked = load("RWK_Speed", { fastForward: { maxSpeed: 4, speed: 3, lock: true } }, { stored: { "rwk.speed.g": 2 } });
  assert.deepEqual(locked.labels(), ["Fast forward"], "no speed to pick");
  assert.deepEqual(load("RWK_Speed", { fastForward: { maxSpeed: 2 } }).labels(), ["Fast forward"], "one speed: nothing to pick");
  assert.match(value(load("RWK_Speed", { fastForward: { inBattle: false } }).tools[0].detail), /not in battles/);
  assert.equal(load("RWK_Speed", { fastForward: false }).tools.length, 0);
  assert.equal(load("RWK_Speed", { fastForward: true }).tools.length, 2, "builds that still say true");
});

test("fast forward: off in battles when the deployer says so", () => {
  let updates = 0;
  let battle = false;
  const globals = {
    SceneManager: {
      updateScene() {
        updates++;
      },
      isSceneChanging: () => false,
      isCurrentSceneStarted: () => true,
      updateInputData() {},
      _scene: {},
    },
    $gameParty: { inBattle: () => battle },
  };
  const run = load("RWK_Speed", { fastForward: { maxSpeed: 4, speed: 3, inBattle: false } }, { globals });
  run.context.window.$gameParty = globals.$gameParty; // the plugin checks window.$gameParty first
  run.tools[0].onSelect(); // on
  run.context.SceneManager.updateScene();
  assert.equal(updates, 3);
  battle = true;
  updates = 0;
  run.context.SceneManager.updateScene();
  assert.equal(updates, 1);
});

function messageGlobals() {
  class Window_Message {
    newPage() {}
    update() {}
    isTriggered() {
      return false;
    }
  }
  class Window_ScrollText {
    isFastForward() {
      return false;
    }
  }
  return { Window_Message, Window_ScrollText };
}

test("message modes: which modes, the starting one, lock", () => {
  const all = load("RWK_Message", { messageMode: { auto: true, skip: true, mode: "normal", autoSpeed: "normal" } }, { globals: messageGlobals() });
  assert.deepEqual(all.labels(), ["Messages: Normal", "Auto speed: Normal"]);
  all.tools[0].onSelect();
  all.tools[0].onSelect();
  assert.equal(value(all.tools[0].label), "Messages: Skip");

  const noSkip = load("RWK_Message", { messageMode: { skip: false } }, { globals: messageGlobals() });
  noSkip.tools[0].onSelect();
  noSkip.tools[0].onSelect();
  assert.equal(value(noSkip.tools[0].label), "Messages: Normal", "Normal → Auto → Normal, never Skip");

  const starts = load("RWK_Message", { messageMode: { mode: "auto", autoSpeed: "slow" } }, { globals: messageGlobals() });
  assert.deepEqual(starts.labels(), ["Messages: Auto", "Auto speed: Slow"]);
  const chose = load("RWK_Message", { messageMode: { mode: "auto" } }, { globals: messageGlobals(), stored: { "rwk.messageMode.g": "normal" } });
  assert.equal(chose.labels()[0], "Messages: Normal", "the player's own choice wins over the starting mode");

  const locked = load("RWK_Message", { messageMode: { mode: "auto", autoSpeed: "fast", lock: true } }, { globals: messageGlobals(), stored: { "rwk.messageMode.g": "normal" } });
  assert.deepEqual(locked.labels(), [], "nothing to change");
  assert.deepEqual(load("RWK_Message", { messageMode: { auto: false, skip: false } }, { globals: messageGlobals() }).labels(), [], "tap to finish only");
});

test("always dash: a starting value for new players, or locked", () => {
  const configManager = () => ({
    alwaysDash: false,
    applyData(config) {
      this.alwaysDash = !!config.alwaysDash;
    },
    save() {},
  });

  const start = load("RWK_Dash", { alwaysDash: { on: true, lock: false } }, { globals: { ConfigManager: configManager() } });
  const cm = start.context.ConfigManager;
  cm.applyData({});
  assert.equal(cm.alwaysDash, true, "never chose: the deployer's value");
  cm.applyData({ alwaysDash: false });
  assert.equal(cm.alwaysDash, false, "chose: theirs");
  assert.equal(start.tools.length, 1);

  const locked = load("RWK_Dash", { alwaysDash: { on: true, lock: true } }, { globals: { ConfigManager: configManager() } });
  const lcm = locked.context.ConfigManager;
  lcm.applyData({ alwaysDash: false });
  lcm.alwaysDash = false; // Options → Always Dash
  assert.equal(lcm.alwaysDash, true);
  assert.equal(locked.tools.length, 0, "no switch in the ⚙ menu");

  const plain = load("RWK_Dash", { alwaysDash: { on: null, lock: false } }, { globals: { ConfigManager: configManager() } });
  plain.context.ConfigManager.applyData({});
  assert.equal(plain.context.ConfigManager.alwaysDash, false, "the game's own default");
});

test("save tools: only the allowed actions", () => {
  const detail = (saveTools) => load("RWK_SaveTools", { saveTools }).tools[0].detail;
  assert.equal(detail({ export: true, import: true, delete: true }), "Export, import or delete save slots");
  assert.equal(detail({ export: true, import: false, delete: true }), "Export or delete save slots");
  assert.equal(detail({ export: false, import: false, delete: true }), "Delete save slots");
  assert.equal(detail(true), "Export, import or delete save slots");
  assert.equal(load("RWK_SaveTools", { saveTools: false }).tools.length, 0);
});
