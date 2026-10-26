// The result of a run, for people and for scripts. Every command ends the
// same way: a summary on stderr (renderSummary), and the result on stdout:
// --json prints it as one JSON object; otherwise the link, when stdout is
// piped or --quiet. In GitHub Actions it also becomes the step's outputs
// ($GITHUB_OUTPUT) and a job summary ($GITHUB_STEP_SUMMARY), --json or not.
//
//   { schema: 1, ok: true, command, site, url, locked, build: { files, bytes, r2Files, r2Uploaded }, next, warnings }
//   { schema: 1, ok: false, command, error, hint, exitCode, warnings }
//
// command is the name `rwk --help` lists ("deploy", "saves import"…).
// schema changes only when a field is removed or changes meaning.

import fs from "node:fs";
import { c, formatBytes, sym } from "./ui.js";

export const RESULT_SCHEMA = 1;

// value: what the command returned (deploy(), upgrade()), or nothing
export function runResult(command, value, warnings) {
  return { schema: RESULT_SCHEMA, ok: true, command, site: null, url: null, ...(value || {}), warnings: [...warnings] };
}

export function failedResult(command, err, warnings) {
  return { schema: RESULT_SCHEMA, ok: false, command, error: err.message, hint: err.hint || null, exitCode: err.exitCode || 1, warnings: [...warnings] };
}

const DONE = {
  deploy: "deployed",
  upgrade: "toolkit updated",
  "saves import": "saves uploaded",
  "rename": "renamed",
  "config": "config saved",
};

// The same closing block for every command: what was done, the facts, what to do next.
export function renderSummary(result) {
  const name = result.site || "rpgmaker-web-toolkit";
  const rows = [];
  if (result.url) rows.push(["Link", c.bold(result.url)]);
  if (result.locked) rows.push(["Access", c.yellow("still locked: run the command again in a terminal to finish its protection")]);
  const b = result.build;
  if (b) rows.push(["Files", `${b.files} (${formatBytes(b.bytes)})${b.r2Files ? `, ${b.r2Files} on R2 (${b.r2Uploaded} uploaded)` : ""}`]);
  rows.push(["Warnings", result.warnings.length ? c.yellow(String(result.warnings.length)) : "none"]);
  const lines = ["", `${c.green(sym.ok)} ${c.bold(name)}: ${DONE[result.command] || "done"}`, ...rows.map(([k, v]) => `  ${c.dim(k.padEnd(9))}${v}`)];
  for (const w of result.warnings) lines.push(`    ${c.yellow(sym.warn)} ${w}`);
  for (const [i, text] of (result.next || []).entries()) lines.push(`  ${c.dim((i ? "" : "Next").padEnd(9))}${text}`);
  return lines.join("\n");
}

// $GITHUB_OUTPUT lines: name=value, one line each.
export function githubOutputs(result) {
  const oneLine = (v) => String(v ?? "").replace(/[\r\n]+/g, " ");
  const outputs = { ok: result.ok, site: result.site, url: result.url, warnings: result.warnings.length };
  if (!result.ok) outputs.error = result.error;
  return Object.entries(outputs).map(([name, value]) => `${name}=${oneLine(value)}\n`).join("");
}

// Markdown for $GITHUB_STEP_SUMMARY.
export function stepSummary(result) {
  const cell = (v) => String(v).replace(/\|/g, "\\|").replace(/[\r\n]+/g, " ");
  const name = result.site ? `\`${result.site}\`` : "rpgmaker-web-toolkit";
  const lines = [result.ok ? `### ✅ ${name}: ${DONE[result.command] || "done"}` : `### ❌ ${name}: ${result.command || "rwk"} failed`, ""];
  const rows = [];
  if (result.url) rows.push(["Site", result.url]);
  if (result.locked) rows.push(["Access", "The site is still locked: finish its access protection in a terminal"]);
  const b = result.build;
  if (b) rows.push(["Files", `${b.files} (${formatBytes(b.bytes)})${b.r2Files ? `, ${b.r2Files} on R2 (${b.r2Uploaded} uploaded)` : ""}`]);
  if (!result.ok) rows.push(["Error", result.error], ...(result.hint ? [["Try", result.hint]] : []), ["Exit code", `${result.exitCode}${result.exitCode === 2 ? " (a question needs a person: run the command once in a terminal)" : ""}`]);
  rows.push(["Warnings", result.warnings.length || "none"]);
  lines.push("| | |", "|---|---|", ...rows.map(([k, v]) => `| ${k} | ${cell(v)} |`), "");
  for (const w of result.warnings) lines.push(`- ${cell(w)}`);
  return lines.join("\n").trimEnd() + "\n";
}

// Prints and writes the result where it was asked for. stdout holds the
// result and nothing else: JSON with --json, else the link when something
// reads stdout (piped) or with --quiet. A CI file that cannot be written
// never changes the run's outcome.
export function publishResult(result, { json = false, quiet = false, tty = !!process.stdout.isTTY, env = process.env, out = (text) => process.stdout.write(text) } = {}) {
  if (json) out(JSON.stringify(result, null, 2) + "\n");
  else if (result.ok && result.url && (quiet || !tty)) out(result.url + "\n");
  const files = [
    [env.GITHUB_OUTPUT, githubOutputs],
    [env.GITHUB_STEP_SUMMARY, stepSummary],
  ];
  for (const [file, render] of files) {
    if (!file) continue;
    try {
      fs.appendFileSync(file, render(result));
    } catch (err) {
      console.error(`Could not write ${file}: ${err.message}`);
    }
  }
}
