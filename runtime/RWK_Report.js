//=============================================================================
// RWK_Report.js - rpgmaker-web-toolkit
// Required Notice: Copyright 2026 Trương Tuấn Anh (https://github.com/Kokoroou)
// License: PolyForm Noncommercial 1.0.0 with the Game Creators permission,
// https://github.com/Kokoroou/rpgmaker-web-toolkit/blob/main/LICENSE
// Problem report: keeps the latest errors and the audio files that failed to
// load, and lets players copy a report (browser, audio state, errors with the
// plugin they most likely came from) from the ⚙ menu or the engine's error screen.
//=============================================================================
/*:
 * @target MZ MV
 * @plugindesc [rpgmaker-web-toolkit] Problem report and audio diagnostics. Requires RWK_Core.
 * @author rpgmaker-web-toolkit
 */

(() => {
  "use strict";

  const RWK = window.RWK;
  if (!RWK) return;

  const MAX_ERRORS = 10;
  const MAX_BUFFERS = 100;
  const MAX_STACK_LINES = 6;

  //---------------------------------------------------------------------------
  // Errors: uncaught ones, and the ones the engine catches to show its error
  // screen (SceneManager.catchException never reaches window.onerror).
  //---------------------------------------------------------------------------

  const errors = [];
  let toldPlayer = false;

  function record(error, source) {
    // MZ throws ["LoadError", url, retry] for files that fail to load.
    if (Array.isArray(error) && error[0] === "LoadError") error = { name: "LoadError", message: String(error[1]) };
    const name = (error && error.name) || "Error";
    const message = error && error.message !== undefined ? String(error.message) : String(error);
    const last = errors[errors.length - 1];
    // The same error often arrives twice (engine + window handler).
    if (last && last.message === message && Date.now() - last.time < 1000) {
      if (!last.stack && error && error.stack) last.stack = String(error.stack);
      return;
    }
    errors.push({ time: Date.now(), source, name, message, stack: error && error.stack ? String(error.stack) : "" });
    if (errors.length > MAX_ERRORS) errors.shift();
  }

  window.addEventListener("error", (e) => {
    // Failed <img>/<script> loads bubble here with no message; the engine reports those itself.
    if (!e.message && !e.error) return;
    record(e.error || { name: "Error", message: e.message, stack: e.filename ? `at ${e.filename}:${e.lineno}:${e.colno}` : "" }, "window");
    if (!toldPlayer) {
      toldPlayer = true;
      RWK.toast("Something went wrong. ⚙ menu → Report a problem copies the details.", "warn", 6000);
    }
  });
  window.addEventListener("unhandledrejection", (e) => record(e.reason, "promise"));

  const _catchException = SceneManager.catchException;
  SceneManager.catchException = function (e) {
    record(e, "engine");
    return _catchException.apply(this, arguments);
  };

  // Which plugin an error most likely came from: the first plugin file in its stack.
  function guessPlugin(stack) {
    const m = /js\/plugins\/([^/?#:)]+)\.js/.exec(stack || "");
    if (!m) return "";
    const name = decodeURIComponent(m[1]);
    return name.startsWith("RWK_") ? `${name} (rpgmaker-web-toolkit)` : name;
  }

  //---------------------------------------------------------------------------
  // Audio: which format the engine asks for, whether WebAudio is unlocked,
  // and which files failed to load (WebAudio#isError in both engines).
  //---------------------------------------------------------------------------

  // Weak references: on MV a stopped WebAudio keeps its decoded PCM (~15 MB per
  // song), so holding the buffers would keep tens of MB alive on phones.
  // Failed files are remembered by name, noted while the buffer still exists.
  const call = (fn) => {
    try {
      return fn();
    } catch (e) {
      return "?";
    }
  };
  const buffers = [];
  const failedFiles = new Set();
  function noteFailures() {
    for (const { ref, file } of buffers) {
      const buffer = ref.deref();
      if (buffer && call(() => buffer.isError()) === true) failedFiles.add(file);
    }
  }
  const _createBuffer = AudioManager.createBuffer;
  AudioManager.createBuffer = function (folder, name) {
    const buffer = _createBuffer.apply(this, arguments);
    if (buffer) {
      noteFailures();
      buffers.push({ ref: new WeakRef(buffer), file: `audio/${folder}/${name}` });
      if (buffers.length > MAX_BUFFERS) buffers.shift();
      while (failedFiles.size > MAX_BUFFERS) failedFiles.delete(failedFiles.values().next().value);
    }
    return buffer;
  };

  function audioLines() {
    const lines = [];
    lines.push(`  Format: ${call(() => AudioManager.audioFileExt())}`);
    // MV checks the browser; MZ decodes Ogg itself.
    if (typeof WebAudio.canPlayOgg === "function") {
      lines.push(`  Browser plays Ogg: ${call(() => (WebAudio.canPlayOgg() ? "yes" : "no"))}, ` +
        `M4A: ${call(() => (WebAudio.canPlayM4a() ? "yes" : "no"))}`);
    }
    const context = WebAudio._context;
    lines.push(`  WebAudio: ${context ? context.state : "not available"}`);
    noteFailures();
    const failed = [...failedFiles];
    lines.push(`  Failed to load: ${failed.length ? "" : "none"}`);
    for (const file of failed.slice(-10)) lines.push(`    ${file}`);
    return lines;
  }

  //---------------------------------------------------------------------------
  // The report. No email or save data: players paste it in public places.
  //---------------------------------------------------------------------------

  function report() {
    const config = RWK.config;
    const lines = [
      "rpgmaker-web-toolkit problem report",
      `Toolkit: ${config.version || "?"} · Engine: ${RWK.engine} · Game: ${config.gameId || "?"}`,
      `Page: ${location.origin}${location.pathname}`,
      `Browser: ${navigator.userAgent}`,
      `Screen: ${window.innerWidth}x${window.innerHeight} @${window.devicePixelRatio || 1}x`,
      `Time: ${new Date().toISOString()}`,
      "",
      "Audio",
      ...audioLines(),
      "",
      `Errors (${errors.length ? "latest last" : "none"})`,
    ];
    for (const e of errors) {
      lines.push(`  [${new Date(e.time).toISOString().slice(11, 19)}] ${e.name}: ${e.message} (${e.source})`);
      const plugin = guessPlugin(e.stack);
      if (plugin) lines.push(`    Plugin: ${plugin}`);
      const stack = e.stack.split("\n").map((l) => l.trim()).filter((l) => l.startsWith("at ") || l.includes("@"));
      for (const l of stack.slice(0, MAX_STACK_LINES)) lines.push(`    ${l}`);
    }
    return lines.join("\n");
  }

  async function copy(text, textarea) {
    try {
      await navigator.clipboard.writeText(text);
      RWK.toast("Report copied.");
    } catch (e) {
      // No clipboard access (an old browser or an insecure page): select it for a manual copy.
      textarea.focus();
      textarea.select();
      RWK.toast("Select all and copy the text.", "warn");
    }
  }

  const reportStyle = document.createElement("style");
  reportStyle.textContent = `
.rwk-report{width:100%;height:min(45vh,320px);box-sizing:border-box;margin:0 0 14px;padding:8px;
  border-radius:8px;border:1px solid #444;background:#111;color:#ddd;font:11px/1.4 ui-monospace,monospace;resize:none}
.rwk-error-copy{margin-top:10px;font:13px system-ui,sans-serif;padding:6px 12px;border-radius:8px;
  border:1px solid #888;background:#2c2c33;color:#eee;cursor:pointer}
`;
  document.head.appendChild(reportStyle);

  function openReport() {
    const text = report();
    const overlay = document.createElement("div");
    overlay.className = "rwk-modal";
    const box = document.createElement("div");
    box.className = "rwk-modal-box";
    const h = document.createElement("h2");
    h.textContent = "Report a problem";
    const p = document.createElement("p");
    p.textContent = "Copy this and send it with what you were doing. It has no email or save data.";
    const textarea = document.createElement("textarea");
    textarea.className = "rwk-report";
    textarea.readOnly = true;
    textarea.value = text;
    const actions = document.createElement("div");
    actions.className = "rwk-modal-actions";
    const copyBtn = document.createElement("button");
    copyBtn.className = "primary";
    copyBtn.textContent = "Copy report";
    copyBtn.addEventListener("click", () => copy(text, textarea));
    const closeBtn = document.createElement("button");
    closeBtn.textContent = "Close";
    closeBtn.addEventListener("click", () => overlay.remove());
    actions.append(closeBtn, copyBtn);
    box.append(h, p, textarea, actions);
    overlay.appendChild(box);
    overlay.addEventListener("click", (e) => e.target === overlay && overlay.remove());
    RWK.shield(overlay);
    document.body.appendChild(overlay);
  }

  // The engine's error screen gets a copy button next to RWK_Core's note.
  const _printError = Graphics.printError;
  Graphics.printError = function () {
    _printError.apply(this, arguments);
    const printer = this._errorPrinter;
    if (!printer || printer.querySelector(".rwk-error-copy")) return;
    const btn = document.createElement("button");
    btn.className = "rwk-error-copy";
    btn.textContent = "Report a problem";
    btn.addEventListener("click", openReport);
    RWK.shield(btn);
    printer.appendChild(btn);
  };

  RWK.tools.add({
    icon: RWK.icons.bug,
    group: "help",
    label: "Report a problem",
    detail: () => (errors.length ? `${errors.length} error(s) so far` : "Copy details for a bug report"),
    onSelect: openReport,
  });

  RWK.report = { text: report, open: openReport };
})();
