// Commands that work from a deployed site's link or name: status, saves export, logs, open, list, delete.

import assert from "node:assert/strict";
import test from "node:test";
import { COMMANDS, commandHelp, parseCommandLine } from "../cli/lib/args.js";
import { saveObjects, toSaveFile } from "../cli/commands/saves-export.js";
import { describeSite } from "../cli/commands/site.js";
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
