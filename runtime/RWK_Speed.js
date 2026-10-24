//=============================================================================
// RWK_Speed.js - rpgmaker-web-toolkit
// Required Notice: Copyright 2026 Trương Tuấn Anh (https://github.com/Kokoroou)
// License: PolyForm Noncommercial 1.0.0 with the Game Creators permission,
// https://github.com/Kokoroou/rpgmaker-web-toolkit/blob/main/LICENSE
// Fast forward ×2 / ×3 / ×4: the scene updates several times per frame, so
// walking, battles, animations and text all run faster. Sound and movies keep
// their normal speed.
//=============================================================================
/*:
 * @target MZ MV
 * @plugindesc [rpgmaker-web-toolkit] Fast forward. Requires RWK_Core.
 * @author rpgmaker-web-toolkit
 */

(() => {
  "use strict";

  const RWK = window.RWK;
  if (!RWK || RWK.config.fastForward === false) return;

  const SPEEDS = [2, 3, 4];
  const SPEED_KEY = "rwk.speed." + RWK.config.gameId;
  const HOLD_MS = 300; // pressing ⏩ longer than this fast-forwards only while held

  let speed = SPEEDS.includes(RWK.storage.get(SPEED_KEY)) ? RWK.storage.get(SPEED_KEY) : SPEEDS[0];
  let toggled = false; // ⏩ tapped, or ` pressed
  let holds = 0; // ⏩ or Tab held down
  const factor = () => (toggled || holds > 0 ? speed : 1);

  //---------------------------------------------------------------------------
  // Each extra update reads input again first, as the engine does every
  // frame, so a key press triggers once instead of once per update. Stops
  // early when the scene changes; the next frame starts the new one.
  //---------------------------------------------------------------------------

  const sceneStarted = (sm) =>
    sm._scene && (sm._scene.isStarted ? sm._scene.isStarted() : sm.isCurrentSceneStarted());

  const _updateScene = SceneManager.updateScene;
  SceneManager.updateScene = function () {
    _updateScene.apply(this, arguments);
    for (let i = factor(); i > 1; i--) {
      if (RWK.tools.isOpen() || this.isSceneChanging() || !sceneStarted(this)) break;
      this.updateInputData();
      if (this.updateEffekseer) this.updateEffekseer(); // MZ battle animations
      _updateScene.apply(this, arguments);
    }
  };

  //---------------------------------------------------------------------------
  // Controls: ⏩ in the touch toolbar (tap: on / off, hold: only while held),
  // ` and held Tab on a keyboard, and the speed in the ⏸ menu.
  //---------------------------------------------------------------------------

  let button = null;

  function refresh() {
    if (!button) return;
    button.classList.toggle("rwk-active", factor() > 1);
    button.querySelector("small").textContent = "×" + speed;
  }

  function setToggled(on) {
    toggled = on;
    refresh();
    RWK.toast(on ? `Fast forward ×${speed}` : "Normal speed", "info", 1200);
  }

  function setSpeed(value) {
    speed = value;
    RWK.storage.set(SPEED_KEY, speed);
    refresh();
  }

  function hold(on) {
    holds = Math.max(0, holds + (on ? 1 : -1));
    refresh();
  }

  RWK.tools.add({
    icon: RWK.icons.fastForward,
    group: "play",
    label: "Fast forward",
    detail: () => (toggled ? `On at ×${speed}` : "Off") + (button ? "" : " · ` turns it on or off, hold Tab for a moment"),
    keepOpen: true,
    onSelect: () => setToggled(!toggled),
  });
  RWK.tools.add({
    icon: RWK.icons.gauge,
    group: "play",
    label: () => `Fast-forward speed: ×${speed}`,
    detail: () => `Tap for ×${SPEEDS[(SPEEDS.indexOf(speed) + 1) % SPEEDS.length]}`,
    keepOpen: true,
    onSelect: () => setSpeed(SPEEDS[(SPEEDS.indexOf(speed) + 1) % SPEEDS.length]),
  });

  if (RWK.controls) {
    const style = document.createElement("style");
    style.textContent = `
.rwk-tool.rwk-tool-speed{width:auto;min-width:calc(var(--u)*.66);padding:0 .45em;gap:.15em;border-radius:999px}
.rwk-tool.rwk-tool-speed small{font-size:calc(var(--u)*.22)}
.rwk-tool.rwk-tool-speed.rwk-active{background:rgba(90,140,255,.8);border-color:#fff}
`;
    document.head.appendChild(style);
    let timer = 0;
    let held = false;
    button = RWK.controls.addTool(
      RWK.icons.fastForward + "<small></small>",
      "rwk-tool-speed",
      () => {
        clearTimeout(timer);
        if (held) {
          held = false;
          hold(false);
        } else setToggled(!toggled);
      },
      "Fast forward (tap: on / off, hold: while held)",
      "right",
      () => {
        clearTimeout(timer);
        timer = setTimeout(() => {
          held = true;
          hold(true);
        }, HOLD_MS);
      }
    );
    refresh();
  }

  // ` toggles and a held Tab fast-forwards, unless the game's plugins use those keys.
  const free = (code, name) => !Input.keyMapper[code] || Input.keyMapper[code] === name;
  let tabHeld = false;
  window.addEventListener("keydown", (e) => {
    if (RWK.tools.isOpen() || e.ctrlKey || e.altKey || e.metaKey) return;
    if (e.keyCode === 192 && !e.repeat && free(192)) {
      setToggled(!toggled);
    } else if (e.keyCode === 9 && free(9, "tab")) {
      e.preventDefault();
      if (!tabHeld) {
        tabHeld = true;
        hold(true);
      }
    }
  });
  const releaseTab = () => {
    if (!tabHeld) return;
    tabHeld = false;
    hold(false);
  };
  window.addEventListener("keyup", (e) => e.keyCode === 9 && releaseTab());
  window.addEventListener("blur", releaseTab);
})();
