// rwk config edit: opens the game's settings (stored in R2) in a text editor.
// It works from the game folder, or from the deployed site's link or name
// when the folder is not at hand: the settings do not need the game's files.

import { DEFAULT_BUCKET, loadSettings } from "../lib/config.js";
import { loadGameConfigs, saveGameConfigs, saveLiveSettings } from "../lib/cloudflare.js";
import { analyzeGame, findGameBySite, storageIdOf } from "../lib/game.js";
import { checkFeatureConfig } from "../lib/features.js";
import { readPolicy } from "../lib/policy.js";
import { keysNeedingDeploy, liveSettingsOf } from "../lib/stage.js";
import { expectTarget, siteNameOf } from "../lib/target.js";
import { CliError, NeedsAnswer, ask, c, isUnattended, log } from "../lib/ui.js";
import { addNewKeys, connect, editInEditor, siteOf } from "./deploy.js";

export async function editConfig(input) {
  const usage = 'rwk config edit <game folder | game link | site name>';
  if (isUnattended()) throw new NeedsAnswer("config edit opens a text editor.", "Run it in a terminal.");
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
  cfg = editInEditor(cfg);
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
