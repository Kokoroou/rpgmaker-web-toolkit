// RWK_SaveSync.js runs in the browser; load it in a VM to check "this device only".
import assert from "node:assert/strict";
import fs from "node:fs";
import test from "node:test";
import vm from "node:vm";

const source = fs.readFileSync(new URL("../runtime/RWK_SaveSync.js", import.meta.url), "utf8");

function load(initial = {}) {
  const store = { ...initial };
  const fetched = [];
  let onSave;
  const RWK = {
    engine: "MZ",
    config: { gameId: "g", sync: { enabled: true } },
    deviceId: "d",
    toast() {},
    storage: {
      get: (k, f) => (k in store ? store[k] : f),
      set: (k, v) => (store[k] = v),
    },
  };
  const context = {
    window: { RWK, addEventListener() {} },
    document: { addEventListener() {} },
    navigator: { onLine: true },
    console,
    setTimeout,
    clearTimeout,
    fetch: async (...a) => (fetched.push(a), { status: 500, ok: false, headers: new Map() }),
    StorageManager: { isLocalMode: () => false, forageKey: (n) => n },
    Scene_Boot: { prototype: { isReady() {} } },
    localforage: {},
  };
  // capture the engine hook the plugin installs
  context.StorageManager.saveZip = () => {};
  context.StorageManager.remove = () => {};
  vm.runInNewContext(source, context);
  return { sync: RWK.saveSync, store, fetched };
}

test("local-only is remembered and reported in status", () => {
  const { sync, store } = load();
  assert.equal(sync.isLocalOnly(), false);
  sync.setLocalOnly(true);
  assert.equal(sync.isLocalOnly(), true);
  assert.equal(store["rwk.localOnly.g"], true);
  assert.equal(sync.status().state, "local");
  assert.equal(load(store).sync.isLocalOnly(), true);
});

test("local-only never touches the network", async () => {
  const { sync, fetched } = load({ "rwk.localOnly.g": true });
  sync.saved("file1");
  await sync.syncNow();
  await sync.flush();
  assert.equal(fetched.length, 0);
});
