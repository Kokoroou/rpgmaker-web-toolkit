//=============================================================================
// RWK_Lens.js - rpgmaker-web-toolkit
// Required Notice: Copyright 2026 Trương Tuấn Anh (https://github.com/Kokoroou)
// License: PolyForm Noncommercial 1.0.0 with the Game Creators permission,
// https://github.com/Kokoroou/rpgmaker-web-toolkit/blob/main/LICENSE
// ⚙ → Share → MakerLens link: the game's owner makes a read-only link that
// opens this game's pictures, audio and events in MakerLens without making
// the game public. One link for both tools: it opens Assets, which has a
// button to switch to Events (and back) with the same link. The Worker keeps the links
// (worker/lens.js); only the owner's emails see this entry.
//=============================================================================
/*:
 * @target MZ MV
 * @plugindesc [rpgmaker-web-toolkit] Read-only MakerLens links, made by the owner. Requires RWK_Core.
 * @author rpgmaker-web-toolkit
 */

(() => {
  "use strict";

  const RWK = window.RWK;
  if (!RWK || !RWK.tools) return;

  const MAKERLENS = "https://makerlens.kokoroou.workers.dev";
  const DURATIONS = [
    { hours: 1, label: "1 hour" },
    { hours: 24, label: "1 day" },
    { hours: 72, label: "3 days" },
    { hours: 168, label: "7 days" },
    { hours: 720, label: "30 days" },
  ];

  const api = async (path, init) => {
    const res = await fetch("/api/lens" + path, { credentials: "same-origin", ...init });
    let body = null;
    try {
      body = res.status === 204 ? null : await res.json();
    } catch {
      body = null;
    }
    return { ok: res.ok, status: res.status, body };
  };

  // The one link MakerLens opens: the token stays after the "#", which no server receives.
  const linkFor = (token) => MAKERLENS + "/assets/#game=" + encodeURIComponent(location.origin) + "&t=" + encodeURIComponent(token);

  const when = (sec) => new Date(sec * 1000).toLocaleString([], { dateStyle: "medium", timeStyle: "short" });

  // Without the Access bypass for /_lens the sign-in page answers instead of the Worker.
  // No cookies and no redirect following, as MakerLens will do.
  async function reachable(token) {
    try {
      const res = await fetch("/_lens/ping", { headers: { authorization: "Bearer " + token }, credentials: "omit", redirect: "manual" });
      return res.ok;
    } catch {
      return false;
    }
  }

  const style = document.createElement("style");
  style.textContent = `
.rwk-lens{max-width:560px}
.rwk-lens p{margin:0 0 10px;opacity:.85}
.rwk-lens-form{display:flex;flex-wrap:wrap;gap:8px;margin:0 0 12px}
.rwk-lens-form input,.rwk-lens-form select{font:inherit;font-size:14px;min-height:40px;box-sizing:border-box;padding:6px 10px;border-radius:8px;
  border:1px solid #555;background:#1f1f25;color:#eee}
.rwk-lens-form input{flex:1;min-width:140px}
.rwk-lens button{font:inherit;font-size:13px;min-height:36px;padding:6px 12px;border-radius:8px;border:1px solid #555;background:#2c2c33;color:#eee;cursor:pointer}
.rwk-lens button.rwk-primary{background:#2d8a55;border-color:#2d8a55;color:#fff}
.rwk-lens-new{margin:0 0 12px;padding:10px;border:1px solid #2d8a55;border-radius:10px}
.rwk-lens-new[hidden]{display:none}
.rwk-lens-row{display:flex;align-items:center;gap:8px;margin:6px 0}
.rwk-lens-row input{flex:1;min-width:0;font:12px monospace;padding:6px 8px;border-radius:6px;border:1px solid #555;background:#1f1f25;color:#eee}
.rwk-lens-warn{color:#f0b429}
.rwk-lens-list{max-height:min(35vh,260px);overflow:auto;border-top:1px solid #333}
.rwk-lens-item{display:flex;align-items:center;gap:8px;padding:8px 0;border-bottom:1px solid #333}
.rwk-lens-item div{flex:1;min-width:0}
.rwk-lens-item small{display:block;opacity:.65;font-size:12px}
`;
  document.head.appendChild(style);

  function el(tag, props, ...kids) {
    const node = document.createElement(tag);
    Object.assign(node, props || {});
    node.append(...kids);
    return node;
  }

  function openPanel() {
    if (document.querySelector(".rwk-lens")) return;
    if (!navigator.onLine) {
      RWK.toast("Links are made in the cloud: connect to the internet first.", "warn", 3000);
      return;
    }
    const overlay = el("div", { className: "rwk-modal" });
    const box = el("div", { className: "rwk-modal-box rwk-lens" });
    let done = null;
    const close = () => {
      overlay.remove();
      if (done) done();
    };

    const intro = el("p", {
      textContent:
        "Make one read-only link that opens this game's pictures, audio and events in MakerLens (Assets and Events, switch between them there). The game stays private: " +
        "the link is a key that lets MakerLens read the game's files until it expires. It never opens the saves. " +
        "Anyone you give it to can look at the game's files, so share it only with people you trust.",
    });

    const note = el("input", { type: "text", placeholder: "Note: who is it for? (optional)", maxLength: 60 });
    const duration = el("select", { ariaLabel: "How long the link works" });
    for (const d of DURATIONS) duration.append(el("option", { value: String(d.hours), textContent: d.label, selected: d.hours === 24 }));
    const make = el("button", { className: "rwk-primary", textContent: "Make link" });
    const form = el("div", { className: "rwk-lens-form" }, note, duration, make);

    const fresh = el("div", { className: "rwk-lens-new" });
    fresh.hidden = true;
    const list = el("div", { className: "rwk-lens-list" }, el("p", { textContent: "Loading…" }));

    const closeBtn = el("button", { textContent: "Close" });
    closeBtn.addEventListener("click", close);
    const actions = el("div", { className: "rwk-modal-actions" }, closeBtn);
    box.append(el("h2", { textContent: "MakerLens link" }), intro, form, fresh, list, actions);
    overlay.appendChild(box);
    RWK.shield(overlay);
    done = RWK.panel(overlay, { close });
    // The note comes first, and Enter in it makes the link.
    note.addEventListener("keydown", (e) => {
      if (e.key === "Enter" && !make.disabled) make.click();
    });

    async function refresh() {
      const res = await api("");
      list.textContent = "";
      if (!res.ok) {
        list.append(el("p", { textContent: "Could not load the links. Reload the page if your login expired." }));
        return;
      }
      if (!res.body.links.length) {
        list.append(el("p", { textContent: "No active links." }));
        return;
      }
      for (const link of res.body.links) {
        const stop = el("button", { textContent: "Stop" });
        stop.addEventListener("click", async () => {
          stop.disabled = true;
          const r = await api("/" + link.id, { method: "DELETE" });
          if (!r.ok) RWK.toast("Could not stop the link.", "error", 3000);
          refresh();
        });
        const text = el("div", { textContent: link.label || "No note" }, el("small", { textContent: "Works until " + when(link.exp) }));
        list.append(el("div", { className: "rwk-lens-item" }, text, stop));
      }
    }

    function show(token) {
      const url = linkFor(token);
      fresh.textContent = "";
      fresh.append(el("p", { textContent: "Link made. Copy it now: the key is not shown again." }));
      const field = el("input", { type: "text", readOnly: true, value: url });
      field.addEventListener("focus", () => field.select());
      const copy = el("button", { textContent: "Copy" });
      copy.addEventListener("click", async () => {
        try {
          await navigator.clipboard.writeText(url);
          RWK.toast("Link copied.", "info", 1800);
        } catch {
          field.focus();
          RWK.toast("Press Ctrl+C to copy.", "info", 2500);
        }
      });
      fresh.append(el("div", { className: "rwk-lens-row" }, field, copy));
      fresh.hidden = false;
    }

    make.addEventListener("click", async () => {
      make.disabled = true;
      try {
        const res = await api("", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ hours: Number(duration.value), label: note.value }),
        });
        if (!res.ok) {
          RWK.toast((res.body && res.body.error) || "Could not make the link.", "error", 4000);
          return;
        }
        note.value = "";
        show(res.body.token);
        if (!(await reachable(res.body.token))) {
          fresh.append(
            el("p", {
              className: "rwk-lens-warn",
              textContent:
                "MakerLens may not be able to open this link yet: the sign-in still answers for /_lens. " +
                "Run rwk deploy once more on your PC (it adds the bypass), then try the link.",
            })
          );
        }
        refresh();
      } catch (e) {
        console.error("[RWK] lens failed", e);
        RWK.toast("Could not make the link. Check the connection.", "error", 4000);
      } finally {
        make.disabled = false;
      }
    });

    refresh();
  }

  // Only the owner sees the entry: the Worker answers 403 to everyone else (and to
  // a public game, where nobody can be told apart).
  api("")
    .then((res) => {
      if (!res.ok || !res.body || !res.body.owner) return;
      RWK.tools.add({
        icon: RWK.icons.link,
        group: "share",
        label: "MakerLens link",
        detail: "Let someone look at this game's pictures and events",
        onSelect: openPanel,
      });
    })
    .catch(() => {});
})();
