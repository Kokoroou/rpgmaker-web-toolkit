//=============================================================================
// RWK_SafeSaves.js - rpgmaker-web-toolkit
// Required Notice: Copyright 2026 Trương Tuấn Anh (https://github.com/Kokoroou)
// License: PolyForm Noncommercial 1.0.0 with the Game Creators permission,
// https://github.com/Kokoroou/rpgmaker-web-toolkit/blob/main/LICENSE
// Keeps saves safe on the web: quick save / quick load and a timed autosave,
// each in a slot of its own (rwk-quick, rwk-auto) that cloud sync carries like
// the game's slots, a ☁ toolbar icon showing the sync state, and a request
// that the browser never clears this site's storage on its own.
//=============================================================================
/*:
 * @target MZ MV
 * @plugindesc [rpgmaker-web-toolkit] Quick save / load, autosave, sync status. Requires RWK_Core.
 * @author rpgmaker-web-toolkit
 */

(() => {
  "use strict";

  const RWK = window.RWK;
  if (!RWK) return;

  const MZ = RWK.engine === "MZ";
  const { icons } = RWK;
  const sync = RWK.saveSync; // null when cloud sync is off
  const quickCfg = RWK.config.quickSave === false ? null : RWK.config.quickSave || {};
  const autoCfg = RWK.config.autoSave === false ? null : RWK.config.autoSave || {};
  const ignoreSaveLock = !quickCfg || quickCfg.ignoreSaveLock !== false;
  const AUTO_MS = Math.min(60, Math.max(1, Number(autoCfg && autoCfg.minutes) || 5)) * 60000;
  const AUTO_CHECK_MS = 10000;
  const QUICK = "rwk-quick";
  const AUTO = "rwk-auto";

  //---------------------------------------------------------------------------
  // Ask the browser to keep this site's storage: without it, a browser short
  // on space (or Safari after 7 days away) may delete saves on its own.
  // Asked at the first save, since Firefox shows a prompt.
  //---------------------------------------------------------------------------

  let persistAsked = false;
  function keepSaves() {
    const storage = navigator.storage;
    if (persistAsked || !storage || !storage.persist) return;
    persistAsked = true;
    Promise.resolve(storage.persisted ? storage.persisted() : false)
      .then((done) => done || storage.persist())
      .catch(() => {});
  }

  const _saveGame = DataManager.saveGame;
  DataManager.saveGame = function () {
    keepSaves();
    return _saveGame.apply(this, arguments);
  };

  //---------------------------------------------------------------------------
  // ☁ sync state: a line in the ⚙ menu's Saves group that uploads waiting
  // saves. The toolbar has no icon for it, to keep the screen clear.
  //---------------------------------------------------------------------------

  if (sync) {
    const CLOUD = { synced: icons.cloudCheck, syncing: icons.cloudUpload, offline: icons.cloudOff, error: icons.cloudAlert };
    RWK.tools.add({
      icon: () => CLOUD[sync.status().state],
      group: "save",
      label: "Cloud saves",
      detail: () => sync.status().text,
      keepOpen: true,
      onSelect: () => {
        const { state, text } = sync.status();
        if (state === "synced") RWK.toast("☁ Saves are in sync", "info", 1500);
        else if (state === "error") RWK.toast(text, "warn", 4000);
        else sync.syncNow();
      },
    });
  }

  if (!quickCfg && !autoCfg) return;

  //---------------------------------------------------------------------------
  // The toolkit's slots, next to the game's own: the same save contents and
  // format, written under the names rwk-quick / rwk-auto, so they never take
  // a slot of the game's save screen. MZ: localforage through StorageManager
  // (sync sees it); MV: localStorage "RPG rwk-quick" (sync is told).
  //---------------------------------------------------------------------------

  const KEY = (name) => "RPG " + name;
  const infos = {}; // name -> { at, playtime, map }, from the save itself

  const has = (name) => (MZ ? StorageManager.exists(name) : localStorage.getItem(KEY(name)) !== null);

  async function read(name) {
    if (MZ) return StorageManager.loadObject(name);
    const raw = localStorage.getItem(KEY(name));
    if (!raw) throw new Error("no save in " + name);
    return JsonEx.parse(LZString.decompressFromBase64(raw));
  }

  // The steps of DataManager.saveGame, minus the save list entry.
  async function write(name) {
    $gameSystem.onBeforeSave();
    const contents = DataManager.makeSaveContents();
    const info = { at: Date.now(), playtime: $gameSystem.playtimeText(), map: $gameMap.displayName() || "" };
    contents.rwkInfo = info;
    if (sync && name === AUTO) sync.hush();
    if (MZ) {
      await StorageManager.saveObject(name, contents);
    } else {
      localStorage.setItem(KEY(name), LZString.compressToBase64(JsonEx.stringify(contents)));
      if (sync) sync.saved(name);
    }
    infos[name] = info;
    keepSaves();
  }

  // Cloud sync may have brought newer copies at boot: read what is there.
  const _bootStart = Scene_Boot.prototype.start;
  Scene_Boot.prototype.start = function () {
    _bootStart.apply(this, arguments);
    for (const name of [QUICK, AUTO]) {
      if (!has(name)) continue;
      Promise.resolve()
        .then(() => read(name))
        .then((contents) => (infos[name] = (contents && contents.rwkInfo) || {}))
        .catch(() => {});
    }
  };

  function describe(name) {
    const info = infos[name];
    if (!info) return "";
    return [info.map, info.playtime, info.at && new Date(info.at).toLocaleString()].filter(Boolean).join(" · ");
  }

  //---------------------------------------------------------------------------
  // When saving and loading are safe
  //---------------------------------------------------------------------------

  const sceneStarted = () => {
    const scene = SceneManager._scene;
    return scene && (scene.isStarted ? scene.isStarted() : SceneManager.isCurrentSceneStarted());
  };

  // -> "" or why not. The game's own save menu is closed during events, so a
  // save never lands in the middle of one (messages are not saved).
  function saveBlocker() {
    const scene = SceneManager._scene;
    if (!(scene instanceof Scene_Map) || SceneManager.isSceneChanging() || !sceneStarted()) {
      return "Saving works on the map only";
    }
    if ($gameMap.isEventRunning() || $gameMessage.isBusy() || $gamePlayer.isTransferring()) {
      return "Wait until the event or message ends";
    }
    if (!ignoreSaveLock && !$gameSystem.isSaveEnabled()) return "The game does not allow saving here";
    return "";
  }

  function loadBlocker() {
    const scene = SceneManager._scene;
    if (!scene || scene instanceof Scene_Boot || SceneManager.isSceneChanging() || !sceneStarted()) {
      return "Wait until the game has finished loading";
    }
    if (scene instanceof Scene_Battle) return "Loading does not work during a battle";
    return "";
  }

  let busy = false;

  async function saveTo(name, { quiet = false } = {}) {
    const blocker = busy ? "Still saving…" : saveBlocker();
    if (blocker) {
      if (!quiet) RWK.toast(blocker, "warn", 2500);
      return false;
    }
    busy = true;
    try {
      await write(name);
      if (!quiet) RWK.toast("Quick saved", "info", 1500);
      return true;
    } catch (e) {
      console.error("[RWK] save to %s failed", name, e);
      RWK.toast("Could not save: " + (e && e.message ? e.message : e), "error", 5000);
      return false;
    } finally {
      busy = false;
    }
  }

  // The steps of Scene_Load: read, rebuild the game objects, go to the map.
  async function loadFrom(name) {
    busy = true;
    try {
      const contents = await read(name);
      DataManager.createGameObjects();
      DataManager.extractSaveContents(contents);
      if (DataManager.correctDataErrors) DataManager.correctDataErrors();
    } catch (e) {
      console.error("[RWK] load from %s failed", name, e);
      RWK.toast("Could not load the save. Reload the page if the game misbehaves.", "error", 6000);
      return;
    } finally {
      busy = false;
    }
    const scene = SceneManager._scene;
    SoundManager.playLoad();
    if (scene.fadeOutAll) scene.fadeOutAll();
    Scene_Load.prototype.reloadMapIfUpdated.call(scene);
    SceneManager.goto(Scene_Map);
    $gameSystem.onAfterLoad();
  }

  // Loading drops unsaved progress, so ask first, over the paused ⚙ menu.
  // No need on the title screen.
  async function askLoad(name, what) {
    if (!has(name)) {
      RWK.toast(name === QUICK ? "No quick save yet" : "No autosave yet", "warn", 2000);
      return;
    }
    const blocker = busy ? "Still saving…" : loadBlocker();
    if (blocker) {
      RWK.toast(blocker, "warn", 2500);
      return;
    }
    if (!(SceneManager._scene instanceof Scene_Title)) {
      if (!RWK.tools.isOpen()) RWK.tools.open();
      const info = describe(name);
      const ok = await RWK.choose(
        "Load the " + what,
        (info ? info + "\n\n" : "") + "Progress since then is lost.",
        [
          { label: "Cancel", value: false },
          { label: "Load", value: true, primary: true },
        ]
      );
      if (!ok) return RWK.tools.close();
    }
    RWK.tools.close();
    loadFrom(name);
  }

  //---------------------------------------------------------------------------
  // Quick save / quick load: tiles in the ⚙ menu's top row, F6 / F7
  //---------------------------------------------------------------------------

  if (quickCfg) {
    RWK.tools.add({ quick: true, icon: icons.save, label: "Quick save", onSelect: () => saveTo(QUICK) });
    RWK.tools.add({ quick: true, keepOpen: true, icon: icons.folderOpen, label: "Quick load", onSelect: () => askLoad(QUICK, "quick save") });

    const free = (code) => !Input.keyMapper[code];
    window.addEventListener("keydown", (e) => {
      if (RWK.tools.isOpen() || e.repeat || e.ctrlKey || e.altKey || e.metaKey) return;
      if (e.keyCode === 117 && free(117)) {
        e.preventDefault();
        saveTo(QUICK);
      } else if (e.keyCode === 118 && free(118)) {
        e.preventDefault();
        askLoad(QUICK, "quick save");
      }
    });
  }

  //---------------------------------------------------------------------------
  // Autosave: every few minutes on the map while the player is playing, and
  // when the page goes to the background (phones often close it there).
  //---------------------------------------------------------------------------

  if (autoCfg) {
    const minutes = AUTO_MS / 60000;
    const lastInput = () => Math.max(Input.date || 0, (window.TouchInput && TouchInput.date) || 0);
    let lastAuto = Date.now();
    let inputAtAuto = lastInput();

    const autosave = async () => {
      // Nothing to keep if the player has not touched the game since.
      if (busy || lastInput() <= inputAtAuto || saveBlocker()) return false;
      const input = lastInput();
      lastAuto = Date.now(); // a failed try waits for the next round too
      if (!(await saveTo(AUTO, { quiet: true }))) return false;
      inputAtAuto = input;
      return true;
    };

    setInterval(() => {
      if (!RWK.tools.isOpen() && Date.now() - lastAuto >= AUTO_MS) autosave();
    }, AUTO_CHECK_MS);
    document.addEventListener("visibilitychange", () => {
      if (document.visibilityState !== "hidden") return;
      autosave().then((saved) => saved && sync && sync.syncNow());
    });

    RWK.tools.add({
      icon: icons.history,
      group: "save",
      label: "Load autosave",
      detail: () => describe(AUTO) || (has(AUTO) ? "Saved" : `None yet: made every ${minutes} min on the map`),
      keepOpen: true,
      onSelect: () => askLoad(AUTO, "autosave"),
    });
  }

  RWK.safeSaves = { quickSave: () => saveTo(QUICK), quickLoad: () => askLoad(QUICK, "quick save") };
})();
