// Non-interactive runs (CI, --yes): no question waits for an answer, and the
// Cloudflare API token in the environment replaces the toolkit's login.

import assert from "node:assert/strict";
import { test } from "node:test";
import { parseCommandLine } from "../cli/lib/args.js";
import { NeedsAnswer, ask, choose, confirm, isUnattended, pause, setUnattended } from "../cli/lib/ui.js";
import { PROFILE, envApiToken, useEnvToken, wranglerRun } from "../cli/lib/wrangler.js";

test("non-interactive: --yes, --json or no terminal on stdin", () => {
  const parse = (args, stdinIsTTY = true) => parseCommandLine(args, { stdinIsTTY });
  assert.equal(parse(["deploy", "--yes", "g"]).unattended, true);
  assert.equal(parse(["deploy", "-y", "g"]).unattended, true);
  assert.equal(parse(["deploy", "g"]).unattended, false);
  assert.equal(parse(["deploy", "g", "--json"]).unattended, true, "--json implies --yes");
  assert.equal(parse(["deploy", "g"], false).unattended, true, "CI: stdin is not a terminal");
  assert.throws(() => parse(["deploy", "--non-interactive", "g"]), { exitCode: 64 }, "one spelling: --yes");
});

test("non-interactive: questions take their default, or stop the run", async (t) => {
  t.mock.method(console, "log", () => {});
  setUnattended(true);
  t.after(() => setUnattended(false));
  assert.ok(isUnattended());

  assert.equal(await ask("Site name", "my-game", (v) => (/^[a-z-]+$/.test(v) ? null : "bad")), "my-game");
  await assert.rejects(ask("Game folder"), NeedsAnswer, "no default");
  await assert.rejects(ask("Site name", "My Game", (v) => (/^[a-z-]+$/.test(v) ? null : "bad")), NeedsAnswer, "a default that fails its check");
  await assert.rejects(ask("Link", "", null, { hint: "Pass it after the command." }), (err) => {
    assert.match(err.message, /Nobody can answer "Link"/);
    assert.equal(err.hint, "Pass it after the command.");
    return true;
  });

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
