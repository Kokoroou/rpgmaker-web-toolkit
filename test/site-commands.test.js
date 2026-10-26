// Commands that work from a deployed site's link or name: status, saves export, logs, open, list, delete.

import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { COMMANDS, commandHelp, parseCommandLine } from "../cli/lib/args.js";
import { exportSaves, saveObjects, toSaveFile } from "../cli/commands/saves-export.js";
import { deleteSite, describeSite, list, logs, open, status } from "../cli/commands/site.js";
import { userHash as userHashOf } from "../cli/lib/cloudflare.js";
import { getObject, listObjects } from "../cli/lib/r2-api.js";
import { renderSummary, runResult } from "../cli/lib/report.js";

const parse = (args) => parseCommandLine(args, { stdinIsTTY: true });

test("args: the new commands and their options", () => {
  for (const name of ["status", "logs", "open", "list", "delete"]) assert.ok(COMMANDS.some((c) => c.name === name), name);
  const exported = parse(["saves", "export", "my-game", "--email", "a@b.c", "--out", "./backup"]);
  assert.deepEqual([exported.spec.name, exported.target, exported.flags.email, exported.flags.out], ["saves export", "my-game", "a@b.c", "./backup"]);
  assert.match(commandHelp(exported.spec), /\[--email <address>\] \[--out <folder>\]/);
  assert.equal(parse(["list"]).spec.targets.length, 0);
  assert.throws(() => parse(["status", "my-game", "--email", "x@y.z"]), (err) => err.exitCode === 64 && /Unknown option --email/.test(err.message));
  assert.throws(() => parse(["rename", "g", "--out", "x"]), (err) => err.exitCode === 64);
});

test("saves export: only the player's save files, written as the desktop engine does", () => {
  const prefix = "saves/abc/my-game/";
  const items = [
    { key: `${prefix}file1`, size: 10 },
    { key: `${prefix}global`, size: 4 },
    { key: `${prefix}nested/file2`, size: 1 },
    { key: "saves/other/my-game/file1", size: 1 },
  ];
  assert.deepEqual(saveObjects(items, prefix).map((o) => o.name), ["file1", "global"]);
  // The cloud blob is one byte per char; the desktop file holds those chars as UTF-8.
  assert.deepEqual([...toSaveFile(Buffer.from([0x41, 0xe9, 0xff]))], [...Buffer.from("Aéÿ", "utf8")]);
});

test("r2 api: pages through a listing and reads an object", async () => {
  const calls = [];
  const pages = [
    { success: true, result: [{ key: "a", size: 1 }], result_info: { is_truncated: true, cursor: "next" } },
    { success: true, result: [{ key: "b", size: 2 }], result_info: { is_truncated: false } },
  ];
  const fetchImpl = async (url, init) => {
    calls.push([url, init.headers.authorization]);
    return Response.json(pages.shift());
  };
  const items = await listObjects({ token: "t", accountId: "acc", bucket: "rwk", prefix: "saves/x/", fetchImpl });
  assert.deepEqual(items.map((i) => i.key), ["a", "b"]);
  assert.match(calls[0][0], /\/accounts\/acc\/r2\/buckets\/rwk\/objects\?prefix=saves%2Fx%2F&per_page=1000$/);
  assert.match(calls[1][0], /cursor=next/);
  assert.equal(calls[0][1], "Bearer t");

  const blob = await getObject({ token: "t", accountId: "acc", bucket: "rwk", key: "saves/x/file1", fetchImpl: async (url) => (assert.match(url, /objects\/saves%2Fx%2Ffile1$/), new Response("data")) });
  assert.equal(blob.toString(), "data");
  assert.equal(await getObject({ token: "t", accountId: "a", bucket: "b", key: "k", fetchImpl: async () => new Response("", { status: 404 }) }), null);
  await assert.rejects(
    listObjects({ token: "t", accountId: "a", bucket: "b", prefix: "p", fetchImpl: async () => Response.json({ success: false, errors: [{ message: "denied" }] }, { status: 403 }) }),
    /denied.*Workers R2 Storage → Read/
  );
});

test("status: what the site is, and a warning when Access is not in front", async () => {
  const cfg = { title: "Game", engine: "MZ", slug: "my-game", url: "https://my-game.a.workers.dev", auth: { mode: "access" }, sync: { enabled: true } };
  const players = async () => ({ h1: 1, h2: 2 });

  const protectedSite = await describeSite(cfg, { probe: async () => ({ protected: true }), players });
  assert.equal(protectedSite.up, true);
  const text = (r) => r.facts.map(([k, v]) => `${k}: ${v}`).join("\n");
  assert.match(text(protectedSite), /Site: up, behind Cloudflare Access/);
  assert.match(text(protectedSite), /Players: 2 email\(s\)/);

  const open = await describeSite(cfg, { probe: async () => ({ protected: false, status: 200 }), players });
  assert.match(text(open), /NOT protecting/);

  const down = await describeSite(cfg, { probe: async () => ({ protected: false, error: "ENOTFOUND" }), players: async () => Promise.reject(new Error("r2")) });
  assert.equal(down.up, false);
  assert.match(text(down), /not reachable: ENOTFOUND/);
  assert.doesNotMatch(text(down), /Players/);
});

test("report: facts become rows of the closing summary", () => {
  const result = runResult("status", { site: "my-game", url: "https://my-game.a.workers.dev", facts: [["Players", "2 email(s)"]] }, []);
  const out = renderSummary(result);
  assert.match(out, /my-game: status/);
  assert.match(out, /Players\s+2 email\(s\)/);
});

// The commands with the Cloudflare and terminal steps replaced.
const CFG = { title: "Game", engine: "MZ", slug: "my-game", url: "https://my-game.a.workers.dev", auth: { mode: "access" }, sync: { enabled: true } };
const quiet = (t) => {
  t.mock.method(console, "log", () => {});
  t.mock.method(process.stderr, "write", () => true);
};
const baseDeps = (configs = { fp1: { ...CFG } }) => ({
  connect: async () => ({ email: "me@x.y", account: { id: "acc" } }),
  loadSettings: () => ({}),
  loadGameConfigs: async () => structuredClone(configs),
  ask: async () => "",
});

test("status, list and open: work from a name, with no folder", async (t) => {
  quiet(t);
  const deps = { ...baseDeps(), probe: async () => ({ protected: true }), players: async () => ({ h: 1 }) };
  const result = await status("my-game", deps);
  assert.deepEqual([result.title, result.up], ["Game", true]);
  assert.ok(result.facts.some(([k]) => k === "Players"));

  const listed = await list(deps);
  assert.deepEqual(listed.sites.map((s) => s.site), ["my-game"]);
  assert.equal((await list({ ...deps, loadGameConfigs: async () => ({}) })).sites.length, 0);

  const spawned = [];
  const child = { on: () => child, unref: () => {} };
  await open("my-game", { ...deps, spawn: (cmd, args) => (spawned.push([cmd, args]), child) });
  assert.equal(spawned.length, 1);
  assert.ok(spawned[0][1].some((a) => a.includes("my-game.a.workers.dev")) || spawned[0][0].includes("my-game"));

  const noLink = { ...deps, loadGameConfigs: async () => ({ fp1: { ...CFG, url: undefined } }) };
  await assert.rejects(open("my-game", noLink), /No link is recorded/);
  await assert.rejects(status("./some/folder", deps), { exitCode: 64 });
  await assert.rejects(status("other-game", deps), /No game in this Cloudflare account/);
  assert.equal((await status("", { ...deps, ask: async () => "my-game" })).title, "Game");
});

test("delete: needs the site name typed, then removes the Worker and the config", async (t) => {
  quiet(t);
  const deleted = [];
  let saved = null;
  const configs = { fp1: { ...CFG, retiredWorkers: ["old-name"] }, fp2: { ...CFG, slug: "other" } };
  const deps = {
    ...baseDeps(configs),
    deleteWorker: async (name) => (deleted.push(name), name !== "old-name"),
    saveGameConfigs: async (bucket, value) => {
      saved = value;
    },
  };
  const result = await deleteSite("my-game", deps);
  assert.deepEqual(deleted, ["my-game", "old-name"]);
  assert.deepEqual(Object.keys(saved), ["fp2"]);
  assert.equal(result.url, null);

  deleted.length = 0;
  await assert.rejects(deleteSite("my-game", { ...deps, deleteWorker: async () => false }), /Could not delete the Worker/);
});

test("logs: needs a terminal", async (t) => {
  quiet(t);
  const tty = process.stdin.isTTY;
  t.after(() => {
    process.stdin.isTTY = tty;
  });
  process.stdin.isTTY = false;
  await assert.rejects(logs("my-game", baseDeps()), /Ctrl\+C/);
});

test("saves export: lists, downloads and writes the player's saves", async (t) => {
  quiet(t);
  const out = fs.mkdtempSync(path.join(os.tmpdir(), "rwk-export-"));
  t.after(() => fs.rmSync(out, { recursive: true, force: true }));
  const listed = [];
  const deps = {
    connect: async () => ({ email: "me@x.y", account: { id: "acc" } }),
    loadSettings: () => ({}),
    findSite: async () => ({ ...CFG }),
    ask: async () => "Player@X.y",
    apiToken: async () => "tok",
    listObjects: async ({ prefix }) => (listed.push(prefix), [{ key: `${prefix}file1`, size: 3 }, { key: `${prefix}global`, size: 1 }, { key: `${prefix}x/y`, size: 1 }]),
    getObject: async ({ key }) => (key.endsWith("global") ? null : Buffer.from("abc")),
  };
  const result = await exportSaves("my-game", { out }, deps);
  assert.match(listed[0], /^saves\/[0-9a-f]{32}\/my-game\/$/);
  assert.deepEqual(fs.readdirSync(out), ["file1.rmmzsave"]);
  assert.equal(fs.readFileSync(path.join(out, "file1.rmmzsave"), "utf8"), "abc");
  assert.equal(result.facts[0][1].startsWith("2 "), true);

  // A public site keeps saves under "public"; MV uses .rpgsave.
  const mv = path.join(out, "mv");
  await exportSaves("my-game", { out: mv }, { ...deps, findSite: async () => ({ ...CFG, engine: "MV", auth: { mode: "none" } }) });
  assert.match(listed[1], new RegExp(userHashOf("public")));
  assert.ok(fs.existsSync(path.join(mv, "file1.rpgsave")));

  await assert.rejects(exportSaves("my-game", { out }, { ...deps, findSite: async () => ({ ...CFG, sync: { enabled: false } }) }), /sync is off/);
  await assert.rejects(exportSaves("my-game", { out }, { ...deps, apiToken: async () => null }), /Not logged in/);
  await assert.rejects(exportSaves("my-game", { out }, { ...deps, listObjects: async () => [] }), /No cloud saves/);
  assert.equal((await exportSaves("", { out: mv, email: "a@b.c" }, { ...deps, ask: async () => "my-game" })).facts.length, 2);
});
