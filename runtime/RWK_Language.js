//=============================================================================
// RWK_Language.js - rpgmaker-web-toolkit
// Required Notice: Copyright 2026 Trương Tuấn Anh (https://github.com/Kokoroou)
// License: PolyForm Noncommercial 1.0.0 with the Game Creators permission,
// https://github.com/Kokoroou/rpgmaker-web-toolkit/blob/main/LICENSE
// Translations: a game that ships data-vi/, data-en/… next to data/ plays
// from the folder the player picks. A file the translation lacks comes from data/.
//=============================================================================
/*:
 * @target MZ MV
 * @plugindesc [rpgmaker-web-toolkit] Language picker for data-<code> translations. Requires RWK_Core.
 * @author rpgmaker-web-toolkit
 */

(() => {
  "use strict";

  const RWK = window.RWK;
  // The folders and their files, from the CLI (cli/lib/languages.js: languagesRuntime).
  const cfg = RWK && RWK.config.languages;
  if (!cfg || !cfg.choices) return;

  const codes = Object.keys(cfg.choices);
  const KEY = "rwk.language." + RWK.config.gameId;
  const stored = RWK.storage.get(KEY);
  // "" is the game as it is (data/). The creator's lock keeps everyone on the default.
  const current = cfg.lock ? cfg.default : typeof stored === "string" && (stored === "" || codes.includes(stored)) ? stored : cfg.default;

  //---------------------------------------------------------------------------
  // Both engines read their data with XMLHttpRequest("data/<file>") (DataManager),
  // and so do many plugins. Point those at the translation's copy, file by file.
  //---------------------------------------------------------------------------

  if (current) {
    const { dir, files } = cfg.choices[current];
    const have = new Set(files);
    const _open = XMLHttpRequest.prototype.open;
    XMLHttpRequest.prototype.open = function (method, url) {
      const m = typeof url === "string" && /^(\.\/)?data\/([^/?#]+)(.*)$/.exec(url);
      if (!m || !have.has(m[2])) return _open.apply(this, arguments);
      const args = Array.from(arguments);
      args[1] = `${m[1] || ""}${dir}/${m[2]}${m[3]}`;
      return _open.apply(this, args);
    };
    document.documentElement.lang = current;
  }

  //---------------------------------------------------------------------------
  // ⚙ → Language. The data is read once at start-up, so a change restarts the game.
  //---------------------------------------------------------------------------

  // Folders are named by whatever the translator typed: jp, cn, vn…
  const ALIAS = { jp: "ja", cn: "zh-CN", tw: "zh-TW", kr: "ko", vn: "vi", br: "pt-BR" };

  function nameOf(code) {
    const tag = ALIAS[code] || code;
    try {
      const name = new Intl.DisplayNames([tag], { type: "language" }).of(tag);
      if (name && name.toLowerCase() !== tag.toLowerCase()) return name.charAt(0).toLocaleUpperCase(tag) + name.slice(1);
    } catch (e) {
      // No Intl.DisplayNames, or a code it does not know.
    }
    return code.toUpperCase();
  }

  const labelOf = (code) => (code ? nameOf(code) : cfg.original ? `${nameOf(cfg.original)} (original)` : "Original");

  async function pick() {
    const options = ["", ...codes].map((code) => ({ label: labelOf(code), value: code, primary: code === current }));
    options.push({ label: "Cancel", value: null });
    const code = await RWK.choose("Language", "The game restarts to change language: progress since your last save is lost.", options);
    if (code === null || code === current) return;
    RWK.storage.set(KEY, code);
    location.reload();
  }

  if (!cfg.lock) {
    RWK.tools.add({
      icon: RWK.icons.languages,
      group: "display",
      label: () => `Language: ${labelOf(current)}`,
      detail: "Tap to change; the game restarts",
      onSelect: pick,
    });
  }
})();
