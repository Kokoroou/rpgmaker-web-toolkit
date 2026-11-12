// rwk upgrade: brings a deployed game to this toolkit version without uploading
// it again: the game files already uploaded stay as they are, and the new Worker
// serves the new runtime plugins over them (worker/toolkit.js). Settings come
// from R2, as for a normal deploy. The game is named by its link or site name
// (its folder may be gone), or by its folder, which gives the site name and the
// creator's current policy and is otherwise not read. Several games (links or
// site names), or --all, are updated one after the other in one run: one login,
// one question, one summary; a game that fails does not stop the others.

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

const USAGE = "rwk upgrade <game folder | game link | site name>... | --all";

// Every game of the account is a candidate for --all; the ones already on this
// toolkit are left alone (an explicit name is always updated).
const upToDate = (cfg) => cfg.toolkitVersion === TOOLKIT_VERSION;

export async function upgrade(input, { all = false } = {}) {
  let inputs = all ? [] : [].concat(input || []);
  if (!all && !inputs.length) {
    inputs = [
      await ask("Paste the game's link (https://<site name>.<username>.workers.dev), its site name or its folder", "", null, {
        hint: `Pass it after the command: ${USAGE}`,
      }),
    ];
  }
  const many = all || inputs.length > 1;
  const targets = inputs.map((value) => expectTarget(value, many ? ["link", "name"] : ["folder", "link", "name"], USAGE));

  let game = null;
  if (!many && targets[0].kind === "folder") {
    log.step("Analyzing the game");
    game = analyzeGame(targets[0].value);
    log.ok(`${game.engine} · ${game.title}`);
    log.info(c.dim(game.root));
  }

  const { email, account } = await connect(loadSettings());
  const ctx = { email, account, bucket: DEFAULT_BUCKET, configs: null, token: null, nested: many };

  log.step(many ? "Finding the games" : "Finding the game");
  ctx.configs = await loadGameConfigs(ctx.bucket);

  if (!many) {
    const target = targets[0];
    const [fingerprint, cfg] = game ? await publishedSiteOf(ctx.configs, game, { project: readProjectFile(game), folder: target.value, command: "upgrade" }) : findGameBySite(ctx.configs, siteNameOf(target));
    log.ok(`${cfg.engine} · ${cfg.title}${game ? ` (site name: ${cfg.slug})` : ""}`);
    if (cfg.url) log.info(c.dim(cfg.url));
    const done = await updateGame(ctx, { fingerprint, cfg, game, confirmFirst: true });
    return done ? { ...siteOf(cfg), next: NEXT } : siteOf(cfg);
  }

  // The games to update, all found before anything changes: a wrong name stops the run first.
  const picked = new Map();
  if (all) {
    for (const entry of Object.entries(ctx.configs).sort((a, b) => a[1].slug.localeCompare(b[1].slug))) picked.set(entry[0], entry);
  } else {
    for (const target of targets) {
      const entry = findGameBySite(ctx.configs, siteNameOf(target));
      picked.set(entry[0], entry);
    }
  }
  const entries = [...picked.values()];
  if (!entries.length) {
    log.info("No games in this account yet: rwk deploy <game folder>");
    return { site: null, url: null, sites: [], facts: [["Games", "none"]] };
  }
  const skipped = all ? entries.filter(([, cfg]) => upToDate(cfg)) : [];
  const todo = entries.filter((entry) => !skipped.includes(entry));
  log.table(entries.map(([, cfg]) => [cfg.slug, skipped.some(([, other]) => other === cfg) ? c.dim(`already on toolkit ${TOOLKIT_VERSION}`) : `${cfg.engine} · ${cfg.title}`]));
  if (!todo.length) {
    log.ok(`Every game is already on toolkit ${TOOLKIT_VERSION}`);
    return { site: null, url: null, sites: entries.map(([, cfg]) => siteOf(cfg)), facts: [["Games", `${entries.length} already up to date`]] };
  }

  explain(null, todo.length);
  if (!(await confirm(`Update ${todo.length} game${todo.length > 1 ? "s" : ""}?`, true))) return { site: null, url: null, sites: [] };

  const updated = [];
  const failed = [];
  for (const [i, [fingerprint, cfg]] of todo.entries()) {
    log.step(`[${i + 1}/${todo.length}] ${cfg.slug}`);
    try {
      await updateGame(ctx, { fingerprint, cfg, game: null, confirmFirst: false });
      updated.push(cfg);
    } catch (err) {
      failed.push({ cfg, err });
      log.warn(`"${cfg.slug}" was not updated: ${err.message}${err.hint ? `\n${err.hint}` : ""}`);
    }
  }
  const facts = [["Games", [`${updated.length} updated`, skipped.length ? `${skipped.length} already up to date` : "", failed.length ? `${failed.length} failed` : ""].filter(Boolean).join(", ")]];
  if (failed.length) {
    const names = failed.map(({ cfg }) => cfg.slug);
    throw new CliError(`${failed.length} of ${todo.length} games were not updated: ${names.join(", ")}.`, {
      hint: `Fix what the warnings say, then run: rwk upgrade ${names.join(" ")}`,
      exitCode: failed[0].err.exitCode || 1,
    });
  }
  return { site: null, url: null, sites: [...updated, ...skipped.map(([, cfg]) => cfg)].map(siteOf), facts, next: NEXT };
}

const NEXT = ["Players get the new version on their next reload. In game: ⚙ → Report a problem shows the toolkit version."];

// What an update does; the same words for one game and for several.
function explain(game, count = 1) {
  log.info(`What happens next${count > 1 ? `, for each of the ${count} games` : ""} (toolkit ${TOOLKIT_VERSION}):`);
  log.list([
    "The Worker and the toolkit's in-game plugins are updated, with the settings stored in R2 (rwk config).",
    `The game files already uploaded stay as they are: nothing is downloaded or uploaded from this PC.${game ? c.dim("\nChanged the game's files? rwk deploy uploads the changes and updates the toolkit too.") : ""}`,
    "Saves and older saves are not touched.",
  ]);
  if (!game) log.info(c.dim("To change the game itself (a patch, a translation), run rwk deploy from the game folder."));
}

// One game: the checks, the Worker, the config in R2, the Access probe.
// ctx: what the run shares (login, the configs read once, the API token).
// confirmFirst: ask before changing anything (a single game; several games ask once).
// -> false when the person said no.
async function updateGame(ctx, { fingerprint, cfg, game, confirmFirst }) {
  const { email, account, bucket, configs } = ctx;
  // A step of its own for one game; a part of the game's step when there are several.
  const stage = ctx.nested ? log.phase : log.step;
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

  if (confirmFirst) {
    explain(game);
    if (!(await confirm(`Update "${cfg.slug}"?`, true))) return false;
  }

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
  stage("Updating the Worker (the game files stay as uploaded)");
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
  const token = (ctx.token ||= await apiToken());
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
    log.phase("Updating the Worker without MakerLens links");
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
  return true;
}
