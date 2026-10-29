// Every CLI and Worker file parses: a syntax error in a file that no other test loads
// (deploy.js, for one) fails here rather than in a user's deploy. node --check in a child
// process, so the files stay out of the coverage report.

import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { test } from "node:test";

const root = path.join(import.meta.dirname, "..");
const files = ["cli", "cli/commands", "cli/lib", "worker", "scripts"].flatMap((dir) =>
  fs.readdirSync(path.join(root, dir)).filter((f) => f.endsWith(".js")).map((f) => `${dir}/${f}`),
);

test("modules: every file in cli/, worker/ and scripts/ parses", () => {
  assert.ok(files.includes("cli/commands/deploy.js"));
  for (const rel of files) {
    const run = spawnSync(process.execPath, ["--check", path.join(root, rel)], { encoding: "utf8" });
    assert.equal(run.status, 0, `${rel}\n${run.stderr}`);
  }
});
