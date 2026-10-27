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
  const PAGE = 40;
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

  // Database text without the message codes (\C[2], \I[5]) and line breaks.
  const plain = (text) => String(text || "").replace(/\\[A-Za-z]+\[\d+\]/g, "").replace(/\\./g, "").replace(/\s+/g, " ").trim();

  // q: the search, lower case. 0: the number or the name matches (or no search),
  // 1: only the description does, -1: no match.
  function rank(q, id, name, text = "") {
    if (!q || String(id) === q.replace(/^0+/, "") || name.toLowerCase().includes(q)) return 0;
    return text && plain(text).toLowerCase().includes(q) ? 1 : -1;
  }

  // Every match, name and number first, then the description: the panel shows
  // them a page at a time.
  function matches(entries, query, text) {
    const q = query.trim().toLowerCase();
    const first = [];
    const then = [];
    for (const entry of entries) {
      const r = rank(q, entry.id, plain(entry.name), text ? text(entry) : "");
      if (r === 0) first.push(entry);
      else if (r === 1) then.push(entry);
    }
    return first.concat(then);
  }

  // kind: "all", "item", "key" (key items), "weapon" or "armor".
  function findItems(query, kind = "all") {
    const entries = [];
    for (const [k, list] of [["item", $dataItems], ["weapon", $dataWeapons], ["armor", $dataArmors]]) {
      for (const item of list || []) {
        if (!item || !plain(item.name)) continue;
        if (kind === "all" || kind === (k === "item" && item.itypeId === 2 ? "key" : k)) entries.push(item);
      }
    }
    return matches(entries, query, (item) => item.description);
  }

  function addItem(item, count) {
    const room = $gameParty.maxItems(item) - $gameParty.numItems(item);
    if (room <= 0) return `${item.name}: you already hold the most the game allows`;
    $gameParty.gainItem(item, Math.min(count, room));
    return `${item.name} ×${$gameParty.numItems(item)}`;
  }

  // States with a name, matching the search (name or number).
  function findStates(query) {
    return matches(($dataStates || []).filter((state) => state && plain(state.name)), query);
  }

  // Puts a state on a party member or takes it off, whatever its resistances.
  function setState(actor, stateId, on) {
    const state = $dataStates[stateId];
    if (on && stateId === actor.deathStateId() && god) return `God mode is on: ${actor.name()} cannot be knocked out`;
    if (on && !actor.isStateAffected(stateId)) {
      actor.addNewState(stateId);
      actor.resetStateCounts(stateId);
      actor.refresh();
    } else if (!on) {
      actor.removeState(stateId);
    }
    return `${actor.name()}: ${plain(state.name)} ${on ? "on" : "off"}`;
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
    const entries = [];
    for (let id = 1; id < (names || []).length; id++) entries.push({ id, name: String(names[id] || "").trim() });
    const q = query.trim();
    return matches(entries, query).filter((entry) => entry.name || q);
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
    return matches(
      ($dataMapInfos || []).filter((info) => info && info.name).map((info) => ({ id: info.id, name: info.name })),
      query
    );
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
  const chosen = {}; // the tab last picked in each row of tabs, kept while the game runs

  function injectStyle() {
    if (document.getElementById("rwk-cheats-style")) return;
    const style = document.createElement("style");
    style.id = "rwk-cheats-style";
    style.textContent = `
.rwk-cheats{max-width:520px;display:flex;flex-direction:column;max-height:min(90vh,760px)}
.rwk-cheats-body{flex:1;min-height:0;overflow:auto;overscroll-behavior:contain;margin:0 0 14px}
.rwk-cheats-row{display:flex;flex-wrap:wrap;gap:8px;align-items:center}
.rwk-cheats button,.rwk-cheats input{font:inherit;min-height:40px;padding:6px 12px;border-radius:8px;border:1px solid #555;
  background:#2c2c33;color:#eee}
.rwk-cheats button{cursor:pointer}
.rwk-cheats button[aria-pressed="true"]{background:#3b6fd8;border-color:#3b6fd8;color:#fff}
.rwk-cheats-tabs{display:flex;flex-wrap:wrap;gap:6px;margin:0 0 10px}
.rwk-cheats-tabs button{min-height:36px;padding:4px 12px;background:none;border-color:#444}
.rwk-cheats-tabs button[aria-selected="true"]{background:#3b6fd8;border-color:#3b6fd8;color:#fff}
.rwk-cheats-tabs.sub{margin:10px 0 0}
.rwk-cheats-tabs.sub button{min-height:32px;padding:2px 10px;font-size:13px;border-radius:16px}
.rwk-cheats input{flex:1;min-width:0;box-sizing:border-box;height:40px;background:#141418}
.rwk-cheats input[type=number]{flex:0 1 9em}
.rwk-cheats-items{display:flex;flex-direction:column;margin-top:6px;border-top:1px solid #333}
.rwk-cheats-item{display:flex;align-items:center;gap:8px;padding:4px 0;border-bottom:1px solid #333}
.rwk-cheats-item span{flex:1;min-width:0;overflow-wrap:anywhere}
.rwk-cheats-item small{opacity:.65}
.rwk-cheats-item small.desc{display:block}
.rwk-cheats-item button,.rwk-cheats-item input{min-height:36px;padding:4px 10px}
.rwk-cheats-item input[type=number]{flex:0 0 7em;height:36px}
.rwk-cheats-note{margin:6px 0 0;font-size:13px;opacity:.7}
.rwk-cheats-more{margin-top:8px;width:100%}
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
  const note = (text) => el("p", { className: "rwk-cheats-note", textContent: text });

  // Tabs over sections that build themselves when picked. defs: [{ label, build }],
  // build() -> the nodes. One tab alone shows no bar. key: where the pick is kept.
  function tabs(key, defs, sub = false) {
    const panel = el("div");
    if (defs.length === 1) {
      panel.append(...defs[0].build());
      return panel;
    }
    const bar = el("div", { className: "rwk-cheats-tabs" + (sub ? " sub" : "") });
    bar.setAttribute("role", "tablist");
    const buttons = defs.map((def, i) => {
      const b = button(def.label, () => pick(i));
      b.setAttribute("role", "tab");
      return b;
    });
    const pick = (i) => {
      chosen[key] = i;
      buttons.forEach((b, j) => b.setAttribute("aria-selected", String(j === i)));
      panel.textContent = "";
      panel.append(...defs[i].build());
    };
    bar.append(...buttons);
    const wrap = el("div", {}, [bar, panel]);
    pick(chosen[key] < defs.length ? chosen[key] || 0 : 0);
    return wrap;
  }

  // A search box over a list of every match, PAGE at a time.
  // find(query) -> the entries; row(entry) -> a node.
  function searchList(placeholder, find, row) {
    const search = el("input", { type: "search", placeholder });
    search.setAttribute("aria-label", placeholder);
    const list = el("div", { className: "rwk-cheats-items" });
    const count = note("");
    let found = [];
    let shown = 0;
    const more = button("", () => showPage());
    more.className = "rwk-cheats-more";
    const showPage = () => {
      for (const entry of found.slice(shown, shown + PAGE)) list.append(row(entry));
      shown = Math.min(found.length, shown + PAGE);
      count.textContent = found.length ? `${shown} of ${found.length}` : "Nothing found.";
      more.hidden = shown >= found.length;
      more.textContent = `Show ${Math.min(PAGE, found.length - shown)} more`;
    };
    const fill = () => {
      list.textContent = "";
      found = find(search.value);
      shown = 0;
      showPage();
    };
    search.addEventListener("input", fill);
    fill();
    return [el("div", { className: "rwk-cheats-row", style: "margin-top:8px" }, [search]), count, list, more];
  }

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

    const basics = () => [
      el("div", { className: "rwk-cheats-row" }, [button("Heal everyone", run(healAll)), godBtn, button("Level +1", run(levelUp))]),
      note("God mode: HP never goes down and no one is knocked out."),
    ];

    // The member the states below are put on.
    let member = 0;
    const states = () => {
      const members = $gameParty.members();
      if (!members.length) return [note("No one in the party.")];
      const holder = el("div");
      const draw = () => {
        holder.textContent = "";
        const actor = members[Math.min(member, members.length - 1)];
        const who = el("div", { className: "rwk-cheats-row" });
        members.forEach((m, i) => {
          const b = button(m.name(), () => {
            member = i;
            draw();
          });
          b.setAttribute("aria-pressed", String(m === actor));
          who.append(b);
        });
        holder.append(
          who,
          ...searchList("Search states by name or number", findStates, (state) => {
            const toggle = button("", () => {
              RWK.toast(setState(actor, state.id, !actor.isStateAffected(state.id)), "info", 1500);
              drawToggle();
            });
            const drawToggle = () => {
              const on = actor.isStateAffected(state.id);
              toggle.textContent = on ? "ON" : "OFF";
              toggle.setAttribute("aria-pressed", String(on));
            };
            drawToggle();
            toggle.setAttribute("aria-label", plain(state.name));
            return el("div", { className: "rwk-cheats-item" }, [el("span", { textContent: plain(state.name) + " " }, [el("small", { textContent: `#${state.id}` })]), toggle]);
          })
        );
      };
      draw();
      return [holder];
    };

    return [tabs("party", [{ label: "Party", build: basics }, { label: "States", build: states }], true)];
  }

  const ITEM_KINDS = [
    ["all", "All"],
    ["item", "Items"],
    ["key", "Key items"],
    ["weapon", "Weapons"],
    ["armor", "Armor"],
  ];

  function itemsSection() {
    const gold = el("input", { type: "number", min: "1", value: "1000", inputMode: "numeric" });
    gold.setAttribute("aria-label", "Gold to add");
    const goldBtn = button("Add " + TextManager.currencyUnit, () => {
      const amount = Math.round(Number(gold.value));
      if (amount > 0) RWK.toast(addGold(amount), "info", 1500);
    });

    const items = (kind) => () =>
      searchList(
        kind === "all" ? "Search by name, number or description" : "Search this list by name, number or description",
        (query) => findItems(query, kind),
        (item) => {
          const held = el("small");
          const desc = plain(item.description);
          const name = el("span", { textContent: plain(item.name) + " " }, [held, ...(desc ? [el("small", { className: "desc", textContent: desc })] : [])]);
          const update = () => (held.textContent = `×${$gameParty.numItems(item)}`);
          update();
          const add = (n) =>
            button("+" + n, () => {
              RWK.toast(addItem(item, n), "info", 1500);
              update();
            });
          return el("div", { className: "rwk-cheats-item" }, [name, add(1), add(10)]);
        }
      );
    return [
      el("div", { className: "rwk-cheats-row" }, [gold, goldBtn]),
      tabs("items", ITEM_KINDS.map(([kind, name]) => ({ label: name, build: items(kind) })), true),
    ];
  }

  function battleSection() {
    const win = button("Win this battle", () => {
      RWK.toast(winBattle(), "info", 1500);
      close();
    });
    win.disabled = !inBattle();
    return [
      el("div", { className: "rwk-cheats-row" }, [win]),
      note(inBattle() ? "Ends as a normal victory: EXP, gold and drops." : "Only during a battle."),
    ];
  }

  function switchesSection() {
    const switches = () =>
      searchList("Search switches by name or number", findSwitches, (entry) => {
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
        return el("div", { className: "rwk-cheats-item" }, [el("span", { textContent: label(entry) }), toggle]);
      });
    const variables = () =>
      searchList("Search variables by name or number", findVariables, (entry) => {
        const current = $gameVariables.value(entry.id);
        const name = el("span", { textContent: label(entry) });
        // Only numbers can be typed in; a plugin may keep text or a list in a variable.
        if (typeof current !== "number") {
          const shown = JSON.stringify(current);
          return el("div", { className: "rwk-cheats-item" }, [name, el("small", { textContent: shown && shown.length > 24 ? shown.slice(0, 24) + "…" : shown })]);
        }
        const input = el("input", { type: "number", value: String(current), inputMode: "numeric" });
        input.setAttribute("aria-label", label(entry));
        input.addEventListener("change", () => {
          if (setVariable(entry.id, input.value)) RWK.toast(`${label(entry)} = ${$gameVariables.value(entry.id)}`, "info", 1500);
          input.value = String($gameVariables.value(entry.id));
        });
        return el("div", { className: "rwk-cheats-item" }, [name, input]);
      });
    return [
      note("Events read these to decide what happens: a wrong value can block the story. Save first."),
      tabs("switches", [{ label: "Switches", build: switches }, { label: "Variables", build: variables }], true),
    ];
  }

  function movementSection() {
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

    const walls = () => {
      const throughBtn = button("", () => {
        setThrough(!through);
        draw();
      });
      const draw = () => {
        throughBtn.textContent = through ? "Walk through walls: on" : "Walk through walls: off";
        throughBtn.setAttribute("aria-pressed", String(through));
      };
      draw();

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
      return [
        el("div", { className: "rwk-cheats-row" }, [throughBtn, remember]),
        note(blocked ? `Teleport: ${blocked}` : "Teleport: to a remembered place, or to the middle of a map (walk through walls if you land in one)."),
        placesList,
      ];
    };

    const maps = () => [
      note(blocked ? `Teleport: ${blocked}` : "Teleport to the middle of a map."),
      ...searchList("Search maps by name or number", findMaps, (map) =>
        el("div", { className: "rwk-cheats-item" }, [el("span", { textContent: `${map.name} ` }, [el("small", { textContent: `#${map.id}` })]), go(map.id, null, null)])
      ),
    ];

    return [tabs("movement", [{ label: "Walls and places", build: walls }, { label: "Maps", build: maps }], true)];
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
    const sections = [
      groups.party && { label: "Party", build: partySection },
      groups.items && { label: "Gold and items", build: itemsSection },
      groups.battle && { label: "Battle", build: battleSection },
      groups.switches && { label: "Switches and variables", build: switchesSection },
      groups.movement && { label: "Movement", build: movementSection },
    ].filter(Boolean);
    const body = el("div", { className: "rwk-cheats-body" }, [tabs("section", sections)]);
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
    findStates,
    setState,
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
