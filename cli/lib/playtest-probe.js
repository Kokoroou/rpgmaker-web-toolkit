// RWK_TEST: the steps `rwk test` drives in the game's page (cli/commands/playtest.js).
// Not a plugin: the test adds it to the page before any of the game's scripts
// (Page.addScriptToEvaluateOnNewDocument), so it runs the same on a game folder
// served on this PC and on a deployed site, MZ or MV, with or without the toolkit.
// Each step returns what it saw, or throws with what went wrong.

(() => {
  "use strict";
  if (window.RWK_TEST) return;

  const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
  const engineErrors = [];

  async function until(test, timeoutMs) {
    const end = performance.now() + timeoutMs;
    for (;;) {
      try {
        if (test()) return true;
      } catch {
        // The engine is still setting up.
      }
      if (performance.now() > end) return false;
      await sleep(25);
    }
  }

  // The errors the engine catches to show its error screen never reach
  // window.onerror: wrap SceneManager.catchException as soon as it exists
  // (rmmz_managers.js / rpg_managers.js load before any plugin).
  const watch = setInterval(() => {
    const sm = window.SceneManager;
    if (!sm || typeof sm.catchException !== "function") return;
    clearInterval(watch);
    const original = sm.catchException;
    sm.catchException = function (e) {
      try {
        // MZ throws ["LoadError", url, retry] for files that fail to load.
        if (Array.isArray(e) && e[0] === "LoadError") engineErrors.push({ name: "LoadError", message: String(e[1]), stack: "" });
        else engineErrors.push({ name: (e && e.name) || "Error", message: e && e.message !== undefined ? String(e.message) : String(e), stack: e && e.stack ? String(e.stack) : "" });
      } catch {
        // Never break the engine's own handling.
      }
      return original.apply(this, arguments);
    };
  }, 5);

  const sceneName = () => {
    const scene = window.SceneManager && SceneManager._scene;
    return scene ? scene.constructor.name : "";
  };
  const started = () => {
    const scene = SceneManager._scene;
    return !!scene && (scene.isStarted ? scene.isStarted() : SceneManager.isCurrentSceneStarted());
  };
  const isMap = () => SceneManager._scene instanceof Scene_Map && started() && !SceneManager.isSceneChanging();

  // The text of the engine's error screen (MZ #errorPrinter, MV #ErrorPrinter), or "".
  function errorShown() {
    const printer = document.getElementById("errorPrinter") || document.getElementById("ErrorPrinter");
    const text = printer ? printer.innerText.replace(/\s+/g, " ").trim() : "";
    return text.replace(/Report a problem$/, "").trim().slice(0, 300);
  }

  function state() {
    let mapId = null;
    try {
      mapId = window.$gameMap && $gameMap.mapId ? $gameMap.mapId() : null;
    } catch {
      mapId = null;
    }
    return { scene: sceneName(), mapId, errorShown: errorShown(), engineErrors: engineErrors.splice(0) };
  }

  function stuck(what) {
    const shown = errorShown();
    return new Error(`${what} (scene: ${sceneName() || "none"}${shown ? `; error screen: ${shown}` : ""})`);
  }

  // The engine's input, held down as a player would (Input._currentState is what the keyboard sets).
  const DIRS = ["left", "up", "right", "down"];
  function hold(keys) {
    const s = window.Input && Input._currentState;
    if (!s) return;
    for (const key of [...DIRS, "ok", "escape", "cancel"]) s[key] = keys.includes(key);
  }

  async function boot(timeoutMs = 90000) {
    const ok = await until(() => window.Scene_Boot && SceneManager._scene && !(SceneManager._scene instanceof Scene_Boot) && started(), timeoutMs);
    if (!ok) throw stuck(`the game did not get past loading in ${timeoutMs / 1000} s`);
    const config = (window.RWK && window.RWK.config) || null;
    return {
      scene: sceneName(),
      engine: window.Utils && Utils.RPGMAKER_NAME,
      toolkit: !!config,
      sync: !!(config && config.sync && config.sync.enabled),
      controls: !!(config && config.controls && config.controls.enabled !== false && config.controls.showOn !== "never"),
    };
  }

  // A new game, as the title's New Game does it, else the bare steps.
  async function newGame() {
    const scene = SceneManager._scene;
    if (!(scene instanceof Scene_Map)) {
      if (scene instanceof Scene_Title && scene.commandNewGame) scene.commandNewGame();
      else {
        DataManager.setupNewGame();
        SceneManager.goto(Scene_Map);
      }
    }
    let ok = await until(isMap, 15000);
    if (!ok && !(SceneManager._scene instanceof Scene_Map)) {
      // A title that stays busy (an animation, a plugin's own title) holds the change: the bare steps.
      if (!(SceneManager._nextScene instanceof Scene_Map)) {
        DataManager.setupNewGame();
        SceneManager.goto(Scene_Map);
      }
      if (SceneManager._scene) SceneManager._scene.isBusy = () => false;
      ok = await until(isMap, 30000);
    }
    if (!ok) throw stuck("the new game did not reach a map");
    await until(() => !$gamePlayer.isTransferring(), 10000);
    return { mapId: $gameMap.mapId(), eventRunning: $gameMap.isEventRunning() };
  }

  // Walks a square for `seconds`, pressing OK now and then so messages and choices move on.
  async function walk(seconds = 8) {
    if (!(SceneManager._scene instanceof Scene_Map)) throw stuck("not on a map");
    const start = { x: $gamePlayer.x, y: $gamePlayer.y, mapId: $gameMap.mapId() };
    const end = performance.now() + seconds * 1000;
    let moved = 0;
    let last = `${$gamePlayer.x},${$gamePlayer.y}`;
    let i = 0;
    try {
      while (performance.now() < end) {
        const dir = DIRS[Math.floor(i / 8) % 4];
        hold(i % 4 === 3 ? ["ok"] : [dir]);
        await sleep(100);
        const here = `${$gamePlayer.x},${$gamePlayer.y}`;
        if (here !== last) moved++;
        last = here;
        i++;
      }
    } finally {
      hold([]);
    }
    return { from: start, to: { x: $gamePlayer.x, y: $gamePlayer.y, mapId: $gameMap.mapId() }, steps: moved, scene: sceneName() };
  }

  // Back on the map, from wherever the walk left the game (a menu, a battle...).
  async function backToMap() {
    if (isMap()) return;
    if (!(SceneManager._scene instanceof Scene_Map)) SceneManager.goto(Scene_Map);
    if (!(await until(isMap, 15000))) throw stuck("could not get back to the map");
  }

  async function menu() {
    await backToMap();
    SceneManager.push(Scene_Menu);
    if (!(await until(() => SceneManager._scene instanceof Scene_Menu && started(), 15000))) throw stuck("the menu did not open");
    await sleep(800);
    SceneManager.pop();
    if (!(await until(isMap, 15000))) throw stuck("the menu did not close");
    return { ok: true };
  }

  async function save(slot) {
    await backToMap();
    $gameSystem.onBeforeSave();
    // MZ: a promise; MV: true / false.
    const result = await Promise.resolve(DataManager.saveGame(slot));
    if (result === false) throw stuck(`saving to file ${slot} failed`);
    return { slot };
  }

  async function load(slot) {
    const result = await Promise.resolve(DataManager.loadGame(slot));
    if (result === false) throw stuck(`loading file ${slot} failed`);
    // As Scene_Load#onLoadSuccess does.
    try {
      Scene_Load.prototype.reloadMapIfUpdated.call(new Scene_Load());
    } catch {
      // Older engines have no reloadMapIfUpdated.
    }
    SceneManager.goto(Scene_Map);
    if ($gameSystem.onAfterLoad) $gameSystem.onAfterLoad();
    if (!(await until(isMap, 20000))) throw stuck("the loaded game did not reach its map");
    return { mapId: $gameMap.mapId() };
  }

  // The toolkit's ⚙ menu: opens, lists its tools, closes.
  async function toolkitMenu() {
    const tools = window.RWK && window.RWK.tools;
    if (!tools) return { skipped: "the toolkit is not in this game" };
    tools.open();
    const ok = await until(() => document.querySelector(".rwk-menu"), 5000);
    if (!ok) throw new Error("the ⚙ menu did not open");
    await sleep(300);
    const rows = document.querySelectorAll(".rwk-menu .rwk-group, .rwk-menu .rwk-tools-list > *").length;
    tools.close();
    await until(() => !tools.isOpen(), 3000);
    return { rows };
  }

  const visible = (el) => {
    if (!el) return false;
    const r = el.getBoundingClientRect();
    const style = getComputedStyle(el);
    return r.width > 0 && r.height > 0 && style.display !== "none" && style.visibility !== "hidden";
  };

  // On a phone: the game fits the screen, and the toolkit's touch controls show.
  function phone() {
    const canvas = document.getElementById("gameCanvas") || document.getElementById("GameCanvas") || document.querySelector("canvas");
    const r = canvas ? canvas.getBoundingClientRect() : null;
    const fits = !!r && r.width > 0 && r.left >= -1 && r.top >= -1 && r.right <= innerWidth + 1 && r.bottom <= innerHeight + 1;
    return {
      viewport: `${innerWidth}x${innerHeight}`,
      canvas: r ? `${Math.round(r.width)}x${Math.round(r.height)}` : null,
      fits,
      controls: visible(document.querySelector(".rwk-pad")),
      toolkit: !!window.RWK,
      scroll: document.documentElement.scrollWidth > innerWidth + 1,
    };
  }

  window.RWK_TEST = { state, boot, newGame, walk, menu, save, load, toolkitMenu, phone };
})();
