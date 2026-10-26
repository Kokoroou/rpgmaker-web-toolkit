// Non-interactive runs (CI, --yes): no question waits for an answer, and the
// Cloudflare API token in the environment replaces the toolkit's login.

import assert from "node:assert/strict";
import { test } from "node:test";
import { NeedsAnswer, ask, choose, confirm, isUnattended, pause, setUnattended, splitFlags } from "../cli/lib/ui.js";
import { PROFILE, envApiToken, useEnvToken, wranglerRun } from "../cli/lib/wrangler.js";

test("non-interactive: --yes, --non-interactive or no terminal on stdin", () => {
  assert.deepEqual(splitFlags(["--yes", "D:\\Games\\My", "Game"], { stdinIsTTY: true }), { unattended: true, json: false, rest: ["D:\\Games\\My", "Game"] });
  assert.deepEqual(splitFlags(["import-saves", "-y", "g"], { stdinIsTTY: true }), { unattended: true, json: false, rest: ["import-saves", "g"] });
  assert.equal(splitFlags(["--non-interactive", "g"], { stdinIsTTY: true }).unattended, true);
  assert.deepEqual(splitFlags(["g"], { stdinIsTTY: true }), { unattended: false, json: false, rest: ["g"] });
  assert.deepEqual(splitFlags(["--json", "g"], { stdinIsTTY: true }), { unattended: true, json: true, rest: ["g"] }, "--json implies --yes");
  assert.equal(splitFlags(["g"], { stdinIsTTY: false }).unattended, true, "CI: stdin is not a terminal");
});

test("non-interactive: questions take their default, or stop the run", async (t) => {
  t.mock.method(console, "log", () => {});
  setUnattended(true);
  t.after(() => setUnattended(false));
  assert.ok(isUnattended());

  assert.equal(await ask("Site name", "my-game", (v) => (/^[a-z-]+$/.test(v) ? null : "bad")), "my-game");
  await assert.rejects(ask("Game folder"), NeedsAnswer, "no default");
  await assert.rejects(ask("Site name", "My Game", (v) => (/^[a-z-]+$/.test(v) ? null : "bad")), NeedsAnswer, "a default that fails its check");
  await assert.rejects(ask("Link", "", null, { hint: "Pass it after the command." }), /Nobody can answer "Link".*Pass it after the command\./);

  assert.equal(await confirm("Enable sync?", true), true);
  assert.equal(await confirm("Include extra?", false), false);
  assert.equal(await confirm("Delete the old Worker?", true, { whenUnattended: false }), false, "the caller's unattended answer wins");

  const options = [{ label: "A", value: "a" }, { label: "B", value: "b" }];
  assert.equal(await choose("Pick", options, 1), "b");
  assert.equal(await choose("Pick", options, 0, { whenUnattended: 1 }), "b");
  await assert.rejects(choose("Why public?", options, 0, { whenUnattended: null }), NeedsAnswer);
  await assert.rejects(pause("Press Enter"), NeedsAnswer);

  const err = await ask("Game folder").catch((e) => e);
  assert.equal(err.exitCode, 2, "exit code 2: a question needs a person");
});

test("non-interactive: CLOUDFLARE_API_TOKEN replaces the toolkit's login profile", (t) => {
  t.after(() => useEnvToken({}));
  const base = { PATH: "/bin", CLOUDFLARE_API_TOKEN: "tok", CF_API_KEY: "key", CLOUDFLARE_ACCOUNT_ID: "acc" };

  assert.equal(useEnvToken({}), false);
  const profile = wranglerRun(["deploy"], base);
  assert.deepEqual(profile.args, ["deploy", "--profile", PROFILE]);
  assert.equal(profile.env.CLOUDFLARE_API_TOKEN, undefined, "an interactive run ignores a token set for something else");
  assert.equal(profile.env.CF_API_KEY, undefined);

  assert.equal(useEnvToken(base), true);
  assert.equal(envApiToken(), "tok");
  const token = wranglerRun(["deploy"], base);
  assert.deepEqual(token.args, ["deploy"], "no profile: it would win over the token");
  assert.equal(token.env.CLOUDFLARE_API_TOKEN, "tok");
  assert.equal(token.env.CF_API_KEY, undefined, "other credentials are still dropped");
  assert.equal(token.env.WRANGLER_SEND_METRICS, "false");
});
