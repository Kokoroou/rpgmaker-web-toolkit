//=============================================================================
// RWK_SaveTools.js - rpgmaker-web-toolkit
// Export a save slot as a desktop save file (file3.rmmzsave / file3.rpgsave)
// so an external save editor can change it, import the edited file back, or
// delete a slot.
//=============================================================================
/*:
 * @target MZ MV
 * @plugindesc [rpgmaker-web-toolkit] Save export / import / delete. Requires RWK_Core.
 * @author rpgmaker-web-toolkit
 */

(() => {
  "use strict";

  const RWK = window.RWK;
  if (!RWK || RWK.config.saveTools === false) return;

  const MZ = RWK.engine === "MZ";
  const EXT = MZ ? ".rmmzsave" : ".rpgsave";
  const SYNC_WAIT_MS = 8000;

  //---------------------------------------------------------------------------
  // Slots. MZ: ids 0 (autosave) .. maxSavefiles-1; MV: 1 .. maxSavefiles.
  //---------------------------------------------------------------------------

  function slotIds() {
    const ids = [];
    if (MZ) {
      for (let id = $dataSystem.optAutosave ? 0 : 1; id < DataManager.maxSavefiles(); id++) ids.push(id);
    } else {
      for (let id = 1; id <= DataManager.maxSavefiles(); id++) ids.push(id);
    }
    return ids;
  }

  const slotName = (id) => (MZ && id === 0 ? "Autosave" : "File " + id);
  const fileName = (id) => "file" + id + EXT;
  const exists = (id) => (MZ ? DataManager.savefileExists(id) : StorageManager.exists(id));
  const slotInfo = (id) => (MZ ? DataManager.savefileInfo(id) : DataManager.loadSavefileInfo(id));

  function describe(info) {
    if (!info) return "";
    const parts = [];
    if (info.title) parts.push(info.title);
    if (info.playtime) parts.push(info.playtime);
    if (info.timestamp) parts.push(new Date(info.timestamp).toLocaleString());
    return parts.join(" · ");
  }

  //---------------------------------------------------------------------------
  // File format: the same bytes the desktop game writes, so files move freely
  // between this page, save editors and a desktop save/ folder.
  //   MZ: pako binary string, written as UTF-8.  MV: LZString base64 text.
  //---------------------------------------------------------------------------

  async function exportSlot(id) {
    let data;
    if (MZ) {
      const zip = await StorageManager.loadZip(DataManager.makeSavename(id));
      data = new TextEncoder().encode(zip);
    } else {
      data = LZString.compressToBase64(StorageManager.load(id));
    }
    const url = URL.createObjectURL(new Blob([data], { type: "application/octet-stream" }));
    const a = document.createElement("a");
    a.href = url;
    a.download = fileName(id);
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 60000);
  }

  // Accepts the desktop format, the raw bytes some editors write instead,
  // or plain JSON. -> { json, contents }
  async function parseFile(buffer) {
    const bytes = new Uint8Array(buffer);
    let text = new TextDecoder().decode(bytes).replace(/^﻿/, "");
    let json;
    if (/^\s*\{/.test(text)) {
      json = text.trim();
    } else if (MZ) {
      if (/[^\x00-\xff]/.test(text)) text = latin1(bytes); // not UTF-8: raw zip bytes
      json = await StorageManager.zipToJson(text);
    } else {
      json = LZString.decompressFromBase64(text.trim());
    }
    const contents = JsonEx.parse(json);
    // Every game save has these; config/global files and junk do not.
    if (!contents || typeof contents !== "object" || !contents.system || !contents.party) {
      throw new Error("not a save file");
    }
    return { json, contents };
  }

  function latin1(bytes) {
    let out = "";
    for (let i = 0; i < bytes.length; i += 0x8000) {
      out += String.fromCharCode.apply(null, bytes.subarray(i, i + 0x8000));
    }
    return out;
  }

  // Writes through the engine so save sync sees it like a normal save, then
  // refreshes the slot's entry in the save list (title, party, playtime).
  // That loads the save into the game objects, which is fine: the page
  // reloads next.
  async function importSlot(id, { json, contents }) {
    if (MZ) await StorageManager.saveZip(DataManager.makeSavename(id), await StorageManager.jsonToZip(json));
    else StorageManager.save(id, json);

    let info = null;
    try {
      DataManager.createGameObjects();
      DataManager.extractSaveContents(contents);
      info = DataManager.makeSavefileInfo();
    } catch (e) {
      console.warn("[RWK] could not read save info", e);
    }
    if (MZ) {
      DataManager._globalInfo[id] = info || { ...(DataManager._globalInfo[id] || {}), timestamp: Date.now() };
      await StorageManager.saveObject("global", DataManager._globalInfo);
    } else {
      const globalInfo = DataManager.loadGlobalInfo() || [];
      globalInfo[id] = info || { ...(globalInfo[id] || {}), timestamp: Date.now() };
      DataManager.saveGlobalInfo(globalInfo);
    }
  }

  // Removes through the engine so save sync deletes the cloud copy too, and
  // drops the slot from the save list.
  async function deleteSlot(id) {
    if (MZ) {
      await StorageManager.remove(DataManager.makeSavename(id));
      await StorageManager.updateForageKeys();
      DataManager._globalInfo[id] = null;
      await StorageManager.saveObject("global", DataManager._globalInfo);
    } else {
      StorageManager.remove(id);
      const globalInfo = DataManager.loadGlobalInfo() || [];
      globalInfo[id] = null;
      DataManager.saveGlobalInfo(globalInfo);
    }
    // A save / load screen open behind the panel still shows the slot.
    const scene = SceneManager._scene;
    if (scene && scene._listWindow && scene._listWindow.refresh) scene._listWindow.refresh();
  }

  //---------------------------------------------------------------------------
  // Panel
  //---------------------------------------------------------------------------

  const style = document.createElement("style");
  style.textContent = `
.rwk-saves{max-width:520px}
.rwk-saves-list{max-height:min(55vh,420px);overflow:auto;margin:0 0 14px;border-top:1px solid #333}
.rwk-saves-row{display:flex;align-items:center;gap:8px;padding:8px 0;border-bottom:1px solid #333}
.rwk-saves-row div{flex:1;min-width:0}
.rwk-saves-row small{display:block;opacity:.65;font-size:12px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.rwk-saves-row button{font:inherit;font-size:13px;padding:6px 10px;border-radius:8px;border:1px solid #555;
  background:#2c2c33;color:#eee;cursor:pointer}
.rwk-saves-row button:disabled{opacity:.35;cursor:default}
.rwk-saves-row button.danger{color:#f88;border-color:#844}
.rwk-saves-btn{position:fixed;left:6px;top:6px;z-index:55;width:30px;height:30px;padding:0;border-radius:50%;
  border:1px solid rgba(255,255,255,.3);background:rgba(20,20,28,.5);color:#fff;font-size:15px;cursor:pointer;
  opacity:.2;transition:opacity .2s}
.rwk-saves-btn:hover{opacity:1}
`;
  document.head.appendChild(style);

  let busy = false;

  function openPanel() {
    const scene = SceneManager._scene;
    if (!DataManager.isDatabaseLoaded() || !scene || scene instanceof Scene_Boot) {
      RWK.toast("Wait until the game has finished loading.", "warn", 2500);
      return;
    }
    if (busy || document.querySelector(".rwk-saves")) return;

    const overlay = document.createElement("div");
    overlay.className = "rwk-modal";
    const box = document.createElement("div");
    box.className = "rwk-modal-box rwk-saves";
    const h = document.createElement("h2");
    h.textContent = "Saves";
    const p = document.createElement("p");
    p.textContent =
      `Export saves a slot as fileN${EXT}, the file the desktop game uses, ` +
      "ready for a save editor. Import puts an edited file back into a slot and restarts the game. " +
      "Delete empties a slot" + (RWK.saveSync ? ", here and in the cloud." : ".");
    const list = document.createElement("div");
    list.className = "rwk-saves-list";
    const close = () => overlay.remove();

    const fill = () => {
      list.textContent = "";
      for (const id of slotIds()) list.appendChild(slotRow(id, close, fill));
    };
    fill();

    const actions = document.createElement("div");
    actions.className = "rwk-modal-actions";
    actions.appendChild(button("Close", close));
    box.append(h, p, list, actions);
    overlay.appendChild(box);
    overlay.addEventListener("click", (e) => e.target === overlay && close());
    RWK.shield(overlay);
    document.body.appendChild(overlay);
  }

  function slotRow(id, closePanel, refreshPanel) {
    const has = exists(id);
    const row = document.createElement("div");
    row.className = "rwk-saves-row";
    const label = document.createElement("div");
    label.textContent = slotName(id);
    const sub = document.createElement("small");
    sub.textContent = has ? describe(slotInfo(id)) || "Saved" : "Empty";
    label.appendChild(sub);
    const exp = button("Export", () =>
      exportSlot(id).catch((e) => {
        console.error("[RWK] export failed", e);
        RWK.toast("Could not export " + slotName(id) + ".", "error", 4000);
      })
    );
    exp.disabled = !has;
    const imp = button("Import", () => pickFile(id, has, closePanel));
    const del = button("Delete", () => confirmDelete(id, refreshPanel));
    del.className = "danger";
    del.disabled = !has;
    row.append(label, exp, imp, del);
    return row;
  }

  async function confirmDelete(id, refreshPanel) {
    const ok = await RWK.choose(
      "Delete save",
      `Delete ${slotName(id)}?` +
        (RWK.saveSync ? "\nIt is also removed from the cloud, on every device." : "") +
        "\n\nThis cannot be undone: export it first to keep a copy.",
      [
        { label: "Cancel", value: false, primary: true },
        { label: "Delete", value: true },
      ]
    );
    if (!ok || busy) return;
    busy = true;
    try {
      await deleteSlot(id);
      RWK.toast(slotName(id) + " deleted.", "info", 2000);
    } catch (e) {
      console.error("[RWK] delete failed", e);
      RWK.toast("Could not delete " + slotName(id) + ".", "error", 4000);
    } finally {
      busy = false;
      refreshPanel();
    }
  }

  function button(label, onClick) {
    const b = document.createElement("button");
    b.textContent = label;
    b.addEventListener("click", onClick);
    return b;
  }

  // The file picker must open straight from the tap, before any await.
  function pickFile(id, has, closePanel) {
    const input = document.createElement("input");
    input.type = "file";
    input.addEventListener("change", async () => {
      const file = input.files && input.files[0];
      if (!file) return;
      let parsed;
      try {
        parsed = await parseFile(await file.arrayBuffer());
      } catch (e) {
        console.warn("[RWK] import rejected", e);
        RWK.toast(`“${file.name}” is not a save file of this game's engine (${EXT}).`, "error", 5000);
        return;
      }
      const ok = await RWK.choose(
        "Import save",
        `Put “${file.name}” into ${slotName(id)}?` +
          (has ? "\nThe save in that slot is replaced." : "") +
          "\n\nThe game restarts afterwards: progress not saved yet is lost.",
        [
          { label: "Cancel", value: false },
          { label: "Import", value: true, primary: true },
        ]
      );
      if (!ok) return;
      closePanel();
      await runImport(id, parsed);
    });
    input.click();
  }

  async function runImport(id, parsed) {
    busy = true;
    RWK.toast("Importing…", "info", 0);
    try {
      await importSlot(id, parsed);
    } catch (e) {
      busy = false;
      console.error("[RWK] import failed", e);
      RWK.toast("Import failed: " + (e && e.message ? e.message : e), "error", 6000);
      return;
    }
    // Upload now if possible; anything left over is pushed at the next boot.
    if (RWK.saveSync) {
      RWK.toast("☁ Uploading the imported save…", "info", 0);
      await Promise.race([RWK.saveSync.flush(), new Promise((r) => setTimeout(r, SYNC_WAIT_MS))]).catch(() => {});
    }
    RWK.toast("Imported into " + slotName(id) + ". Restarting…", "info", 0);
    setTimeout(() => location.reload(), 600);
  }

  //---------------------------------------------------------------------------
  // Entry point: a 💾 tool in the on-screen toolbar, or a small corner button
  // when the touch controls are not shown (desktop).
  //---------------------------------------------------------------------------

  if (RWK.controls) {
    RWK.controls.addTool("💾", "rwk-tool-saves", openPanel);
  } else {
    const btn = document.createElement("button");
    btn.className = "rwk-saves-btn";
    btn.textContent = "💾";
    btn.title = "Export / import / delete saves";
    btn.addEventListener("click", openPanel);
    RWK.shield(btn);
    document.body.appendChild(btn);
  }

  RWK.saveTools = { open: openPanel };
})();
