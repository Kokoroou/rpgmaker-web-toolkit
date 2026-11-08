//=============================================================================
// RWK_Download.js - rpgmaker-web-toolkit
// Required Notice: Copyright 2026 Trương Tuấn Anh (https://github.com/Kokoroou)
// License: PolyForm Noncommercial 1.0.0 with the Game Creators permission,
// https://github.com/Kokoroou/rpgmaker-web-toolkit/blob/main/LICENSE
// ⚙ → Share → Download game (ZIP): the game's host/admin downloads the full
// web build as a ZIP archive. Only the owner's emails see this entry.
//=============================================================================
/*:
 * @target MZ MV
 * @plugindesc [rpgmaker-web-toolkit] Download game build as ZIP, for the host/owner. Requires RWK_Core.
 * @author rpgmaker-web-toolkit
 */

(() => {
  "use strict";

  const RWK = window.RWK;
  if (!RWK || !RWK.tools) return;

  async function download() {
    if (!navigator.onLine) {
      RWK.toast("Downloading needs an internet connection.", "warn", 3000);
      return;
    }
    const ok = await RWK.choose(
      "Download game (ZIP)",
      "Download the complete web build of this game as a ZIP archive? This includes all game data, media, and scripts.",
      [
        { label: "Download", value: true, primary: true },
        { label: "Cancel", value: false, cancel: true },
      ]
    );
    if (!ok) return;

    RWK.toast("Starting download…", "info", 3000);
    const a = document.createElement("a");
    a.href = "/api/download";
    a.download = "";
    document.body.appendChild(a);
    a.click();
    a.remove();
  }

  // Only the owner sees the entry, and only when the deploy made the archive:
  // the Worker answers 403 to everyone else, and `ready: false` for a game
  // deployed before the archive was part of the build.
  fetch("/api/download?check=1", { credentials: "same-origin" })
    .then(async (res) => {
      if (!res.ok) return;
      const data = await res.json().catch(() => null);
      if (!data || !data.owner || !data.ready) return;
      RWK.tools.add({
        icon: RWK.icons.download,
        group: "share",
        label: "Download game (ZIP)",
        detail: "Download the complete game build as a ZIP file (Host only)",
        onSelect: download,
      });
    })
    .catch(() => {});
})();
