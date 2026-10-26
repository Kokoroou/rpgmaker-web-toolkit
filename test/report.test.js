// The result of a run for scripts and CI: --json on stdout, and GitHub
// Actions' step outputs and job summary.

import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { test } from "node:test";
import { failedResult, githubOutputs, publishResult, runResult, stepSummary } from "../cli/lib/report.js";
import { NeedsAnswer, log, print, setJsonOutput } from "../cli/lib/ui.js";

const deployed = runResult(
  "deploy",
  { site: "my-game", url: "https://my-game.alice.workers.dev", locked: false, build: { files: 1200, bytes: 300 * 1024 ** 2, r2Files: 2, r2Uploaded: 1 } },
  ["3 file name(s) have | odd\ncharacters"]
);

test("result: what a deploy returns, or why it failed", () => {
  assert.equal(deployed.ok, true);
  assert.equal(deployed.command, "deploy");
  assert.equal(deployed.url, "https://my-game.alice.workers.dev");
  assert.deepEqual(runResult("edit-config", undefined, []), { ok: true, command: "edit-config", site: null, url: null, warnings: [] });

  const failed = failedResult("deploy", new NeedsAnswer("Nobody can answer"), ["w"]);
  assert.deepEqual(failed, { ok: false, command: "deploy", error: "Nobody can answer", exitCode: 2, warnings: ["w"] });
  assert.equal(failedResult("deploy", new Error("boom"), []).exitCode, 1);
});

test("GitHub Actions: step outputs, one line each, and a job summary", () => {
  assert.equal(githubOutputs(deployed), "ok=true\nsite=my-game\nurl=https://my-game.alice.workers.dev\nwarnings=1\n");
  const failed = failedResult("update-from-link", new Error("Could not update\nthe Worker"), []);
  assert.equal(githubOutputs(failed), "ok=false\nsite=\nurl=\nwarnings=0\nerror=Could not update the Worker\n");

  const summary = stepSummary(deployed);
  assert.match(summary, /^### ✅ `my-game`: deployed\n/);
  assert.match(summary, /\| Site \| https:\/\/my-game\.alice\.workers\.dev \|/);
  assert.match(summary, /\| Files \| 1200 \(300\.0 MB\), 2 on R2 \(1 uploaded\) \|/);
  assert.match(summary, /^- 3 file name\(s\) have \\\| odd characters$/m, "a warning cannot break the table or the list");

  const stuck = stepSummary(failedResult("deploy", new NeedsAnswer("Nobody can answer"), []));
  assert.match(stuck, /^### ❌ rpgmaker-web-toolkit: deploy failed/);
  assert.match(stuck, /\| Exit code \| 2 \(a question needs a person/);
  assert.match(stuck, /\| Warnings \| none \|/);
});

test("publishResult: JSON on stdout only with --json; GitHub files when the runner sets them", (t) => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "rwk-report-"));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  const env = { GITHUB_OUTPUT: path.join(dir, "out"), GITHUB_STEP_SUMMARY: path.join(dir, "summary.md") };
  fs.writeFileSync(env.GITHUB_OUTPUT, "earlier=1\n");

  let printed = "";
  publishResult(deployed, { json: true, env, out: (text) => (printed += text) });
  assert.deepEqual(JSON.parse(printed), deployed);
  assert.equal(fs.readFileSync(env.GITHUB_OUTPUT, "utf8"), "earlier=1\n" + githubOutputs(deployed), "appended, as GitHub expects");
  assert.equal(fs.readFileSync(env.GITHUB_STEP_SUMMARY, "utf8"), stepSummary(deployed));

  printed = "";
  publishResult(deployed, { json: false, env: {}, out: (text) => (printed += text) });
  assert.equal(printed, "", "nothing extra on a plain run");

  t.mock.method(console, "error", () => {});
  assert.doesNotThrow(() => publishResult(deployed, { env: { GITHUB_OUTPUT: path.join(dir, "missing", "out") } }), "a CI file never fails the run");
});

test("--json: the log goes to stderr, so stdout holds only the result", (t) => {
  const out = t.mock.method(console, "log", () => {});
  const err = t.mock.method(console, "error", () => {});
  t.after(() => setJsonOutput(false));
  setJsonOutput(true);
  log.info("hello");
  print("Done!");
  assert.equal(out.mock.callCount(), 0);
  assert.deepEqual(err.mock.calls.map((c) => c.arguments[0]), ["  hello", "Done!"]);
  setJsonOutput(false);
  log.info("back");
  assert.equal(out.mock.callCount(), 1);
});
