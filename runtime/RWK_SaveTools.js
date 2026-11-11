//=============================================================================
// RWK_SaveTools.js - rpgmaker-web-toolkit
// Required Notice: Copyright 2026 Trương Tuấn Anh (https://github.com/Kokoroou)
// License: PolyForm Noncommercial 1.0.0 with the Game Creators permission,
// https://github.com/Kokoroou/rpgmaker-web-toolkit/blob/main/LICENSE
// Export a save slot as a desktop save file (file3.rmmzsave / file3.rpgsave)
// so an external save editor can change it, import the edited file back, or
// delete a slot; or download the whole save folder (slots, config, global and
// where they come from) as one ZIP.
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

  // What the deployer allows (cli/lib/stage.js: saveToolsConfig).
  const cfg = typeof RWK.config.saveTools === "object" ? RWK.config.saveTools : {};
  const allow = { export: cfg.export !== false, import: cfg.import !== false, delete: cfg.delete !== false };
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
    if (info.playtime) parts.push(info.playtime);
    if (info.timestamp) parts.push(new Date(info.timestamp).toLocaleString());
    return parts.join(" · ");
  }

  //---------------------------------------------------------------------------
  // File format: the same bytes the desktop game writes, so files move freely
  // between this page, save editors and a desktop save/ folder.
  //   MZ: pako binary string, written as UTF-8.  MV: LZString base64 text.
  //---------------------------------------------------------------------------

  // The bytes of one save as the desktop game writes it. `id` is a slot, or
  // "config" / "global": the engine's settings file and its list of slots.
  async function saveBytes(id) {
    if (MZ) {
      const name = typeof id === "string" ? id : DataManager.makeSavename(id);
      return new TextEncoder().encode(await StorageManager.loadZip(name));
    }
    const mvId = id === "config" ? -1 : id === "global" ? 0 : id;
    return new TextEncoder().encode(LZString.compressToBase64(StorageManager.load(mvId)));
  }

  function download(data, name, type) {
    const url = URL.createObjectURL(new Blob([data], { type }));
    const a = document.createElement("a");
    a.href = url;
    a.download = name;
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 60000);
  }

  async function exportSlot(id) {
    download(await saveBytes(id), fileName(id), "application/octet-stream");
  }

  //---------------------------------------------------------------------------
  // Export all: the whole save/ folder of the desktop game as one ZIP. Besides
  // the slots it holds config and global (the options and the slot list) and
  // rwk-environment.json, which says where the saves come from.
  //---------------------------------------------------------------------------

  const CRC_TABLE = (() => {
    const table = new Uint32Array(256);
    for (let n = 0; n < 256; n++) {
      let c = n;
      for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
      table[n] = c >>> 0;
    }
    return table;
  })();

  function crc32(bytes) {
    let crc = 0xffffffff;
    for (let i = 0; i < bytes.length; i++) crc = CRC_TABLE[(crc ^ bytes[i]) & 0xff] ^ (crc >>> 8);
    return (crc ^ 0xffffffff) >>> 0;
  }

  // entries: [{ name, data: Uint8Array }] -> Uint8Array of a ZIP, files stored
  // without compression (saves are already compressed).
  function buildZip(entries, date = new Date()) {
    const dosTime = (date.getHours() << 11) | (date.getMinutes() << 5) | (date.getSeconds() >> 1);
    const dosDate = ((date.getFullYear() - 1980) << 9) | ((date.getMonth() + 1) << 5) | date.getDate();
    const encoder = new TextEncoder();
    const parts = [];
    const central = [];
    let offset = 0;
    for (const { name, data } of entries) {
      const nameBytes = encoder.encode(name);
      const crc = crc32(data);
      const local = new DataView(new ArrayBuffer(30));
      local.setUint32(0, 0x04034b50, true);
      local.setUint16(4, 20, true);
      local.setUint16(6, 0x0800, true); // UTF-8 names
      local.setUint16(10, dosTime, true);
      local.setUint16(12, dosDate, true);
      local.setUint32(14, crc, true);
      local.setUint32(18, data.length, true);
      local.setUint32(22, data.length, true);
      local.setUint16(26, nameBytes.length, true);
      parts.push(new Uint8Array(local.buffer), nameBytes, data);
      const entry = new DataView(new ArrayBuffer(46));
      entry.setUint32(0, 0x02014b50, true);
      entry.setUint16(4, 20, true);
      entry.setUint16(6, 20, true);
      entry.setUint16(8, 0x0800, true);
      entry.setUint16(12, dosTime, true);
      entry.setUint16(14, dosDate, true);
      entry.setUint32(16, crc, true);
      entry.setUint32(20, data.length, true);
      entry.setUint32(24, data.length, true);
      entry.setUint16(28, nameBytes.length, true);
      entry.setUint32(42, offset, true);
      central.push(new Uint8Array(entry.buffer), nameBytes);
      offset += 30 + nameBytes.length + data.length;
    }
    const centralSize = central.reduce((n, part) => n + part.length, 0);
    const end = new DataView(new ArrayBuffer(22));
    end.setUint32(0, 0x06054b50, true);
    end.setUint16(8, entries.length, true);
    end.setUint16(10, entries.length, true);
    end.setUint32(12, centralSize, true);
    end.setUint32(16, offset, true);
    const all = [...parts, ...central, new Uint8Array(end.buffer)];
    const out = new Uint8Array(all.reduce((n, part) => n + part.length, 0));
    let at = 0;
    for (const part of all) {
      out.set(part, at);
      at += part.length;
    }
    return out;
  }

  const has = (id) => {
    try {
      if (id === "config" || id === "global") {
        if (MZ) return StorageManager.forageKeys ? StorageManager.forageKeys.includes(StorageManager.forageKey(id)) : true;
        return StorageManager.exists(id === "config" ? -1 : 0);
      }
      return exists(id);
    } catch (e) {
      return false;
    }
  };

  // -> { name, data }[] for the ZIP, and what is in it
  async function collectAll() {
    const entries = [];
    const slots = [];
    for (const id of [...slotIds(), "config", "global"]) {
      if (!has(id)) continue;
      try {
        const file = typeof id === "string" ? id + EXT : fileName(id);
        entries.push({ name: "save/" + file, data: await saveBytes(id) });
        if (typeof id === "number") slots.push(id);
      } catch (e) {
        console.warn("[RWK] could not read", id, e);
      }
    }
    const info = {
      exportedAt: new Date().toISOString(),
      engine: RWK.engine,
      gameTitle: (window.$dataSystem && $dataSystem.gameTitle) || document.title || "",
      gameId: RWK.config.gameId,
      saveExtension: EXT,
      slots,
      files: entries.map((e) => e.name),
      cloudSync: !!RWK.saveSync,
      deviceId: RWK.deviceId || null,
      page: location.origin + location.pathname,
      userAgent: navigator.userAgent,
      note: "Copy the save/ folder next to the desktop game, or import single files from ⚙ → Saves.",
    };
    entries.push({ name: "rwk-environment.json", data: new TextEncoder().encode(JSON.stringify(info, null, 2)) });
    return { entries, slots };
  }

  async function exportAll() {
    const { entries, slots } = await collectAll();
    if (!slots.length) throw new Error("no saves");
    const stamp = new Date().toISOString().slice(0, 10);
    download(buildZip(entries), "saves-" + stamp + ".zip", "application/zip");
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
    p.textContent = [
      allow.export && `Export saves a slot as fileN${EXT}, the file the desktop game uses, ready for a save editor. Export all downloads the whole save folder as a ZIP.`,
      allow.import && "Import puts an edited file back into a slot and restarts the game.",
      allow.delete && "Delete empties a slot" + (RWK.saveSync ? ", here and in the cloud." : "."),
    ]
      .filter(Boolean)
      .join(" ");
    const list = document.createElement("div");
    list.className = "rwk-saves-list";
    let done = null;
    const close = () => {
      overlay.remove();
      if (done) done();
    };

    const fill = () => {
      list.textContent = "";
      for (const id of slotIds()) list.appendChild(slotRow(id, close, fill));
    };
    fill();

    const actions = document.createElement("div");
    actions.className = "rwk-modal-actions";
    if (allow.export) {
      actions.appendChild(
        button("Export all", () =>
          exportAll().catch((e) => {
            console.error("[RWK] export all failed", e);
            RWK.toast(e && e.message === "no saves" ? "There are no saves to export." : "Could not export the saves.", "error", 4000);
          })
        )
      );
    }
    actions.appendChild(button("Close", close));
    box.append(h, p, list, actions);
    overlay.appendChild(box);
    RWK.shield(overlay);
    done = RWK.panel(overlay, { close });
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
    row.append(label, ...[allow.export && exp, allow.import && imp, allow.delete && del].filter(Boolean));
    return row;
  }

  async function confirmDelete(id, refreshPanel) {
    const ok = await RWK.choose(
      "Delete save",
      `Delete ${slotName(id)}?` +
        (RWK.saveSync ? "\nIt is also removed from the cloud, on every device." : "") +
        (RWK.saveSync && RWK.config.saveHistory
          ? "\n\n⚙ → Older saves can bring it back for " + RWK.config.saveHistory.days + " days."
          : "\n\nThis cannot be undone: export it first to keep a copy."),
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
          { label: "Cancel", value: false, cancel: true },
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

  const actions = ["Export", "import", "delete"].filter((name) => allow[name.toLowerCase()]);
  const last = actions.pop();
  const detail = (actions.length ? actions.join(", ") + " or " + last : last) + " save slots";
  RWK.tools.add({ icon: RWK.icons.save, group: "save", label: "Saves", detail: detail[0].toUpperCase() + detail.slice(1), onSelect: openPanel });

  RWK.saveTools = { open: openPanel, buildZip, crc32 };
})();
