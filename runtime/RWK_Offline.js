//=============================================================================
// RWK_Offline.js - rpgmaker-web-toolkit
// Required Notice: Copyright 2026 Trương Tuấn Anh (https://github.com/Kokoroou)
// License: PolyForm Noncommercial 1.0.0 with the Game Creators permission,
// https://github.com/Kokoroou/rpgmaker-web-toolkit/blob/main/LICENSE
// Generated into the web build by the CLI. Do not add to the original game.
// ⚙ → Play offline: downloads every picture, sound and data file into the
// browser's Cache Storage (the cache rwk-sw.js answers from), so the game
// opens and plays without a connection. Resumable: a file already kept is
// skipped, so a dropped connection or a new deploy only costs what is missing.
//=============================================================================
/*:
 * @target MZ MV
 * @plugindesc [rpgmaker-web-toolkit] Download the game to play offline. Requires RWK_Core.
 * @author rpgmaker-web-toolkit
 */

(() => {
  "use strict";

  const RWK = window.RWK;
  if (!RWK || !RWK.config.offline) return;
  if (!("serviceWorker" in navigator) || !window.caches || !window.isSecureContext) return;

  const FILES_CACHE = "rwk-files"; // CACHE in rwk-sw.js
  const PARALLEL = 3;
  const ATTEMPTS = 3;
  const SW_WAIT_MS = 5000;

  const megabytes = (bytes) => (bytes >= 1e9 ? `${(bytes / 1e9).toFixed(1)} GB` : `${Math.max(bytes > 0 ? 1 : 0, Math.round(bytes / 1e6))} MB`);
  const sizeOf = (version) => Number(String(version).split("-")[0]) || 0;

  // The key rwk-sw.js stores a file under.
  const keyOf = (rel) => location.origin + "/" + rel.split("/").map(encodeURIComponent).join("/");

  //---------------------------------------------------------------------------
  // The list: asked of the Service Worker, which has the build's file list.
  //---------------------------------------------------------------------------

  // -> { files: { rel: version }, shell: [rel] } or null (no worker yet)
  async function askWorker() {
    let registration = null;
    try {
      registration = await Promise.race([navigator.serviceWorker.ready, new Promise((resolve) => setTimeout(resolve, SW_WAIT_MS))]);
    } catch (e) {
      return null;
    }
    const worker = registration && registration.active;
    if (!worker) return null;
    return new Promise((resolve) => {
      const channel = new MessageChannel();
      const timer = setTimeout(() => resolve(null), SW_WAIT_MS);
      channel.port1.onmessage = (event) => {
        clearTimeout(timer);
        resolve(event.data);
      };
      worker.postMessage({ type: "rwk-files" }, [channel.port2]);
    });
  }

  // What the build holds and what this device is missing.
  // -> { files, bytes, missing: [{ rel, key, size }], missingBytes, free } or null
  async function plan() {
    const list = await askWorker();
    if (!list) return null;
    const have = new Set((await (await caches.open(FILES_CACHE)).keys()).map((request) => request.url));
    const items = [
      ...Object.entries(list.files).map(([rel, version]) => ({ rel, key: keyOf(rel), size: sizeOf(version) })),
      ...list.shell.map((rel) => ({ rel, key: keyOf(rel), size: 0 })),
    ];
    const missing = items.filter((item) => !have.has(item.key));
    let free = null;
    try {
      const { quota, usage } = await navigator.storage.estimate();
      if (quota) free = Math.max(0, quota - (usage || 0));
    } catch (e) {
      // no StorageManager
    }
    return {
      files: items.length,
      bytes: items.reduce((sum, item) => sum + item.size, 0),
      missing,
      missingBytes: missing.reduce((sum, item) => sum + item.size, 0),
      free,
    };
  }

  //---------------------------------------------------------------------------
  // The download. run: { total, done, bytes, bytesTotal, failed, reason,
  // signal } -> the same object, finished (reason: null, "paused", "offline",
  // "signin" or "failed").
  //---------------------------------------------------------------------------

  const wait = (ms, signal) =>
    new Promise((resolve) => {
      const timer = setTimeout(resolve, ms);
      signal.addEventListener("abort", () => (clearTimeout(timer), resolve()), { once: true });
    });

  // Stores one file; counts its bytes as they arrive.
  async function fetchOne(cache, item, run) {
    let counted = 0;
    try {
      const res = await fetch(item.key, { signal: run.signal, headers: { "x-rwk-preload": "1" } });
      // Not a login page Access redirected to, nor a partial or failed answer.
      if (res.redirected || res.type !== "basic") throw Object.assign(new Error("Signed out"), { signin: true });
      if (res.status !== 200) throw new Error(`HTTP ${res.status}`);
      let body = res;
      if (typeof TransformStream === "function" && res.body) {
        const meter = new TransformStream({
          transform(chunk, controller) {
            counted += chunk.byteLength;
            run.bytes += chunk.byteLength;
            run.onProgress();
            controller.enqueue(chunk);
          },
        });
        body = new Response(res.body.pipeThrough(meter), { status: 200, headers: res.headers });
      }
      await cache.put(item.key, body);
      if (!counted) run.bytes += item.size;
    } catch (e) {
      run.bytes -= counted; // started again from zero, or not at all
      throw e;
    }
  }

  function newRun(items, signal, onProgress = () => {}) {
    return {
      total: items.length,
      done: 0,
      bytes: 0,
      bytesTotal: items.reduce((sum, item) => sum + item.size, 0),
      failed: [],
      reason: null,
      signal,
      onProgress,
    };
  }

  async function download(items, { signal = new AbortController().signal, onProgress } = {}, run = newRun(items, signal, onProgress)) {
    ({ signal } = run);
    // Browsers delete a site's data under pressure unless it is persistent.
    try {
      if (navigator.storage && navigator.storage.persist) await navigator.storage.persist();
    } catch (e) {
      // not allowed: still downloads
    }
    const cache = await caches.open(FILES_CACHE);
    let next = 0;
    const lane = async () => {
      while (!run.reason) {
        const item = items[next++];
        if (!item) return;
        for (let attempt = 1; ; attempt++) {
          if (signal.aborted) {
            run.reason = run.reason || "paused";
            return;
          }
          try {
            await fetchOne(cache, item, run);
            run.done++;
            run.onProgress();
            break;
          } catch (e) {
            if (signal.aborted) {
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
            await wait(300 * 2 ** attempt, signal);
          }
        }
      }
    };
    await Promise.all(Array.from({ length: PARALLEL }, lane));
    if (!run.reason && run.failed.length) run.reason = "failed";
    return run;
  }

  //---------------------------------------------------------------------------
  // State shown in the menu, kept up to date by scans and by the download.
  //---------------------------------------------------------------------------

  let latest = null; // the last plan()
  let active = null; // the running download: { run, controller }
  let panel = null; // the open panel: { render }

  async function scan() {
    try {
      latest = await plan();
    } catch (e) {
      console.warn("[RWK] Could not read the cache", e);
      latest = null;
    }
    if (panel) panel.render();
    return latest;
  }

  function statusText() {
    if (active) return `Downloading… ${percent(active.run)}%`;
    if (!latest) return "Keep the game on this device to play without a connection";
    if (!latest.missing.length) return `Ready to play offline · ${megabytes(latest.bytes)} on this device`;
    return `${megabytes(latest.missingBytes)} to download`;
  }

  const percent = (run) => (run.bytesTotal ? Math.min(100, Math.floor((run.bytes / run.bytesTotal) * 100)) : Math.floor((run.done / Math.max(1, run.total)) * 100));

  function start() {
    if (active || !latest || !latest.missing.length) return;
    const controller = new AbortController();
    let last = 0;
    const onProgress = () => {
      const now = Date.now();
      if (now - last < 200) return;
      last = now;
      if (panel) panel.render();
    };
    const run = newRun(latest.missing, controller.signal, onProgress);
    active = { controller, run };
    const releaseLock = keepAwake();
    const finish = () => {
      releaseLock();
      active = null;
    };
    download(latest.missing, {}, run).then(
      async (result) => {
        finish();
        await scan();
        outcome(result);
      },
      (e) => {
        finish();
        RWK.toast("Download stopped: " + e.message, "error", 4000);
        scan();
      }
    );
    if (panel) panel.render();
  }

  function outcome(run) {
    if (run.reason === "paused") return;
    if (run.reason === "offline") RWK.toast("Connection lost. Open Play offline to continue where it stopped.", "warn", 5000);
    else if (run.reason === "signin") RWK.toast("You are signed out. Reload the page, sign in, then continue the download.", "warn", 6000);
    else if (run.reason === "failed") RWK.toast(`${run.failed.length} file(s) did not download. Try again.`, "warn", 5000);
    else RWK.toast("Ready to play offline", "info", 3000);
  }

  // Keeps the screen on while files download.
  function keepAwake() {
    let lock = null;
    let released = false;
    const take = async () => {
      try {
        if (!released && navigator.wakeLock && document.visibilityState === "visible") lock = await navigator.wakeLock.request("screen");
      } catch (e) {
        // refused: the download still runs
      }
    };
    const again = () => take();
    document.addEventListener("visibilitychange", again);
    take();
    return () => {
      released = true;
      document.removeEventListener("visibilitychange", again);
      if (lock) lock.release().catch(() => {});
    };
  }

  //---------------------------------------------------------------------------
  // Install as an app. Chrome offers it through an event; iPhone and iPad
  // only through Share → Add to Home Screen, which is also what stops Safari
  // from deleting a site's files after a week without a visit.
  //---------------------------------------------------------------------------

  let installPrompt = null;
  window.addEventListener("beforeinstallprompt", (event) => {
    event.preventDefault();
    installPrompt = event;
  });
  window.addEventListener("appinstalled", () => {
    installPrompt = null;
    if (panel) panel.render();
  });

  const isStandalone = () => {
    try {
      return !!navigator.standalone || ["standalone", "fullscreen"].some((mode) => matchMedia(`(display-mode: ${mode})`).matches);
    } catch (e) {
      return false;
    }
  };
  const isApple = () => /iPhone|iPad|iPod/.test(navigator.userAgent || "") || (navigator.platform === "MacIntel" && navigator.maxTouchPoints > 1);

  //---------------------------------------------------------------------------
  // The panel.
  //---------------------------------------------------------------------------

  const STYLE = `
.rwk-off-bar{height:10px;border-radius:5px;background:#33333b;overflow:hidden;margin:0 0 8px}
.rwk-off-bar i{display:block;height:100%;width:0;background:#3b6fd8;transition:width .2s}
.rwk-off-note{margin:0 0 14px;font-size:13px;opacity:.75;white-space:pre-line}
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
    const title = el("h2", { textContent: "Play offline" });
    const message = el("p");
    const bar = el("div", { className: "rwk-off-bar" }, [el("i")]);
    const note = el("p", { className: "rwk-off-note" });
    const actions = el("div", { className: "rwk-modal-actions" });
    const overlay = el("div", { className: "rwk-modal" }, [el("div", { className: "rwk-modal-box" }, [title, message, bar, note, actions])]);
    const button = (label, onClick, primary) => {
      const b = el("button", { textContent: label, className: primary ? "primary" : "" });
      b.addEventListener("click", onClick);
      return b;
    };
    const close = () => {
      overlay.remove();
      style.remove();
      panel = null;
    };

    const render = () => {
      actions.textContent = "";
      const bits = [];
      let running = "";
      bar.hidden = true;
      const p = latest;
      if (active) {
        const run = active.run;
        bar.hidden = false;
        bar.firstChild.style.width = percent(run) + "%";
        message.textContent = `Downloading ${megabytes(run.bytes)} of ${megabytes(run.bytesTotal)} · ${run.done} of ${run.total} files`;
        running = "You can close this and keep playing: the download goes on. Keep this page open until it finishes.";
        actions.append(
          button("Close", close),
          button("Pause", () => active && active.controller.abort(), true)
        );
      } else if (!p) {
        message.textContent = "Checking what this device already has…";
        actions.append(button("Close", close));
      } else if (!p.missing.length) {
        message.textContent = `Everything is on this device (${p.files} files, ${megabytes(p.bytes)}). The game opens and plays without a connection. Saves made offline upload when you are back online.`;
        actions.append(button("Close", close));
      } else {
        const have = p.files - p.missing.length;
        message.textContent = have
          ? `${megabytes(p.missingBytes)} left to download (${p.missing.length} of ${p.files} files).`
          : `Download the game to this device: ${p.files} files, ${megabytes(p.bytes)}. Then it opens and plays without a connection.`;
        if (p.free !== null) bits.push(`${megabytes(p.free)} free on this device`);
        const tooBig = p.free !== null && p.missingBytes > p.free * 0.95;
        if (tooBig) bits.push("Not enough space: free some, or clear other sites' data");
        else bits.push("Wi-Fi is best: this is a big download");
        actions.append(button("Close", close), button(have ? "Continue" : `Download ${megabytes(p.missingBytes)}`, start, true));
        if (tooBig) actions.lastChild.disabled = true;
      }
      if (!active && p && installPrompt && !isStandalone()) {
        actions.insertBefore(
          button("Install app", async () => {
            const prompt = installPrompt;
            installPrompt = null;
            render();
            try {
              await prompt.prompt();
            } catch (e) {
              // dismissed
            }
          }),
          actions.firstChild
        );
      }
      if (isApple() && !isStandalone()) bits.push("On iPhone and iPad: tap Share, then Add to Home Screen. Safari deletes a website's files after a week without a visit, but not an app's.");
      note.textContent = [running, ...bits].filter(Boolean).join("\n");
    };

    overlay.addEventListener("click", (e) => e.target === overlay && close());
    RWK.shield(overlay);
    document.body.appendChild(overlay);
    panel = { render };
    render();
    if (!active) scan();
  }

  RWK.offline = { plan, download, scan, keyOf };

  RWK.tools.add({
    icon: RWK.icons.download,
    group: "offline",
    label: "Play offline",
    detail: statusText,
    onSelect: openPanel,
  });

  // The state for the menu, once the Service Worker is up.
  window.addEventListener("load", () => setTimeout(scan, 3000));
})();
