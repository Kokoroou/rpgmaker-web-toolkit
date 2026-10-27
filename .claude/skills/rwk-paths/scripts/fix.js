#!/usr/bin/env node
// Fixes the path problems scan.js finds, at one of three levels. Without --apply it only prints the plan.
//
//   node fix.js <game folder> [--level safe|standard|thorough] [--apply] [--json]
//   node fix.js <game folder> --undo <backup folder>
//
//   safe       rewrites references (data/*.json, the plugin list, index.html, CSS) to the exact name of the file they mean
//   standard   safe + renames upper-case extensions and engine folders (img/Faces -> img/faces) + rewrites path literals in plugin scripts
//   thorough   standard + renames files with characters that break a web address (# ? \ %XX) and rewrites the references to them
//
// What it never does: guess between several files, touch a reference that is missing altogether, merge or delete a
// file, or change the formatting of a file (only the characters of the name are replaced). With --apply every file it
// edits is copied to <game>/.rwk-paths-backup/<time>/ first, the renames are recorded there, and the game is scanned
// again: if that shows a new problem, everything is rolled back.

import fs from "node:fs";
import path from "node:path";
import { analyzeGame, collectFiles, resolveCI } from "../../../../cli/lib/game.js";
import { countByKind, scanPaths } from "../../../../cli/lib/paths.js";

const LEVELS = {
  safe: { renames: false, code: false, unsafe: false },
  standard: { renames: true, code: true, unsafe: false },
  thorough: { renames: true, code: true, unsafe: true },
};
const BACKUP_DIR = ".rwk-paths-backup";

const args = process.argv.slice(2);
const option = (name, fallback) => (args.includes(name) ? args[args.indexOf(name) + 1] : fallback);
const folder = args.find((a, i) => !a.startsWith("--") && !["--level", "--undo"].includes(args[i - 1]));
const levelName = option("--level", "standard");
const apply = args.includes("--apply");
const json = args.includes("--json");

if (!folder || !LEVELS[levelName]) {
  console.error("Usage: node fix.js <game folder> [--level safe|standard|thorough] [--apply] [--json]\n       node fix.js <game folder> --undo <backup folder>");
  process.exit(64);
}
const level = LEVELS[levelName];
const report = { level: levelName, applied: apply, renames: [], edits: [], skipped: [], remaining: null, rolledBack: false, backup: null };
const say = (text) => json || console.log(text);

const isCode = (source) => /^js\/(main\.js|plugins\/.+\.js)$/i.test(source);
const load = () => {
  const game = analyzeGame(path.resolve(folder));
  const files = collectFiles(game, {});
  return { game, files, byRel: new Map(files.map((f) => [f.rel, f])), ...scanPaths(files) };
};

// A name without the characters that break a web address.
const safeName = (base) => base.replace(/[#?\\]|%[0-9a-f]{2}/gi, "_").replace(/^\s+|\s+$/g, "");

//---------------------------------------------------------------------------
// renaming (two steps, so a change of case alone works on every disk)
//---------------------------------------------------------------------------

function renameOnDisk(from, to) {
  if (from !== to && fs.existsSync(to) && from.toLowerCase() !== to.toLowerCase()) throw new Error(`${to} already exists`);
  const tmp = `${from}.rwk-tmp`;
  fs.renameSync(from, tmp);
  fs.renameSync(tmp, to);
}

function plannedRenames(state) {
  const ops = [];
  for (const issue of state.issues) {
    if (issue.kind === "ext" && issue.fix === "file") {
      const from = state.byRel.get(issue.actual).abs;
      ops.push({ order: 0, from, to: path.join(path.dirname(from), path.posix.basename(issue.to)) });
    } else if (issue.kind === "unsafe" && level.unsafe) {
      const from = state.byRel.get(issue.source).abs;
      const base = path.basename(from);
      const to = safeName(base);
      const dirUnsafe = path.relative(state.game.root, path.dirname(from)).split(path.sep).some((s) => safeName(s) !== s);
      if (dirUnsafe || to === base || !to) report.skipped.push(`${issue.source}: the folder or the name cannot be made safe automatically`);
      else ops.push({ order: 0, from, to: path.join(path.dirname(from), to), unsafe: true });
    } else if (issue.kind === "folder" && issue.fix === "file") {
      const from = resolveCI(state.game.root, ...issue.actual.split("/"));
      ops.push({ order: 1000 - from.split(path.sep).length, from, to: path.join(path.dirname(from), path.posix.basename(issue.to)) });
    }
  }
  return ops.sort((a, b) => a.order - b.order);
}

//---------------------------------------------------------------------------
// editing: only the characters of the name change
//---------------------------------------------------------------------------

// Where the strings at the given JSON paths start and end in the text (without the quotes).
function locateStrings(text, wanted) {
  const found = new Map();
  let i = 0;
  const ws = () => {
    while (i < text.length && " \t\r\n﻿".includes(text[i])) i++;
  };
  const str = () => {
    const start = ++i;
    while (text[i] !== '"') i += text[i] === "\\" ? 2 : 1;
    return [start, i++];
  };
  const value = (p) => {
    ws();
    const c = text[i];
    if (c === '"') {
      const [s, e] = str();
      const key = JSON.stringify(p);
      if (wanted.has(key)) found.set(key, [s, e]);
    } else if (c === "{" || c === "[") {
      const close = c === "{" ? "}" : "]";
      i++;
      ws();
      if (text[i] === close) return void i++;
      for (let n = 0; ; n++) {
        ws();
        let k = n;
        if (c === "{") {
          const [s, e] = str();
          k = JSON.parse(`"${text.slice(s, e)}"`);
          ws();
          i++; // :
        }
        value([...p, k]);
        ws();
        if (text[i++] !== ",") return;
      }
    } else {
      while (i < text.length && !",]} \t\r\n".includes(text[i])) i++;
    }
  };
  value([]);
  return found;
}

function wantedIssues(state) {
  return state.issues.filter(
    (i) => (i.kind === "case" || i.kind === "unicode") && i.fix === "reference" && i.to && i.sites.length && (level.code || !isCode(i.source))
  );
}

// thorough: references to a file that was just renamed show up as missing; point them at the new name
function followRenames(state, renamed) {
  const out = [];
  for (const issue of state.issues) {
    if (issue.kind !== "missing" || !issue.sites.length) continue;
    // a "#" or "?" ends a web address in html / css, but is part of the name in the data files
    const clean = /\.json$/i.test(issue.source) ? issue.ref : issue.ref.replace(/[?#].*$/, "");
    const segs = clean.split("/");
    const last = segs.pop();
    const hit = renamed.some((r) => {
      const old = r.oldRel.toLowerCase();
      const expected = issue.expected.toLowerCase();
      return old === expected || old.replace(/\.[^./]+$/, "") === expected;
    });
    if (hit && safeName(last) !== last) out.push({ ...issue, kind: "case", fix: "reference", to: [...segs, safeName(last)].join("/") + issue.ref.slice(clean.length) });
  }
  return out;
}

function applyReferences(state, issues, backup) {
  const bySource = new Map();
  for (const issue of issues) for (const site of issue.sites) bySource.set(issue.source, [...(bySource.get(issue.source) || []), { issue, site }]);
  for (const [source, items] of bySource) {
    const file = state.byRel.get(source);
    const text = fs.readFileSync(file.abs, "utf8");
    const edits = [];
    const jsonSites = items.filter((x) => x.site.at.json);
    const located = jsonSites.length ? locateStrings(text, new Set(jsonSites.map((x) => JSON.stringify(x.site.at.json)))) : new Map();
    for (const { issue, site } of items) {
      if (site.at.json) {
        const span = located.get(JSON.stringify(site.at.json));
        const old = JSON.stringify(issue.ref).slice(1, -1);
        if (span && text.slice(span[0], span[1]) === old) edits.push({ start: span[0], end: span[1], old, next: JSON.stringify(issue.to).slice(1, -1), issue, site });
        else report.skipped.push(`${site.where}: the text is not what the scan saw (escaped characters?), left as is`);
      } else if (text.slice(site.at.start, site.at.end) === site.at.text) {
        edits.push({ start: site.at.start, end: site.at.end, old: site.at.text, next: issue.to, issue, site });
      } else {
        report.skipped.push(`${site.where}: the text changed since the scan, left as is`);
      }
    }
    if (!edits.length) continue;
    let next = text;
    for (const e of edits.sort((a, b) => b.start - a.start)) next = next.slice(0, e.start) + e.next + next.slice(e.end);
    for (const e of edits) report.edits.push({ file: source, where: e.site.where, from: e.old, to: e.next });
    if (apply) {
      backup.save(file.abs);
      fs.writeFileSync(file.abs, next);
    }
  }
}

//---------------------------------------------------------------------------
// backup and undo
//---------------------------------------------------------------------------

function makeBackup(root) {
  const dir = path.join(root, BACKUP_DIR, new Date().toISOString().replace(/[:.]/g, "-"));
  const manifest = { level: levelName, renames: [], edited: [] };
  const write = () => fs.writeFileSync(path.join(dir, "manifest.json"), JSON.stringify(manifest, null, 2));
  fs.mkdirSync(dir, { recursive: true });
  write();
  return {
    dir,
    save(abs) {
      const rel = path.relative(root, abs);
      if (manifest.edited.includes(rel)) return;
      fs.mkdirSync(path.dirname(path.join(dir, "files", rel)), { recursive: true });
      fs.copyFileSync(abs, path.join(dir, "files", rel));
      manifest.edited.push(rel);
      write();
    },
    renamed(from, to) {
      manifest.renames.push({ from: path.relative(root, from), to: path.relative(root, to) });
      write();
    },
  };
}

function undo(root, dir) {
  const manifest = JSON.parse(fs.readFileSync(path.join(dir, "manifest.json"), "utf8"));
  for (const rel of manifest.edited) fs.copyFileSync(path.join(dir, "files", rel), path.join(root, rel));
  for (const { from, to } of [...manifest.renames].reverse()) renameOnDisk(path.join(root, to), path.join(root, from));
  return manifest;
}

//---------------------------------------------------------------------------

const undoDir = option("--undo");
if (undoDir) {
  const root = analyzeGame(path.resolve(folder)).root;
  const manifest = undo(root, path.resolve(undoDir));
  console.log(`Restored ${manifest.edited.length} file(s) and reversed ${manifest.renames.length} rename(s).`);
  process.exit(0);
}

const before = load();
const backup = apply ? makeBackup(before.game.root) : null;
report.backup = backup && backup.dir;
const countsBefore = countByKind(before.issues);

// 1. names
const renamedFiles = [];
for (const op of level.renames ? plannedRenames(before) : []) {
  const item = { from: path.relative(before.game.root, op.from), to: path.relative(before.game.root, op.to) };
  if (apply) {
    try {
      renameOnDisk(op.from, op.to);
      backup.renamed(op.from, op.to);
    } catch (err) {
      report.skipped.push(`${item.from}: ${err.message}`);
      continue;
    }
  }
  report.renames.push(item);
  if (op.unsafe) renamedFiles.push({ oldRel: item.from.split(path.sep).join("/") });
}

// 2. references, on the names as they are now
const state = apply && report.renames.length ? load() : before;
const planned = [...wantedIssues(state), ...(level.unsafe ? followRenames(state, renamedFiles.map((r) => ({ oldRel: r.oldRel.replace(/^[^/]+/, (d) => d.toLowerCase()) }))) : [])];
applyReferences(state, planned, backup);

// 3. check, and roll back on anything worse
if (apply) {
  const after = load();
  const countsAfter = countByKind(after.issues);
  const worse = countsAfter.missing > countsBefore.missing || countsAfter.collision > countsBefore.collision || countsAfter.case + countsAfter.unicode > countsBefore.case + countsBefore.unicode;
  if (worse) {
    undo(after.game.root, backup.dir);
    report.rolledBack = true;
    report.skipped.push(`The scan after the changes found new problems (${JSON.stringify(countsAfter)} vs ${JSON.stringify(countsBefore)}): everything was restored.`);
  }
  report.remaining = report.rolledBack ? countsBefore : countsAfter;
}

if (json) {
  console.log(JSON.stringify(report, null, 2));
} else {
  say(`${apply ? "Applied" : "Plan (nothing written; add --apply)"} · level ${levelName}`);
  for (const r of report.renames) say(`  rename  ${r.from} -> ${r.to}`);
  for (const e of report.edits.slice(0, 200)) say(`  edit    ${e.where}: "${e.from}" -> "${e.to}"`);
  if (report.edits.length > 200) say(`  … and ${report.edits.length - 200} more edit(s)`);
  for (const s of report.skipped) say(`  skipped ${s}`);
  say(`${report.renames.length} rename(s), ${report.edits.length} edit(s)${apply ? `; backup: ${report.backup}` : ""}`);
  if (report.remaining) say(`Left after the scan: ${Object.entries(report.remaining).filter(([, n]) => n).map(([k, n]) => `${k} ${n}`).join(", ") || "nothing"}`);
}
process.exitCode = report.rolledBack ? 3 : 0;
