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

  // Where Workers Assets ends up serving a *.html file: a request for one is
  // redirected to the page without its extension (/credits.html -> /credits),
  // and a page's own index.html to its folder (/dir/index.html -> /dir/, the
  // start page index.html -> /). -> that pathname, or null for any other file.
  function htmlTarget(rel) {
    if (!String(rel).toLowerCase().endsWith(".html")) return null;
    const noExt = rel.slice(0, -".html".length);
    if (noExt === "index") return "/";
    if (noExt.endsWith("/index")) return "/" + noExt.slice(0, -"index".length);
    return "/" + noExt;
  }

  // Whether a fetch was answered with Access's login page instead of the file.
  // Access redirects a signed-out visitor too, so a redirect alone does not
  // say: the answer is Access's unless it landed on the page the .html file
  // above is served as (that redirect is the site's own, and is not a sign-out).
  function signedOut(res, rel) {
    if (res.type !== "basic") return true;
    if (!res.redirected) return false;
    const target = htmlTarget(rel);
    try {
      const url = new URL(res.url);
      return !(target && url.origin === location.origin && trimSlash(url.pathname) === trimSlash(target));
    } catch {
      return true; // no url to check: treat it as no answer
    }
  }

  const trimSlash = (pathname) => (pathname.length > 1 && pathname.endsWith("/") ? pathname.slice(0, -1) : pathname);

  // A build path as its parts, or none for one that could leave the folder (a
  // backslash is how Windows spells a separator, never part of a build path).
  function pathSegments(rel) {
    const text = String(rel || "");
    if (text.includes("\\")) return [];
    return text.split("/").filter((part) => part && part !== "." && part !== "..");
  }

  // A name a filesystem accepts for the new folder: the characters Windows,
  // macOS and Linux refuse (or that would break a path) become a dash, and the
  // leading and trailing dots and spaces (which Windows drops, so the folder a
  // second run looks for would not be the one made) go.
  function folderNameFrom(title) {
    const text = String(title || "")
      .replace(/[\\/:*?"<>|\x00-\x1f]/g, "-")
      .replace(/\s+/g, " ")
      .slice(0, 120)
      .replace(/^[.\s]+|[.\s]+$/g, "");
    return text || "Game web build";
  }

  // The game's own name, for the folder the build is written into: the engine's
  // database title once loaded, else the page's title.
  function gameFolderName() {
    let title = "";
    try {
      if (window.$dataSystem && window.$dataSystem.gameTitle) title = window.$dataSystem.gameTitle;
    } catch (e) {
      // no database yet: the page's title below
    }
    return folderNameFrom(title || (document && document.title) || "");
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
      if (signedOut(res, item.rel)) throw Object.assign(new Error("Signed out"), { signin: true });
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
  // State shown in the menu, the panel and the pill, kept up to date by the
  // download.
  //---------------------------------------------------------------------------

  let active = null; // the running download: { run, controller, dirFor, folder }
  let latest = null; // the last finished run, for the panel
  let latestFolder = ""; // the folder the last finished run wrote into
  let panel = null; // the open panel: { render }
  let pill = null; // the small progress pill shown while the panel is hidden

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
    else RWK.toast(`Game saved to the folder "${latestFolder}": ${run.done} file(s), ${megabytes(run.bytes)}.`, "info", 5000);
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

    // A folder of its own inside the one picked, named after the game, so the
    // build never mixes with whatever else is there. A second run into the same
    // place finds the folder and continues in it.
    const name = gameFolderName();
    let gameDir;
    try {
      gameDir = await root.getDirectoryHandle(name, { create: true });
    } catch (e) {
      RWK.toast(`Could not make the folder "${name}": ` + (e.message || e), "error", 5000);
      return;
    }

    RWK.toast("Checking the folder…", "info", 2000);
    const { dirFor } = dirCacheFor(gameDir);
    let plan;
    try {
      plan = folderPlan(files, await existingSizes(dirFor, files));
    } catch (e) {
      RWK.toast("Could not read the folder: " + (e.message || e), "error", 5000);
      return;
    }
    if (!plan.todo.length) {
      RWK.toast(`Everything is already in "${name}".`, "info", 4000);
      return;
    }

    const lines = [`Save ${plan.todo.length} file(s), ${megabytes(plan.bytes)}, into the folder "${name}"?`];
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
      if (pill) pill.render();
    };
    const run = newRun(plan.todo, controller.signal, plan.skipped, onProgress);
    active = { controller, run, dirFor, folder: name };
    openPanel();
    download(dirFor, plan.todo, run).then(
      (result) => {
        active = null;
        latest = result;
        latestFolder = name;
        if (panel) panel.render();
        if (pill) pill.render();
        outcome(result);
      },
      (e) => {
        active = null;
        RWK.toast("Download stopped: " + (e.message || e), "error", 5000);
        if (panel) panel.render();
        if (pill) pill.render();
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
    if (latest && latest.reason !== null) {
      // A run that stopped (paused, offline, failed): the panel says so.
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
  // The panel and the pill. The panel is the window with the bar; the pill is
  // the small "Saving… 42%" tag it leaves at the top-left when the host hides
  // it, so the download stays in sight with the toolkit out of the way. When
  // the last file arrives the pill holds 100% for a few seconds, then goes.
  //---------------------------------------------------------------------------

  const PILL_HIDE_MS = 5000; // how long the finished pill stays

  const STYLE = `
.rwk-dl-bar{height:10px;border-radius:5px;background:#33333b;overflow:hidden;margin:0 0 8px}
.rwk-dl-bar i{display:block;height:100%;width:0;background:#3b6fd8;transition:width .2s}
.rwk-dl-note{margin:0 0 14px;font-size:13px;opacity:.75;white-space:pre-line}
.rwk-modal-actions button.rwk-dl-danger{background:#b3261e;border-color:#b3261e;color:#fff}
.rwk-dl-pill{position:fixed;left:6px;top:50px;z-index:2147482600;display:flex;align-items:center;gap:8px;
  font:13px/1 system-ui,sans-serif;color:#fff;background:rgba(0,0,0,.72);border:1px solid #444;
  border-radius:999px;padding:7px 13px 7px 10px;cursor:pointer}
.rwk-dl-pill .rwk-dl-spin{flex:none;width:13px;height:13px;border-radius:50%;border:2px solid rgba(255,255,255,.28);
  border-top-color:#fff;animation:rwk-dl-spin .7s linear infinite}
.rwk-dl-pill.done{background:rgba(24,84,40,.9)}
.rwk-dl-pill.done .rwk-dl-spin{display:none}
@keyframes rwk-dl-spin{to{transform:rotate(360deg)}}
`;

  let styleNode = null;
  function ensureStyle() {
    if (styleNode) return;
    styleNode = el("style", { textContent: STYLE });
    document.head.appendChild(styleNode);
  }

  function el(tag, props, children = []) {
    const node = document.createElement(tag);
    Object.assign(node, props);
    for (const child of children) node.appendChild(child);
    return node;
  }

  // The pill: percent while the download runs, a spinner beside it, and a tap
  // that brings the panel back. After the run ends it shows 100% for
  // PILL_HIDE_MS and then removes itself.
  function showPill() {
    if (pill) {
      pill.render();
      return;
    }
    ensureStyle();
    const spin = el("span", { className: "rwk-dl-spin" });
    const pct = el("span", { className: "rwk-dl-pct" });
    const node = el("button", { className: "rwk-dl-pill", type: "button", title: "Download game (folder)" }, [spin, pct]);
    node.setAttribute("data-rwk-ui", "");
    node.setAttribute("aria-live", "polite");
    node.addEventListener("click", () => openPanel());
    RWK.shield(node);
    document.body.appendChild(node);
    let timer = null;
    const render = () => {
      const run = active ? active.run : latest;
      if (active) {
        if (timer) clearTimeout(timer), (timer = null);
        node.classList.remove("done");
        pct.textContent = percent(active.run) + "%";
        return;
      }
      node.classList.add("done");
      pct.textContent = run && run.reason === null ? "100%" : "Stopped";
      if (!timer) timer = setTimeout(hidePill, PILL_HIDE_MS);
    };
    pill = { node, render, stop: () => timer && clearTimeout(timer) };
    render();
  }

  function hidePill() {
    if (!pill) return;
    pill.stop();
    pill.node.remove();
    pill = null;
  }

  function openPanel() {
    if (panel) return;
    hidePill(); // the panel already shows the same progress
    ensureStyle();
    const title = el("h2", { textContent: "Download game (folder)" });
    const message = el("p");
    const bar = el("div", { className: "rwk-dl-bar" }, [el("i")]);
    const note = el("p", { className: "rwk-dl-note" });
    const actions = el("div", { className: "rwk-modal-actions" });
    const overlay = el("div", { className: "rwk-modal" }, [el("div", { className: "rwk-modal-box" }, [title, message, bar, note, actions])]);
    const button = (label, onClick, className = "") => {
      const b = el("button", { textContent: label, className });
      b.addEventListener("click", onClick);
      return b;
    };
    let done = null;
    // Hide, not close: the download keeps running, and the pill shows its
    // progress while the toolkit is out of the way. A run that already finished
    // shows its 100% pill for PILL_HIDE_MS too.
    const hide = () => {
      overlay.remove();
      panel = null;
      if (done) done();
      if (active || latest) showPill();
    };

    const render = () => {
      actions.textContent = "";
      bar.hidden = true;
      const run = active ? active.run : latest;
      if (active) {
        bar.hidden = false;
        bar.firstChild.style.width = percent(active.run) + "%";
        message.textContent = `Saving ${megabytes(active.run.bytes)} of ${megabytes(active.run.bytesTotal)} · ${active.run.done} of ${active.run.total} files into "${active.folder}"`;
        note.textContent = active.run.skipped ? `${active.run.skipped} file(s) were already in the folder and were skipped.` : "";
        actions.append(button("Hide", hide), button("Cancel", () => active && active.controller.abort(), "rwk-dl-danger"));
      } else if (run && run.reason === null) {
        message.textContent = `Saved ${run.done} file(s), ${megabytes(run.bytes)}, to the folder "${latestFolder}". It holds the same build the site serves.`;
        note.textContent = "To play it, serve the folder over http:// rather than opening index.html directly: the game loads its data with XMLHttpRequest, which a file:// page cannot use.";
        actions.append(button("Hide", hide));
      } else if (run) {
        message.textContent = `${run.done} of ${run.total} file(s) were written before the download stopped.`;
        note.textContent = "Start it again from ⚙ → Share → Download game (folder): files already written are skipped, so only the rest is fetched.";
        actions.append(button("Hide", hide));
      } else {
        message.textContent = "No download has run in this page yet.";
        actions.append(button("Hide", hide));
      }
    };

    RWK.shield(overlay);
    panel = { render };
    render(); // fills the buttons before the frame puts the focus on one
    done = RWK.panel(overlay, { close: hide });
  }

  // The pure parts, for the tests (no DOM, no File System Access API).
  RWK.download = { folderPlan, pathSegments, keyOf, signedOut, folderNameFrom };

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
