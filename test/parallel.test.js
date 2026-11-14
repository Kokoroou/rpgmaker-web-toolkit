// Deploys running at once in different shells: the lock between them and the one file
// (games.json) they all write to.

import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { test } from "node:test";
import { putGameConfig, updateGameConfigs } from "../cli/lib/cloudflare.js";
import { pidAlive, withLock } from "../cli/lib/lock.js";

const tmp = (t) => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "rwk-par-"));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  return dir;
};
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

//---------------------------------------------------------------------------
// The lock
//---------------------------------------------------------------------------

test("withLock: one holder at a time", async (t) => {
  const file = path.join(tmp(t), "x.lock");
  let inside = 0;
  let worst = 0;
  const order = [];
  await Promise.all(
    [1, 2, 3, 4].map((n) =>
      withLock(file, async () => {
        worst = Math.max(worst, ++inside);
        await sleep(15);
        order.push(n);
        inside--;
      }, { pollMs: 2 })
    )
  );
  assert.equal(worst, 1);
  assert.equal(order.length, 4);
  assert.equal(fs.existsSync(file), false, "released");
});

test("withLock: released after an error, and a lock of a dead process is taken over", async (t) => {
  const file = path.join(tmp(t), "x.lock");
  await assert.rejects(withLock(file, async () => { throw new Error("boom"); }), /boom/);
  assert.equal(fs.existsSync(file), false);

  fs.writeFileSync(file, "2147483646"); // no such process
  assert.equal(pidAlive(2147483646), false);
  assert.equal(await withLock(file, async () => "got it", { pollMs: 2 }), "got it");
});

test("withLock: a live holder is waited for, and the wait ends with a message", async (t) => {
  const file = path.join(tmp(t), "x.lock");
  fs.writeFileSync(file, String(process.pid)); // alive, and not stale
  await assert.rejects(withLock(file, async () => {}, { timeoutMs: 60, pollMs: 5 }), /holds .*x\.lock/);
});

//---------------------------------------------------------------------------
// games.json: two deploys must not lose each other's game
//---------------------------------------------------------------------------

function fakeR2() {
  const store = { json: "{}" };
  return {
    store,
    load: async () => {
      await sleep(5); // a real read takes time: this is where deploys used to overlap
      return JSON.parse(store.json);
    },
    save: async (bucket, configs) => {
      await sleep(5);
      store.json = JSON.stringify(configs);
    },
  };
}

test("updateGameConfigs: parallel writers each keep their game", async (t) => {
  const r2 = fakeR2();
  const lockFile = path.join(tmp(t), "games.lock");
  const games = Array.from({ length: 6 }, (_, i) => i);
  await Promise.all(games.map((i) => putGameConfig("b", `fp${i}`, { slug: `game-${i}` }, { lockFile, load: r2.load, save: r2.save })));
  assert.deepEqual(Object.keys(JSON.parse(r2.store.json)).sort(), games.map((i) => `fp${i}`));
});

test("updateGameConfigs: without the lock the same writers do lose games (what the lock is for)", async () => {
  const r2 = fakeR2();
  await Promise.all([0, 1, 2].map(async (i) => {
    const configs = await r2.load();
    configs[`fp${i}`] = { slug: `g${i}` };
    await r2.save("b", configs);
  }));
  assert.ok(Object.keys(JSON.parse(r2.store.json)).length < 3);
});

test("putGameConfig: a site name another game just took stops the deploy", async (t) => {
  const r2 = fakeR2();
  const opts = { lockFile: path.join(tmp(t), "games.lock"), load: r2.load, save: r2.save };
  await putGameConfig("b", "fpA", { slug: "game" }, opts);
  await assert.rejects(putGameConfig("b", "fpB", { slug: "game" }, opts), (err) => /just taken/.test(err.message) && /--name/.test(err.hint));
  assert.deepEqual(Object.keys(JSON.parse(r2.store.json)), ["fpA"]);
  await putGameConfig("b", "fpA", { slug: "game", url: "https://x" }, opts); // its own name, changed later
  assert.equal(JSON.parse(r2.store.json).fpA.url, "https://x");
  await updateGameConfigs("b", (configs) => delete configs.fpA, opts);
  assert.deepEqual(JSON.parse(r2.store.json), {});
});
