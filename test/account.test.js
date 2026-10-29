// --account: which Cloudflare account a run works in (cli/lib/cloudflare.js), and what doctor says about it.

import assert from "node:assert/strict";
import test from "node:test";
import { generalHelp, parseCommandLine } from "../cli/lib/args.js";
import { runChecks } from "../cli/commands/doctor.js";
import { askedAccount, matchAccount, pickAccount, setAccountFlag } from "../cli/lib/cloudflare.js";
import { NeedsAnswer, setUnattended } from "../cli/lib/ui.js";

const parse = (args) => parseCommandLine(args, { stdinIsTTY: true });
const accounts = [
  { id: "a1", name: "Alice" },
  { id: "a2", name: "Team" },
];

test("--account: a global flag, anywhere on the line, listed in the help", () => {
  assert.equal(parse(["status", "my-game", "--account", "a2"]).flags.account, "a2");
  assert.equal(parse(["--account", "Team", "list"]).flags.account, "Team");
  assert.equal(parse(["list"]).flags.account, undefined);
  assert.throws(() => parse(["list", "--account"]), /argument missing|value/i);
  assert.match(generalHelp(), /--account\s+The Cloudflare account to work in, by ID or name/);
});

test("askedAccount: --account wins, CLOUDFLARE_ACCOUNT_ID only in an unattended run", () => {
  const env = { CLOUDFLARE_ACCOUNT_ID: "a1" };
  assert.deepEqual(askedAccount({ flag: "a2", env, unattended: true }), { value: "a2", from: "--account" });
  assert.deepEqual(askedAccount({ flag: null, env, unattended: true }), { value: "a1", from: "CLOUDFLARE_ACCOUNT_ID" });
  assert.equal(askedAccount({ flag: null, env, unattended: false }), null);
  assert.equal(askedAccount({ flag: null, env: {}, unattended: true }), null);
});

test("matchAccount: by ID, then by name without regard to case; unknown and ambiguous are errors", () => {
  assert.equal(matchAccount(accounts, "a2").account.id, "a2");
  assert.equal(matchAccount(accounts, "alice").account.id, "a1");
  assert.match(matchAccount(accounts, "nope").error, /no Cloudflare account "nope". It has: Alice \(a1\), Team \(a2\)/);
  const twins = [...accounts, { id: "a3", name: "team" }];
  assert.match(matchAccount(twins, "Team").error, /Several accounts are named "Team": a2, a3/);
});

test("pickAccount: the asked one, never saved; else the saved one, the only one, or a question", async (t) => {
  const settings = { accountId: "a1" };
  assert.equal((await pickAccount(accounts, settings, { value: "Team", from: "--account" })).id, "a2");
  assert.equal(settings.accountId, "a1", "--account is for one run");
  await assert.rejects(pickAccount(accounts, settings, { value: "x", from: "--account" }), (err) => err.exitCode === 1 && /--account: .*"x"/.test(err.message));
  assert.equal((await pickAccount(accounts, settings, null)).id, "a1");

  const single = {};
  assert.equal((await pickAccount([accounts[1]], single, null)).id, "a2");
  assert.equal(single.accountId, "a2");
  await assert.rejects(pickAccount([], {}, null), /no Cloudflare account/);

  setUnattended(true);
  t.after(() => setUnattended(false));
  await assert.rejects(pickAccount(accounts, { accountId: "gone" }, null), (err) => err instanceof NeedsAnswer && err.exitCode === 2 && /--account/.test(err.hint));
});

test("setAccountFlag: what askedAccount reads by default", (t) => {
  t.after(() => setAccountFlag(null));
  setAccountFlag("Team");
  assert.deepEqual(askedAccount({ env: {} }), { value: "Team", from: "--account" });
  setAccountFlag("");
  assert.equal(askedAccount({ env: {}, unattended: false }), null);
});

test("doctor: says which account it checks and where the choice came from", async () => {
  const fetchImpl = async (url) => {
    if (url.includes("/accounts?")) return Response.json({ success: true, result: accounts });
    return Response.json({ success: true, result: [] });
  };
  const base = { nodeVersion: "22.1.0", wranglerVersion: "4.1.0", getToken: async () => "tok", fetchImpl };
  const account = (checks) => checks.filter((x) => x.label === "Account");

  const flag = await runChecks({ ...base, asked: { value: "team", from: "--account" }, savedAccountId: "a1" });
  assert.equal(account(flag)[0].detail, "Team (a2), from --account");
  assert.ok(flag.some((x) => x.label === "Workers scripts"), "the checks go on in that account");

  const saved = await runChecks({ ...base, asked: null, savedAccountId: "a1" });
  assert.equal(account(saved)[0].detail, "Alice (a1), the one chosen last time");

  const unknown = await runChecks({ ...base, asked: { value: "x", from: "CLOUDFLARE_ACCOUNT_ID" } });
  assert.equal(account(unknown)[0].status, "fail");
  assert.match(account(unknown)[0].detail, /CLOUDFLARE_ACCOUNT_ID: .*"x"/);
  assert.equal(unknown.at(-1).label, "Account", "nothing is checked in an account that is not there");
});
