// rwk config: changes the game's settings (stored in R2) by questions and
// answers, or in a text editor on request; --get / --set read or change one
// setting without questions, for scripts.
// It works from the game folder, or from the deployed site's link or name
// when the folder is not at hand: the settings do not need the game's files.

import { DEFAULT_BUCKET, loadSettings } from "../lib/config.js";
import { loadGameConfigs, saveGameConfigs, saveLiveSettings } from "../lib/cloudflare.js";
import { analyzeGame, findGameBySite, storageIdOf } from "../lib/game.js";
import { guidedEdit } from "../lib/config-wizard.js";
import { IDENTITY_KEYS, getSetting, parseAssignment, setSetting, splitKey } from "../lib/config-keys.js";
import { checkFeatureConfig } from "../lib/features.js";
import { readPolicy } from "../lib/policy.js";
import { keysNeedingDeploy, liveSettingsOf } from "../lib/stage.js";
import { expectTarget, siteNameOf } from "../lib/target.js";
import { CliError, NeedsAnswer, ask, c, isUnattended, log } from "../lib/ui.js";
import { addNewKeys, editInEditor } from "./deploy.js";
import { connect, siteOf } from "../lib/session.js";

export async function editConfig(input, { get, set } = {}) {
  const usage = 'rwk config <game folder | game link | site name>';
  // Checked before logging in, so a typo costs nothing.
  const assignments = (set || []).map(parseAssignment);
  for (const [key] of assignments) setSetting({}, key, 0);
  if (get !== undefined) splitKey(get);
  const oneSetting = get !== undefined || assignments.length > 0;
  if (isUnattended() && !oneSetting) throw new NeedsAnswer("config asks its questions in the terminal.", "Run it in a terminal, or change one setting with --set <key>=<value>.");
  if (!input) {
    input = await ask("Drag and drop or paste the game folder path (or the game's link or site name)", "", null, {
      hint: `Pass it after the command: ${usage}`,
    });
  }
  const target = expectTarget(input, ["folder", "link", "name"], usage);

  let game = null;
  if (target.kind === "folder") {
    log.step("Analyzing the game");
    game = analyzeGame(target.value);
    log.ok(`${game.engine} · ${game.title}`);
    log.info(c.dim(game.root));
  }

  await connect(loadSettings());
  const bucket = DEFAULT_BUCKET;
  const configs = await loadGameConfigs(bucket);
  let fingerprint;
  let cfg;
  if (game) {
    fingerprint = game.fingerprint;
    cfg = configs[fingerprint];
    if (!cfg) throw new CliError("This game is not published yet, so it has no settings to edit.", { hint: `Publish it first: rwk deploy "${target.value}"` });
    await addNewKeys(game, cfg);
    // Recorded from the game folder, for the commands that have none.
    const policy = readPolicy(game);
    cfg.policy = policy ? { hosting: policy.hosting, features: policy.features } : null;
  } else {
    log.step("Finding the game");
    [fingerprint, cfg] = findGameBySite(configs, siteNameOf(target));
    log.ok(`${cfg.engine} · ${cfg.title}`);
  }
  log.ok(`Using the config saved in R2 (site name: ${cfg.slug})`);
  const policy = cfg.policy || null;

  const before = cfg;
  if (get !== undefined) {
    const value = getSetting(cfg, get);
    const text = value === undefined ? "not set (the default applies)" : JSON.stringify(value);
    return { ...siteOf(cfg), key: get, value: value === undefined ? null : value, facts: [[get, text]], next: [] };
  }
  let edited;
  if (oneSetting) {
    edited = cfg;
    for (const [key, value] of assignments) {
      edited = setSetting(edited, key, value);
      log.ok(`${key} = ${value === null ? "default" : JSON.stringify(value)}`);
    }
  } else {
    // Questions and answers; the JSON stays one menu entry away.
    edited = await guidedEdit(cfg, { editJson: (current) => editInEditor(current) });
  }
  if (!edited) {
    log.info("Nothing saved.");
    return { ...siteOf(cfg), next: [] };
  }
  // Identity fields are not editable, whichever way the config was changed.
  cfg = { ...edited };
  for (const key of IDENTITY_KEYS) {
    if (before[key] === undefined) delete cfg[key];
    else cfg[key] = before[key];
  }
  configs[fingerprint] = cfg;
  await saveGameConfigs(bucket, configs);
  if (!cfg.liveSettings) {
    log.ok("Config saved to R2.");
    return {
      ...siteOf(cfg),
      next: ['Run rwk deploy "<game folder>" to apply it. After that deploy, changes to the in-game features apply without one.'],
    };
  }
  for (const problem of checkFeatureConfig(cfg)) log.warn(problem);
  await saveLiveSettings(bucket, storageIdOf(cfg), liveSettingsOf(cfg.engine, cfg, policy));
  log.ok("Config saved to R2.");
  const rebuild = keysNeedingDeploy(before, cfg);
  return {
    ...siteOf(cfg),
    next: [
      "Players get the new settings the next time they open the game (within a minute).",
      ...(rebuild.length ? [`Run rwk deploy again to apply ${rebuild.map((k) => `"${k}"`).join(", ")}: only a deploy changes these.`] : []),
    ],
  };
}
