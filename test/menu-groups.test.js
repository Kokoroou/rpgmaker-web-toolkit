// The ⚙ menu's groups (GROUPS in RWK_Core.js): every tool the runtime plugins
// add names one of them, so none falls under "More" by a typo.

import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { test } from "node:test";

const runtime = path.join(import.meta.dirname, "..", "runtime");
const source = (name) => fs.readFileSync(path.join(runtime, name), "utf8");

test("menu: every runtime tool names a known group, and Play holds none of them", () => {
  const block = source("RWK_Core.js").match(/const GROUPS = \{([\s\S]*?)\};/)[1];
  const groups = [...block.matchAll(/^\s*(\w+):/gm)].map((m) => m[1]);
  assert.ok(groups.includes("play"), "kept for other plugins");

  const used = new Map();
  for (const file of fs.readdirSync(runtime).filter((f) => /^RWK_.*\.js$/.test(f))) {
    for (const m of source(file).matchAll(/\bgroup: "(\w+)"/g)) used.set(m[1], [...(used.get(m[1]) || []), file]);
  }
  for (const [group, files] of used) assert.ok(groups.includes(group), `${group} (${files.join(", ")}) is not in GROUPS`);
  assert.equal(used.has("play"), false, "the toolkit's own tools sit in the narrower groups");
  for (const group of ["speed", "messages", "items"]) assert.ok(used.has(group), group);
});
