// The result of a run, for scripts and CI. --json prints it as one JSON
// object on stdout (the log goes to stderr); in GitHub Actions it also
// becomes the step's outputs ($GITHUB_OUTPUT) and a job summary
// ($GITHUB_STEP_SUMMARY), --json or not.
//
//   { ok: true, command, site, url, locked, build: { files, bytes, r2Files, r2Uploaded }, warnings }
//   { ok: false, command, error, exitCode, warnings }

import fs from "node:fs";
import { formatBytes } from "./ui.js";

// value: what the command returned (deploy(), updateFromLink()), or nothing
export function runResult(command, value, warnings) {
  return { ok: true, command, site: null, url: null, ...(value || {}), warnings: [...warnings] };
}

export function failedResult(command, err, warnings) {
  return { ok: false, command, error: err.message, exitCode: err.exitCode || 1, warnings: [...warnings] };
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
  const done = { deploy: "deployed", "update-from-link": "updated", "import-saves": "saves uploaded", rename: "renamed", "edit-config": "config saved" };
  const lines = [result.ok ? `### ✅ ${name}: ${done[result.command] || "done"}` : `### ❌ ${name}: ${result.command} failed`, ""];
  const rows = [];
  if (result.url) rows.push(["Site", result.url]);
  if (result.locked) rows.push(["Access", "The site is still locked: finish its access protection in a terminal"]);
  const b = result.build;
  if (b) rows.push(["Files", `${b.files} (${formatBytes(b.bytes)})${b.r2Files ? `, ${b.r2Files} on R2 (${b.r2Uploaded} uploaded)` : ""}`]);
  if (!result.ok) rows.push(["Error", result.error], ["Exit code", `${result.exitCode}${result.exitCode === 2 ? " (a question needs a person: run the command once in a terminal)" : ""}`]);
  rows.push(["Warnings", result.warnings.length || "none"]);
  lines.push("| | |", "|---|---|", ...rows.map(([k, v]) => `| ${k} | ${cell(v)} |`), "");
  for (const w of result.warnings) lines.push(`- ${cell(w)}`);
  return lines.join("\n").trimEnd() + "\n";
}

// Prints and writes the result where it was asked for. A CI file that
// cannot be written never changes the run's outcome.
export function publishResult(result, { json = false, env = process.env, out = (text) => process.stdout.write(text) } = {}) {
  if (json) out(JSON.stringify(result, null, 2) + "\n");
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
