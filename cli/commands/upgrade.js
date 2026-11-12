// rwk upgrade: brings a deployed game to this toolkit version without uploading
// it again: the game files already uploaded stay as they are, and the new Worker
// serves the new runtime plugins over them (worker/toolkit.js). Settings come
// from R2, as for a normal deploy. The game is named by its link or site name
// (its folder may be gone), or by its folder, which gives the site name and the
// creator's current policy and is otherwise not read.

import { DEFAULT_BUCKET, LIMITS_CACHE_FILE, TOOLKIT_ROOT, loadSettings } from "../lib/config.js";
import { apiToken, deleteBuildZip, downloadOwnersForUpgrade, downloadPlan, downloadWaysOf, lensOwnersForUpgrade, loadGameConfigs, loadOverflowRels, probeAccess, saveGameConfigs, saveLiveSettings } from "../lib/cloudflare.js";
import { analyzeGame, findGameBySite, storageIdOf } from "../lib/game.js";
import { readProjectFile } from "../lib/project.js";
import { publishedSiteOf } from "../lib/sites.js";
import { applyPolicy, isIndexable, readPolicy } from "../lib/policy.js";
import { checkFeatureConfig } from "../lib/features.js";
import { RUNTIME_PLUGINS, TOOLKIT_VERSION, guardSource, liveSettingsOf, runtimeConfigOf, runtimeSources, translateWorker } from "../lib/stage.js";
import { loadLimits } from "../lib/limits.js";
import { expectTarget, siteNameOf } from "../lib/target.js";
import { CliError, ask, c, confirm, log } from "../lib/ui.js";
import { deployKeepingAssets, keepAssetsPatch } from "../lib/workers-api.js";
import { checkPlayers, ensureLensBypass, isAuthReady, perPlayerSettings } from "./deploy.js";
import { connect, siteOf } from "../lib/session.js";

export async function upgrade(input) {
  const usage = "rwk upgrade <game folder | game link | site name>";
  if (!input) {
    input = await ask("Paste the game's link (https://<site name>.<username>.workers.dev), its site name or its folder", "", null, {
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

  const { email, account } = await connect(loadSettings());
  const bucket = DEFAULT_BUCKET;

  log.step("Finding the game");
  const configs = await loadGameConfigs(bucket);
  const [fingerprint, cfg] = game ? await publishedSiteOf(configs, game, { project: readProjectFile(game), folder: target.value, command: "upgrade" }) : findGameBySite(configs, siteNameOf(target));
  log.ok(`${cfg.engine} · ${cfg.title}${game ? ` (site name: ${cfg.slug})` : ""}`);
  if (cfg.url) log.info(c.dim(cfg.url));
  const stored = JSON.stringify(cfg);
  // From the folder, the creator's policy as it is now; it is recorded for the next upgrade.
  if (game) {
    const read = readPolicy(game);
    cfg.policy = read ? { hosting: read.hosting, features: read.features } : null;
  }

  // Recorded at each deploy from the game folder; older configs have none,
  // and the Worker then keeps every feature the deployed build turned off.
  const policy = cfg.policy || null;
  if (policy && policy.hosting === "none") {
    throw new CliError("The game's creator does not allow publishing this game as a website, so the toolkit stops here.");
  }
  if (!isAuthReady(cfg.auth)) {
    throw new CliError("This site's access protection is not set up yet.", { hint: 'Finish the first deploy from the game folder (rwk deploy "<game folder>"), then run this again.' });
  }

  log.info(`What happens next (toolkit ${TOOLKIT_VERSION}):`);
  log.info("  1. The Worker and the toolkit's in-game plugins are updated, with the settings stored in R2 (rwk config).");
  log.info("  2. The game files already uploaded stay as they are: nothing is downloaded or uploaded from this PC.");
  if (game) log.info(c.dim("     Changed the game's files? rwk deploy uploads the changes and updates the toolkit too."));
  log.info("  3. Saves and older saves are not touched.");
  if (!game) log.info(c.dim("  To change the game itself (a patch, a translation), run rwk deploy from the game folder."));
  if (!(await confirm(`Update "${cfg.slug}"?`, true))) return siteOf(cfg);

  for (const problem of checkFeatureConfig(cfg)) log.warn(problem);
  const gameConfig = applyPolicy(cfg, policy);
  const toolkit = {
    names: RUNTIME_PLUGINS,
    plugins: runtimeSources(),
    guard: guardSource(),
    config: runtimeConfigOf(cfg.engine, gameConfig),
    keepOff: cfg.policy === undefined,
  };
  const overflowRels = await loadOverflowRels(bucket, storageIdOf(cfg));

  const translate = translateWorker(cfg, policy, await loadLimits({ cacheFile: LIMITS_CACHE_FILE }));
  let lensOwners = lensOwnersForUpgrade(cfg, email);
  const downloadOwners = downloadOwnersForUpgrade(cfg, email);
  log.step("Updating the Worker (the game files stay as uploaded)");
  const patchFor = (owners) => keepAssetsPatch({
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
    lensOwners: owners,
    downloadOwners,
    downloadWays: downloadWaysOf(cfg),
    translate,
  });
  const token = await apiToken();
  if (!token) throw new CliError("Not logged in to Cloudflare.", { hint: "Run the command in a terminal once to log in, or set CLOUDFLARE_API_TOKEN." });
  // Without a recorded policy the Worker keeps what the deployed build turned
  // off (keepOff), which a settings file would override: a deploy from the
  // game folder writes the first one.
  const known = cfg.policy !== undefined;
  if (known) await saveLiveSettings(bucket, storageIdOf(cfg), liveSettingsOf(cfg.engine, cfg, policy));
  await deployKeepingAssets({ token, accountId: account.id, slug: cfg.slug, patch: patchFor(lensOwners) });
  log.ok(`Worker "${cfg.slug}" updated`);
  // Links turned (back) on need the /_lens bypass, as after a deploy; turning
  // them off there puts the Worker up again without owners.
  if (cfg.auth.mode === "access" && cfg.url && (await ensureLensBypass({ ...cfg, lensOwners }, account))) {
    cfg.lens = false;
    lensOwners = [];
    log.info(c.bold("Updating the Worker without MakerLens links"));
    await deployKeepingAssets({ token, accountId: account.id, slug: cfg.slug, patch: patchFor(lensOwners) });
  }
  // The download ZIP is made from the game folder, so only rwk deploy makes one;
  // one the config no longer asks for is removed here, to free its R2 space.
  const zipStep = downloadPlan(cfg, downloadOwners);
  let downloadZip = cfg.downloadZip;
  if (zipStep === "remove") {
    try {
      if (await deleteBuildZip({ bucket, slug: storageIdOf(cfg) })) log.info(c.dim("Removed the download ZIP from R2 (this config does not make one)."));
      downloadZip = false;
    } catch (err) {
      log.warn(`Could not remove the download ZIP from R2: ${err.message}`);
    }
  } else if (zipStep === "make" && cfg.downloadZip !== true) {
    log.info(c.dim("The download ZIP is made by the next rwk deploy from the game folder."));
  }
  // liveSettings only once the policy is known; the version in any case, for rwk status.
  const updated = { ...cfg, liveSettings: known || cfg.liveSettings, toolkitVersion: TOOLKIT_VERSION, lensOwners, downloadOwners, downloadZip };
  if (JSON.stringify(updated) !== stored) {
    configs[fingerprint] = updated;
    await saveGameConfigs(bucket, configs);
  }

  if (cfg.auth.mode === "access" && cfg.url) {
    const probe = await probeAccess(cfg.url);
    if (probe.protected) log.ok("Cloudflare Access is protecting the site");
    else log.warn(c.yellow("Cloudflare Access is NO LONGER protecting the site! Check the dashboard (Worker → Access)."));
    await checkPlayers(bucket, cfg, policy);
  }

  return { ...siteOf(cfg), next: ["Players get the new version on their next reload. In game: ⚙ → Report a problem shows the toolkit version."] };
}
