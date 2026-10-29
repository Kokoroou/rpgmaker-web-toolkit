import { spawn, spawnSync } from "node:child_process";
import crypto from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { DEFAULT_BUCKET, LIMITS_CACHE_FILE, TOOLKIT_ROOT, createBuildDir, loadSettings } from "../lib/config.js";
import {
  apiToken,
  deleteWorker,
  deployWorker,
  ensureBucket,
  importSaves,
  listSaveFiles,
  loadGameConfigs,
  loadPlayers,
  probeAccess,
  saveGameConfigs,
  saveLiveSettings,
  syncOverflow,
  writeWorkerProject,
} from "../lib/cloudflare.js";
import { AccessApiError, enableAccess } from "../lib/access-api.js";
import { analyzeGame, collectFiles, nonAsciiPaths, storageIdOf, suggestSlug, takenNames, validateSlug } from "../lib/game.js";
import { editorCommand, openUrlCommand } from "../lib/platform.js";
import { loadLimits } from "../lib/limits.js";
import { gamepadKeys, cleanHint, defaultLabel, scanKeys } from "../lib/keys.js";
import { POLICY_FILE, allowsPublic, applyPolicy, isIndexable, readPolicy } from "../lib/policy.js";
import { DEFAULT_PRESET, PRESETS, baseConfig, checkFeatureConfig, playerEmails } from "../lib/features.js";
import { TOOLKIT_VERSION, generatedFiles, keysNeedingDeploy, liveSettingsOf, playerOverrides, runtimeConfigOf, syncPublicDir } from "../lib/stage.js";
import { formatMiB, showPolicy, tooManyFiles, warnLanguages, warnMobileMedia, warnPathProblems } from "../lib/build-checks.js";
import { engineOf } from "../lib/engines.js";
import { connect, siteOf } from "../lib/session.js";
import { askNewName, checkSiteName, preview } from "./preview.js";
import { expectTarget } from "../lib/target.js";
import { PROJECT_FILE, readProjectFile, showProjectFile, siteNameFor, withProjectPatterns } from "../lib/project.js";
import { CliError, NeedsAnswer, ask, c, choose, confirm, formatBytes, isUnattended, log, pause } from "../lib/ui.js";

// deploy, saves import (importOnly) and rename (rename, to): the commands that start from the game folder.
// dryRun (rename and saves import only; deploy --dry-run is analyze): reads R2, then says what would
// happen and stops; nothing in the account is created or changed.
export async function deploy(inputPath, { importOnly = false, rename = false, to, dryRun = false, name } = {}) {
  const usage = importOnly ? 'rwk saves import "<game folder>"' : rename ? 'rwk rename "<game folder>" --to <new name>' : 'rwk deploy "<game folder>"';
  if (!inputPath) {
    inputPath = await ask("Drag and drop or paste the game folder path", "", null, { hint: `Pass it after the command: ${usage}` });
  }
  inputPath = expectTarget(inputPath, ["folder"], usage).value;

  //-------------------------------------------------------------------------
  log.step("Analyzing the game");
  const game = analyzeGame(inputPath);
  log.ok(`${game.engine} · ${game.title}`);
  log.info(c.dim(game.root));
  const policy = readPolicy(game);
  showPolicy(policy);
  const project = readProjectFile(game);
  showProjectFile(project);

  const settings = loadSettings();
  const { email, account } = await connect(settings);
  const bucket = DEFAULT_BUCKET;
  if (dryRun) return preview(game, policy, await loadConfigsIfAny(bucket), { inputPath, rename, to });
  await ensureBucket(bucket, account.id);

  const configs = await loadGameConfigs(bucket);
  let saved = "";
  // Writes the shared config back to R2, skipping the call when nothing changed.
  const saveGameConfig = async () => {
    const next = JSON.stringify(cfg);
    if (next === saved) return;
    configs[game.fingerprint] = cfg;
    await saveGameConfigs(bucket, configs);
    saved = next;
  };

  let cfg = configs[game.fingerprint];
  const slug = checkSiteName(siteNameFor(name, project, cfg), cfg, takenNames(configs, game.fingerprint), inputPath);
  if (cfg) {
    saved = JSON.stringify(cfg);
    log.ok(`Using the config saved in R2 (site name: ${cfg.slug})`);
  } else if (rename) {
    throw new CliError("This game is not published yet, so it has no site to rename.", { hint: `Publish it first: rwk deploy "${inputPath}"` });
  } else {
    log.info("First deploy of this game: answer a few questions (Enter = use the default).");
    cfg = await createConfig(game, takenNames(configs, game.fingerprint), slug, project);
  }
  await addNewKeys(game, cfg);
  // Kept for upgrade, which has no game folder to read it from.
  cfg.policy = policy ? { hosting: policy.hosting, features: policy.features } : null;
  await saveGameConfig();

  // Then deploys as usual, under the new name.
  if (rename) {
    const from = cfg.slug;
    if (!(await renameSite(cfg, takenNames(configs, game.fingerprint), to))) return siteOf(cfg);
    await saveGameConfig();
    if (project && project.name === from) log.info(`Change "name" in ${PROJECT_FILE} to "${cfg.slug}" too.`);
  }

  // The creator can turn sync off; the stored config keeps the deployer's choice.
  const syncOn = applyPolicy(cfg, policy).sync.enabled;
  if (importOnly) {
    if (!syncOn) {
      log.warn("The game's creator turned cloud save sync off for this game.");
      return siteOf(cfg);
    }
    await offerSaveImport(game, cfg, bucket, email, true);
    await saveGameConfig();
    return siteOf(cfg);
  }

  await checkPublic(cfg, policy);
  await saveGameConfig();
  for (const problem of checkFeatureConfig(cfg)) log.warn(problem);

  //-------------------------------------------------------------------------
  log.step("Preparing the web build");
  const limits = await loadLimits({ cacheFile: LIMITS_CACHE_FILE });
  const { maxFiles, maxFileBytes } = limits.assets;
  if (limits.newer) log.info(c.dim(`Free plan limits updated on ${limits.updated}: ${maxFiles} files, ${formatMiB(maxFileBytes)} each`));
  const buildDir = createBuildDir(game.root, cfg.slug);
  const files = collectFiles(game, withProjectPatterns(cfg, project));
  const overflow = files.filter((f) => f.size > maxFileBytes);
  const assets = files.filter((f) => f.size <= maxFileBytes);
  const generated = generatedFiles(game, applyPolicy(cfg, policy), files);
  const assetCount = new Set([...assets.map((f) => f.rel), ...generated.keys()]).size;
  const totalBytes = files.reduce((sum, f) => sum + f.size, 0);
  log.info(`${files.length} files, ${formatBytes(totalBytes)} (${overflow.length} file(s) over ${formatMiB(maxFileBytes)} go to R2)`);
  if (assetCount > maxFiles) throw tooManyFiles(assets, assetCount, maxFiles);
  if (engineOf(game.engine).mobileMedia) warnMobileMedia(files);
  warnLanguages(files, cfg.languages);
  const oddNames = nonAsciiPaths(files);
  if (oddNames.length) {
    const shown = oddNames.slice(0, 3).join(", ") + (oddNames.length > 3 ? ", …" : "");
    log.warn(`${oddNames.length} file name(s) have non-ASCII characters (${shown}). If a picture or sound is missing in the browser, check these first.`);
  }

  warnPathProblems(files);

  const publicDir = path.join(buildDir, "public");
  const stats = syncPublicDir(publicDir, assets, generated);
  log.ok(`Temporary build ready (${stats.linked} hard links, ${stats.copied} copies)`);
  log.info(c.dim(buildDir));
  if (stats.copied) log.info(c.dim("Hard links were not possible (different drive, or the drive root is not writable), so files were copied."));

  //-------------------------------------------------------------------------
  let r2 = null;
  if (overflow.length) {
    log.step("Large files on R2");
    r2 = await syncOverflow({ bucket, slug: storageIdOf(cfg), files: overflow });
    log.ok(`Uploaded ${r2.uploaded}, unchanged ${r2.unchanged}, removed ${r2.removed}`);
  }

  //-------------------------------------------------------------------------
  log.step("Deploying the Worker (wrangler uploads changed files only)");
  const playerSettings = perPlayerSettings(game.engine, cfg, policy);
  const project = {
    buildDir,
    slug: cfg.slug,
    gameId: storageIdOf(cfg),
    bucket,
    overflowRels: overflow.map((f) => f.rel),
    toolkitRoot: TOOLKIT_ROOT,
    indexable: isIndexable(cfg),
    saveHistory: runtimeConfigOf(game.engine, cfg).saveHistory,
    playerSettings,
  };
  const authReady = isAuthReady(cfg.auth);
  // Written before the Worker, which reads it from R2 and puts it over the build's own.
  const publishSettings = () => saveLiveSettings(bucket, storageIdOf(cfg), liveSettingsOf(game.engine, cfg, policy));
  await publishSettings();
  let url = await deployWorker(writeWorkerProject({ ...project, auth: cfg.auth, locked: !authReady }));
  if (url) cfg.url = url;
  cfg.liveSettings = true; // config applies without a redeploy from now on
  cfg.toolkitVersion = TOOLKIT_VERSION; // for rwk status
  await saveGameConfig();

  if (!authReady) {
    await setupAuth(cfg, account, policy, email);
    await saveGameConfig();
    if (isAuthReady(cfg.auth)) {
      // A public site that asked to be listed needs the files without noindex.
      if (isIndexable(cfg)) {
        project.indexable = true;
        syncPublicDir(publicDir, assets, generatedFiles(game, applyPolicy(cfg, policy), files));
      }
      project.playerSettings = perPlayerSettings(game.engine, cfg, policy);
      await publishSettings();
      log.step("Redeploying with access protection");
      url = await deployWorker(writeWorkerProject({ ...project, auth: cfg.auth, locked: false }));
    } else {
      log.warn("The site is still locked. Run this command again to finish setting up access protection.");
    }
  } else if (cfg.auth.mode === "access" && cfg.url) {
    const probe = await probeAccess(cfg.url);
    if (probe.protected) log.ok("Cloudflare Access is protecting the site");
    else log.warn(c.yellow("Cloudflare Access is NO LONGER protecting the site! Check the dashboard (Worker → Access)."));
  }

  // After a rename, once the new site works.
  if (isAuthReady(cfg.auth)) {
    await retireWorkers(cfg);
    await saveGameConfig();
  }

  //-------------------------------------------------------------------------
  if (syncOn && isAuthReady(cfg.auth)) await offerSaveImport(game, cfg, bucket, email, false);
  await saveGameConfig();
  if (cfg.auth.mode === "access") await checkPlayers(bucket, cfg, policy);

  return {
    ...siteOf(cfg),
    locked: !isAuthReady(cfg.auth),
    build: { files: files.length, bytes: totalBytes, r2Files: overflow.length, r2Uploaded: r2 ? r2.uploaded : 0 },
    next: [
      "The config is stored in R2: on another PC, log in to the same Cloudflare account and run the command again.",
      "On a phone: open the link → browser menu → “Add to Home Screen” to play fullscreen.",
    ],
  };
}

// The deployer's per-player settings for the Worker, with a word on what they do.
export function perPlayerSettings(engine, cfg, policy) {
  const emails = playerEmails(cfg);
  if (!emails.length) return {};
  if (cfg.auth.mode !== "access") {
    // Locked until Access is on: asked again for the redeploy after it.
    if (cfg.auth.mode === "none") log.warn(`"players" has settings for ${emails.length} email(s), but a public site cannot tell players apart: everyone gets the shared settings.`);
    return {};
  }
  const settings = playerOverrides(engine, cfg, policy);
  log.info(c.dim(`Own settings for ${Object.keys(settings).length} of the ${emails.length} email(s) in "players".`));
  return settings;
}

export function isAuthReady(auth = {}) {
  return auth.mode === "none" || (auth.mode === "access" && !!auth.teamDomain && !!auth.aud);
}

// Opens the config in the OS text editor ($VISUAL / $EDITOR first) and blocks until it is closed; reopens on bad JSON.
export function editInEditor(cfg) {
  const file = path.join(os.tmpdir(), `rwk-${cfg.slug}-${crypto.randomUUID().slice(0, 8)}.json`);
  fs.writeFileSync(file, JSON.stringify(cfg, null, 2));
  try {
    for (;;) {
      const editor = editorCommand(file);
      log.info(`Opening ${editor.label}: edit, save, then close it to continue…`);
      // A terminal editor (nano, vim) needs the terminal; a GUI one ignores it.
      const run = spawnSync(editor.cmd, editor.args, { stdio: "inherit" });
      if (run.error) throw new Error(`Could not start ${editor.cmd} (${run.error.message}). Set the EDITOR environment variable to your text editor, for example EDITOR=nano.`);
      try {
        const next = JSON.parse(fs.readFileSync(file, "utf8").replace(/^﻿/, ""));
        // Identity fields are not editable: they tie the config to the game and Worker.
        // rwk rename changes the site name. The policy is the game creator's.
        // liveSettings and toolkitVersion say what the deployed Worker can do.
        return { ...next, slug: cfg.slug, fingerprint: cfg.fingerprint, storageId: cfg.storageId, retiredWorkers: cfg.retiredWorkers, policy: cfg.policy, liveSettings: cfg.liveSettings, toolkitVersion: cfg.toolkitVersion };
      } catch (err) {
        log.warn(`Invalid JSON (${err.message}); reopening so you can fix it.`);
      }
    }
  } finally {
    fs.rmSync(file, { force: true });
  }
}

//---------------------------------------------------------------------------
// First-run questions
//---------------------------------------------------------------------------

async function createConfig(game, takenSlugs, name, project) {
  const slug =
    name ??
    (await ask("Site name (becomes <name>.<username>.workers.dev)", suggestSlug(game), (v) => {
      const problem = validateSlug(v);
      if (problem) return problem;
      return takenSlugs.has(v) ? `"${v}" is already used by another game; choose another name.` : null;
    }, { hint: "Pass it with --name <site name>." }));
  if (name) log.ok(`Site name: ${name}`);

  const include = [];
  // Folders the rwk.json already includes are not asked about.
  const unknownDirs = game.unknownDirs.filter((dir) => !project || !project.include.includes(dir));
  if (unknownDirs.length) {
    log.info(`Non-standard folders in the game root: ${unknownDirs.join(", ")}`);
    for (const dir of unknownDirs) {
      if (await confirm(`Include "${dir}" in the web build? (yes if a plugin reads files from it)`, false)) include.push(dir);
    }
  }

  const syncEnabled = await confirm("Enable cloud save sync (continue playing on other devices)?", true);
  const presetNames = Object.keys(PRESETS);
  const preset = await choose(
    "Which features may players use? (each one can be changed later with rwk config)",
    presetNames.map((name) => ({ label: PRESETS[name].label, value: name })),
    presetNames.indexOf(DEFAULT_PRESET)
  );

  const cfg = baseConfig(game, { slug, include, syncEnabled, preset });

  const keys = scanKeys(game.root);
  cfg.controls.scannedKeys = keys.map((k) => k.key);
  if (keys.length) {
    log.info("The game's plugins use keys a touch screen cannot press:");
    for (const k of keys) log.info(`    ${c.bold(k.key.padEnd(10))} ${c.dim(k.plugins.join(", "))}`);
  } else {
    log.info("No plugin uses special keys.");
  }
  if (await confirm("Add an on-screen gamepad for touch screens (D-pad, A/B/X/Y)?", true)) {
    cfg.controls.enabled = true;
    cfg.controls.dpad = await confirm("Include the D-pad? (No = move by tapping the map only)", true);
    cfg.controls.buttons = await askButtons(keys, false);
    log.info(c.dim("Labels, groups, size and opacity can be changed with rwk config; in game, ⚙ → Edit button layout moves buttons around."));
  }
  return cfg;
}

async function askButtons(keys, shoulder) {
  // A/B/X/Y (and L/R when on) already press these.
  const covered = gamepadKeys(shoulder);
  keys = keys.filter((k) => !covered.has(k.key.toLowerCase()));
  const buttons = [];
  if (keys.length) {
    log.info(c.dim("These keys go in the ⌨ panel of the in-game toolbar, each with a hint saying what it is for."));
    log.info(c.dim('Label each button: Enter = default, "-" = skip this key.'));
  }
  for (const k of keys) {
    const label = await ask(`Button label for key "${k.key}" (${k.hint})`, defaultLabel(k.key));
    if (label !== "-") buttons.push({ key: k.key, label, hint: k.hint });
  }
  return buttons;
}

// After a game patch, plugins may use new keys: offer buttons for those only.
export async function addNewKeys(game, cfg) {
  const controls = cfg.controls;
  if (!controls) return;
  const known = new Set(controls.scannedKeys || []);
  const scanned = scanKeys(game.root);
  // Configs made before hints existed, or before they were cleaned up: say
  // what each key is for.
  for (const b of controls.buttons || []) {
    if (b.hint) b.hint = cleanHint(b.hint);
    const k = !b.hint && scanned.find((s) => s.key === b.key);
    if (k) b.hint = k.hint;
  }
  const fresh = scanned.filter((k) => !known.has(k.key));
  if (!fresh.length) return;
  controls.scannedKeys = [...known, ...fresh.map((k) => k.key)];
  log.info(`This game version uses new keys: ${fresh.map((k) => k.key).join(", ")}`);
  if (controls.enabled && (await confirm("Add on-screen buttons for these keys?", true))) {
    controls.buttons.push(...(await askButtons(fresh, controls.shoulder === true)));
  }
}

//---------------------------------------------------------------------------
// Rename: the Worker's name is the site name, so the site moves to a new
// Worker and the old one is deleted once the new site works. Saves, older
// saves, the player list and large files stay where they are in R2
// (storageId), so nothing is copied.
//---------------------------------------------------------------------------

async function renameSite(cfg, taken, to) {
  const slug = await askNewName(cfg, taken, to);
  const access = cfg.auth.mode === "access";
  if (!(await confirm(`Rename "${cfg.slug}" to "${slug}"?`, true))) return false;

  cfg.storageId = storageIdOf(cfg);
  cfg.retiredWorkers = [...new Set([...(cfg.retiredWorkers || []), cfg.slug])].filter((name) => name !== slug);
  cfg.slug = slug;
  delete cfg.url;
  if (access) cfg.auth = {}; // the new hostname needs its own Access application
  return true;
}

async function retireWorkers(cfg) {
  if (!cfg.retiredWorkers) return;
  if (!cfg.retiredWorkers.length) {
    delete cfg.retiredWorkers; // renamed back to the old name
    return;
  }
  log.step("Old site address");
  for (const name of cfg.retiredWorkers) {
    // Deleting a site is for a person to say yes to.
    if (!(await confirm(`Delete the old Worker "${name}" now? Its link stops working; saves are kept.`, true, { whenUnattended: false }))) {
      log.info(c.dim("Asked again at the next deploy."));
      continue;
    }
    if (await deleteWorker(name)) {
      log.ok(`Deleted the Worker "${name}"`);
      cfg.retiredWorkers = cfg.retiredWorkers.filter((other) => other !== name);
    } else {
      log.warn(`Could not delete "${name}". Delete it in the dashboard: Workers & Pages → ${name} → Settings → Delete.`);
    }
  }
  if (cfg.retiredWorkers.length) return;
  delete cfg.retiredWorkers;
  if (cfg.auth.mode === "access") {
    log.info(c.dim("Its Access application is still listed in Zero Trust → Access controls → Applications: delete it there if you like."));
  }
}

//---------------------------------------------------------------------------
// Access protection
//---------------------------------------------------------------------------

const ACCESS_TOKEN_HINT =
  'Give the API token the "Access: Apps and Policies → Edit" and "Access: Organizations, Identity Providers, and Groups → Read" permissions (see the guide, "Run without questions"), or run the command once in a terminal.';

// Creates the Access application and its policy through the API.
// -> true when cfg.auth is set; false when it could not be done (the reason is logged).
async function accessThroughApi(cfg, account, email) {
  const emails = [...new Set([email, ...playerEmails(cfg)].filter(Boolean).map((e) => e.trim().toLowerCase()))];
  if (!cfg.url) return fail("the site's link is not known yet");
  if (!emails.length) return fail("no email to allow: set \"players\" in the config, or give the API token the User Details → Read permission");
  const token = await apiToken();
  if (!token) return fail("not logged in");
  try {
    const result = await enableAccess({ token, accountId: account.id, slug: cfg.slug, url: cfg.url, emails });
    cfg.auth = { mode: "access", teamDomain: result.teamDomain, aud: result.aud };
    log.ok(`Cloudflare Access is on for ${emails.join(", ")} (${result.teamDomain})`);
    return true;
  } catch (err) {
    if (!(err instanceof AccessApiError)) throw err;
    return fail(err.denied ? `${err.message}\n${ACCESS_TOKEN_HINT}` : err.message);
  }

  function fail(reason) {
    log.warn(`Could not turn Access on through the Cloudflare API: ${reason}`);
    return false;
  }
}

async function setupAuth(cfg, account, policy, email) {
  log.step("Access protection");
  if (isUnattended()) {
    // Nobody to ask: Access is the only safe answer, and a public site stays a person's call.
    if (await accessThroughApi(cfg, account, email)) return;
    throw new NeedsAnswer("The site is deployed but locked, and Access could not be turned on without a person (see above). Run the command in a terminal once; later runs can be non-interactive.");
  }
  log.info("The site is locked for now. Choose how to protect it:");
  const options = [{ label: "Cloudflare Access: email login, saves tied to the email (recommended)", value: "access" }];
  if (allowsPublic(policy)) options.push({ label: "No protection: a public site anyone can open, everyone shares saves", value: "none" });
  else log.info(c.dim("A public site is not offered: the game's creator asks that it stays private."));
  options.push({ label: "Later (keep the site locked)", value: "later" });
  const mode = await choose("Option", options);
  if (mode === "later") return;
  if (mode === "none") {
    const auth = await askPublic(cfg, policy);
    if (auth) cfg.auth = auth;
    return;
  }

  if (!cfg.url) cfg.url = await ask("Worker URL (https://<name>.<username>.workers.dev)");
  if (await accessThroughApi(cfg, account, email)) {
    log.info("Only that email may sign in at first. To invite players, see \"Protect the site and invite players\" in the guide.");
    return;
  }
  log.info("Doing it in the dashboard instead:");
  const dash = `https://dash.cloudflare.com/${account.id}/workers/services/view/${cfg.slug}/production/access`;
  log.info("Follow these steps in the browser (opening the Worker's Access page):");
  log.info(`  1. Select ${c.bold("Protect this Worker behind Access")}.`);
  log.info(`  2. Scope: ${c.bold("All traffic")} (${c.bold("Previews only")} leaves the game itself open).`);
  log.info(`  3. Authentication policy: ${c.bold("Add policy")} → ${c.bold("Cloudflare account")}, then ${c.bold("Apply Access")}.`);
  log.info("  4. If Cloudflare asks to set up Zero Trust (first time): pick a team name and the Free plan.");
  log.info(`  Only the Cloudflare account's email may sign in at first. To invite players, see "Protect the site and invite players" in the guide.`);
  log.info(c.dim(`  ${dash}`));
  openBrowser(dash);

  for (;;) {
    await pause("When done, press Enter to check…");
    const probe = await probeAccess(cfg.url);
    if (probe.protected && probe.aud) {
      cfg.auth = { mode: "access", teamDomain: probe.teamDomain, aud: probe.aud };
      log.ok(`Access detected: ${probe.teamDomain}`);
      return;
    }
    log.warn(probe.error ? `Could not reach the site: ${probe.error}` : "The site is not protected by Access yet (changes can take about a minute).");
    const next = await choose("Next", [
      { label: "Check again", value: "retry" },
      { label: "Enter the team domain and AUD manually", value: "manual" },
      { label: "Later (keep the site locked)", value: "later" },
    ]);
    if (next === "later") return;
    if (next === "manual") {
      const teamDomain = await ask("Team domain (e.g. myteam.cloudflareaccess.com)", "", (v) =>
        /^[a-z0-9-]+\.cloudflareaccess\.com$/i.test(v) ? null : "Format: <team>.cloudflareaccess.com"
      );
      const aud = await ask("Application Audience (AUD) tag", "", (v) => (/^[a-f0-9]{32,}$/i.test(v) ? null : "The AUD is a long hex string"));
      cfg.auth = { mode: "access", teamDomain: teamDomain.toLowerCase(), aud };
      return;
    }
  }
}

// A public site hands the game to anyone with the link, which is the game
// creator's call. Ask why it may be public, and keep the answer.
async function askPublic(cfg, policy) {
  let basis;
  if (policy && policy.hosting === "public") {
    log.ok(`The game's creator allows public hosting (${POLICY_FILE}).`);
    basis = "creator-policy";
  } else {
    log.warn("A public site is redistribution of the game: only the people who hold its rights may decide that.");
    basis = await choose(
      "Why may this game be public?",
      [
        { label: "I made this game, or I publish it for the people who made it", value: "author" },
        { label: "Its creators allow anyone to host it publicly (its license or their written permission says so)", value: "permission" },
        { label: "Neither: keep the site locked and use Cloudflare Access instead", value: null },
      ],
      0,
      { whenUnattended: null, hint: "Only a person can answer this: run the command once in a terminal." }
    );
    if (!basis) return null;
  }
  cfg.indexable = await confirm("Let search engines list the site?", false);
  return { mode: "none", basis, since: new Date().toISOString().slice(0, 10) };
}

// Public sites from before the question existed, or whose game now ships a
// policy that wants it private.
async function checkPublic(cfg, policy) {
  if (cfg.auth.mode !== "none") return;
  if (!allowsPublic(policy)) {
    log.warn("The game's creator asks that the site stays private, so it will no longer be public.");
    log.info("The site is locked until Cloudflare Access is on (the next step).");
    cfg.auth = {};
    delete cfg.indexable;
    return;
  }
  if (cfg.auth.basis) return;
  log.step("Public site");
  log.info("This site is public. The toolkit now asks why, once.");
  const auth = await askPublic(cfg, policy);
  if (!auth) {
    log.info("The site is locked until Cloudflare Access is on (the next step).");
    delete cfg.indexable;
  }
  cfg.auth = auth || {};
}

// How many emails have saves for this game, recorded by the Worker.
const SHARE_WARN_AT = 5;
export async function checkPlayers(bucket, cfg, policy) {
  let players;
  try {
    players = await loadPlayers(bucket, storageIdOf(cfg));
  } catch {
    return; // Only a reminder: never fail a deploy over it.
  }
  const count = Object.keys(players).length;
  if (!count) return;
  const limit = policy && policy.hosting === "personal" ? 1 : policy && policy.hosting === "shared" ? Infinity : SHARE_WARN_AT;
  if (count <= limit) {
    log.info(c.dim(`${count} email(s) have saves for this game.`));
    return;
  }
  log.warn(`${count} different emails have saves for this game.`);
  if (limit === 1) log.info("The game's creator asked that this copy is for your own use only. Remove the other emails from the Access policy.");
  else log.info("Sharing your copy with many people is redistribution of the game. Keep it to yourself and your household, or ask the creator.");
}

function openBrowser(url) {
  try {
    const { cmd, args } = openUrlCommand(url);
    // A missing opener (xdg-open on a bare server) reports through 'error', not by throwing.
    spawn(cmd, args, { detached: true, stdio: "ignore" }).on("error", () => {}).unref();
  } catch {
    // The URL is printed anyway.
  }
}

//---------------------------------------------------------------------------
// --dry-run for rename and saves import
//---------------------------------------------------------------------------

// The saved configs, or none when the toolkit's bucket does not exist yet (a dry run does not create it).
async function loadConfigsIfAny(bucket) {
  try {
    return await loadGameConfigs(bucket);
  } catch (err) {
    if (/bucket does not exist|NoSuchBucket|10006/i.test(err.message)) return {};
    throw err;
  }
}

//---------------------------------------------------------------------------
// Save import
//---------------------------------------------------------------------------

async function offerSaveImport(game, cfg, bucket, accountEmail, force) {
  if (!cfg.sync.enabled) {
    log.warn("Save sync is disabled for this game.");
    return;
  }
  if (!force && cfg.savesImportedAt) return;
  if (!game.saveDir) {
    if (force) log.warn("No save/ folder found in the game.");
    return;
  }
  const saves = listSaveFiles(game.saveDir, game.engine);
  if (!saves.length) return;

  log.step("Local saves");
  log.info(`Found ${saves.length} save(s) in ${game.saveDir}: ${saves.map((s) => s.name).join(", ")}`);
  // Unattended, only the saves import command uploads them; a deploy leaves
  // the question for the next run in a terminal.
  if (!force && isUnattended()) {
    log.info(c.dim("Not uploaded in a non-interactive run: use rwk saves import to upload them."));
    return;
  }
  if (!(await confirm("Upload these saves to the cloud? (overwrites cloud saves with the same name)", !cfg.savesImportedAt, { whenUnattended: true }))) {
    if (!force) cfg.savesImportedAt = "skipped";
    return;
  }
  const email =
    cfg.auth.mode === "none"
      ? "public"
      : await ask("The email you use to sign in through Cloudflare Access", accountEmail || "", (v) => (/.+@.+/.test(v) ? null : "Invalid email"), {
          hint: 'Give the API token "User Details: Read", or upload the saves from a terminal.',
        });
  const count = await importSaves({ bucket, slug: storageIdOf(cfg), email, saves, engine: game.engine, gameTitle: game.gameTitle });
  cfg.savesImportedAt = new Date().toISOString();
  log.ok(`Uploaded ${count} save(s) to the cloud`);
}
