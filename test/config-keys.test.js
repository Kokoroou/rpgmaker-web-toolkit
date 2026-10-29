// rwk config --get / --set: one setting at a time, for scripts.

import assert from "node:assert/strict";
import { test } from "node:test";
import { parseCommandLine } from "../cli/lib/args.js";
import { getSetting, parseAssignment, parseValue, setSetting } from "../cli/lib/config-keys.js";
import { publishResult, renderSummary, runResult } from "../cli/lib/report.js";

const parse = (args) => parseCommandLine(args, { stdinIsTTY: true });
const cfg = { slug: "my-game", fingerprint: "f1", cheats: true, fastForward: { maxSpeed: 4 }, alwaysDash: false, controls: { opacity: 0.2, buttons: [] } };

test("config --get / --set: parsed for config only, --set repeatable, not both at once", () => {
  const set = parse(["config", "my-game", "--set", "cheats=false", "--set", "fastForward.maxSpeed=3"]);
  assert.equal(set.target, "my-game");
  assert.deepEqual(set.flags.set, ["cheats=false", "fastForward.maxSpeed=3"]);
  assert.equal(parse(["config", "my-game", "--get", "cheats"]).flags.get, "cheats");
  assert.throws(() => parse(["status", "my-game", "--get", "cheats"]), (err) => err.exitCode === 64 && /Unknown option --get/.test(err.message));
  assert.throws(() => parse(["config", "g", "--get", "a", "--set", "b=1"]), (err) => err.exitCode === 64 && /cannot go together/.test(err.message));
});

test("config values: JSON when it reads as JSON, text otherwise", () => {
  assert.equal(parseValue("false"), false);
  assert.equal(parseValue("3"), 3);
  assert.equal(parseValue("null"), null);
  assert.deepEqual(parseValue('{"skip":false}'), { skip: false });
  assert.equal(parseValue("always"), "always");
  assert.deepEqual(parseAssignment("controls.showOn=a=b"), ["controls.showOn", "a=b"], "only the first = splits");
  assert.throws(() => parseAssignment("cheats"), (err) => err.exitCode === 64 && /key=value/.test(err.message));
  assert.throws(() => parseAssignment("=1"), /key=value/);
});

test("config --get: a dotted path, undefined when nothing is set", () => {
  assert.equal(getSetting(cfg, "cheats"), true);
  assert.equal(getSetting(cfg, "fastForward.maxSpeed"), 4);
  assert.equal(getSetting(cfg, "fastForward.inBattle"), undefined);
  assert.equal(getSetting(cfg, "alwaysDash.on"), undefined, "a value that is not an object has no keys");
  assert.equal(getSetting(cfg, "controls.buttons.length"), undefined, "a list by position only");
  assert.deepEqual(getSetting({ controls: { buttons: [{ key: "Tab" }] } }, "controls.buttons.0"), { key: "Tab" });
  assert.throws(() => getSetting(cfg, "a..b"), (err) => err.exitCode === 64);
  assert.throws(() => getSetting(cfg, "__proto__.x"), (err) => err.exitCode === 64);
});

test("config --set: a copy with the value, objects made on the way, null back to the default", () => {
  const next = setSetting(cfg, "fastForward.inBattle", false);
  assert.deepEqual(next.fastForward, { maxSpeed: 4, inBattle: false });
  assert.deepEqual(cfg.fastForward, { maxSpeed: 4 }, "the original is untouched");
  assert.deepEqual(setSetting(cfg, "cheats.items", false).cheats, { items: false }, "true (on, defaults) becomes an object of limits");
  assert.deepEqual(setSetting(cfg, "saveHistory.keep", 5).saveHistory, { keep: 5 });
  assert.ok(!("maxSpeed" in setSetting(cfg, "fastForward.maxSpeed", null).fastForward));
  assert.ok(!("backlog" in setSetting(cfg, "backlog.x", null)), "removing under a missing key makes nothing");
  assert.throws(() => setSetting(cfg, "alwaysDash.on", true), (err) => err.exitCode === 64 && /not an object/.test(err.message));
});

test("config --set: the keys the toolkit writes itself are refused", () => {
  assert.throws(() => setSetting(cfg, "slug", "other"), (err) => err.exitCode === 64 && /rwk rename/.test(err.hint));
  for (const key of ["fingerprint", "storageId", "policy.hosting", "liveSettings", "toolkitVersion"]) {
    assert.throws(() => setSetting(cfg, key, 1), /written by the toolkit/, key);
  }
});

test("config --get: the value alone on stdout, and a summary that reads it back", () => {
  let out = "";
  const write = { out: (text) => (out += text), err: () => {}, env: {} };
  const read = runResult("config", { site: "my-game", url: null, key: "controls.showOn", value: "touch", facts: [["controls.showOn", '"touch"']] }, []);
  publishResult(read, { tty: true, ...write });
  assert.equal(out, "touch\n", "text without quotes, even in a terminal");
  out = "";
  publishResult({ ...read, key: "fastForward", value: { maxSpeed: 3 } }, { tty: false, ...write });
  assert.equal(out, '{"maxSpeed":3}\n');
  out = "";
  publishResult({ ...read, value: null }, { tty: false, ...write });
  assert.equal(out, "null\n");
  out = "";
  publishResult(read, { json: true, ...write });
  assert.equal(JSON.parse(out).value, "touch");
  assert.match(renderSummary(read), /my-game: setting read/);
});
