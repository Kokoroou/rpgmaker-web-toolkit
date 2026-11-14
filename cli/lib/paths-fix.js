// Fixes the path problems cli/lib/paths.js finds, at one of three levels. Without apply it only makes the plan.
// Used by `rwk fix-paths` and by the rwk-paths skill's fix.js.
//
//   safe       rewrites references (data/*.json, the plugin list, index.html, CSS) to the exact name of the file they mean
//   standard   safe + renames upper-case extensions and engine folders (img/Faces -> img/faces) + rewrites path literals in plugin scripts
//   thorough   standard + renames files with characters that break a web address (# ? \ %XX) and rewrites the references to them
//
// What it never does: guess between several files, touch a reference that is missing altogether, merge or delete a
// file, or change the formatting of a file (only the characters of the name are replaced). With apply every file it
// edits is copied to <game>/.rwk-paths-backup/<time>/ first, the renames are recorded there, and the game is scanned
// again: if that shows a new problem, everything is rolled back.

import fs from "node:fs";
import path from "node:path";
import { analyzeGame, collectFiles, resolveCI } from "./game.js";
import { countByKind, scanPaths } from "./paths.js";

export const FIX_LEVELS = {
  safe: { renames: false, code: false, unsafe: false },
  standard: { renames: true, code: true, unsafe: false },
  thorough: { renames: true, code: true, unsafe: true },
};
export const BACKUP_DIR = ".rwk-paths-backup";

const isCode = (source) => /^js\/(main\.js|plugins\/.+\.js)$/i.test(source);
const loadState = (folder) => {
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

function plannedRenames(state, level, report) {
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

function wantedIssues(state, level) {
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

function applyReferences(state, issues, backup, report, apply) {
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

function makeBackup(root, levelName) {
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

function restore(root, dir) {
  const manifest = JSON.parse(fs.readFileSync(path.join(dir, "manifest.json"), "utf8"));
  for (const rel of manifest.edited) fs.copyFileSync(path.join(dir, "files", rel), path.join(root, rel));
  for (const { from, to } of [...manifest.renames].reverse()) renameOnDisk(path.join(root, to), path.join(root, from));
  return manifest;
}

// Puts the game back as it was before the fix that made `backupDir`. -> { edited: [rel], renames: [{ from, to }] }
export function undoFix(folder, backupDir) {
  const dir = path.resolve(backupDir);
  if (!fs.existsSync(path.join(dir, "manifest.json"))) throw new Error(`${backupDir} is not a backup made by the path fix (no manifest.json).`);
  return restore(analyzeGame(path.resolve(folder)).root, dir);
}

// The backups of a game (its folder, or its www/), oldest first. -> [absolute folder]
export function listBackups(folder) {
  const dir = path.join(analyzeGame(path.resolve(folder)).root, BACKUP_DIR);
  if (!fs.existsSync(dir)) return [];
  return fs.readdirSync(dir).sort().map((name) => path.join(dir, name)).filter((p) => fs.existsSync(path.join(p, "manifest.json")));
}

//---------------------------------------------------------------------------

// -> { level, applied, root, before, renames: [{ from, to }], edits: [{ file, where, from, to }], skipped: [text],
//      remaining: counts | null, rolledBack, backup: folder | null }
// before: the counts by kind before anything changed; remaining: the counts after (apply only).
export function fixPaths(folder, { level: levelName = "standard", apply = false } = {}) {
  const level = FIX_LEVELS[levelName];
  if (!level) throw new Error(`Unknown level "${levelName}": use ${Object.keys(FIX_LEVELS).join(", ")}.`);
  const report = { level: levelName, applied: apply, root: null, before: null, renames: [], edits: [], skipped: [], remaining: null, rolledBack: false, backup: null };

  const before = loadState(folder);
  report.root = before.game.root;
  const backup = apply ? makeBackup(before.game.root, levelName) : null;
  report.backup = backup && backup.dir;
  const countsBefore = countByKind(before.issues);
  report.before = countsBefore;

  // 1. names
  const renamedFiles = [];
  for (const op of level.renames ? plannedRenames(before, level, report) : []) {
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
  const state = apply && report.renames.length ? loadState(folder) : before;
  const planned = [...wantedIssues(state, level), ...(level.unsafe ? followRenames(state, renamedFiles.map((r) => ({ oldRel: r.oldRel.replace(/^[^/]+/, (d) => d.toLowerCase()) }))) : [])];
  applyReferences(state, planned, backup, report, apply);

  // 3. check, and roll back on anything worse
  if (apply) {
    const after = loadState(folder);
    const countsAfter = countByKind(after.issues);
    const worse = countsAfter.missing > countsBefore.missing || countsAfter.collision > countsBefore.collision || countsAfter.case + countsAfter.unicode > countsBefore.case + countsBefore.unicode;
    if (worse) {
      restore(after.game.root, backup.dir);
      report.rolledBack = true;
      report.skipped.push(`The scan after the changes found new problems (${JSON.stringify(countsAfter)} vs ${JSON.stringify(countsBefore)}): everything was restored.`);
    }
    report.remaining = report.rolledBack ? countsBefore : countsAfter;
    // Nothing to change: no empty backup left behind.
    if (!report.renames.length && !report.edits.length && !report.rolledBack) {
      fs.rmSync(backup.dir, { recursive: true, force: true });
      report.backup = null;
    }
  }
  return report;
}
