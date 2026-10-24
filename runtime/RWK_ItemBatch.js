//=============================================================================
// RWK_ItemBatch.js - rpgmaker-web-toolkit
// Required Notice: Copyright 2026 Trương Tuấn Anh (https://github.com/Kokoroou)
// License: PolyForm Noncommercial 1.0.0 with the Game Creators permission,
// https://github.com/Kokoroou/rpgmaker-web-toolkit/blob/main/LICENSE
// Use several of a consumable item at once from the item menu: pick a
// quantity, the item is used that many times, and an item that runs a common
// event runs it that many times in a row with only the last run's messages.
//=============================================================================
/*:
 * @target MZ MV
 * @plugindesc [rpgmaker-web-toolkit] Use several items at once. Requires RWK_Core.
 * @author rpgmaker-web-toolkit
 */

(() => {
  "use strict";

  const RWK = window.RWK;
  if (!RWK || RWK.config.itemBatch === false) return;

  const MZ = RWK.engine === "MZ";
  const MAX = 99;
  const PREF_KEY = "rwk.itemBatch." + RWK.config.gameId;

  //---------------------------------------------------------------------------
  // Engine adapter. Both engines reserve common events through Game_Temp and
  // start them from the map interpreter, but MV holds one reservation (a new
  // one replaces it) and MZ keeps a queue.
  //---------------------------------------------------------------------------

  const _reserveCommonEvent = Game_Temp.prototype.reserveCommonEvent;

  const engine = MZ
    ? {
        // MZ runs every common event reserved by one use.
        idsOfUse: (ids) => ids,
        reserve(ids) {
          for (const id of ids) _reserveCommonEvent.call($gameTemp, id);
        },
        windowWidth: () => 456,
        createNumberWindow: (x, y, width, height) => new Window_ItemBatchNumber(new Rectangle(x, y, width, height)),
      }
    : {
        // MV keeps only the last one reserved by a use, as it does natively.
        idsOfUse: (ids) => ids.slice(-1),
        reserve(ids) {
          mvQueue = ids.slice(1);
          _reserveCommonEvent.call($gameTemp, ids[0]);
        },
        windowWidth: () => 456,
        createNumberWindow: (x, y, width, height) => new Window_ItemBatchNumber(x, y, height),
      };

  // MV: the rest of the runs, reserved one by one as each is started.
  let mvQueue = [];
  if (!MZ) {
    const _clearCommonEvent = Game_Temp.prototype.clearCommonEvent;
    Game_Temp.prototype.clearCommonEvent = function () {
      _clearCommonEvent.apply(this, arguments);
      if (mvQueue.length) _reserveCommonEvent.call(this, mvQueue.shift());
    };
  }

  //---------------------------------------------------------------------------
  // Which items: consumable, held more than once, and every common event they
  // run is one that can safely repeat unattended (no choices, transfers,
  // battles, shops, menus...). Common events they call are checked too.
  //---------------------------------------------------------------------------

  const UNSAFE = new Set([
    102, // show choices
    103, // input number
    104, // select item
    201, // transfer player
    261, // play movie
    301, // battle processing
    302, // shop processing
    303, // name input
    351, // open menu
    352, // open save screen
    353, // game over
    354, // return to title
  ]);
  const safeCache = new Map();

  function isSafeCommonEvent(id, seen = new Set()) {
    if (safeCache.has(id)) return safeCache.get(id);
    if (seen.has(id)) return true; // a loop of calls is judged by its other commands
    seen.add(id);
    const event = $dataCommonEvents[id];
    const safe =
      !!event &&
      event.list.every((c) => !UNSAFE.has(c.code) && (c.code !== 117 || isSafeCommonEvent(c.parameters[0], seen)));
    safeCache.set(id, safe);
    return safe;
  }

  const enabled = () => RWK.storage.get(PREF_KEY, true) !== false;

  function batchMax(item) {
    if (!enabled() || !DataManager.isItem(item) || !item.consumable) return 0;
    const events = item.effects.filter((e) => e.code === Game_Action.EFFECT_COMMON_EVENT);
    if (!events.every((e) => isSafeCommonEvent(e.dataId))) return 0;
    return Math.min(MAX, $gameParty.numItems(item));
  }

  //---------------------------------------------------------------------------
  // Quantity window: the shop's number window without the price.
  //---------------------------------------------------------------------------

  function Window_ItemBatchNumber() {
    this.initialize.apply(this, arguments);
  }
  Window_ItemBatchNumber.prototype = Object.create(Window_ShopNumber.prototype);
  Window_ItemBatchNumber.prototype.constructor = Window_ItemBatchNumber;

  Window_ItemBatchNumber.prototype.drawTotalPrice = function () {};

  Window_ItemBatchNumber.prototype.refresh = function () {
    Window_ShopNumber.prototype.refresh.call(this);
    this.resetTextColor();
    this.drawText("Use how many?", 0, 0, this.contentsWidth(), "center");
  };

  //---------------------------------------------------------------------------
  // Item scene: ask for the quantity before the item is used (and before its
  // target is picked), then use it that many times.
  //---------------------------------------------------------------------------

  const _create = Scene_Item.prototype.create;
  Scene_Item.prototype.create = function () {
    _create.apply(this, arguments);
    const width = engine.windowWidth();
    const height = Math.min(Graphics.boxHeight, Window_Base.prototype.fittingHeight.call(Window_Base.prototype, 8));
    const x = Math.floor((Graphics.boxWidth - width) / 2);
    const y = Math.floor((Graphics.boxHeight - height) / 2);
    const w = engine.createNumberWindow(x, y, width, height);
    w.setHandler("ok", this.onItemBatchOk.bind(this));
    w.setHandler("cancel", this.onItemBatchCancel.bind(this));
    w.hide();
    w.deactivate();
    this._itemBatchWindow = w;
    this.addWindow(w);
  };

  const _determineItem = Scene_Item.prototype.determineItem;
  Scene_Item.prototype.determineItem = function () {
    this._itemBatchTimes = 0;
    const max = batchMax(this.item());
    if (max < 2) {
      _determineItem.apply(this, arguments);
      return;
    }
    const w = this._itemBatchWindow;
    w.setup(this.item(), max, 0);
    w.show();
    w.activate();
  };

  Scene_Item.prototype.onItemBatchOk = function () {
    const w = this._itemBatchWindow;
    w.hide();
    w.deactivate();
    this._itemBatchTimes = w.number();
    _determineItem.call(this);
  };

  Scene_Item.prototype.onItemBatchCancel = function () {
    this._itemBatchWindow.hide();
    this._itemBatchWindow.deactivate();
    this.activateItemWindow();
  };

  let recording = null; // ids reserved by the use in progress
  let quiet = false; // after the first use: no item sound per use

  Game_Temp.prototype.reserveCommonEvent = function (id) {
    if (recording) recording.push(id);
    else _reserveCommonEvent.apply(this, arguments);
  };

  const _playSeForItem = Scene_ItemBase.prototype.playSeForItem;
  Scene_ItemBase.prototype.playSeForItem = function () {
    if (!quiet) _playSeForItem.apply(this, arguments);
  };

  const _useItem = Scene_Item.prototype.useItem;
  Scene_Item.prototype.useItem = function () {
    const times = this._itemBatchTimes || 1;
    this._itemBatchTimes = 0; // later uses from the actor window are single
    if (times < 2) {
      _useItem.apply(this, arguments);
      return;
    }
    const item = this.item();
    const action = new Game_Action(this.user());
    action.setItemObject(item);
    const runs = [];
    try {
      for (let i = 0; i < times; i++) {
        // Stop early when there is nothing left to use, or nothing left to
        // gain (an actor at full HP). Items without a target only need to be held.
        if (i > 0 && !(action.isForFriend() ? this.canUse() : this.user().canUse(item))) break;
        recording = [];
        quiet = i > 0;
        _useItem.apply(this, arguments);
        runs.push(...engine.idsOfUse(recording));
      }
    } finally {
      recording = null;
      quiet = false;
    }
    if (runs.length) {
      queueRuns(runs);
      this.checkCommonEvent();
    }
  };

  //---------------------------------------------------------------------------
  // Running the common events: a run is silent when the same common event
  // runs again later, so only the last one shows its messages. Silent runs
  // also skip sounds and waits.
  //---------------------------------------------------------------------------

  let pending = []; // [{ list, silent }] in run order

  function queueRuns(ids) {
    pending = ids.map((id, i) => ({ list: $dataCommonEvents[id].list, silent: ids.indexOf(id, i + 1) !== -1 }));
    engine.reserve(ids);
  }

  // A new game or a loaded save drops anything still waiting.
  const _createGameObjects = DataManager.createGameObjects;
  DataManager.createGameObjects = function () {
    _createGameObjects.apply(this, arguments);
    pending = [];
    mvQueue = [];
  };

  const _setup = Game_Interpreter.prototype.setup;
  Game_Interpreter.prototype.setup = function (list) {
    _setup.apply(this, arguments);
    this._itemBatchSilent = false;
    if (pending.length && list === pending[0].list && this === $gameMap._interpreter) {
      this._itemBatchSilent = pending.shift().silent;
    }
  };

  // Common events called from a silent run are silent too.
  const _setupChild = Game_Interpreter.prototype.setupChild;
  Game_Interpreter.prototype.setupChild = function () {
    _setupChild.apply(this, arguments);
    if (this._childInterpreter) this._childInterpreter._itemBatchSilent = this._itemBatchSilent;
  };

  // Show Text: skip the message and its text lines.
  const _command101 = Game_Interpreter.prototype.command101;
  Game_Interpreter.prototype.command101 = function () {
    if (!this._itemBatchSilent) return _command101.apply(this, arguments);
    while (this.nextEventCode() === 401) this._index++;
    return true;
  };

  // Wait, Play ME, Play SE.
  for (const code of [230, 249, 250]) {
    const name = "command" + code;
    const original = Game_Interpreter.prototype[name];
    Game_Interpreter.prototype[name] = function () {
      return this._itemBatchSilent ? true : original.apply(this, arguments);
    };
  }

  //---------------------------------------------------------------------------
  // ⏸ menu switch, per browser.
  //---------------------------------------------------------------------------

  RWK.tools.add({
    icon: RWK.icons.items,
    group: "play",
    label: "Use several items at once",
    detail: () =>
      enabled() ? "On: asks how many when you use an item you hold several of" : "Off: items are used one at a time",
    keepOpen: true,
    onSelect: () => RWK.storage.set(PREF_KEY, !enabled()),
  });
})();
