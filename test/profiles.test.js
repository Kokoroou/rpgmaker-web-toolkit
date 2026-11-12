// Login profiles (cli/lib/config.js, cli/commands/login.js): one Cloudflare login each,
// so a game can be managed under another email than the first login's.

import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { commandHelp, COMMANDS, generalHelp, parseCommandLine } from "../cli/lib/args.js";
import { runChecks } from "../cli/commands/doctor.js";
import { login, logout, profiles, useProfile } from "../cli/commands/login.js";
import { ensureLogin, pickAccount } from "../cli/lib/cloudflare.js";
import { activeProfile, loadSettings, loadState, normalizeState, saveSettings, setProfileFlag, validateProfileName, wranglerProfileOf } from "../cli/lib/config.js";
import { NeedsAnswer, setQuiet, setUnattended } from "../cli/lib/ui.js";

const parse = (args) => parseCommandLine(args, { stdinIsTTY: true });
const tmpFile = (t) => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "rwk-profiles-"));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  return path.join(dir, "settings.json");
};
// A settings.json in memory, for the commands' loadState / saveState.
const memoryState = (initial) => {
  let state = normalizeState(initial);
  return {
    loadState: () => structuredClone(state),
    saveState: (next) => {
      state = structuredClone(next);
    },
    get: () => state,
  };
};
const quietly = (t) => {
  setQuiet(true);
  t.after(() => {
    setQuiet(false);
    setProfileFlag(null);
  });
};

test("profile names: lowercase like a site name; the default one keeps the wrangler profile it had", () => {
  assert.equal(validateProfileName("work"), null);
  assert.equal(validateProfileName("team-2"), null);
  for (const bad of ["Work", "-x", "x-", "a_b", "", "a".repeat(33)]) assert.ok(validateProfileName(bad), bad);
  assert.equal(wranglerProfileOf("default"), "rpgmaker-web-toolkit");
  assert.equal(wranglerProfileOf("work"), "rpgmaker-web-toolkit-work");
});

test("settings.json: the file from before profiles is the default profile's", () => {
  assert.deepEqual(normalizeState(null), { profile: "default", profiles: {} });
  assert.deepEqual(normalizeState({ accountId: "a1" }), { profile: "default", profiles: { default: { accountId: "a1" } } });
  const state = normalizeState({ profile: "work", profiles: { work: { accountId: "a2" }, "Bad Name": {}, gone: null } });
  assert.deepEqual(state, { profile: "work", profiles: { work: { accountId: "a2" } } });
  assert.equal(normalizeState({ profile: "nope", profiles: {} }).profile, "default", "a current profile that is not there falls back");
});

test("activeProfile: --profile, else the saved choice, else default", (t) => {
  t.after(() => setProfileFlag(null));
  const state = normalizeState({ profile: "work", profiles: { work: {} } });
  assert.deepEqual(activeProfile({ flag: "home", state }), { name: "home", from: "--profile" });
  assert.deepEqual(activeProfile({ flag: null, state }), { name: "work", from: "saved" });
  assert.deepEqual(activeProfile({ flag: null, state: normalizeState(null) }), { name: "default", from: "default" });
  setProfileFlag("home");
  assert.equal(activeProfile().name, "home");
});

test("loadSettings / saveSettings: each profile keeps its own account", (t) => {
  const file = tmpFile(t);
  fs.writeFileSync(file, JSON.stringify({ accountId: "old" }));
  assert.deepEqual(loadSettings("default", file), { accountId: "old" });
  saveSettings({ accountId: "a2", email: "b@example.com" }, "work", file);
  saveSettings({ accountName: "Alice" }, "default", file);
  assert.deepEqual(loadSettings("default", file), { accountId: "old", accountName: "Alice" });
  assert.deepEqual(loadSettings("work", file), { accountId: "a2", email: "b@example.com" });
  assert.deepEqual(loadSettings("none", file), {});
  assert.equal(loadState(file).profile, "default", "saving settings does not switch profiles");
});

test("--profile: a global flag, checked, in the help; the new commands are listed", () => {
  assert.equal(parse(["deploy", "g", "--profile", "work"]).flags.profile, "work");
  assert.equal(parse(["--profile", "work", "list"]).flags.profile, "work");
  assert.throws(() => parse(["list", "--profile", "Work!"]), (err) => err.exitCode === 64 && /Bad profile name/.test(err.message));
  assert.match(generalHelp(), /--profile\s+The login profile/);
  for (const name of ["login", "logout", "whoami", "profiles", "profiles use"]) assert.ok(COMMANDS.some((cmd) => cmd.name === name), name);
  const use = parse(["profiles", "use", "work"]);
  assert.equal(use.spec.name, "profiles use");
  assert.equal(use.target, "work");
  assert.equal(parse(["profiles"]).spec.name, "profiles");
  assert.match(commandHelp(COMMANDS.find((cmd) => cmd.name === "profiles use")), /rwk profiles use <profile>/);
});

test("ensureLogin: a profile never made is an error, not a browser login", async (t) => {
  quietly(t);
  const out = { loggedIn: false };
  await assert.rejects(
    ensureLogin({}, { profile: { name: "wrok", from: "--profile" }, known: false, readLogin: async () => out }),
    (err) => /No login profile "wrok"/.test(err.message) && /rwk login --profile wrok/.test(err.hint)
  );
  setUnattended(true);
  t.after(() => setUnattended(false));
  // The default profile, and one made before, go on to the usual login (here: unattended, so a question).
  await assert.rejects(ensureLogin({}, { profile: { name: "default", from: "default" }, known: false, readLogin: async () => out }), NeedsAnswer);
  await assert.rejects(ensureLogin({}, { profile: { name: "work", from: "saved" }, known: true, readLogin: async () => out }), NeedsAnswer);
});

test("--account for an account this login does not reach: the hint points to another profile", async () => {
  const accounts = [{ id: "a1", name: "Alice" }];
  await assert.rejects(pickAccount(accounts, {}, { value: "Bob", from: "--account" }), (err) => /rwk login --profile/.test(err.hint));
});

test("login: logs in to the profile, chooses its account, and makes it current", async (t) => {
  quietly(t);
  setProfileFlag("work");
  const mem = memoryState({ accountId: "a1" });
  const calls = [];
  const deps = {
    ...mem,
    logIn: async (name) => {
      calls.push(name);
      return { loggedIn: true, email: "bob@example.com", accounts: [{ id: "b1", name: "Bob" }] };
    },
    confirm: async () => assert.fail("a new profile is not asked about"),
  };
  const result = await login(deps);
  assert.deepEqual(calls, ["work"]);
  assert.equal(mem.get().profile, "work");
  assert.deepEqual(mem.get().profiles.work, { accountId: "b1", accountName: "Bob", email: "bob@example.com" });
  assert.deepEqual(mem.get().profiles.default, { accountId: "a1" }, "the other profile stays");
  assert.equal(result.profile, "work");

  // Again, declined: nothing changes.
  const asked = await login({ ...deps, confirm: async () => false, logIn: async () => assert.fail("declined") });
  assert.equal(asked.email, "bob@example.com");

  setUnattended(true);
  t.after(() => setUnattended(false));
  await assert.rejects(login(deps), NeedsAnswer);
});

test("login again as another email: the old account choice is dropped", async (t) => {
  quietly(t);
  setProfileFlag("default");
  const mem = memoryState({ profiles: { default: { accountId: "a1", email: "alice@example.com" } } });
  const accounts = [
    { id: "c1", name: "Carol" },
    { id: "c2", name: "Team" },
  ];
  let settingsSeen;
  await login({
    ...mem,
    confirm: async () => true,
    logIn: async () => ({ loggedIn: true, email: "carol@example.com", accounts }),
    pickAccount: async (list, settings) => {
      settingsSeen = settings;
      return list[1];
    },
  });
  assert.deepEqual(settingsSeen, {});
  assert.equal(mem.get().profiles.default.email, "carol@example.com");
  assert.equal(mem.get().profiles.default.accountId, "c2");
});

test("logout: forgets the profile; the current one goes back to default", async (t) => {
  quietly(t);
  setProfileFlag("work");
  const mem = memoryState({ profile: "work", profiles: { default: { accountId: "a1" }, work: { accountId: "b1", email: "bob@example.com" } } });
  const removed = [];
  await logout({ ...mem, logOut: async (name) => removed.push(name) > 0 });
  assert.deepEqual(removed, ["work"]);
  assert.deepEqual(Object.keys(mem.get().profiles), ["default"]);
  assert.equal(mem.get().profile, "default");

  setProfileFlag("ghost");
  await assert.rejects(logout({ ...mem, logOut: async () => false }), /No login profile "ghost"/);
});

test("profiles and profiles use", async (t) => {
  quietly(t);
  const mem = memoryState({ profile: "work", profiles: { work: { email: "bob@example.com", accountId: "b1", accountName: "Bob" }, default: { accountId: "a1" } } });
  const list = await profiles(mem);
  assert.equal(list.profile, "work");
  assert.deepEqual(
    list.profiles.map((p) => [p.name, p.current, p.email]),
    [
      ["default", false, null],
      ["work", true, "bob@example.com"],
    ]
  );
  assert.deepEqual((await profiles(memoryState(null))).profiles.map((p) => p.name), ["default"], "a fresh PC still lists the default profile");

  await useProfile("default", mem);
  assert.equal(mem.get().profile, "default");
  await assert.rejects(useProfile("nope", mem), (err) => /rwk login --profile nope/.test(err.hint));
  await assert.rejects(useProfile(undefined, mem), (err) => err.exitCode === 64);
  await assert.rejects(useProfile("Bad!", mem), (err) => err.exitCode === 64);
});

test("doctor: names the profile it checks", async () => {
  const fetchImpl = async () => Response.json({ success: true, result: [{ id: "b1", name: "Bob" }] });
  const base = { nodeVersion: "22.1.0", wranglerVersion: "4.1.0", fetchImpl, asked: null, savedAccountId: "b1", usingEnvToken: false };
  const work = { name: "work", from: "--profile" };
  const ok = await runChecks({ ...base, getToken: async () => "tok", profile: work });
  assert.equal(ok.find((x) => x.label === "Cloudflare login").detail, "the toolkit's own login, profile work");
  const out = await runChecks({ ...base, getToken: async () => null, profile: work });
  assert.match(out.find((x) => x.label === "Cloudflare login").hint, /rwk login --profile work/);
  const def = await runChecks({ ...base, getToken: async () => "tok", profile: { name: "default", from: "default" } });
  assert.equal(def.find((x) => x.label === "Cloudflare login").detail, "the toolkit's own login");
});
