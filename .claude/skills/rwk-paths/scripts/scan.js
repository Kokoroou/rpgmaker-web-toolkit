#!/usr/bin/env node
// Finds file paths that work on Windows but not on the web. Read-only.
//
//   node scan.js <game folder> [--level quick|standard|deep] [--json]
//
//   quick     file and folder names only (upper-case extensions, engine folders, case collisions, unsafe characters)
//   standard  quick + every static reference (data/*.json, plugin list, index.html, CSS, path literals in plugin scripts)
//   deep      standard + a list of plugin code that builds paths at run time, for a person (or Claude) to read

import fs from "node:fs";
import path from "node:path";
import { analyzeGame, collectFiles } from "../../../../cli/lib/game.js";
import { countByKind, scanPaths } from "../../../../cli/lib/paths.js";

const args = process.argv.slice(2);
const flag = (name) => args.includes(name);
const option = (name, fallback) => (args.includes(name) ? args[args.indexOf(name) + 1] : fallback);
const folder = args.find((a, i) => !a.startsWith("--") && args[i - 1] !== "--level");
const level = option("--level", "standard");

if (!folder || !["quick", "standard", "deep"].includes(level)) {
  console.error("Usage: node scan.js <game folder> [--level quick|standard|deep] [--json]");
  process.exit(64);
}

// Code that makes a path out of pieces (or reads one from outside): static scanning cannot follow it.
const DYNAMIC = /(?:ImageManager\.(?:load\w+|reserve\w+)|AudioManager\.(?:play\w+|load\w+)|loadBitmap|loadNormalBitmap|new Audio\(|new Image\(|\.src\s*=|fetch\(|XMLHttpRequest|Utils\.encodeURI|\bimg\s*\/|["'`](?:img|audio|movies|data|fonts)\/["'`]\s*\+|\+\s*["'`]\.(?:png|ogg|m4a|json|webm|mp4)["'`])/;

function reviewList(files) {
  const out = [];
  for (const file of files) {
    if (!/^js\/(main\.js|plugins\/.+\.js)$/i.test(file.rel) || file.size > 4 * 1024 ** 2) continue;
    fs.readFileSync(file.abs, "utf8").split("\n").forEach((line, i) => {
      if (line.length < 400 && DYNAMIC.test(line)) out.push({ file: file.rel, line: i + 1, code: line.trim().slice(0, 160) });
    });
  }
  return out;
}

const game = analyzeGame(path.resolve(folder));
const files = collectFiles(game, {});
const { checked, issues } = scanPaths(files, { references: level !== "quick" });
const result = {
  game: { title: game.title, engine: game.engine, root: game.root },
  level,
  checked,
  counts: countByKind(issues),
  issues: issues.map(({ sites, ...rest }) => ({ ...rest, where: sites.slice(0, 3).map((s) => s.where) })),
};
if (level === "deep") result.review = reviewList(files);

if (flag("--json")) {
  console.log(JSON.stringify(result, null, 2));
} else {
  console.log(`${game.engine} · ${game.title} · level ${level} · ${checked} references checked`);
  for (const [kind, n] of Object.entries(result.counts)) if (n) console.log(`  ${kind.padEnd(10)}${n}`);
  for (const i of result.issues) {
    const fix = i.fix ? `fixable (${i.fix})` : "needs a person";
    console.log(`- [${i.kind}] ${i.source}: "${i.ref}"${i.actual ? ` -> ${i.actual}` : ""}${i.to ? ` (to "${i.to}")` : ""} x${i.count}, ${fix}${i.where.length ? ` @ ${i.where[0]}` : ""}`);
  }
  if (result.review) {
    console.log(`\nPlugin code that builds paths at run time (${result.review.length} lines): read these for names the scan cannot see`);
    for (const r of result.review.slice(0, 200)) console.log(`  ${r.file}:${r.line}  ${r.code}`);
  }
}
process.exitCode = issues.some((i) => i.kind !== "missing") ? 1 : 0;
