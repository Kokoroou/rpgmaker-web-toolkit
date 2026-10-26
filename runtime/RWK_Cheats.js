//=============================================================================
// RWK_Cheats.js - rpgmaker-web-toolkit
// Required Notice: Copyright 2026 Trương Tuấn Anh (https://github.com/Kokoroou)
// License: PolyForm Noncommercial 1.0.0 with the Game Creators permission,
// https://github.com/Kokoroou/rpgmaker-web-toolkit/blob/main/LICENSE
// Cheats in ⚙ → Cheats, off unless the deployer turns them on (`cheats`):
// heal the party, god mode, level up, gold, items, win a battle, switches and
// variables, walk through walls, teleport and remembered places. Each browser
// confirms once before the first use. Nothing runs per frame: god mode is a
// check in Game_Actor.setHp / addState, walking through walls one in
// Game_Player.isDebugThrough.
//=============================================================================
/*:
 * @target MZ MV
 * @plugindesc [rpgmaker-web-toolkit] Cheats (party, gold and items, battle, switches and variables, movement). Requires RWK_Core.
 * @author rpgmaker-web-toolkit
 */

(() => {
  "use strict";

  const RWK = window.RWK;
  if (!RWK || !RWK.config.cheats) return;

  // The deployer's groups (cli/lib/stage.js: cheatsConfig).
  const groups = RWK.config.cheats;
  const OK_KEY = "rwk.cheats.ok." + RWK.config.gameId;
  const GOD_KEY = "rwk.cheats.god." + RWK.config.gameId;
  const THROUGH_KEY = "rwk.cheats.through." + RWK.config.gameId;
  const PLACES_KEY = "rwk.cheats.places." + RWK.config.gameId;
  const MAX_RESULTS = 40;
  const MAX_PLACES = 8;

  //---------------------------------------------------------------------------
  // The cheats (same names in MZ and MV)
  //---------------------------------------------------------------------------

  let god = !!(groups.party && RWK.storage.get(GOD_KEY, false));

  // God mode: the party's HP never goes down and nothing knocks them out.
  // Healing, MP and TP work as usual.
  const _setHp = Game_Actor.prototype.setHp;
  Game_Actor.prototype.setHp = function (hp) {
    if (god && hp < this.hp && this.isAlive()) hp = this.hp;
    return _setHp.call(this, hp);
  };
  const _addState = Game_Actor.prototype.addState;
  Game_Actor.prototype.addState = function (stateId) {
    if (god && stateId === this.deathStateId()) return;
    return _addState.apply(this, arguments);
  };

  function setGod(on) {
    god = on;
    RWK.storage.set(GOD_KEY, on);
    if (on) for (const actor of $gameParty.members()) if (actor.isDead()) actor.revive();
  }

  function healAll() {
    for (const actor of $gameParty.members()) actor.recoverAll();
    return "Party healed";
  }

  function levelUp() {
    const raised = $gameParty.members().filter((actor) => actor.level < actor.maxLevel());
    for (const actor of raised) actor.changeLevel(actor.level + 1, false);
    return raised.length ? `Level up: ${raised.map((a) => a.name()).join(", ")}` : "Everyone is at the top level";
  }

  function addGold(amount) {
    const before = $gameParty.gold();
    $gameParty.gainGold(amount);
    return `+${($gameParty.gold() - before).toLocaleString()} ${TextManager.currencyUnit}`;
  }

  // Items, weapons and armors with a name, matching the search.
  function findItems(query) {
    const q = query.trim().toLowerCase();
    const out = [];
    for (const list of [$dataItems, $dataWeapons, $dataArmors]) {
      for (const item of list || []) {
        if (!item || !item.name || !item.name.trim()) continue;
        if (q && !item.name.toLowerCase().includes(q)) continue;
        out.push(item);
        if (out.length >= MAX_RESULTS) return out;
      }
    }
    return out;
  }

  function addItem(item, count) {
    const room = $gameParty.maxItems(item) - $gameParty.numItems(item);
    if (room <= 0) return `${item.name}: you already hold the most the game allows`;
    $gameParty.gainItem(item, Math.min(count, room));
    return `${item.name} ×${$gameParty.numItems(item)}`;
  }

  const inBattle = () => $gameParty.inBattle() && BattleManager._phase && BattleManager._phase !== "battleEnd";

  // The battle ends as a normal victory on the next frame: EXP, gold, drops.
  function winBattle() {
    for (const enemy of $gameTroop.aliveMembers()) {
      // addNewState, not addState: bosses that resist knockout fall too.
      enemy.addNewState(enemy.deathStateId());
      enemy.performCollapse();
    }
    return "Enemies defeated";
  }

  // Switches and variables, by id or by the name given in the editor.
  // names: $dataSystem.switches / .variables (index 0 is unused).
  function findNamed(names, query) {
    const q = query.trim().toLowerCase();
    const out = [];
    for (let id = 1; id < (names || []).length; id++) {
      const name = String(names[id] || "").trim();
      const byId = q !== "" && String(id) === q.replace(/^0+/, "");
      if (!byId && (!name || (q && !name.toLowerCase().includes(q)))) continue;
      out.push({ id, name });
      if (out.length >= MAX_RESULTS) break;
    }
    return out;
  }
  const findSwitches = (query) => findNamed($dataSystem.switches, query);
  const findVariables = (query) => findNamed($dataSystem.variables, query);
  const label = (entry) => String(entry.id).padStart(4, "0") + (entry.name ? " " + entry.name : "");

  // setValue refreshes the map, so event pages that depend on it update.
  function toggleSwitch(id) {
    const on = !$gameSwitches.value(id);
    $gameSwitches.setValue(id, on);
    return on;
  }

  function setVariable(id, value) {
    const n = Math.round(Number(value));
    if (!Number.isFinite(n)) return false;
    $gameVariables.setValue(id, n);
    return true;
  }

  // Walk through walls, events and map edges.
  let through = !!(groups.movement && RWK.storage.get(THROUGH_KEY, false));
  if (groups.movement) {
    const _isDebugThrough = Game_Player.prototype.isDebugThrough;
    Game_Player.prototype.isDebugThrough = function () {
      return through || _isDebugThrough.call(this);
    };
  }

  function setThrough(on) {
    through = on;
    RWK.storage.set(THROUGH_KEY, on);
  }

  const mapName = (mapId) => {
    const info = $dataMapInfos[mapId];
    return info && info.name ? info.name : "Map " + mapId;
  };

  function findMaps(query) {
    const q = query.trim().toLowerCase();
    const out = [];
    for (const info of $dataMapInfos || []) {
      if (!info || !info.name) continue;
      if (q && String(info.id) !== q && !info.name.toLowerCase().includes(q)) continue;
      out.push({ id: info.id, name: info.name });
      if (out.length >= MAX_RESULTS) break;
    }
    return out;
  }

  // -> why the player cannot be moved now, or null
  function teleportBlocked() {
    if (!(SceneManager._scene instanceof Scene_Map)) return "Only on the map, not in a menu or a battle.";
    if ($gameMap.isEventRunning()) return "Not while an event is running.";
    if ($gamePlayer.isTransferring()) return "The party is already moving to another map.";
    return null;
  }

  // The map's size from its data file, the same one the game loads.
  async function mapSize(mapId) {
    const res = await fetch("data/Map" + String(mapId).padStart(3, "0") + ".json");
    if (!res.ok) throw new Error("HTTP " + res.status);
    const map = await res.json();
    return { width: map.width, height: map.height };
  }

  const clamp = (n, max) => Math.max(0, Math.min(max, Math.round(n)));

  // x, y: a tile, or null for the middle of the map. The move happens when
  // the map runs again (after the panel closes), with the usual fade.
  async function teleport(mapId, x = null, y = null) {
    const blocked = teleportBlocked();
    if (blocked) return { ok: false, message: blocked };
    let size;
    try {
      size = await mapSize(mapId);
    } catch (e) {
      return { ok: false, message: `Could not read ${mapName(mapId)} (${e.message})` };
    }
    const tx = x === null ? Math.floor(size.width / 2) : clamp(x, size.width - 1);
    const ty = y === null ? Math.floor(size.height / 2) : clamp(y, size.height - 1);
    $gamePlayer.reserveTransfer(mapId, tx, ty, $gamePlayer.direction(), 0);
    return { ok: true, message: `${mapName(mapId)} (${tx}, ${ty})` };
  }

  // Remembered places: [{ mapId, x, y }], newest first, in this browser.
  const places = () => {
    const list = RWK.storage.get(PLACES_KEY, []);
    return Array.isArray(list) ? list : [];
  };

  function rememberPlace() {
    const place = { mapId: $gameMap.mapId(), x: $gamePlayer.x, y: $gamePlayer.y };
    const same = (p) => p.mapId === place.mapId && p.x === place.x && p.y === place.y;
    RWK.storage.set(PLACES_KEY, [place, ...places().filter((p) => !same(p))].slice(0, MAX_PLACES));
    return `Remembered: ${mapName(place.mapId)} (${place.x}, ${place.y})`;
  }

  function forgetPlace(index) {
    RWK.storage.set(PLACES_KEY, places().filter((_, i) => i !== index));
  }

  //---------------------------------------------------------------------------
  // Panel. The game is paused while it is open, as with the messages log.
  //---------------------------------------------------------------------------

  let overlay = null;
  let restoreUpdate = null;

  function injectStyle() {
    if (document.getElementById("rwk-cheats-style")) return;
    const style = document.createElement("style");
    style.id = "rwk-cheats-style";
    style.textContent = `
.rwk-cheats{max-width:520px;display:flex;flex-direction:column;max-height:min(90vh,760px)}
.rwk-cheats-body{flex:1;min-height:0;overflow:auto;overscroll-behavior:contain;margin:0 0 14px}
.rwk-cheats h3{margin:14px 0 6px;font-size:12px;font-weight:600;letter-spacing:.06em;text-transform:uppercase;opacity:.6}
.rwk-cheats-row{display:flex;flex-wrap:wrap;gap:8px;align-items:center}
.rwk-cheats button,.rwk-cheats input{font:inherit;min-height:40px;padding:6px 12px;border-radius:8px;border:1px solid #555;
  background:#2c2c33;color:#eee}
.rwk-cheats button{cursor:pointer}
.rwk-cheats button[aria-pressed="true"]{background:#3b6fd8;border-color:#3b6fd8;color:#fff}
.rwk-cheats input{flex:1;min-width:0;box-sizing:border-box;height:40px;background:#141418}
.rwk-cheats input[type=number]{flex:0 1 9em}
.rwk-cheats-items{display:flex;flex-direction:column;margin-top:6px;border-top:1px solid #333}
.rwk-cheats-item{display:flex;align-items:center;gap:8px;padding:4px 0;border-bottom:1px solid #333}
.rwk-cheats-item span{flex:1;min-width:0;overflow-wrap:anywhere}
.rwk-cheats-item small{opacity:.65}
.rwk-cheats-item button,.rwk-cheats-item input{min-height:36px;padding:4px 10px}
.rwk-cheats-item input[type=number]{flex:0 0 7em;height:36px}
.rwk-cheats-note{margin:6px 0 0;font-size:13px;opacity:.7}
`;
    document.head.appendChild(style);
  }

  const el = (tag, props = {}, children = []) => {
    const node = document.createElement(tag);
    Object.assign(node, props);
    node.append(...children);
    return node;
  };
  const button = (text, onClick) => {
    const b = el("button", { type: "button", textContent: text });
    b.addEventListener("click", onClick);
    return b;
  };
  const run = (fn) => () => RWK.toast(fn(), "info", 1800);

  function partySection() {
    const godBtn = button("", () => {
      setGod(!god);
      draw();
    });
    const draw = () => {
      godBtn.textContent = god ? "God mode: on" : "God mode: off";
      godBtn.setAttribute("aria-pressed", String(god));
    };
    draw();
    return [
      el("h3", { textContent: "Party" }),
      el("div", { className: "rwk-cheats-row" }, [button("Heal everyone", run(healAll)), godBtn, button("Level +1", run(levelUp))]),
      el("p", { className: "rwk-cheats-note", textContent: "God mode: HP never goes down and no one is knocked out." }),
    ];
  }

  function itemsSection() {
    const gold = el("input", { type: "number", min: "1", value: "1000", inputMode: "numeric" });
    gold.setAttribute("aria-label", "Gold to add");
    const goldBtn = button("Add " + TextManager.currencyUnit, () => {
      const amount = Math.round(Number(gold.value));
      if (amount > 0) RWK.toast(addGold(amount), "info", 1800);
    });

    const search = el("input", { type: "search", placeholder: "Search items, weapons, armor" });
    search.setAttribute("aria-label", "Search items");
    const results = el("div", { className: "rwk-cheats-items" });
    const fill = () => {
      results.textContent = "";
      const found = findItems(search.value);
      if (!found.length) results.append(el("p", { className: "rwk-cheats-note", textContent: "Nothing found." }));
      for (const item of found) {
        const held = el("small");
        const name = el("span", { textContent: item.name + " " }, [held]);
        const update = () => (held.textContent = `×${$gameParty.numItems(item)}`);
        update();
        const add = (n) =>
          button("+" + n, () => {
            RWK.toast(addItem(item, n), "info", 1500);
            update();
          });
        results.append(el("div", { className: "rwk-cheats-item" }, [name, add(1), add(10)]));
      }
    };
    search.addEventListener("input", fill);
    fill();
    return [
      el("h3", { textContent: "Gold and items" }),
      el("div", { className: "rwk-cheats-row" }, [gold, goldBtn]),
      el("div", { className: "rwk-cheats-row", style: "margin-top:8px" }, [search]),
      results,
    ];
  }

  function battleSection() {
    const win = button("Win this battle", () => {
      RWK.toast(winBattle(), "info", 1500);
      close();
    });
    win.disabled = !inBattle();
    return [
      el("h3", { textContent: "Battle" }),
      el("div", { className: "rwk-cheats-row" }, [win]),
      el("p", { className: "rwk-cheats-note", textContent: inBattle() ? "Ends as a normal victory: EXP, gold and drops." : "Only during a battle." }),
    ];
  }

  // A search box over a list that fills itself again on each keystroke.
  // render(query, list): adds the rows to list.
  function searchList(placeholder, render) {
    const search = el("input", { type: "search", placeholder });
    search.setAttribute("aria-label", placeholder);
    const list = el("div", { className: "rwk-cheats-items" });
    const fill = () => {
      list.textContent = "";
      render(search.value, list);
      if (!list.childNodes.length) list.append(el("p", { className: "rwk-cheats-note", textContent: "Nothing found." }));
    };
    search.addEventListener("input", fill);
    fill();
    return [el("div", { className: "rwk-cheats-row", style: "margin-top:8px" }, [search]), list];
  }

  function switchesSection() {
    const switches = searchList("Search switches by name or number", (query, list) => {
      for (const entry of findSwitches(query)) {
        const toggle = button("", () => {
          toggleSwitch(entry.id);
          draw();
        });
        const draw = () => {
          const on = $gameSwitches.value(entry.id);
          toggle.textContent = on ? "ON" : "OFF";
          toggle.setAttribute("aria-pressed", String(on));
        };
        draw();
        toggle.setAttribute("aria-label", label(entry));
        list.append(el("div", { className: "rwk-cheats-item" }, [el("span", { textContent: label(entry) }), toggle]));
      }
    });
    const variables = searchList("Search variables by name or number", (query, list) => {
      for (const entry of findVariables(query)) {
        const current = $gameVariables.value(entry.id);
        const name = el("span", { textContent: label(entry) });
        // Only numbers can be typed in; a plugin may keep text or a list in a variable.
        if (typeof current !== "number") {
          const shown = JSON.stringify(current);
          list.append(el("div", { className: "rwk-cheats-item" }, [name, el("small", { textContent: shown && shown.length > 24 ? shown.slice(0, 24) + "…" : shown })]));
          continue;
        }
        const input = el("input", { type: "number", value: String(current), inputMode: "numeric" });
        input.setAttribute("aria-label", label(entry));
        input.addEventListener("change", () => {
          if (setVariable(entry.id, input.value)) RWK.toast(`${label(entry)} = ${$gameVariables.value(entry.id)}`, "info", 1500);
          input.value = String($gameVariables.value(entry.id));
        });
        list.append(el("div", { className: "rwk-cheats-item" }, [name, input]));
      }
    });
    return [
      el("h3", { textContent: "Switches and variables" }),
      el("p", { className: "rwk-cheats-note", textContent: "Events read these to decide what happens: a wrong value can block the story. Save first." }),
      ...switches,
      ...variables,
    ];
  }

  function movementSection() {
    const throughBtn = button("", () => {
      setThrough(!through);
      draw();
    });
    const draw = () => {
      throughBtn.textContent = through ? "Walk through walls: on" : "Walk through walls: off";
      throughBtn.setAttribute("aria-pressed", String(through));
    };
    draw();

    const blocked = teleportBlocked();
    const go = (mapId, x, y) => {
      const b = button("Go", async () => {
        b.disabled = true;
        const result = await teleport(mapId, x, y);
        RWK.toast(result.message, result.ok ? "info" : "warn", 2000);
        if (result.ok) close();
        else b.disabled = false;
      });
      b.disabled = !!blocked;
      return b;
    };

    const placesList = el("div", { className: "rwk-cheats-items" });
    const fillPlaces = () => {
      placesList.textContent = "";
      places().forEach((p, i) => {
        const forget = button("Forget", () => {
          forgetPlace(i);
          fillPlaces();
        });
        placesList.append(el("div", { className: "rwk-cheats-item" }, [el("span", { textContent: `${mapName(p.mapId)} (${p.x}, ${p.y})` }), go(p.mapId, p.x, p.y), forget]));
      });
    };
    fillPlaces();
    const remember = button("Remember this place", () => {
      RWK.toast(rememberPlace(), "info", 1500);
      fillPlaces();
    });
    remember.disabled = !(SceneManager._scene instanceof Scene_Map);

    const maps = searchList("Search maps by name or number", (query, list) => {
      for (const map of findMaps(query)) {
        list.append(el("div", { className: "rwk-cheats-item" }, [el("span", { textContent: `${map.name} ` }, [el("small", { textContent: `#${map.id}` })]), go(map.id, null, null)]));
      }
    });

    return [
      el("h3", { textContent: "Movement" }),
      el("div", { className: "rwk-cheats-row" }, [throughBtn, remember]),
      el("p", { className: "rwk-cheats-note", textContent: blocked ? `Teleport: ${blocked}` : "Teleport: to a remembered place, or to the middle of a map (walk through walls if you land in one)." }),
      placesList,
      ...maps,
    ];
  }

  function isReady() {
    const scene = SceneManager._scene;
    return DataManager.isDatabaseLoaded() && scene && !(scene instanceof Scene_Boot) && !(scene instanceof Scene_Title);
  }

  function open() {
    if (overlay) return;
    injectStyle();
    overlay = el("div", { className: "rwk-modal" });
    const box = el("div", { className: "rwk-modal-box rwk-cheats" });
    box.setAttribute("role", "dialog");
    box.setAttribute("aria-label", "Cheats");
    const body = el("div", { className: "rwk-cheats-body" }, [
      ...(groups.party ? partySection() : []),
      ...(groups.items ? itemsSection() : []),
      ...(groups.battle ? battleSection() : []),
      ...(groups.switches ? switchesSection() : []),
      ...(groups.movement ? movementSection() : []),
    ]);
    const actions = el("div", { className: "rwk-modal-actions" }, [button("Close", close)]);
    box.append(el("h2", { textContent: "Cheats" }), body, actions);
    overlay.appendChild(box);
    overlay.addEventListener("click", (e) => e.target === overlay && close());
    RWK.shield(overlay);
    document.body.appendChild(overlay);

    const _updateScene = SceneManager.updateScene;
    SceneManager.updateScene = function () {};
    restoreUpdate = () => (SceneManager.updateScene = _updateScene);
  }

  function close() {
    if (!overlay) return;
    overlay.remove();
    overlay = null;
    if (restoreUpdate) restoreUpdate();
    restoreUpdate = null;
    Input.clear();
    if (window.TouchInput) TouchInput.clear();
  }

  async function start() {
    if (!isReady()) {
      RWK.toast("Start or load a game first.", "warn", 2500);
      return;
    }
    if (!RWK.storage.get(OK_KEY, false)) {
      const ok = await RWK.choose(
        "Use cheats?",
        "Cheats change the game as its creator made it, and the changes stay in your saves.\n" +
          "Save first if you may want to go back.",
        [{ label: "Cancel", value: false }, { label: "Use cheats", value: true, primary: true }]
      );
      if (!ok) return;
      RWK.storage.set(OK_KEY, true);
    }
    open();
  }

  // While open the keys belong to the panel (typing in its boxes); Esc closes it.
  window.addEventListener(
    "keydown",
    (e) => {
      if (!overlay) return;
      if (e.key === "Escape") {
        e.preventDefault();
        close();
      }
      e.stopPropagation();
    },
    true
  );

  RWK.tools.add({
    icon: RWK.icons.wand,
    group: "cheat",
    label: "Cheats",
    detail: () => {
      const on = [god && "god mode", through && "walk through walls"].filter(Boolean).join(" and ");
      if (on) return on[0].toUpperCase() + on.slice(1) + ": on";
      const names = { party: "party", items: "gold and items", battle: "battle", switches: "switches and variables", movement: "movement" };
      return Object.keys(names).filter((g) => groups[g]).map((g) => names[g]).join(", ");
    },
    onSelect: start,
  });

  RWK.cheats = {
    healAll,
    levelUp,
    addGold,
    addItem,
    findItems,
    winBattle,
    setGod,
    isGod: () => god,
    findSwitches,
    findVariables,
    toggleSwitch,
    setVariable,
    setThrough,
    isThrough: () => through,
    findMaps,
    teleport,
    rememberPlace,
    forgetPlace,
    places,
    open: start,
  };
})();
