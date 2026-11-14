// fix-paths: fixes, in the game folder, the file paths that work on Windows but break on the web
// (letter case, upper-case extensions, engine folder spelling, characters a web address cannot hold).
// Shows the plan first; changes nothing without --apply or a yes in the terminal. Keeps a backup
// (<game>/.rwk-paths-backup/<time>/), rescans after the changes and rolls back if they made it worse.
// No Cloudflare: a published game gets the fix with the next `rwk deploy` (changed files only).

import path from "node:path";
import { FIX_LEVELS, fixPaths as runFix, listBackups, undoFix } from "../lib/paths-fix.js";
import { expectTarget } from "../lib/target.js";
import { CliError, UsageError, ask, c, choose, confirm, isUnattended, log } from "../lib/ui.js";

const USAGE = 'rwk fix-paths "<game folder>" [--level safe|standard|thorough] [--apply] [--undo <backup folder | last>]';
const SHOWN = 50;

const LEVEL_WORDS = {
  safe: "only the references (data, plugin list, index.html, CSS) are changed to the file's exact name; no file is renamed",
  standard: "safe + upper-case extensions (.PNG → .png), engine folders (img/Faces → img/faces) and path literals in plugin code",
  thorough: "standard + files whose names have # ? \\ or %XX are renamed (a#1.png → a_1.png), with their references",
};

const realDeps = { fixPaths: runFix, undoFix, listBackups, ask, choose, confirm };

// The counts that are left for a person: what no level fixes on its own.
const PERSON_KINDS = ["missing", "collision"];

export async function fixPaths(input, { level, apply = false, undo } = {}, deps = {}) {
  const d = { ...realDeps, ...deps };
  if (!input) input = await d.ask("Drag and drop or paste the game folder path", "", null, { hint: `Pass it after the command, or run it in the game folder: ${USAGE}` });
  const folder = expectTarget(input, ["folder"], USAGE).value;
  if (level !== undefined && !FIX_LEVELS[level]) throw new UsageError(`Unknown level "${level}" for --level.`, { hint: `Use one of: ${Object.keys(FIX_LEVELS).join(", ")}` });
  if (undo !== undefined) {
    if (level !== undefined || apply) throw new UsageError("--undo takes no --level or --apply: it puts the game back as it was.", { hint: `Usage: ${USAGE}` });
    return undoLast(folder, undo, d);
  }

  if (level === undefined) {
    level = await d.choose(
      "How much may be changed?",
      Object.keys(FIX_LEVELS).map((name) => ({ label: `${name}: ${LEVEL_WORDS[name]}`, value: name })),
      1
    );
  }

  log.step(`Planning the fix (level ${level})`);
  const plan = d.fixPaths(folder, { level, apply: false });
  log.info(c.dim(plan.root));
  showPlan(plan);
  const changes = plan.renames.length + plan.edits.length;
  const left = leftFor(plan.before, level);

  if (!changes) {
    log.ok(`Nothing to change at level ${level}`);
    for (const line of left) log.info(line);
    return { dryRun: true, fix: summaryOf(plan), facts: [["Changes", "none"]], next: [] };
  }
  if (!apply) {
    apply = !isUnattended() && (await d.confirm(`Make these ${changes} change(s) in the game folder? A backup is kept`, true));
    if (!apply) {
      return { dryRun: true, fix: summaryOf(plan), facts: [["Changes", `${changes} planned, none made`]], next: [`To make them: ${commandLine(folder, level)} --apply`] };
    }
  }

  log.step("Fixing");
  const done = d.fixPaths(folder, { level, apply: true });
  if (done.rolledBack) {
    throw new CliError("The changes made new problems appear in the scan, so the game was put back as it was.", {
      hint: `Nothing changed. Try a lower level (--level safe), or rwk analyze "${folder}" to see the problems`,
    });
  }
  for (const s of done.skipped) log.warn(`Skipped: ${s}`);
  log.ok(`${done.renames.length} rename(s) (files and folders), ${done.edits.length} reference(s) rewritten`);
  log.info(`Backup: ${done.backup}`);
  const remaining = Object.entries(done.remaining).filter(([, n]) => n);
  if (remaining.length) log.info(`Left after the scan: ${remaining.map(([k, n]) => `${k} ${n}`).join(", ")}`);
  for (const line of leftFor(done.remaining, level)) log.info(line);
  return {
    fix: summaryOf(done),
    facts: [["Changes", `${done.renames.length} rename(s), ${done.edits.length} edit(s)`], ["Backup", done.backup]],
    next: [
      `Publish the fix (only the changed files are uploaded): rwk deploy "${folder}"`,
      `To undo it: rwk fix-paths "${folder}" --undo last`,
      `Delete ${path.join(done.root, ".rwk-paths-backup")} once the game works.`,
    ],
  };
}

function undoLast(folder, undo, d) {
  let dir = undo;
  if (undo === "last") {
    const found = d.listBackups(folder);
    if (!found.length) throw new CliError("This game has no backup from rwk fix-paths.", { hint: "Name the backup folder: --undo <game>/.rwk-paths-backup/<time>" });
    dir = found[found.length - 1];
  }
  log.step("Undoing the fix");
  const manifest = d.undoFix(folder, dir);
  log.ok(`Restored ${manifest.edited.length} file(s) and reversed ${manifest.renames.length} rename(s) from ${dir}`);
  return { facts: [["Restored", `${manifest.edited.length} file(s), ${manifest.renames.length} rename(s)`]], next: [`The backup is still in ${dir}; delete it when you no longer need it.`] };
}

function showPlan(plan) {
  const lines = [...plan.renames.map((r) => `rename  ${r.from} → ${r.to}`), ...plan.edits.map((e) => `edit    ${e.where}: "${e.from}" → "${e.to}"`)];
  for (const line of lines.slice(0, SHOWN)) log.info(line);
  if (lines.length > SHOWN) log.info(c.dim(`… and ${lines.length - SHOWN} more (--json lists them all)`));
  for (const s of plan.skipped) log.warn(`Skipped: ${s}`);
}

// What this level leaves alone, and what would fix it.
function leftFor(counts, level) {
  const lines = [];
  const person = PERSON_KINDS.reduce((n, k) => n + (counts[k] || 0), 0);
  if (person) lines.push(`${person} problem(s) need a person (a missing file, or several files that differ only by case): rwk analyze shows them.`);
  if (level !== "thorough" && counts.unsafe) lines.push(`${counts.unsafe} file name(s) have characters a web address cannot hold: --level thorough renames them.`);
  if (level === "safe" && (counts.ext || counts.folder)) lines.push("Upper-case extensions and engine folder names are renamed from --level standard.");
  return lines;
}

const summaryOf = (r) => ({ level: r.level, applied: r.applied, renames: r.renames, edits: r.edits, skipped: r.skipped, before: r.before, remaining: r.remaining, backup: r.backup });
const commandLine = (folder, level) => `rwk fix-paths "${folder}" --level ${level}`;
