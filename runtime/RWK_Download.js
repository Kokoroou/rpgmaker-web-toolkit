//=============================================================================
// RWK_Download.js - rpgmaker-web-toolkit
// Required Notice: Copyright 2026 Trương Tuấn Anh (https://github.com/Kokoroou)
// License: PolyForm Noncommercial 1.0.0 with the Game Creators permission,
// https://github.com/Kokoroou/rpgmaker-web-toolkit/blob/main/LICENSE
// ⚙ → Share → Download game: the game's host/admin saves the full web build to
// this PC, to play or debug it locally. Only the owner's emails see these
// entries.
//   - (folder): writes every file into a folder the user picks, through the
//     File System Access API. Chromium only (Chrome, Edge, Brave); nothing
//     else has showDirectoryPicker, and that is on purpose: this is a tool for
//     a desktop, not a player feature.
//   - (ZIP): the archive the deploy made and keeps in R2, shown only when the
//     config asks for one ("download": { "zip": true }).
//=============================================================================
/*:
 * @target MZ MV
 * @plugindesc [rpgmaker-web-toolkit] Save the game build to a folder (Chromium) or a ZIP, for the host. Requires RWK_Core.
 * @author rpgmaker-web-toolkit
 */

(() => {
  "use strict";

  const RWK = window.RWK;
  if (!RWK || !RWK.tools) return;

  const PARALLEL = 4; // more lanes make Chrome and the disk contend, fewer are slow
  const ATTEMPTS = 3;
  const PROGRESS_MS = 200;

  const megabytes = (bytes) => (bytes >= 1e9 ? `${(bytes / 1e9).toFixed(1)} GB` : `${Math.max(bytes > 0 ? 1 : 0, Math.round(bytes / 1e6))} MB`);

  // The path of a build file, encoded as the site serves it (same as RWK_Offline).
  const keyOf = (rel) => location.origin + "/" + pathSegments(rel).map(encodeURIComponent).join("/");

  // A build path as its parts, or none for one that could leave the folder (a
  // backslash is how Windows spells a separator, never part of a build path).
  function pathSegments(rel) {
    const text = String(rel || "");
    if (text.includes("\\")) return [];
    return text.split("/").filter((part) => part && part !== "." && part !== "..");
  }

  // What is left to write: a file already in the folder with the same size is
  // skipped, so a second try after a dropped connection continues.
  // existing: Map<rel, size> of what the folder holds (or a plain object).
  function folderPlan(files, existing = new Map()) {
    // A Map (what existingSizes() builds) or a plain object, whichever came in.
    const isMap = !!existing && typeof existing.get === "function" && typeof existing.has === "function";
    const sizeOf = (rel) => (isMap ? existing.get(rel) : existing[rel]);
    const has = (rel) => (isMap ? existing.has(rel) : !!existing && Object.hasOwn(existing, rel));
    const todo = [];
    let bytes = 0;
    let skipped = 0;
    let totalBytes = 0;
    for (const file of files) {
      const size = Number(file.size) || 0;
      totalBytes += size;
      if (has(file.rel) && Number(sizeOf(file.rel)) === size) {
        skipped++;
        continue;
      }
      todo.push(file);
      bytes += size;
    }
    return { todo, skipped, bytes, totalBytes };
  }

  //---------------------------------------------------------------------------
  // The folder the user picked: paths resolved once, then reused.
  //---------------------------------------------------------------------------

  const wait = (ms, signal) =>
    new Promise((resolve) => {
      const timer = setTimeout(resolve, ms);
      signal.addEventListener("abort", () => (clearTimeout(timer), resolve()), { once: true });
    });

  // create: false only looks a folder up, so checking a folder the user picked
  // never leaves empty folders behind if they cancel.
  function dirCacheFor(root) {
    const dirs = new Map(); // "<create>:img/pictures" -> Promise<handle>
    const dirFor = (rel, create = true) => {
      const parts = pathSegments(rel).slice(0, -1);
      const key = `${create ? 1 : 0}:${parts.join("/")}`;
      if (!dirs.has(key)) {
        dirs.set(
          key,
          (async () => {
            let dir = root;
            for (const part of parts) dir = await dir.getDirectoryHandle(part, create ? { create: true } : {});
            return dir;
          })()
        );
      }
      return dirs.get(key);
    };
    return { dirFor };
  }

  // The files of `list` already in the folder, with their sizes: a file handle
  // that does not exist throws NotFoundError, which is simply "not there".
  async function existingSizes(dirFor, files) {
    const found = new Map();
    for (const file of files) {
      const parts = pathSegments(file.rel);
      if (!parts.length) continue;
      try {
        const dir = await dirFor(file.rel, false);
        const handle = await dir.getFileHandle(parts[parts.length - 1]); // without create
        found.set(file.rel, (await handle.getFile()).size);
      } catch (e) {
        // absent, or a directory where the file should be
      }
    }
    return found;
  }

  //---------------------------------------------------------------------------
  // The download: run: { total, done, bytes, bytesTotal, skipped, failed,
  // reason, signal, onProgress } -> the same object, finished (reason: null,
  // "paused", "offline", "signin" or "failed").
  //---------------------------------------------------------------------------

  async function writeOne(dirFor, item, run) {
    const parts = pathSegments(item.rel);
    if (!parts.length) throw new Error("bad path");
    let counted = 0;
    const dir = await dirFor(item.rel);
    const handle = await dir.getFileHandle(parts[parts.length - 1], { create: true });
    let writable = null;
    try {
      const res = await fetch(keyOf(item.rel), { signal: run.signal });
      // Not a login page Access redirected to, nor a partial or failed answer.
      if (res.redirected || res.type !== "basic") throw Object.assign(new Error("Signed out"), { signin: true });
      if (res.status !== 200) throw new Error(`HTTP ${res.status}`);
      writable = await handle.createWritable();
      let body = res.body;
      if (body && typeof TransformStream === "function") {
        const meter = new TransformStream({
          transform(chunk, controller) {
            counted += chunk.byteLength;
            run.bytes += chunk.byteLength;
            run.onProgress();
            controller.enqueue(chunk);
          },
        });
        body = body.pipeThrough(meter);
      }
      if (body) {
        await body.pipeTo(writable); // closes it
        writable = null;
      } else {
        await writable.write(await res.blob());
        await writable.close();
        writable = null;
      }
      if (!counted) run.bytes += Number(item.size) || 0;
    } catch (e) {
      run.bytes -= counted; // started again from zero, or not at all
      if (writable) await writable.abort().catch(() => {});
      throw e;
    }
  }

  function newRun(items, signal, skipped, onProgress = () => {}) {
    return {
      total: items.length,
      done: 0,
      bytes: 0,
      bytesTotal: items.reduce((sum, item) => sum + (Number(item.size) || 0), 0),
      skipped,
      failed: [],
      reason: null,
      signal,
      onProgress,
    };
  }

  async function download(dirFor, items, run) {
    let next = 0;
    const lane = async () => {
      while (!run.reason) {
        const item = items[next++];
        if (!item) return;
        for (let attempt = 1; ; attempt++) {
          if (run.signal.aborted) {
            run.reason = run.reason || "paused";
            return;
          }
          try {
            await writeOne(dirFor, item, run);
            run.done++;
            run.onProgress();
            break;
          } catch (e) {
            if (run.signal.aborted) {
              run.reason = run.reason || "paused";
              return;
            }
            if (e.signin) {
              run.reason = "signin";
              return;
            }
            if (navigator.onLine === false) {
              run.reason = "offline";
              return;
            }
            if (attempt >= ATTEMPTS) {
              run.failed.push(item.rel);
              break;
            }
            await wait(300 * 2 ** attempt, run.signal);
          }
        }
      }
    };
    await Promise.all(Array.from({ length: PARALLEL }, lane));
    if (!run.reason && run.failed.length) run.reason = "failed";
    return run;
  }

  //---------------------------------------------------------------------------
  // State shown in the menu and the panel, kept up to date by the download.
  //---------------------------------------------------------------------------

  let active = null; // the running download: { run, controller, dirFor }
  let latest = null; // the last finished run, for the panel
  let panel = null; // the open panel: { render }

  const percent = (run) => (run.bytesTotal ? Math.min(100, Math.floor((run.bytes / run.bytesTotal) * 100)) : Math.floor((run.done / Math.max(1, run.total)) * 100));

  function statusText() {
    if (active) return `Saving… ${percent(active.run)}%`;
    if (latest && latest.reason === null) return `Saved · ${latest.done} files, ${megabytes(latest.bytes)}`;
    return "Save the game to a folder on this PC (Chrome, Edge)";
  }

  function outcome(run) {
    if (run.reason === "paused") RWK.toast("Download stopped. Start it again to continue: files already written are skipped.", "info", 6000);
    else if (run.reason === "offline") RWK.toast("Connection lost. Start the download again to continue where it stopped.", "warn", 6000);
    else if (run.reason === "signin") RWK.toast("You are signed out. Reload the page, sign in, then start again.", "warn", 6000);
    else if (run.reason === "failed") RWK.toast(`${run.failed.length} file(s) did not download. Start again to retry them.`, "warn", 6000);
    else RWK.toast(`Game saved to the folder: ${run.done} file(s), ${megabytes(run.bytes)}.`, "info", 5000);
  }

  // Reads the build's file list and the folder, asks, then writes. The folder
  // picker is called before this, still inside the click.
  async function start(root) {
    let list = null;
    try {
      const res = await fetch("/api/download/list", { credentials: "same-origin" });
      if (!res.ok) {
        RWK.toast(res.status === 403 ? "Only the game's owner can download it." : "Could not read the file list. Try again.", "error", 5000);
        return;
      }
      list = await res.json();
    } catch (e) {
      RWK.toast("Could not read the file list. Check the connection.", "error", 5000);
      return;
    }
    const files = list && Array.isArray(list.files) ? list.files.filter((f) => pathSegments(f.rel).length) : [];
    if (!files.length) {
      RWK.toast("This build has no file list yet: run rwk deploy again, then reload the page.", "warn", 7000);
      return;
    }

    RWK.toast("Checking the folder…", "info", 2000);
    const { dirFor } = dirCacheFor(root);
    let plan;
    try {
      plan = folderPlan(files, await existingSizes(dirFor, files));
    } catch (e) {
      RWK.toast("Could not read the folder: " + (e.message || e), "error", 5000);
      return;
    }
    if (!plan.todo.length) {
      RWK.toast("Everything is already in that folder.", "info", 4000);
      return;
    }

    const lines = [`Save ${plan.todo.length} file(s), ${megabytes(plan.bytes)}, into the folder you chose?`];
    if (plan.skipped) lines.push(`${plan.skipped} file(s) are already there and are skipped.`);
    lines.push("Keep this page open while it runs. You can stop it and start again later: files already written are skipped.");
    const ok = await RWK.choose("Download game (folder)", lines.join("\n"), [
      { label: "Download", value: true, primary: true },
      { label: "Cancel", value: false, cancel: true },
    ]);
    if (!ok) return;

    const controller = new AbortController();
    let last = 0;
    const onProgress = () => {
      const now = Date.now();
      if (now - last < PROGRESS_MS) return;
      last = now;
      if (panel) panel.render();
    };
    const run = newRun(plan.todo, controller.signal, plan.skipped, onProgress);
    active = { controller, run, dirFor };
    openPanel();
    download(dirFor, plan.todo, run).then(
      (result) => {
        active = null;
        latest = result;
        if (panel) panel.render();
        outcome(result);
      },
      (e) => {
        active = null;
        RWK.toast("Download stopped: " + (e.message || e), "error", 5000);
        if (panel) panel.render();
      }
    );
  }

  // Called by the menu entry. showDirectoryPicker must run before any await,
  // or Chrome refuses it: the click's permission is gone.
  function downloadFolder() {
    if (active) {
      openPanel();
      return;
    }
    if (!navigator.onLine) {
      RWK.toast("Downloading needs an internet connection.", "warn", 3000);
      return;
    }
    let picked;
    try {
      picked = window.showDirectoryPicker({ mode: "readwrite", id: "rwk-game" });
    } catch (e) {
      RWK.toast("This browser cannot save to a folder.", "warn", 4000);
      return;
    }
    picked
      .then((root) => start(root))
      .catch((e) => {
        if (e && e.name === "AbortError") return; // the picker was closed
        RWK.toast("Could not open the folder: " + (e.message || e), "error", 5000);
      });
  }

  //---------------------------------------------------------------------------
  // The panel.
  //---------------------------------------------------------------------------

  const STYLE = `
.rwk-dl-bar{height:10px;border-radius:5px;background:#33333b;overflow:hidden;margin:0 0 8px}
.rwk-dl-bar i{display:block;height:100%;width:0;background:#3b6fd8;transition:width .2s}
.rwk-dl-note{margin:0 0 14px;font-size:13px;opacity:.75;white-space:pre-line}
`;

  function el(tag, props, children = []) {
    const node = document.createElement(tag);
    Object.assign(node, props);
    for (const child of children) node.appendChild(child);
    return node;
  }

  function openPanel() {
    if (panel) return;
    const style = el("style", { textContent: STYLE });
    document.head.appendChild(style);
    const title = el("h2", { textContent: "Download game (folder)" });
    const message = el("p");
    const bar = el("div", { className: "rwk-dl-bar" }, [el("i")]);
    const note = el("p", { className: "rwk-dl-note" });
    const actions = el("div", { className: "rwk-modal-actions" });
    const overlay = el("div", { className: "rwk-modal" }, [el("div", { className: "rwk-modal-box" }, [title, message, bar, note, actions])]);
    const button = (label, onClick, primary) => {
      const b = el("button", { textContent: label, className: primary ? "primary" : "" });
      b.addEventListener("click", onClick);
      return b;
    };
    let done = null;
    const close = () => {
      overlay.remove();
      style.remove();
      panel = null;
      if (done) done();
    };

    const render = () => {
      actions.textContent = "";
      bar.hidden = true;
      const run = active ? active.run : latest;
      if (active) {
        bar.hidden = false;
        bar.firstChild.style.width = percent(active.run) + "%";
        message.textContent = `Saving ${megabytes(active.run.bytes)} of ${megabytes(active.run.bytesTotal)} · ${active.run.done} of ${active.run.total} files`;
        note.textContent = active.run.skipped ? `${active.run.skipped} file(s) were already in the folder and were skipped.` : "";
        actions.append(button("Close", close), button("Cancel", () => active && active.controller.abort(), true));
      } else if (run && run.reason === null) {
        message.textContent = `Saved ${run.done} file(s), ${megabytes(run.bytes)}, to the folder. The game folder holds the same build the site serves.`;
        note.textContent = "";
        actions.append(button("Close", close));
      } else if (run) {
        message.textContent = `${run.done} of ${run.total} file(s) were written before the download stopped.`;
        note.textContent = "Start it again from ⚙ → Share → Download game (folder): files already written are skipped, so only the rest is fetched.";
        actions.append(button("Close", close));
      } else {
        message.textContent = "No download has run in this page yet.";
        actions.append(button("Close", close));
      }
    };

    RWK.shield(overlay);
    panel = { render };
    render(); // fills the buttons before the frame puts the focus on one
    done = RWK.panel(overlay, { close });
  }

  // The pure parts, for the tests (no DOM, no File System Access API).
  RWK.download = { folderPlan, pathSegments, keyOf };

  //---------------------------------------------------------------------------
  // The menu entries. /api/download?check=1 answers 403 to everyone but the
  // owner, and says whether there is a ZIP and a file list to work with.
  //---------------------------------------------------------------------------

  fetch("/api/download?check=1", { credentials: "same-origin" })
    .then(async (res) => {
      if (!res.ok) return;
      const data = await res.json().catch(() => null);
      if (!data || !data.owner) return;
      // The folder: Chromium only, and only when the deploy wrote the list.
      if (data.folder && "showDirectoryPicker" in window) {
        RWK.tools.add({
          icon: RWK.icons.folderOpen,
          group: "share",
          label: "Download game (folder)",
          detail: statusText,
          onSelect: downloadFolder,
        });
      }
      // The ZIP: only when the deploy made one (the config asked for it).
      if (data.ready) {
        RWK.tools.add({
          icon: RWK.icons.download,
          group: "share",
          label: "Download game (ZIP)",
          detail: "Download the complete game build as a ZIP file (Host only)",
          onSelect: downloadZIP,
        });
      }
    })
    .catch(() => {});

  async function downloadZIP() {
    if (!navigator.onLine) {
      RWK.toast("Downloading needs an internet connection.", "warn", 3000);
      return;
    }
    const ok = await RWK.choose(
      "Download game (ZIP)",
      "Download the complete game build of this game as a ZIP archive? This includes all game data, media, and scripts.",
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
})();
