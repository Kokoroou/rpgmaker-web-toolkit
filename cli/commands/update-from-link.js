// Brings a deployed game to this toolkit version from its link alone, for
// when its folder is gone: the game files already uploaded stay as they are,
// and the new Worker serves the new runtime plugins over them
// (worker/toolkit.js). Settings come from R2, as for a normal deploy.

import { DEFAULT_BUCKET, TOOLKIT_ROOT, loadSettings } from "../lib/config.js";
import { apiToken, loadGameConfigs, loadOverflowRels, probeAccess, saveGameConfigs, saveLiveSettings } from "../lib/cloudflare.js";
import { findGameBySite, siteNameFromLink, storageIdOf } from "../lib/game.js";
import { applyPolicy, isIndexable } from "../lib/policy.js";
import { checkFeatureConfig } from "../lib/features.js";
import { RUNTIME_PLUGINS, TOOLKIT_VERSION, liveSettingsOf, runtimeConfigOf, runtimeSources } from "../lib/stage.js";
import { ask, c, confirm, log, print } from "../lib/ui.js";
import { deployKeepingAssets, keepAssetsPatch } from "../lib/workers-api.js";
import { checkPlayers, connect, isAuthReady, perPlayerSettings, siteOf } from "./deploy.js";

export async function updateFromLink(link) {
  if (!link) {
    link = await ask("Paste the game's link (https://<site name>.<username>.workers.dev)", "", null, {
      hint: 'Pass it after the command: rwk --yes update-from-link "<game link>".',
    });
  }
  const name = siteNameFromLink(link);

  const { account } = await connect(loadSettings());
  const bucket = DEFAULT_BUCKET;

  log.step("Finding the game");
  const configs = await loadGameConfigs(bucket);
  const [fingerprint, cfg] = findGameBySite(configs, name);
  log.ok(`${cfg.engine} · ${cfg.title}`);
  if (cfg.url) log.info(c.dim(cfg.url));

  // Recorded at each deploy from the game folder; older configs have none,
  // and the Worker then keeps every feature the deployed build turned off.
  const policy = cfg.policy || null;
  if (policy && policy.hosting === "none") {
    throw new Error("The game's creator does not allow publishing this game as a website, so the toolkit stops here.");
  }
  if (!isAuthReady(cfg.auth)) {
    throw new Error("This site's access protection is not set up yet. Finish the first deploy from the game folder, then run this again.");
  }

  log.info(`What happens next (toolkit ${TOOLKIT_VERSION}):`);
  log.info("  1. The Worker and the toolkit's in-game plugins are updated, with the settings stored in R2 (edit-config).");
  log.info("  2. The game files already uploaded stay as they are: nothing is downloaded or uploaded from this PC.");
  log.info("  3. Saves and older saves are not touched.");
  log.info(c.dim("  To change the game itself (a patch, a translation), deploy from the game folder."));
  if (!(await confirm(`Update "${cfg.slug}"?`, true))) return siteOf(cfg);

  for (const problem of checkFeatureConfig(cfg)) log.warn(problem);
  const gameConfig = applyPolicy(cfg, policy);
  const toolkit = {
    names: RUNTIME_PLUGINS,
    plugins: runtimeSources(),
    config: runtimeConfigOf(cfg.engine, gameConfig),
    keepOff: cfg.policy === undefined,
  };
  const overflowRels = await loadOverflowRels(bucket, storageIdOf(cfg));

  log.step("Updating the Worker (the game files stay as uploaded)");
  const patch = keepAssetsPatch({
    slug: cfg.slug,
    gameId: storageIdOf(cfg),
    bucket,
    overflowRels,
    auth: cfg.auth,
    toolkitRoot: TOOLKIT_ROOT,
    indexable: isIndexable(cfg),
    saveHistory: toolkit.config.saveHistory,
    playerSettings: perPlayerSettings(cfg.engine, cfg, policy),
    toolkit,
  });
  const token = await apiToken();
  if (!token) throw new Error("Not logged in to Cloudflare.");
  // Without a recorded policy the Worker keeps what the deployed build turned
  // off (keepOff), which a settings file would override: a deploy from the
  // game folder writes the first one.
  const known = cfg.policy !== undefined;
  if (known) await saveLiveSettings(bucket, storageIdOf(cfg), liveSettingsOf(cfg.engine, cfg, policy));
  await deployKeepingAssets({ token, accountId: account.id, slug: cfg.slug, patch });
  log.ok(`Worker "${cfg.slug}" updated`);
  if (known && !cfg.liveSettings) {
    configs[fingerprint] = { ...cfg, liveSettings: true };
    await saveGameConfigs(bucket, configs);
  }

  if (cfg.auth.mode === "access" && cfg.url) {
    const probe = await probeAccess(cfg.url);
    if (probe.protected) log.ok("Cloudflare Access is protecting the site");
    else log.warn(c.yellow("Cloudflare Access is NO LONGER protecting the site! Check the dashboard (Worker → Access)."));
    await checkPlayers(bucket, cfg, policy);
  }

  print(`\n${c.green("Done!")} ${cfg.url ? c.bold(cfg.url) : ""}`);
  log.info("Players get the new version on their next reload. In game: ⚙ → Report a problem shows the toolkit version.");
  return siteOf(cfg);
}
