// Checks that every file the game points to exists under exactly that spelling.
// Windows ignores letter case, so a game made there works with Actor1.png asked as
// "actor1"; the web host (Workers assets) and the browser do not, and the picture
// or sound is a 404. Reads the game's files, never writes.
//
// Looks at: the data/*.json references (pictures, sounds, movies, event commands),
// the plugins listed in js/plugins.js, index.html and CSS files, and the path
// literals in the plugin scripts. Also at the names themselves (upper-case
// extensions, engine folders such as img/Characters, names that differ only by case).
//
// scanPaths() -> { checked, issues }; an issue is
//   { kind, source, ref, expected, actual, to, fix, count, sites }
//   kind: case | unicode (the file exists under another spelling), missing, ext, folder, collision, unsafe
//   fix:  "reference" (rewrite the reference to `to`), "file" (rename `actual` to `to`), or null (a person decides)
//   sites: where the reference is: { where, at } with at = { json: [path…] } or { start, end, text }

import fs from "node:fs";
import path from "node:path";

const IMAGE = [".png", ".rpgmvp", ".png_"];
const AUDIO = [".ogg", ".m4a", ".rpgmvo", ".rpgmvm", ".ogg_", ".m4a_"];
const MOVIE = [".webm", ".mp4"];
const AUDIO_DIRS = ["bgm", "bgs", "me", "se"].map((d) => `audio/${d}`);

// JSON keys holding a picture name, and the folder it is in.
const IMAGE_KEYS = {
  characterName: "characters",
  faceName: "faces",
  tilesetNames: "tilesets",
  title1Name: "titles1",
  title2Name: "titles2",
  parallaxName: "parallaxes",
  battleback1Name: "battlebacks1",
  battleback2Name: "battlebacks2",
  animation1Name: "animations",
  animation2Name: "animations",
};

// Folders the engine asks for, spelled this way.
export const ENGINE_FOLDERS = {
  img: ["animations", "battlebacks1", "battlebacks2", "characters", "enemies", "faces", "parallaxes", "pictures", "sv_actors", "sv_enemies", "system", "tilesets", "titles1", "titles2"],
  audio: ["bgm", "bgs", "me", "se"],
};

const MAX_TEXT_BYTES = 8 * 1024 ** 2;
const LITERAL = /(["'`])((?:img|audio|data|js|fonts|movies|effects|icon|css)\/[^"'`\n\\$]*?\.[A-Za-z0-9_]{1,6})\1/gid;
const HTML_REF = /\b(?:src|href)\s*=\s*(["'])([^"']+)\1/gid;
const CSS_URL = /url\(\s*(["']?)([^"')]+)\1\s*\)/gid;

const nfcKey = (rel) => rel.normalize("NFC");
const ciKey = (rel) => rel.normalize("NFC").toLowerCase();

function push(map, key, value) {
  if (map.has(key)) map.get(key).push(value);
  else map.set(key, [value]);
}

function buildIndex(files) {
  const exact = new Set();
  const byNfc = new Map();
  const byKey = new Map();
  for (const { rel } of files) {
    exact.add(rel);
    push(byNfc, nfcKey(rel), rel);
    push(byKey, ciKey(rel), rel);
  }
  return { exact, byNfc, byKey };
}

// candidates: [{ rel, dir (segments in the folder part), ext }]
// -> { status: "ok" | "unicode" | "case" | "missing", hits: [{ actual, cand }] }
function lookup(index, candidates) {
  if (candidates.some((cand) => index.exact.has(cand.rel))) return { status: "ok", hits: [] };
  for (const [status, map, key] of [["unicode", index.byNfc, nfcKey], ["case", index.byKey, ciKey]]) {
    const hits = [];
    for (const cand of candidates) for (const actual of map.get(key(cand.rel)) || []) hits.push({ actual, cand });
    if (hits.length) return { status, hits };
  }
  return { status: "missing", hits: [] };
}

const candidatesOf = (dirs, exts, name) => dirs.flatMap((dir) => exts.map((ext) => ({ rel: `${dir}/${name}${ext}`, dir: dir.split("/").length, ext })));

// The name part of a hit (below the folder, without the extension).
function nameOfHit({ actual, cand }) {
  const rest = actual.split("/").slice(cand.dir).join("/");
  return rest.slice(0, rest.length - cand.ext.length);
}

// The reference as it must be written to reach `actual`, keeping its ./ and ../
// (null when it cannot be done safely, e.g. a%20percent-encoded name).
function respell(clean, actual) {
  if (/(^|\/)[^./][^/]*\/\.\.(\/|$)/.test(clean)) return null;
  const actualSegs = actual.split("/");
  const out = clean.split("/");
  let j = actualSegs.length - 1;
  for (let i = out.length - 1; i >= 0; i--) {
    if (out[i] === "" || out[i] === "." || out[i] === "..") continue;
    if (j < 0) return null;
    out[i] = actualSegs[j--];
  }
  return out.join("/");
}

class Issues {
  constructor() {
    this.map = new Map();
    this.checked = 0;
  }

  add(data, site) {
    const key = `${data.kind}|${data.source}|${data.ref}|${data.expected}`;
    let issue = this.map.get(key);
    if (!issue) {
      issue = { ref: null, expected: null, actual: null, to: null, fix: null, ...data, count: 0, sites: [] };
      this.map.set(key, issue);
    }
    issue.count++;
    if (site) issue.sites.push(site);
  }

  list() {
    return [...this.map.values()];
  }
}

//---------------------------------------------------------------------------
// references in the data files
//---------------------------------------------------------------------------

function audioDirs(key) {
  const k = String(key || "").toLowerCase();
  for (const kind of ["bgm", "bgs", "me", "se"]) if (k.endsWith(kind) || (kind === "se" && k === "sounds")) return [`audio/${kind}`];
  return AUDIO_DIRS;
}

const isAudio = (o) => typeof o.name === "string" && typeof o.volume === "number" && typeof o.pitch === "number";
const where = (at) => "$" + at.map((k) => (typeof k === "number" ? `[${k}]` : `.${k}`)).join("");

// -> [{ dirs, exts, name, at }]
function jsonRefs(file, data) {
  const base = path.posix.basename(file).toLowerCase();
  const battlers = base === "actors.json" ? ["img/sv_actors"] : base === "enemies.json" ? ["img/enemies", "img/sv_enemies"] : ["img/enemies", "img/sv_actors", "img/sv_enemies"];
  const out = [];
  const handled = new Set();
  const add = (dirs, exts, name, at) => {
    if (typeof name === "string" && name) out.push({ dirs, exts, name, at });
  };
  const image = (dir, name, at) => add([`img/${dir}`], IMAGE, name, at);
  const audio = (dirs, obj, at) => {
    if (obj && typeof obj === "object" && typeof obj.name === "string") {
      handled.add(obj);
      add(dirs, AUDIO, obj.name, [...at, "name"]);
    }
  };

  const command = (node, at) => {
    const p = node.parameters;
    const pa = (i) => [...at, "parameters", i];
    switch (node.code) {
      case 101: image("faces", p[0], pa(0)); break;
      case 231: image("pictures", p[1], pa(1)); break;
      case 241: audio(["audio/bgm"], p[0], pa(0)); break;
      case 245: audio(["audio/bgs"], p[0], pa(0)); break;
      case 249: audio(["audio/me"], p[0], pa(0)); break;
      case 250: audio(["audio/se"], p[0], pa(0)); break;
      case 44: audio(["audio/se"], p[0], pa(0)); break; // move route: play SE
      case 41: image("characters", p[0], pa(0)); break; // move route: change image
      case 261: add(["movies"], MOVIE, p[0], pa(0)); break;
      case 283: image("battlebacks1", p[0], pa(0)); image("battlebacks2", p[1], pa(1)); break;
      case 284: image("parallaxes", p[0], pa(0)); break;
      case 322: image("characters", p[1], pa(1)); image("faces", p[3], pa(3)); add(battlers, IMAGE, p[5], pa(5)); break;
      default:
    }
  };

  const visit = (node, at, key) => {
    if (typeof node === "string") {
      if (IMAGE_KEYS[key]) image(IMAGE_KEYS[key], node, at);
      else if (key === "battlerName") add(battlers, IMAGE, node, at);
      else if (key === "effectName") add(["effects"], [".efkefc"], node, at);
    } else if (Array.isArray(node)) {
      node.forEach((child, i) => visit(child, [...at, i], key));
    } else if (node && typeof node === "object") {
      if (typeof node.code === "number" && Array.isArray(node.parameters)) command(node, at);
      if (!handled.has(node) && isAudio(node)) audio(audioDirs(key), node, at);
      for (const [k, v] of Object.entries(node)) visit(v, [...at, k], k);
    }
  };
  visit(data, [], "");
  return out;
}

function scanData(files, index, issues) {
  for (const file of files) {
    if (!/^data[^/]*\/.+\.json$/i.test(file.rel) || file.size > 256 * 1024 ** 2) continue;
    let data;
    try {
      data = JSON.parse(fs.readFileSync(file.abs, "utf8").replace(/^﻿/, ""));
    } catch {
      continue; // not valid JSON: the engine's problem, not a path
    }
    for (const ref of jsonRefs(file.rel, data)) {
      issues.checked++;
      const found = lookup(index, candidatesOf(ref.dirs, ref.exts, ref.name));
      if (found.status === "ok") continue;
      const expected = `${ref.dirs[0]}/${ref.name}`;
      const site = { where: `${file.rel} ${where(ref.at)}`, at: { json: ref.at } };
      if (found.status === "missing") {
        issues.add({ kind: "missing", source: file.rel, ref: ref.name, expected }, site);
        continue;
      }
      // A hit whose name part is the same differs in the extension or a folder only: reported on its own.
      const names = [...new Set(found.hits.map(nameOfHit).filter((n) => n !== ref.name))];
      if (!names.length) continue;
      const actual = [...new Set(found.hits.filter((h) => nameOfHit(h) !== ref.name).map((h) => h.actual))];
      issues.add({ kind: found.status, source: file.rel, ref: ref.name, expected, actual: actual[0], to: names.length === 1 ? names[0] : null, fix: names.length === 1 ? "reference" : null }, site);
    }
  }
}

//---------------------------------------------------------------------------
// references in text: plugins.js, index.html, css, plugin scripts
//---------------------------------------------------------------------------

const readText = (file) => (file.size <= MAX_TEXT_BYTES ? fs.readFileSync(file.abs, "utf8") : null);

function scanPluginList(file, text, index, issues) {
  let list;
  try {
    list = JSON.parse(text.slice(text.indexOf("["), text.lastIndexOf("]") + 1));
  } catch {
    return;
  }
  let pos = 0;
  for (const plugin of list) {
    if (!plugin || typeof plugin.name !== "string") continue;
    const quoted = JSON.stringify(plugin.name).replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    // nosemgrep: javascript.lang.security.audit.detect-non-literal-regexp.detect-non-literal-regexp
    const m = new RegExp(`"name"\\s*:\\s*(${quoted})`, "g");
    m.lastIndex = pos;
    const hit = m.exec(text);
    if (hit) pos = m.lastIndex;
    if (plugin.status === false) continue;
    issues.checked++;
    const found = lookup(index, candidatesOf(["js/plugins"], [".js"], plugin.name));
    if (found.status === "ok") continue;
    const expected = `js/plugins/${plugin.name}.js`;
    const site = hit ? { where: `${file.rel} plugin "${plugin.name}"`, at: { start: hit.index + hit[0].length - hit[1].length + 1, end: hit.index + hit[0].length - 1, text: plugin.name } } : null;
    if (found.status === "missing") {
      issues.add({ kind: "missing", source: file.rel, ref: plugin.name, expected }, site);
      continue;
    }
    const names = [...new Set(found.hits.map(nameOfHit).filter((n) => n !== plugin.name))];
    if (!names.length) continue;
    issues.add({ kind: found.status, source: file.rel, ref: plugin.name, expected, actual: found.hits[0].actual, to: names.length === 1 && site ? names[0] : null, fix: names.length === 1 && site ? "reference" : null }, site);
  }
}

// Paths written in text, resolved from baseDir. reportMissing: also say when nothing matches.
function scanTextPaths(file, text, regex, group, baseDir, index, issues, { reportMissing }) {
  for (const m of text.matchAll(regex)) {
    const raw = m[group];
    if (!raw || /^[a-z][a-z0-9+.-]*:|^\/\/|^[#?]/i.test(raw)) continue;
    const clean = raw.replace(/[?#].*$/, "");
    if (!clean) continue;
    const encoded = clean.includes("%");
    let decoded = clean;
    if (encoded) {
      try {
        decoded = decodeURI(clean);
      } catch {
        continue;
      }
    }
    const rel = path.posix.normalize(decoded.startsWith("/") ? decoded.slice(1) : path.posix.join(baseDir, decoded));
    if (rel.startsWith("..")) continue;
    issues.checked++;
    const found = lookup(index, [{ rel, dir: 0, ext: "" }]);
    if (found.status === "ok") continue;
    const [start, end] = m.indices[group];
    const site = { where: `${file.rel}:${text.slice(0, start).split("\n").length}`, at: { start, end, text: raw } };
    if (found.status === "missing") {
      if (reportMissing) issues.add({ kind: "missing", source: file.rel, ref: raw, expected: rel }, site);
      continue;
    }
    const actual = [...new Set(found.hits.map((h) => h.actual))];
    const to = actual.length === 1 && !encoded && !decoded.startsWith("/") ? respell(clean, actual[0]) : null;
    issues.add({ kind: found.status, source: file.rel, ref: raw, expected: rel, actual: actual[0], to: to && to + raw.slice(clean.length), fix: to ? "reference" : null }, site);
  }
}

function scanText(files, index, issues) {
  for (const file of files) {
    const lower = file.rel.toLowerCase();
    const isHtml = lower === "index.html";
    const isCss = lower.endsWith(".css");
    const isScript = /^js\/(plugins\.js|main\.js|plugins\/.+\.js)$/.test(lower);
    if (!isHtml && !isCss && !isScript) continue;
    const text = readText(file);
    if (text === null) continue;
    const baseDir = path.posix.dirname(file.rel) === "." ? "" : path.posix.dirname(file.rel);
    if (isHtml) scanTextPaths(file, text, HTML_REF, 2, "", index, issues, { reportMissing: true });
    if (isCss) scanTextPaths(file, text, CSS_URL, 2, baseDir, index, issues, { reportMissing: true });
    if (lower === "js/plugins.js") scanPluginList(file, text, index, issues);
    if (isScript) scanTextPaths(file, text, LITERAL, 2, "", index, issues, { reportMissing: false });
  }
}

//---------------------------------------------------------------------------
// the names themselves
//---------------------------------------------------------------------------

function scanNames(files, index, issues) {
  for (const [key, group] of index.byKey) {
    if (group.length > 1) issues.add({ kind: "collision", source: group[0], ref: key, expected: group.join(" | ") });
  }
  const folders = new Map();
  for (const { rel } of files) {
    const segs = rel.split("/");
    const ext = path.posix.extname(rel);
    if (ext && ext !== ext.toLowerCase()) {
      const to = rel.slice(0, rel.length - ext.length) + ext.toLowerCase();
      const taken = index.byKey.get(ciKey(to)).length > 1;
      issues.add({ kind: "ext", source: rel, ref: ext, expected: to, actual: rel, to, fix: taken ? null : "file" });
    }
    const known = ENGINE_FOLDERS[segs[0]];
    if (known && segs.length > 2 && known.includes(segs[1].toLowerCase()) && !known.includes(segs[1])) {
      folders.set(`${segs[0]}/${segs[1]}`, `${segs[0]}/${segs[1].toLowerCase()}`);
    }
    if (segs.some((s) => /[#?\\]|%[0-9a-f]{2}|^\s|\s$/i.test(s))) issues.add({ kind: "unsafe", source: rel, ref: rel, expected: rel });
  }
  for (const [from, to] of folders) {
    const taken = [...index.byKey.keys()].some((k) => k.startsWith(`${to.toLowerCase()}/`) && !k.startsWith(`${ciKey(from)}/`));
    issues.add({ kind: "folder", source: from, ref: from, expected: to, actual: from, to, fix: taken ? null : "file" });
  }
}

//---------------------------------------------------------------------------

// references: false looks at the names only (fast: no file is read)
export function scanPaths(files, { references = true } = {}) {
  const index = buildIndex(files);
  const issues = new Issues();
  if (references) {
    scanData(files, index, issues);
    scanText(files, index, issues);
  }
  scanNames(files, index, issues);
  return { checked: issues.checked, issues: issues.list() };
}

// kind -> number of references (or names) affected
export function countByKind(issues) {
  const counts = { case: 0, unicode: 0, missing: 0, ext: 0, folder: 0, collision: 0, unsafe: 0 };
  for (const issue of issues) counts[issue.kind] += issue.count;
  return counts;
}

const sample = (issues, n = 3) => issues.slice(0, n).map((i) => `${i.source}: "${i.ref}"${i.actual ? ` (file: ${i.actual})` : ""}`).join("; ");

// The warnings analyze and deploy show: one line per kind of problem.
export function pathWarnings(issues) {
  const of = (...kinds) => issues.filter((i) => kinds.includes(i.kind));
  const total = (list) => list.reduce((sum, i) => sum + i.count, 0);
  const out = [];
  const spelled = of("case", "unicode");
  if (spelled.length) {
    out.push(
      `${total(spelled)} reference(s) name a file with a different letter case or Unicode form than the file has, e.g. ${sample(spelled)}. Windows accepts this, the web host does not, so these will be missing in the browser. The rwk-paths skills (Claude Code) fix them.`
    );
  }
  const ext = of("ext");
  if (ext.length) out.push(`${ext.length} file(s) have an upper-case extension (${sample(ext, 2)}): the engine asks for it in lower case.`);
  const folder = of("folder");
  if (folder.length) out.push(`${folder.length} folder(s) are not spelled as the engine asks: ${folder.slice(0, 3).map((i) => `${i.ref} (must be ${i.to})`).join(", ")}.`);
  const collision = of("collision");
  if (collision.length) out.push(`${collision.length} group(s) of files differ only by letter case, so only one of each can exist on Windows: ${collision.slice(0, 2).map((i) => i.expected).join("; ")}.`);
  const unsafe = of("unsafe");
  if (unsafe.length) out.push(`${unsafe.length} file name(s) have characters that break a web address (# ? \\ %XX or spaces at the ends), e.g. ${unsafe.slice(0, 3).map((i) => i.source).join(", ")}.`);
  const missing = of("missing");
  if (missing.length) out.push(`${total(missing)} reference(s) point to files that are not in the game, e.g. ${sample(missing)}. Ignore them if nothing uses them.`);
  return out;
}
