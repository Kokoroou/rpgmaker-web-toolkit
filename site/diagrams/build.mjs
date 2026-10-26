// Draws the diagrams on the "How it works" page as static SVG, one light and
// one dark file each: site/public/img/<name>-light.svg and <name>-dark.svg.
// Run from the repository root: node site/diagrams/build.mjs
// No dependencies. Edit the diagrams here, run it, and commit the SVGs.
// The page shows the file that matches the VitePress theme (see style.css).
// Keep them in step with worker/, cli/ and runtime/ when the architecture changes.
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const OUT = path.join(path.dirname(fileURLToPath(import.meta.url)), "..", "public", "img");

const THEMES = {
  light: {
    bg: "#ffffff", zone: "#f6f6f7", zoneLine: "#c2c2c4", box: "#ffffff", line: "#8e8e93",
    text: "#1f1f23", sub: "#55555c", accent: "#3451b2", accentBg: "#eef1fb",
    store: "#fff7e6", storeLine: "#b7791f", edge: "#fdecea", edgeLine: "#c0392b",
  },
  dark: {
    bg: "#1b1b1f", zone: "#232327", zoneLine: "#4a4a50", box: "#2a2a2f", line: "#8a8a92",
    text: "#f0f0f2", sub: "#b4b4bb", accent: "#a8b1ff", accentBg: "#2b2e47",
    store: "#3a2f1a", storeLine: "#d9a441", edge: "#43211f", edgeLine: "#ef7b6f",
  },
};

const esc = (s) => String(s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
const f = (n) => Math.round(n * 10) / 10;

function doc({ w, h, title, desc, theme, body }) {
  const t = THEMES[theme];
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${w} ${h}" role="img" aria-labelledby="t d">
<title id="t">${esc(title)}</title>
<desc id="d">${esc(desc)}</desc>
<defs>
<marker id="ah" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="7" markerHeight="7" orient="auto-start-reverse"><path d="M0 1 L9 5 L0 9 z" fill="${t.line}"/></marker>
</defs>
<style>
text{font-family:system-ui,-apple-system,"Segoe UI",Roboto,"Helvetica Neue",Arial,sans-serif;fill:${t.text};font-size:13px}
.s{fill:${t.sub};font-size:11.5px}.b{font-weight:600}.z{font-size:12px;font-weight:600;fill:${t.sub};letter-spacing:.02em}
.m{text-anchor:middle}.e{text-anchor:end}
</style>
<rect width="${w}" height="${h}" fill="${t.bg}"/>
${body(t)}
</svg>
`;
}

const zone = (t, x, y, w, h, text, kind = "zone") => {
  const fill = kind === "store" ? t.store : kind === "edge" ? t.edge : t.zone;
  const line = kind === "store" ? t.storeLine : kind === "edge" ? t.edgeLine : t.zoneLine;
  return `<rect x="${x}" y="${y}" width="${w}" height="${h}" rx="10" fill="${fill}" stroke="${line}" stroke-width="1.2"/>` +
    `<text class="z" x="${x + 12}" y="${y + 19}">${esc(text)}</text>`;
};
const box = (t, x, y, w, h, title, lines = [], opts = {}) => {
  const fill = opts.accent ? t.accentBg : t.box;
  const line = opts.accent ? t.accent : t.line;
  const top = y + h / 2 - ((lines.length + 1) * 16) / 2 + 12;
  let s = `<rect x="${x}" y="${y}" width="${w}" height="${h}" rx="7" fill="${fill}" stroke="${line}" stroke-width="1.2"/>`;
  s += `<text class="b m" x="${f(x + w / 2)}" y="${f(top)}">${esc(title)}</text>`;
  lines.forEach((l, i) => { s += `<text class="s m" x="${f(x + w / 2)}" y="${f(top + 16 * (i + 1))}">${esc(l)}</text>`; });
  return s;
};
const arrow = (t, pts, opts = {}) => {
  const d = pts.map((p, i) => `${i ? "L" : "M"}${p[0]} ${p[1]}`).join(" ");
  return `<path d="${d}" fill="none" stroke="${t.line}" stroke-width="1.4"${opts.dash ? ' stroke-dasharray="5 4"' : ""} marker-end="url(#ah)"${opts.both ? ' marker-start="url(#ah)"' : ""}/>`;
};
const label = (t, x, y, text, anchor = "start") =>
  `<text class="s${anchor === "middle" ? " m" : anchor === "end" ? " e" : ""}" x="${x}" y="${y}">${esc(text)}</text>`;

// 1. Architecture: what a deploy creates and what a request touches.
const architecture = {
  name: "architecture",
  w: 440, h: 664,
  title: "What a deployed game is made of",
  desc: "Four layers from top to bottom. The player's device runs the game with the RWK plugins, a Service Worker with Cache Storage, and local saves. Requests pass Cloudflare Access, which checks the login. One Worker routes them: it verifies the login, serves settings and the toolkit's plugins, and runs the save API. The Worker reads Static Assets for game files under 25 MiB and one R2 bucket for large files, saves, save history, settings and the list of players.",
  body: (t) => [
    zone(t, 8, 8, 424, 214, "Player's device (browser)"),
    box(t, 22, 36, 192, 70, "Game + RWK plugins", ["RWK_Core, SaveSync,", "SafeSaves, MobileControls…"], { accent: true }),
    box(t, 226, 36, 192, 70, "Service Worker", ["rwk-sw.js: answers file", "requests from the cache"]),
    box(t, 22, 130, 192, 70, "Local saves", ["MZ: localforage", "MV: localStorage"]),
    box(t, 226, 130, 192, 70, "Cache Storage", ["pictures, sounds, data,", "scripts (each < 25 MiB)"]),
    arrow(t, [[118, 106], [118, 130]], { both: true }),
    arrow(t, [[214, 71], [226, 71]]),
    arrow(t, [[322, 106], [322, 130]], { both: true }),

    arrow(t, [[220, 222], [220, 252]]),
    label(t, 232, 241, "page, game files, /api/…"),

    zone(t, 8, 252, 424, 52, "Cloudflare Access (at the edge)", "edge"),
    label(t, 20, 291, "Only invited emails get in; the request carries a signed login."),
    arrow(t, [[220, 304], [220, 334]]),

    zone(t, 8, 334, 424, 196, "One Worker, shared by every game"),
    box(t, 22, 360, 396, 40, "index.js: routes each request", [], { accent: true }),
    box(t, 22, 412, 124, 56, "auth.js", ["checks the JWT,", "reads the email"]),
    box(t, 158, 412, 124, 56, "saves.js", ["save API, ETag,", "save history"]),
    box(t, 294, 412, 124, 56, "players.js", ["counts emails", "that saved"]),
    box(t, 22, 478, 192, 44, "settings.js", ["config from R2, no redeploy"]),
    box(t, 226, 478, 192, 44, "toolkit.js", ["plugins.js, newer plugins"]),
    arrow(t, [[110, 530], [110, 560]]),
    arrow(t, [[330, 530], [330, 560]], { both: true }),

    zone(t, 8, 560, 196, 96, "Static Assets", "store"),
    label(t, 20, 599, "game files under 25 MiB"),
    label(t, 20, 616, "free, no bandwidth limit"),
    zone(t, 216, 560, 216, 96, "R2 bucket", "store"),
    label(t, 228, 599, "files over 25 MiB (Range)"),
    label(t, 228, 616, "saves/ and history/"),
    label(t, 228, 633, "settings and players"),
  ].join("\n"),
};

// 2. Deploy: from the game folder to Cloudflare.
const deploy = {
  name: "deploy",
  w: 440, h: 500,
  title: "What a deploy does",
  desc: "On the creator's PC, the CLI reads the game folder without writing to it, hard-links the files into a temporary build folder, adds the RWK plugins to js/plugins.js, writes the Service Worker file and a robots rule, and then sends the result to Cloudflare. Files over 25 MiB go to R2, the settings go to R2 as a JSON file, and wrangler deploys the Worker with the remaining files as static assets. The build folder is deleted at the end.",
  body: (t) => [
    zone(t, 8, 8, 424, 304, "Creator's PC (run.ps1 / rwk)"),
    box(t, 22, 36, 396, 44, "Game folder", ["read only: never written to"]),
    arrow(t, [[220, 80], [220, 98]]),
    box(t, 22, 98, 396, 44, "cli/ analyzes the game", ["engine, file sizes, names, rwk-policy.json"], { accent: true }),
    arrow(t, [[220, 142], [220, 160]]),
    box(t, 22, 160, 396, 70, "Temporary build (.rwk-build)", ["hard links to the game files", "+ RWK_*.js in js/plugins.js, rwk-sw.js,", "noindex rules"]),
    arrow(t, [[220, 230], [220, 248]]),
    box(t, 22, 248, 396, 50, "wrangler + Cloudflare API", ["uploads, deploys, then deletes the build"]),

    arrow(t, [[84, 298], [84, 340]]),
    arrow(t, [[220, 298], [220, 340]]),
    arrow(t, [[356, 298], [356, 340]]),
    label(t, 92, 324, "Worker + files"),
    label(t, 228, 324, "files over 25 MiB"),
    label(t, 364, 324, "settings"),

    zone(t, 8, 340, 424, 152, "Cloudflare (free plan)", "store"),
    box(t, 20, 366, 128, 62, "Worker", ["worker/ and the", "plugins inside it"], { accent: true }),
    box(t, 154, 366, 128, 62, "R2", ["assets/<site>/…", "changed files only"]),
    box(t, 288, 366, 132, 62, "R2", ["rwk/settings/", "<site>.json"]),
    box(t, 20, 438, 128, 44, "Static Assets", ["the other files"]),
    arrow(t, [[84, 428], [84, 438]]),
  ].join("\n"),
};

// 3. Sequence: first load, then save sync.
function sequence() {
  const X = { b: 56, a: 166, w: 276, r: 386 };
  const names = [["b", "Browser"], ["a", "Access"], ["w", "Worker"], ["r", "R2"]];
  const rows = [
    { phase: "First load" },
    { from: "b", to: "a", text: "open the site" },
    { from: "a", to: "b", text: "login page, then a signed cookie", dash: true },
    { from: "b", to: "w", text: "index.html and game files (through Access)" },
    { from: "w", to: "r", text: "large files, with Range" },
    { from: "b", to: "w", text: "js/plugins.js" },
    { from: "w", to: "r", text: "settings (cached 30 s)" },
    { from: "w", to: "b", text: "plugins.js with this player's settings", dash: true },
    { note: "Service Worker starts keeping files in the cache" },
    { phase: "Save sync" },
    { from: "b", to: "w", text: "GET /api/saves" },
    { from: "w", to: "r", text: "list this player's saves" },
    { from: "w", to: "b", text: "names + ETags; keep the newer, ask if both changed", dash: true },
    { from: "b", to: "w", text: "PUT /api/saves/file1, If-Match: ETag" },
    { from: "w", to: "r", text: "history copy, then write" },
    { from: "w", to: "b", text: "200 + new ETag, or 412 conflict", dash: true },
  ];
  const step = 34;
  let y = 52;
  for (const r of rows) {
    if (r.phase) { y += 10; r.y = y; y += 26; } else { r.y = y + 16; y += r.note ? 34 : step; }
  }
  const h = y + 6;
  return {
    name: "sequence",
    w: 440, h,
    title: "First load and save sync",
    desc: "Two phases between the browser, Cloudflare Access, the Worker and R2. First load: the browser opens the site, Access shows a login page and sets a signed cookie, then the browser fetches the page and game files through Access from the Worker, which serves large files from R2. The Worker reads js/plugins.js and adds the settings it reads from R2 for this player, and the Service Worker starts keeping files in the cache. Save sync: the browser lists saves, and the Worker reads R2 and returns names and ETags so the plugin keeps the newer copy or asks when both changed. Each save uploads about a second later with If-Match; the Worker copies the old save to history, writes the new one, and answers with a new ETag or a 412 conflict.",
    body: (t) => {
      let s = "";
      for (const [k, n] of names) {
        s += `<rect x="${X[k] - 44}" y="10" width="88" height="28" rx="6" fill="${t.accentBg}" stroke="${t.accent}" stroke-width="1.2"/>`;
        s += `<text class="b m" x="${X[k]}" y="29">${n}</text>`;
        s += `<line x1="${X[k]}" y1="38" x2="${X[k]}" y2="${h - 6}" stroke="${t.zoneLine}" stroke-width="1.2" stroke-dasharray="3 4"/>`;
      }
      for (const r of rows) {
        if (r.phase) {
          s += `<rect x="8" y="${r.y - 4}" width="424" height="22" rx="5" fill="${t.zone}"/>`;
          s += `<text class="z" x="18" y="${r.y + 12}">${esc(r.phase)}</text>`;
        } else if (r.note) {
          s += `<rect x="${X.b - 44}" y="${r.y - 12}" width="${X.r - X.b + 88}" height="22" rx="5" fill="${t.box}" stroke="${t.line}" stroke-width="1"/>`;
          s += `<text class="s m" x="${(X.b + X.r) / 2}" y="${r.y + 3}">${esc(r.note)}</text>`;
        } else {
          const a = X[r.from], b = X[r.to];
          s += label(t, Math.min(a, b) + 8, r.y - 6, r.text);
          s += arrow(t, [[a, r.y], [b, r.y]], { dash: r.dash });
        }
      }
      return s;
    },
  };
}

fs.mkdirSync(OUT, { recursive: true });
for (const d of [architecture, deploy, sequence()]) {
  for (const theme of Object.keys(THEMES)) {
    fs.writeFileSync(path.join(OUT, `${d.name}-${theme}.svg`), doc({ ...d, theme }));
  }
}
console.log("wrote architecture, deploy and sequence, light and dark, to site/public/img/");
