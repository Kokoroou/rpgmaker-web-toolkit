//=============================================================================
// RWK_Dash.js - rpgmaker-web-toolkit
// Required Notice: Copyright 2026 Trương Tuấn Anh (https://github.com/Kokoroou)
// License: PolyForm Noncommercial 1.0.0 with the Game Creators permission,
// https://github.com/Kokoroou/rpgmaker-web-toolkit/blob/main/LICENSE
// Always dash from the ⚙ menu, for games that hide the engine's own option.
// It is the same setting as Options → Always Dash, so the game's menu shows
// it too and it is saved (and synced) with the game's config. The deployer
// can set it for players who never chose, or lock it.
//=============================================================================
/*:
 * @target MZ MV
 * @plugindesc [rpgmaker-web-toolkit] Always dash switch in the ⚙ menu. Requires RWK_Core.
 * @author rpgmaker-web-toolkit
 */

(() => {
  "use strict";

  const RWK = window.RWK;
  if (!RWK || RWK.config.alwaysDash === false) return;

  // The deployer's choice (cli/lib/stage.js: alwaysDashConfig).
  const cfg = typeof RWK.config.alwaysDash === "object" ? RWK.config.alwaysDash : {};
  const start = typeof cfg.on === "boolean" ? cfg.on : null;

  if (start !== null && cfg.lock) {
    // Options → Always Dash shows it and cannot change it.
    Object.defineProperty(ConfigManager, "alwaysDash", { configurable: true, get: () => start, set: () => {} });
    return;
  }
  if (start !== null) {
    // Only for a player who never chose: their config has no alwaysDash yet.
    const _applyData = ConfigManager.applyData;
    ConfigManager.applyData = function (config) {
      _applyData.apply(this, arguments);
      if (!config || !("alwaysDash" in config)) this.alwaysDash = start;
    };
  }

  const on = () => !!ConfigManager.alwaysDash;
  // Maps can forbid dashing (map settings: Disable Dashing).
  const mapForbids = () => !!(window.$gameMap && $gameMap.mapId() > 0 && $gameMap.isDashDisabled());
  const walkKey = () => (RWK.controls ? "hold Dash" : "hold Shift");

  function toggle() {
    ConfigManager.alwaysDash = !on();
    ConfigManager.save();
    RWK.toast(on() ? "Always dash: on" : "Always dash: off", "info", 1200);
  }

  RWK.tools.add({
    icon: RWK.icons.footprints,
    group: "speed",
    label: "Always dash",
    detail: () =>
      (on() ? `On: you run, ${walkKey()} to walk` : `Off: ${walkKey()} to run`) +
      (mapForbids() ? " · this map does not allow running" : ""),
    keepOpen: true,
    onSelect: toggle,
  });
})();
