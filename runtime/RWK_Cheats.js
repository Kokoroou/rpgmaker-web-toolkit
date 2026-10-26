//=============================================================================
// RWK_Cheats.js - rpgmaker-web-toolkit
// Required Notice: Copyright 2026 Trương Tuấn Anh (https://github.com/Kokoroou)
// License: PolyForm Noncommercial 1.0.0 with the Game Creators permission,
// https://github.com/Kokoroou/rpgmaker-web-toolkit/blob/main/LICENSE
// Basic cheats in ⚙ → Cheats, off unless the deployer turns them on
// (`cheats`): heal the party, god mode, level up, gold, items, win a battle.
// Each browser confirms once before the first use. Nothing runs per frame:
// god mode is a check in Game_Actor.setHp / addState.
//=============================================================================
/*:
 * @target MZ MV
 * @plugindesc [rpgmaker-web-toolkit] Basic cheats (party, gold and items, battle). Requires RWK_Core.
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
  const MAX_RESULTS = 40;

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
.rwk-cheats-item button{min-height:36px;padding:4px 10px}
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
    detail: () => (god ? "God mode is on" : [groups.party && "party", groups.items && "gold and items", groups.battle && "battle"].filter(Boolean).join(", ")),
    onSelect: start,
  });

  RWK.cheats = { healAll, levelUp, addGold, addItem, findItems, winBattle, setGod, isGod: () => god, open: start };
})();
