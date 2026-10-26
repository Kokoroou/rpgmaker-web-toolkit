import test from "node:test";
import assert from "node:assert/strict";
import { guidedEdit } from "../cli/lib/config-wizard.js";

// Scripted answers, in the order the questions come. A choose answer is the
// label's start (the menu entry), an ask / confirm answer is the value.
function scripted(answers) {
  const queue = [...answers];
  const next = (text) => {
    assert.ok(queue.length, `unexpected question: ${text}`);
    return queue.shift();
  };
  return {
    queue,
    async ask(text, def, validate) {
      const answer = next(text);
      const value = answer === "" ? def : answer;
      assert.equal(validate ? validate(value) : null, null, `"${value}" rejected for: ${text}`);
      return value;
    },
    async confirm(text) {
      return next(text);
    },
    async choose(text, options) {
      const want = next(text);
      const found = options.find((o) => (typeof o.value === "string" ? o.value : o.value?.key ?? o.value) === want || o.label.startsWith(want));
      assert.ok(found, `no option "${want}" in: ${options.map((o) => o.label).join(" | ")}`);
      return found.value;
    },
  };
}

const base = () => ({ slug: "g", fingerprint: "mz:x", preset: "comfortable", sync: { enabled: true }, include: [], exclude: [], auth: { mode: "access" } });

test("a feature turned off, and the config's other keys are left alone", async () => {
  const io = scripted(["features", "fastForward", false, "back", "save"]);
  const out = await guidedEdit(base(), { io });
  assert.equal(out.fastForward, false);
  assert.equal(out.slug, "g");
  assert.deepEqual(io.queue, []);
});

test("limits are written only when they differ from the defaults", async () => {
  const io = scripted(["features", "fastForward", true, true, "3", true, "back", "save"]);
  const out = await guidedEdit(base(), { io });
  assert.deepEqual(out.fastForward, { maxSpeed: 3 });
});

test("fields the questions do not know (lock, speed) survive", async () => {
  const cfg = { ...base(), fastForward: { speed: 2, lock: true } };
  const out = await guidedEdit(cfg, { io: scripted(["features", "fastForward", true, true, "3", true, "back", "save"]) });
  assert.deepEqual(out.fastForward, { speed: 2, lock: true, maxSpeed: 3 });
});

test("an answer equal to the default is still written when the preset sets that field", async () => {
  const cfg = { ...base(), preset: "original" };
  const out = await guidedEdit(cfg, { io: scripted(["features", "fastForward", true, true, "4", true, "back", "save"]) });
  assert.deepEqual(out.fastForward, { inBattle: true });
});

test("turning a feature back on removes the false", async () => {
  const cfg = { ...base(), itemBatch: false };
  const out = await guidedEdit(cfg, { io: scripted(["features", "itemBatch", true, "back", "save"]) });
  assert.equal("itemBatch" in out, false);
});

test("cheats are off by default and `true` turns them on", async () => {
  const out = await guidedEdit(base(), { io: scripted(["features", "cheats", true, false, "back", "save"]) });
  assert.equal(out.cheats, true);
});

test("backlog takes a number", async () => {
  const out = await guidedEdit(base(), { io: scripted(["features", "backlog", true, true, "200", "back", "save"]) });
  assert.equal(out.backlog, 200);
});

test("the starting point changes the preset", async () => {
  const out = await guidedEdit(base(), { io: scripted(["features", "preset", "shared", "back", "save"]) });
  assert.equal(out.preset, "shared");
});

test("on-screen buttons: turn on, add a key button", async () => {
  const io = scripted(["controls", "enabled", true, "buttons", "add", "Tab", "Map", "Open the map", "back", "back", "save"]);
  const out = await guidedEdit(base(), { io });
  assert.equal(out.controls.enabled, true);
  assert.deepEqual(out.controls.buttons, [{ key: "Tab", label: "Map", hint: "Open the map" }]);
});

test("L / R buttons are off by default and can be turned on", async () => {
  const off = await guidedEdit(base(), { io: scripted(["controls", "back", "save"]) });
  assert.notEqual(off.controls?.shoulder, true);
  const on = await guidedEdit(base(), { io: scripted(["controls", "shoulder", true, "back", "save"]) });
  assert.equal(on.controls.shoulder, true);
});

test("exclude patterns are added and removed", async () => {
  const added = await guidedEdit(base(), { io: scripted(["files", "exclude", "add", "data-tw/**", "back", "back", "save"]) });
  assert.deepEqual(added.exclude, ["data-tw/**"]);
  const removed = await guidedEdit(added, { io: scripted(["files", "exclude", "data-tw", "back", "back", "save"]) });
  assert.deepEqual(removed.exclude, []);
});

test("cloud sync and cache", async () => {
  const out = await guidedEdit(base(), { io: scripted(["sync", false, "cache", false, "save"]) });
  assert.deepEqual(out.sync, { enabled: false });
  assert.equal(out.cache, false);
});

test("search engines are only asked about on a public site", async () => {
  await assert.rejects(guidedEdit(base(), { io: scripted(["indexable"]) }), /no option "indexable"/);
  const pub = { ...base(), auth: { mode: "none" } };
  assert.equal((await guidedEdit(pub, { io: scripted(["indexable", true, "save"]) })).indexable, true);
});

test("quit without saving returns null, after asking when there are changes", async () => {
  assert.equal(await guidedEdit(base(), { io: scripted(["quit"]) }), null);
  const io = scripted(["sync", false, "quit", false, "quit", true]);
  assert.equal(await guidedEdit(base(), { io }), null);
  assert.deepEqual(io.queue, []);
});

test("the JSON editor is one entry away and its result is kept", async () => {
  const editJson = async (cfg) => ({ ...cfg, extra: 1 });
  const out = await guidedEdit(base(), { io: scripted(["json", "save"]), editJson });
  assert.equal(out.extra, 1);
});

test("the source config is never modified", async () => {
  const cfg = base();
  const before = JSON.stringify(cfg);
  await guidedEdit(cfg, { io: scripted(["features", "fastForward", false, "back", "save"]) });
  assert.equal(JSON.stringify(cfg), before);
});

test("guidedEdit asks every question with clear: true so answered menus are erased", async () => {
  const seen = [];
  const io = {
    ask: async () => "",
    confirm: async (_t, d, o) => (seen.push(o), d),
    choose: async (_t, options, _d, o) => (seen.push(o), options.find((x) => x.value === "quit").value),
  };
  await guidedEdit({}, { io });
  assert.ok(seen.length > 0 && seen.every((o) => o && o.clear === true));
});
