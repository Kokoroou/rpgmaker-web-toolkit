// Every CLI and Worker module loads: a syntax error or a broken import in a file that no other
// test reaches (deploy.js, for one) fails here rather than in a user's deploy.

import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { test } from "node:test";
import { pathToFileURL } from "node:url";

const root = path.join(import.meta.dirname, "..");
const modules = ["cli/commands", "cli/lib", "worker"].flatMap((dir) =>
  fs.readdirSync(path.join(root, dir)).filter((f) => f.endsWith(".js")).map((f) => `${dir}/${f}`),
);

test("modules: every file in cli/commands, cli/lib and worker loads", async () => {
  assert.ok(modules.includes("cli/commands/deploy.js"));
  for (const rel of modules) {
    await assert.doesNotReject(import(pathToFileURL(path.join(root, rel)).href), rel);
  }
});
