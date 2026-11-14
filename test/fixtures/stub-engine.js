// A stand-in for an RPG Maker engine, only as much as `rwk test` drives
// (cli/lib/test-probe.js): scenes, a map with a player, the menu, save and load.
// It loads no plugin. test/test-command.test.js writes it into a fake game as
// js/rmmz_core.js. window.STUB_FAULTS turns on the faults the test must report.

(() => {
  const faults = window.STUB_FAULTS || {};
  window.Utils = { RPGMAKER_NAME: "MZ" };
  window.Input = { _currentState: {} };

  class Scene_Base {
    constructor() {
      this._started = false;
    }
    isStarted() {
      return this._started;
    }
    start() {}
    update() {}
  }
  class Scene_Boot extends Scene_Base {
    start() {
      if (faults.stuckBoot) {
        // A server that is not there, and a name that is no web address.
        fetch("http://127.0.0.1:9/gone.json").catch(() => {});
        new Image().src = "img/%E0%A4%A.png";
        return;
      }
      setTimeout(() => SceneManager.goto(Scene_Title), 200);
    }
  }
  class Scene_Title extends Scene_Base {
    start() {
      // A picture asked with another letter case than its file's.
      if (faults.missingImage) new Image().src = "img/pictures/title.png";
      else new Image().src = "img/pictures/Title.png";
    }
    commandNewGame() {
      DataManager.setupNewGame();
      SceneManager.goto(Scene_Map);
    }
  }
  class Scene_Map extends Scene_Base {
    update() {
      const s = Input._currentState;
      this._wait = (this._wait || 0) + 1;
      if (this._wait % 6) return;
      if (s.left) $gamePlayer.x--;
      if (s.right) $gamePlayer.x++;
      if (s.up) $gamePlayer.y--;
      if (s.down) $gamePlayer.y++;
    }
  }
  class Scene_Menu extends Scene_Base {
    start() {
      if (faults.menuThrows) setTimeout(() => {
        throw new TypeError("Cannot read properties of undefined (reading 'hp')");
      });
      if (faults.consoleError) console.error("Stub: a plugin failed");
      if (faults.engineError) SceneManager.catchException(new Error("caught by the engine"));
    }
  }
  class Scene_Load extends Scene_Base {
    reloadMapIfUpdated() {}
  }
  Object.assign(window, { Scene_Base, Scene_Boot, Scene_Title, Scene_Map, Scene_Menu, Scene_Load });

  window.SceneManager = {
    _scene: null,
    _nextScene: null,
    _stack: [],
    goto(sceneClass) {
      this._nextScene = sceneClass ? new sceneClass() : null;
    },
    push(sceneClass) {
      this._stack.push(this._scene.constructor);
      this.goto(sceneClass);
    },
    pop() {
      this.goto(this._stack.pop());
    },
    isSceneChanging() {
      return !!this._nextScene;
    },
    isCurrentSceneStarted() {
      return !!this._scene && this._scene._started;
    },
    catchException(e) {
      console.warn("engine caught", e && e.message);
    },
    tick() {
      if (this._nextScene) {
        this._scene = this._nextScene;
        this._nextScene = null;
        this._scene.start();
      } else if (this._scene) {
        this._scene._started = true;
        this._scene.update();
      }
      requestAnimationFrame(() => this.tick());
    },
  };

  window.DataManager = {
    setupNewGame() {
      window.$gameMap = { mapId: () => 1, isEventRunning: () => false };
      window.$gamePlayer = { x: 5, y: 5, isTransferring: () => false };
      window.$gameSystem = { onBeforeSave() {}, onAfterLoad() {} };
    },
    async saveGame(slot) {
      localStorage.setItem(`file${slot}`, JSON.stringify({ x: $gamePlayer.x, y: $gamePlayer.y }));
      // As RWK_SaveSync does once the engine has saved.
      if (window.RWK && RWK.config.sync.enabled) {
        fetch(`api/saves/file${slot}`, { method: "PUT", headers: { "content-type": "application/octet-stream", "x-rwk-enc": "lz", "if-none-match": "*" }, body: "saved" });
      }
      return true;
    },
    async loadGame(slot) {
      const data = JSON.parse(localStorage.getItem(`file${slot}`) || "null");
      if (!data) return false;
      this.setupNewGame();
      Object.assign($gamePlayer, data);
      return true;
    },
  };

  SceneManager.goto(Scene_Boot);
  window.addEventListener("load", () => SceneManager.tick());
})();
