//=============================================================================
// RWK_SaveHistory.js - rpgmaker-web-toolkit
// Required Notice: Copyright 2026 Trương Tuấn Anh (https://github.com/Kokoroou)
// License: PolyForm Noncommercial 1.0.0 with the Game Creators permission,
// https://github.com/Kokoroou/rpgmaker-web-toolkit/blob/main/LICENSE
// Brings back an older copy of a save. The Worker keeps one when a save is
// overwritten or deleted (worker/saves.js); this lists them in ⚙ → Saves and
// restores one, here and in the cloud.
//=============================================================================
/*:
 * @target MZ MV
 * @plugindesc [rpgmaker-web-toolkit] Older saves from the cloud. Requires RWK_Core, RWK_SaveSync.
 * @author rpgmaker-web-toolkit
 */

(() => {
  "use strict";

  const RWK = window.RWK;
  if (!RWK || !RWK.saveSync || !RWK.config.saveHistory) return;

  const MZ = RWK.engine === "MZ";
  const sync = RWK.saveSync;
  const { keep, days } = RWK.config.saveHistory;
  const SYNC_WAIT_MS = 8000;

  // fileN -> N, other names (rwk-quick, rwk-auto) -> null
  const slotOf = (name) => {
    const m = /^file(\d+)$/.exec(name);
    return m ? Number(m[1]) : null;
  };

  function label(name) {
    const id = slotOf(name);
    if (id === null) return sync.label(name);
    return MZ && id === 0 ? "Autosave" : "File " + id;
  }

  const when = (ms) => new Date(ms).toLocaleString([], { dateStyle: "medium", timeStyle: "short" });
  const device = (id) => (id === RWK.deviceId ? "this device" : id);
  const size = (bytes) => (bytes < 1024 * 1024 ? Math.max(1, Math.round(bytes / 1024)) + " KB" : (bytes / 1048576).toFixed(1) + " MB");

  //---------------------------------------------------------------------------
  // Restore: the cloud puts the copy back, sync writes it on this device, then
  // the save list entry (title, playtime) is rebuilt from it, as an import
  // does (RWK_SaveTools). That loads the save into the game objects, which is
  // fine: the page reloads next.
  //---------------------------------------------------------------------------

  async function restore(item) {
    await sync.restore(item.name, item.id);
    const id = slotOf(item.name);
    if (id === null) return;
    let info = null;
    try {
      const contents = MZ ? await StorageManager.loadObject(item.name) : JsonEx.parse(StorageManager.load(id));
      DataManager.createGameObjects();
      DataManager.extractSaveContents(contents);
      info = DataManager.makeSavefileInfo();
    } catch (e) {
      console.warn("[RWK] could not read save info", e);
    }
    if (MZ) {
      DataManager._globalInfo[id] = info || { ...(DataManager._globalInfo[id] || {}), timestamp: item.updatedAt };
      await StorageManager.saveObject("global", DataManager._globalInfo);
    } else {
      const globalInfo = DataManager.loadGlobalInfo() || [];
      globalInfo[id] = info || { ...(globalInfo[id] || {}), timestamp: item.updatedAt };
      DataManager.saveGlobalInfo(globalInfo);
    }
  }

  //---------------------------------------------------------------------------
  // Panel
  //---------------------------------------------------------------------------

  const style = document.createElement("style");
  style.textContent = `
.rwk-history{max-width:520px}
.rwk-history-list{max-height:min(55vh,420px);overflow:auto;margin:0 0 14px;border-top:1px solid #333}
.rwk-history-list h3{margin:12px 0 2px;font-size:13px}
.rwk-history-list > p{margin:12px 0;opacity:.75}
.rwk-history-row{display:flex;align-items:center;gap:8px;padding:8px 0;border-bottom:1px solid #333}
.rwk-history-row div{flex:1;min-width:0}
.rwk-history-row small{display:block;opacity:.65;font-size:12px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.rwk-history-row button{font:inherit;font-size:13px;padding:6px 10px;border-radius:8px;border:1px solid #555;
  background:#2c2c33;color:#eee;cursor:pointer}
`;
  document.head.appendChild(style);

  let busy = false;

  function openPanel() {
    const scene = SceneManager._scene;
    if (!DataManager.isDatabaseLoaded() || !scene || scene instanceof Scene_Boot) {
      RWK.toast("Wait until the game has finished loading.", "warn", 2500);
      return;
    }
    if (!navigator.onLine) {
      RWK.toast("Older saves are in the cloud: connect to the internet first.", "warn", 3000);
      return;
    }
    if (busy || document.querySelector(".rwk-history")) return;

    const overlay = document.createElement("div");
    overlay.className = "rwk-modal";
    const box = document.createElement("div");
    box.className = "rwk-modal-box rwk-history";
    const h = document.createElement("h2");
    h.textContent = "Older saves";
    const p = document.createElement("p");
    p.textContent =
      `Copies the cloud kept when a save was overwritten or deleted: up to ${keep} per save, for ${days} days. ` +
      "Restoring one keeps the current save here too.";
    const list = document.createElement("div");
    list.className = "rwk-history-list";
    const note = document.createElement("p");
    note.textContent = "Loading…";
    list.appendChild(note);
    const close = () => overlay.remove();

    const actions = document.createElement("div");
    actions.className = "rwk-modal-actions";
    const closeBtn = document.createElement("button");
    closeBtn.textContent = "Close";
    closeBtn.addEventListener("click", close);
    actions.appendChild(closeBtn);
    box.append(h, p, list, actions);
    overlay.appendChild(box);
    overlay.addEventListener("click", (e) => e.target === overlay && close());
    RWK.shield(overlay);
    document.body.appendChild(overlay);

    sync
      .history()
      .then((items) => fill(list, items, close))
      .catch((e) => {
        console.error("[RWK] save history failed", e);
        note.textContent = "Could not load the older saves. Check the connection, or reload the page if your login expired.";
      });
  }

  function fill(list, items, closePanel) {
    list.textContent = "";
    if (!items.length) {
      const empty = document.createElement("p");
      empty.textContent = "No older copies yet.";
      list.appendChild(empty);
      return;
    }
    const names = [...new Set(items.map((i) => i.name))].sort((a, b) => a.localeCompare(b, undefined, { numeric: true }));
    for (const name of names) {
      const title = document.createElement("h3");
      title.textContent = label(name);
      list.appendChild(title);
      for (const item of items.filter((i) => i.name === name)) {
        const row = document.createElement("div");
        row.className = "rwk-history-row";
        const text = document.createElement("div");
        text.textContent = when(item.updatedAt);
        const sub = document.createElement("small");
        sub.textContent = "Saved on " + device(item.deviceId) + " · " + size(item.size);
        text.appendChild(sub);
        const button = document.createElement("button");
        button.textContent = "Restore";
        button.addEventListener("click", () => confirmRestore(item, closePanel));
        row.append(text, button);
        list.appendChild(row);
      }
    }
  }

  async function confirmRestore(item, closePanel) {
    const ok = await RWK.choose(
      "Restore save",
      `Put back ${label(item.name)} as saved on ${when(item.updatedAt)}?\n` +
        "The current copy of that save is kept in the older saves.\n\n" +
        "The game restarts afterwards: progress not saved yet is lost.",
      [
        { label: "Cancel", value: false },
        { label: "Restore", value: true, primary: true },
      ]
    );
    if (!ok || busy) return;
    closePanel();
    busy = true;
    RWK.toast("Restoring…", "info", 0);
    try {
      await restore(item);
    } catch (e) {
      busy = false;
      console.error("[RWK] restore failed", e);
      RWK.toast("Could not restore the save. Check the connection and try again.", "error", 5000);
      return;
    }
    // The save list (global) changed too: upload it before the reload if possible.
    await Promise.race([sync.flush(), new Promise((r) => setTimeout(r, SYNC_WAIT_MS))]).catch(() => {});
    RWK.toast(label(item.name) + " restored. Restarting…", "info", 0);
    setTimeout(() => location.reload(), 600);
  }

  RWK.tools.add({
    icon: RWK.icons.archiveRestore,
    group: "save",
    label: "Older saves",
    detail: "Bring back a save as it was earlier",
    onSelect: openPanel,
  });
})();
