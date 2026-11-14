#!/usr/bin/env node
// Fixes the path problems scan.js finds, at one of three levels. Without --apply it only prints the plan.
// The work is cli/lib/paths-fix.js, shared with `rwk fix-paths`.
//
//   node fix.js <game folder> [--level safe|standard|thorough] [--apply] [--json]
//   node fix.js <game folder> --undo <backup folder>
//
//   safe       rewrites references (data/*.json, the plugin list, index.html, CSS) to the exact name of the file they mean
//   standard   safe + renames upper-case extensions and engine folders (img/Faces -> img/faces) + rewrites path literals in plugin scripts
//   thorough   standard + renames files with characters that break a web address (# ? \ %XX) and rewrites the references to them

import { FIX_LEVELS, fixPaths, undoFix } from "../../../../cli/lib/paths-fix.js";

const args = process.argv.slice(2);
const option = (name, fallback) => (args.includes(name) ? args[args.indexOf(name) + 1] : fallback);
const folder = args.find((a, i) => !a.startsWith("--") && !["--level", "--undo"].includes(args[i - 1]));
const levelName = option("--level", "standard");
const apply = args.includes("--apply");
const json = args.includes("--json");

if (!folder || !FIX_LEVELS[levelName]) {
  console.error("Usage: node fix.js <game folder> [--level safe|standard|thorough] [--apply] [--json]\n       node fix.js <game folder> --undo <backup folder>");
  process.exit(64);
}

const undoDir = option("--undo");
if (undoDir) {
  const manifest = undoFix(folder, undoDir);
  console.log(`Restored ${manifest.edited.length} file(s) and reversed ${manifest.renames.length} rename(s).`);
  process.exit(0);
}

const report = fixPaths(folder, { level: levelName, apply });
const say = (text) => json || console.log(text);

if (json) {
  console.log(JSON.stringify(report, null, 2));
} else {
  say(`${apply ? "Applied" : "Plan (nothing written; add --apply)"} · level ${levelName}`);
  for (const r of report.renames) say(`  rename  ${r.from} -> ${r.to}`);
  for (const e of report.edits.slice(0, 200)) say(`  edit    ${e.where}: "${e.from}" -> "${e.to}"`);
  if (report.edits.length > 200) say(`  … and ${report.edits.length - 200} more edit(s)`);
  for (const s of report.skipped) say(`  skipped ${s}`);
  say(`${report.renames.length} rename(s), ${report.edits.length} edit(s)${apply && report.backup ? `; backup: ${report.backup}` : ""}`);
  if (report.remaining) say(`Left after the scan: ${Object.entries(report.remaining).filter(([, n]) => n).map(([k, n]) => `${k} ${n}`).join(", ") || "nothing"}`);
}
process.exitCode = report.rolledBack ? 3 : 0;
