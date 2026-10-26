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

function cheatGlobals() {
  class Game_Actor {
    constructor(name, hp, level) {
      Object.assign(this, { _name: name, hp, mhp: 100, level, states: [] });
    }
    name() {
      return this._name;
    }
    setHp(hp) {
      this.hp = Math.max(0, hp);
    }
    addState(id) {
      this.states.push(id);
    }
    deathStateId() {
      return 1;
    }
    isAlive() {
      return !this.states.includes(1);
    }
    isDead() {
      return !this.isAlive();
    }
    revive() {
      this.states = this.states.filter((id) => id !== 1);
    }
    recoverAll() {
      this.hp = this.mhp;
      this.states = [];
    }
    maxLevel() {
      return 99;
    }
    changeLevel(level) {
      this.level = level;
    }
  }
  const actors = [new Game_Actor("Eve", 40, 5), new Game_Actor("Max", 10, 99)];
  const held = new Map();
  const potion = { id: 1, name: "Potion" };
  const enemies = [{ states: [], collapsed: false }];
  for (const enemy of enemies) {
    Object.assign(enemy, { deathStateId: () => 1, addNewState: (id) => enemy.states.push(id), performCollapse: () => (enemy.collapsed = true) });
  }
  return {
    Game_Actor,
    actors,
    potion,
    enemies,
    TextManager: { currencyUnit: "G" },
    $dataItems: [null, potion, { id: 2, name: "" }, { id: 3, name: "Hi-Potion" }],
    $dataWeapons: [null, { id: 1, name: "Sword" }],
    $dataArmors: [],
    $gameParty: {
      _gold: 0,
      members: () => actors,
      gold() {
        return this._gold;
      },
      gainGold(n) {
        this._gold = Math.min(99999999, this._gold + n);
      },
      maxItems: () => 99,
      numItems: (item) => held.get(item) || 0,
      gainItem: (item, n) => held.set(item, (held.get(item) || 0) + n),
      inBattle: () => true,
    },
    $gameTroop: { aliveMembers: () => enemies.filter((e) => !e.states.includes(1)) },
    BattleManager: { _phase: "input" },
  };
}

test("cheats: off unless the deployer turns them on; the groups it allows", () => {
  assert.equal(load("RWK_Cheats", { cheats: false }, { globals: cheatGlobals() }).tools.length, 0);
  const on = load("RWK_Cheats", { cheats: { party: true, items: true, battle: false } }, { globals: cheatGlobals() });
  assert.deepEqual(on.labels(), ["Cheats"]);
  assert.equal(on.tools[0].group, "cheat");
  assert.equal(value(on.tools[0].detail), "party, gold and items");
});

test("cheats: god mode, heal, level, gold, items, win a battle", () => {
  const globals = cheatGlobals();
  const { context, stored } = load("RWK_Cheats", { cheats: { party: true, items: true, battle: true } }, { globals });
  const cheats = context.window.RWK.cheats;
  const [eve, max] = globals.actors;

  eve.setHp(20);
  assert.equal(eve.hp, 20, "god mode off: damage as usual");
  cheats.setGod(true);
  assert.equal(stored["rwk.cheats.god.g"], true, "remembered in this browser");
  eve.setHp(0);
  eve.addState(1);
  assert.equal(eve.hp, 20, "god mode: HP does not go down");
  assert.ok(eve.isAlive(), "and nothing knocks them out");
  eve.setHp(90);
  assert.equal(eve.hp, 90, "healing still works");
  cheats.setGod(false);

  assert.equal(cheats.healAll(), "Party healed");
  assert.equal(max.hp, 100);
  assert.equal(cheats.levelUp(), "Level up: Eve", "Max is at the top level");
  assert.equal(eve.level, 6);
  assert.equal(cheats.addGold(1000), "+1,000 G");

  assert.deepEqual([...cheats.findItems("potion").map((i) => i.name)], ["Potion", "Hi-Potion"]);
  assert.deepEqual([...cheats.findItems("").map((i) => i.name)], ["Potion", "Hi-Potion", "Sword"], "items without a name are left out");
  assert.equal(cheats.addItem(globals.potion, 10), "Potion ×10");
  assert.equal(cheats.addItem(globals.potion, 200), "Potion ×99", "capped at what the game allows");
  assert.match(cheats.addItem(globals.potion, 1), /already hold the most/);

  cheats.winBattle();
  assert.deepEqual([...globals.enemies[0].states], [1]);
  assert.ok(globals.enemies[0].collapsed);
});

test("cheats: god mode is per game and only with the party group", () => {
  const stored = { "rwk.cheats.god.g": true };
  const globals = cheatGlobals();
  load("RWK_Cheats", { cheats: { party: false, items: true, battle: true } }, { globals, stored });
  globals.actors[0].setHp(0);
  assert.equal(globals.actors[0].hp, 0, "a god mode left on before the deployer took the group away does nothing");
});
