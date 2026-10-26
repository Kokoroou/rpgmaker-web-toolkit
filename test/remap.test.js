// RWK_Remap.js runs in the browser; load it in a VM with the few engine
// globals it touches to test the key maps (no DOM needed before the panel opens).

import assert from "node:assert/strict";
import fs from "node:fs";
import test from "node:test";
import vm from "node:vm";

const source = fs.readFileSync(new URL("../runtime/RWK_Remap.js", import.meta.url), "utf8");

// The engine's own defaults (rpg_core.js / rmmz_core.js).
const keyMapper = () => ({ 9: "tab", 13: "ok", 16: "shift", 27: "escape", 32: "ok", 33: "pageup", 34: "pagedown", 37: "left", 38: "up", 39: "right", 40: "down", 81: "pageup", 87: "pagedown", 88: "escape", 90: "ok" });
const gamepadMapper = () => ({ 0: "ok", 1: "cancel", 2: "shift", 3: "menu", 4: "pageup", 5: "pagedown", 12: "up", 13: "down", 14: "left", 15: "right" });

function load({ remap = { keyboard: true, gamepad: true }, stored = {}, input = {} } = {}) {
  const added = [];
  const store = { ...stored };
  const Input = { keyMapper: keyMapper(), gamepadMapper: gamepadMapper(), cleared: 0, clear() { this.cleared++; }, ...input };
  const window = {
    RWK: {
      config: { remap, gameId: "g" },
      storage: { get: (k, f = null) => (k in store ? store[k] : f), set: (k, v) => (store[k] = JSON.parse(JSON.stringify(v))) },
      tools: { add: (t) => added.push(t) },
      icons: { keys: "<svg/>" },
    },
    addEventListener() {},
  };
  vm.runInNewContext(source, { window, console, Input });
  return { RWK: window.RWK, Input, added, store };
}

test("remap: nothing chosen leaves the game's maps as they were", () => {
  const { Input, added } = load();
  assert.deepEqual({ ...Input.keyMapper }, keyMapper());
  assert.deepEqual({ ...Input.gamepadMapper }, gamepadMapper());
  assert.equal(added.length, 1);
  assert.equal(added[0].label, "Keys and buttons");
});

test("remap: stored choices replace every key of an action", () => {
  const { Input } = load({ stored: { "rwk.remap.g": { key: { ok: 70 }, pad: { ok: 2, shift: 0 } } } });
  assert.deepEqual(Object.keys(Input.keyMapper).filter((c) => Input.keyMapper[c] === "ok"), ["70"], "Enter, Space and Z are gone");
  assert.equal(Input.keyMapper[13], undefined);
  assert.equal(Input.keyMapper[27], "escape", "other actions are kept");
  assert.equal(Input.gamepadMapper[2], "ok");
  assert.equal(Input.gamepadMapper[0], "shift");
  assert.equal(Input.gamepadMapper[12], "up", "the d-pad is untouched");
});

test("remap: a key goes to one action; the one that held it loses it", () => {
  const { RWK } = load();
  const o = RWK.remap.assign({ ok: 70 }, "shift", 70);
  assert.deepEqual({ ...o }, { ok: null, shift: 70 });
  assert.deepEqual(RWK.remap.buildMap(keyMapper(), o)[70], "shift");
  const map = RWK.remap.buildMap(keyMapper(), o);
  assert.equal(Object.values(map).includes("ok"), false, "an action without a key");
  assert.equal(RWK.remap.buildMap(keyMapper(), { shift: 90 })[90], "shift", "taking a key another action had by default");
});

test("remap: reserved keys, and junk in storage", () => {
  const { RWK, Input } = load({ stored: { "rwk.remap.g": { key: { ok: "x", nope: 5, shift: 999, pageup: null }, pad: "bad" } } });
  assert.equal(RWK.remap.isReserved("key", 37, keyMapper()), true, "arrows");
  assert.equal(RWK.remap.isReserved("key", 112, keyMapper()), true, "F1");
  assert.equal(RWK.remap.isReserved("pad", 12, gamepadMapper()), true, "d-pad");
  assert.equal(RWK.remap.isReserved("key", 70, keyMapper()), false);
  assert.deepEqual(JSON.parse(JSON.stringify(RWK.remap.overrides())), { key: { pageup: null }, pad: {} });
  assert.equal(Input.keyMapper[13], "ok");
  assert.equal(Object.values(Input.keyMapper).includes("pageup"), false);
});

test("remap: the deployer can limit it to one device, or turn it off", () => {
  const stored = { "rwk.remap.g": { key: { ok: 70 }, pad: { ok: 2 } } };
  const keyboardOnly = load({ remap: { keyboard: true, gamepad: false }, stored });
  assert.equal(keyboardOnly.Input.keyMapper[70], "ok");
  assert.deepEqual(keyboardOnly.Input.gamepadMapper, gamepadMapper());
  assert.deepEqual(Object.keys(keyboardOnly.RWK.remap.overrides()), ["key"]);
  const off = load({ remap: false, stored });
  assert.deepEqual(off.Input.keyMapper, keyMapper());
  assert.equal(off.added.length, 0);
  const none = load({ remap: { keyboard: false, gamepad: false }, stored });
  assert.equal(none.added.length, 0);
});

test("remap: names for keys and buttons", () => {
  const { RWK } = load();
  assert.equal(RWK.remap.label("key", 90), "Z");
  assert.equal(RWK.remap.label("key", 32), "Space");
  assert.equal(RWK.remap.label("key", 104), "Numpad 8");
  assert.equal(RWK.remap.label("key", 113), "F2");
  assert.equal(RWK.remap.label("pad", 0), "Button 0 (A)");
  assert.equal(RWK.remap.label("pad", 14), "Button 14");
});
