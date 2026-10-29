import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { log, planSteps, print, progressLine, setLive, setQuiet, useLive } from "../cli/lib/ui.js";
import { assetProgress } from "../cli/lib/wrangler.js";
import { syncOverflow } from "../cli/lib/cloudflare.js";

// Runs fn with stderr captured (as a pipe, so no colour) -> what was written.
async function captured(fn) {
  const out = [];
  const write = process.stderr.write;
  process.stderr.write = (s) => (out.push(String(s)), true);
  try {
    await fn();
  } finally {
    process.stderr.write = write;
  }
  return out.join("");
}

test("useLive: only on a terminal, without NO_COLOR, CI or --json", () => {
  assert.equal(useLive({}, true), true);
  assert.equal(useLive({}, false), false);
  assert.equal(useLive({ TERM: "dumb" }, true), false);
  assert.equal(useLive({ NO_COLOR: "1" }, true), false);
  assert.equal(useLive({ CI: "true" }, true), false);
  setLive(false);
  try {
    assert.equal(useLive({}, true), false);
  } finally {
    setLive(true);
  }
});

test("planSteps numbers the next N steps, then steps print as before", async () => {
  const out = await captured(() => {
    log.step("Before");
    planSteps(2);
    log.step("One");
    log.step("Two");
    log.step("After");
  });
  const steps = out.split("\n").filter((l) => /One|Two|Before|After/.test(l));
  assert.deepEqual(
    steps.map((l) => l.replace(/^\S+ /, "")),
    ["Before", "[1/2] One", "[2/2] Two", "After"]
  );
  planSteps(0);
  assert.doesNotMatch(await captured(() => log.step("Zero")), /\[/);
});

test("progressLine on a terminal rewrites one line, cut to the width, and clears it before a log line", async () => {
  const out = [];
  const write = (s) => out.push(s);
  const bar = progressLine({ live: true, write, columns: () => 20 });
  bar.update("short");
  bar.update("a line much longer than twenty columns");
  assert.equal(out[0], "\r\x1b[2K  short");
  assert.equal(out[1], "\r\x1b[2K  a line much long…");
  await captured(() => print("next"));
  assert.equal(out[2], "\r\x1b[2K", "print erases the line first");
  bar.end();
  assert.equal(out.length, 3, "nothing left to erase");
});

test("progressLine elsewhere prints plain lines, and nothing with --quiet", async () => {
  const bar = progressLine({ live: false, write: () => assert.fail("no in-place writes") });
  assert.equal(await captured(() => bar.update("3/12 img/a.png")), "  3/12 img/a.png\n");
  setQuiet(true);
  try {
    assert.equal(await captured(() => bar.update("hidden")), "");
  } finally {
    setQuiet(false);
  }
  bar.end();
});

test("assetProgress turns wrangler's upload counts into one line on a terminal", () => {
  const out = [];
  const updates = [];
  const bar = { live: true, update: (t) => updates.push(t), end: () => updates.push("end") };
  const echo = assetProgress((s) => out.push(s), bar);
  echo.push("🌀 Found 3 new or modified static assets to upload.\nUploaded 1 of ");
  echo.push("3 assets\n\x1b[2mUploaded 3 of 3 assets\x1b[0m\n");
  echo.raw("a warning\n");
  echo.push("✨ Success! Uploaded 3 files");
  echo.end();
  assert.deepEqual(updates, ["end", "Uploaded 1 of 3 assets (33%)", "Uploaded 3 of 3 assets (100%)", "end", "end", "end"]);
  assert.deepEqual(out, ["🌀 Found 3 new or modified static assets to upload.\n", "a warning\n", "✨ Success! Uploaded 3 files\n"]);
});

test("assetProgress passes wrangler's output through unchanged elsewhere", () => {
  const out = [];
  const echo = assetProgress((s) => out.push(s), { live: false });
  echo.push("Uploaded 1 of 3 assets\nUploaded 3");
  echo.raw("warn");
  echo.end();
  assert.deepEqual(out, ["Uploaded 1 of 3 assets\nUploaded 3", "warn"]);
});

function overflowFiles() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "rwk-progress-"));
  return ["a.ogg", "b.ogg"].map((rel) => {
    const abs = path.join(dir, rel);
    fs.writeFileSync(abs, rel.repeat(1000));
    return { rel, abs, size: fs.statSync(abs).size };
  });
}

function fakeIo(bar, remote = {}) {
  const puts = [];
  return {
    puts,
    io: { bar, load: async () => remote, put: async (_b, key) => puts.push(key), remove: async () => {}, putJson: async (_b, key) => puts.push(key) },
  };
}

test("syncOverflow: one updating line with the bytes done on a terminal", async () => {
  const updates = [];
  const { io, puts } = fakeIo({ live: true, update: (t) => updates.push(t), end: () => updates.push("end") });
  const result = await syncOverflow({ bucket: "b", slug: "g", files: overflowFiles(), io });
  assert.deepEqual(result, { uploaded: 2, removed: 0, unchanged: 0 });
  assert.equal(updates.length, 3);
  assert.match(updates[0], /R2 1\/2 · 0 B of 10 KB · a\.ogg$/);
  assert.match(updates[1], /R2 2\/2 · 5 KB of 10 KB · b\.ogg$/);
  assert.equal(updates[2], "end");
  assert.deepEqual(puts.slice(0, 2), ["assets/g/a.ogg", "assets/g/b.ogg"]);
});

test("syncOverflow: a plain line per uploaded file elsewhere, none for unchanged ones", async () => {
  const files = overflowFiles();
  const first = fakeIo({ live: false, update: () => {}, end: () => {} });
  await syncOverflow({ bucket: "b", slug: "g", files, io: first.io });
  // The manifest written by the first run says a.ogg is unchanged.
  const crypto = await import("node:crypto");
  const sha = crypto.createHash("sha256").update(fs.readFileSync(files[0].abs)).digest("hex");
  const updates = [];
  const { io } = fakeIo({ live: false, update: (t) => updates.push(t), end: () => {} }, { "a.ogg": { sha256: sha } });
  const result = await syncOverflow({ bucket: "b", slug: "g", files, io });
  assert.deepEqual(result, { uploaded: 1, removed: 0, unchanged: 1 });
  assert.equal(updates.length, 1);
  assert.match(updates[0], /R2 \[2\/2\] b\.ogg \(0\.0 MB\)$/);
});
