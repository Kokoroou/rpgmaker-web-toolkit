// `clear`: an answered question is erased from a real terminal, and kept elsewhere.

import assert from "node:assert/strict";
import { PassThrough } from "node:stream";
import { test } from "node:test";
import { ask, choose, confirm, eraseLines, setUnattended } from "../cli/lib/ui.js";

const ERASE = "\x1b[1A\x1b[2K";

// Runs fn with stdin fed `answers` (one per question) and stderr captured; tty: stderr is a terminal.
async function withTerminal(tty, answers, fn) {
  const desc = (o, k) => Object.getOwnPropertyDescriptor(o, k);
  const saved = { stdin: desc(process, "stdin"), isTTY: desc(process.stderr, "isTTY"), columns: desc(process.stderr, "columns"), write: process.stderr.write, term: process.env.TERM };
  const stdin = new PassThrough();
  const out = [];
  Object.defineProperty(process, "stdin", { value: stdin, configurable: true });
  Object.defineProperty(process.stderr, "isTTY", { value: tty, configurable: true });
  Object.defineProperty(process.stderr, "columns", { value: 80, configurable: true });
  process.stderr.write = (s) => (out.push(String(s)), true);
  process.env.TERM = "xterm";
  setUnattended(false);
  const queue = [...answers];
  const feeder = setInterval(() => queue.length && stdin.write(`${queue.shift()}\n`), 5);
  try {
    await fn();
  } finally {
    clearInterval(feeder);
    process.stderr.write = saved.write;
    for (const [o, k, d] of [[process, "stdin", saved.stdin], [process.stderr, "isTTY", saved.isTTY], [process.stderr, "columns", saved.columns]]) {
      if (d) Object.defineProperty(o, k, d);
      else delete o[k];
    }
    if (saved.term === undefined) delete process.env.TERM;
    else process.env.TERM = saved.term;
  }
  return out.join("");
}

const erased = (text) => text.split(ERASE).length - 1;

test("eraseLines writes nothing off a terminal or for no lines", async () => {
  assert.equal(await withTerminal(false, [], () => eraseLines(3)), "");
  assert.equal(await withTerminal(true, [], () => eraseLines(0)), "");
  assert.equal(erased(await withTerminal(true, [], () => eraseLines(3))), 3);
});

test("choose with clear erases its menu and the answer on a terminal", async () => {
  const options = [{ label: "A", value: "a" }, { label: "B", value: "b" }];
  let pick;
  const text = await withTerminal(true, ["2"], async () => (pick = await choose("Pick", options, 0, { clear: true })));
  assert.equal(pick, "b");
  assert.equal(erased(text), 1 + 3, "the answer line, then the question and its two options");
});

test("without clear, or off a terminal, nothing is erased", async () => {
  const options = [{ label: "A", value: "a" }];
  assert.equal(erased(await withTerminal(true, ["1"], () => choose("Pick", options, 0))), 0);
  assert.equal(erased(await withTerminal(false, ["1"], () => choose("Pick", options, 0, { clear: true }))), 0);
});

test("ask with clear also erases the warning of an invalid answer", async () => {
  let value;
  const text = await withTerminal(true, ["x", "5"], async () => (value = await ask("Number", "", (v) => (/^\d$/.test(v) ? null : "Digits only"), { clear: true })));
  assert.equal(value, "5");
  assert.equal(erased(text), 3, "prompt + warning + prompt");
});

test("confirm with clear erases its line", async () => {
  let yes;
  const text = await withTerminal(true, ["y"], async () => (yes = await confirm("Sure?", false, { clear: true })));
  assert.equal(yes, true);
  assert.equal(erased(text), 1);
});
