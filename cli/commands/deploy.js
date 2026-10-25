import { spawn, spawnSync } from "node:child_process";
import crypto from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { DEFAULT_BUCKET, LIMITS_CACHE_FILE, TOOLKIT_ROOT, createBuildDir, loadSettings, saveSettings } from "../lib/config.js";
import {
  deleteWorker,
  deployWorker,
  ensureBucket,
  ensureLogin,
  importSaves,
  listSaveFiles,
  loadGameConfigs,
  loadPlayers,
  probeAccess,
  saveGameConfigs,
  syncOverflow,
  writeWorkerProject,
} from "../lib/cloudflare.js";
import { analyzeGame, collectFiles, mobileOnlyMissing, nonAsciiPaths, storageIdOf, suggestSlug, takenNames, validateSlug } from "../lib/game.js";
import { loadLimits } from "../lib/limits.js";
import { GAMEPAD_KEYS, cleanHint, defaultLabel, scanKeys } from "../lib/keys.js";
import { POLICY_FILE, allowsPublic, applyPolicy, describeHosting, isIndexable, readPolicy } from "../lib/policy.js";
import { generatedFiles, saveHistoryConfig, syncPublicDir } from "../lib/stage.js";
import { ask, c, choose, confirm, formatBytes, log, pause, warnings } from "../lib/ui.js";

export async function deploy(inputPath, { importOnly = false, editOnly = false, rename = false } = {}) {
  if (!inputPath) inputPath = await ask("Drag and drop or paste the game folder path");
  inputPath = inputPath.replace(/^["']|["']$/g, "");

  //-------------------------------------------------------------------------
  log.step("Analyzing the game");
  const game = analyzeGame(inputPath);
  log.ok(`${game.engine} · ${game.title}`);
  log.info(c.dim(game.root));
  const policy = readPolicy(game);
  showPolicy(policy);

  const settings = loadSettings();
  const { email, account } = await connect(settings);
  const bucket = DEFAULT_BUCKET;
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
  if (cfg) {
    saved = JSON.stringify(cfg);
    log.ok(`Using the config saved in R2 (site name: ${cfg.slug})`);
  } else if (rename) {
    throw new Error("This game is not published yet: run the deploy command, which asks for the site name.");
  } else {
    log.info("First deploy of this game: answer a few questions (Enter = use the default).");
    cfg = await createConfig(game, takenNames(configs, game.fingerprint));
  }
  await addNewKeys(game, cfg);
  await saveGameConfig();

  // Then deploys as usual, under the new name.
  if (rename) {
    if (!(await renameSite(cfg, takenNames(configs, game.fingerprint)))) return;
    await saveGameConfig();
  }

  if (editOnly) {
    cfg = editInNotepad(cfg);
    await saveGameConfig();
    log.ok("Config saved to R2. Run the deploy command again to apply it.");
    return;
  }

  // The creator can turn sync off; the stored config keeps the deployer's choice.
  const syncOn = applyPolicy(cfg, policy).sync.enabled;
  if (importOnly) {
    if (!syncOn) {
      log.warn("The game's creator turned cloud save sync off for this game.");
      return;
    }
    await offerSaveImport(game, cfg, bucket, email, true);
    await saveGameConfig();
    return;
  }

  await checkPublic(cfg, policy);
  await saveGameConfig();

  //-------------------------------------------------------------------------
  log.step("Preparing the web build");
  const limits = await loadLimits({ cacheFile: LIMITS_CACHE_FILE });
  const { maxFiles, maxFileBytes } = limits.assets;
  if (limits.newer) log.info(c.dim(`Free plan limits updated on ${limits.updated}: ${maxFiles} files, ${formatMiB(maxFileBytes)} each`));
  const buildDir = createBuildDir(game.root, cfg.slug);
  const files = collectFiles(game, cfg);
  const overflow = files.filter((f) => f.size > maxFileBytes);
  const assets = files.filter((f) => f.size <= maxFileBytes);
  const generated = generatedFiles(game, applyPolicy(cfg, policy), files);
  const assetCount = new Set([...assets.map((f) => f.rel), ...generated.keys()]).size;
  const totalBytes = files.reduce((sum, f) => sum + f.size, 0);
  log.info(`${files.length} files, ${formatBytes(totalBytes)} (${overflow.length} file(s) over ${formatMiB(maxFileBytes)} go to R2)`);
  if (assetCount > maxFiles) throw tooManyFiles(assets, assetCount, maxFiles);
  if (game.engine === "MV") warnMobileMedia(files);
  const oddNames = nonAsciiPaths(files);
  if (oddNames.length) {
    const shown = oddNames.slice(0, 3).join(", ") + (oddNames.length > 3 ? ", …" : "");
    log.warn(`${oddNames.length} file name(s) have non-ASCII characters (${shown}). If a picture or sound is missing in the browser, check these first.`);
  }

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
  const project = {
    buildDir,
    slug: cfg.slug,
    gameId: storageIdOf(cfg),
    bucket,
    overflowRels: overflow.map((f) => f.rel),
    toolkitRoot: TOOLKIT_ROOT,
    indexable: isIndexable(cfg),
    saveHistory: saveHistoryConfig(cfg.saveHistory),
  };
  const authReady = isAuthReady(cfg.auth);
  let url = await deployWorker(writeWorkerProject({ ...project, auth: cfg.auth, locked: !authReady }));
  if (url) cfg.url = url;
  await saveGameConfig();

  if (!authReady) {
    await setupAuth(cfg, account, policy);
    await saveGameConfig();
    if (isAuthReady(cfg.auth)) {
      // A public site that asked to be listed needs the files without noindex.
      if (isIndexable(cfg)) {
        project.indexable = true;
        syncPublicDir(publicDir, assets, generatedFiles(game, applyPolicy(cfg, policy), files));
      }
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

  log.step("Build report");
  log.info(`${files.length} files, ${formatBytes(totalBytes)}`);
  if (r2) log.info(`${overflow.length} file(s) over ${formatMiB(maxFileBytes)} on R2 (uploaded ${r2.uploaded}, unchanged ${r2.unchanged})`);
  if (warnings.length) {
    log.info(`${warnings.length} warning(s) during this run:`);
    for (const w of warnings) log.info(`  ${c.yellow("!")} ${w}`);
  } else {
    log.ok("No warnings");
  }

  console.log(`\n${c.green("Done!")} ${cfg.url ? c.bold(cfg.url) : ""}`);
  log.info("The game's config is stored in R2: on another machine, log in to the same Cloudflare account and run the command again.");
  log.info("On a phone: open the link → browser menu → “Add to Home Screen” to play fullscreen.");
}

async function connect(settings) {
  log.step("Cloudflare");
  const session = await ensureLogin(settings);
  saveSettings({ accountId: settings.accountId });
  log.ok(`Account: ${session.account.name}`);
  return session;
}

function isAuthReady(auth = {}) {
  return auth.mode === "none" || (auth.mode === "access" && !!auth.teamDomain && !!auth.aud);
}

// Opens the config in Notepad and blocks until it is closed; reopens on bad JSON.
function editInNotepad(cfg) {
  const file = path.join(os.tmpdir(), `rwk-${cfg.slug}-${crypto.randomUUID().slice(0, 8)}.json`);
  fs.writeFileSync(file, JSON.stringify(cfg, null, 2));
  try {
    for (;;) {
      log.info("Opening Notepad: edit, save (Ctrl+S), then close the window to continue…");
      spawnSync("notepad.exe", [file], { stdio: "ignore" });
      try {
        const next = JSON.parse(fs.readFileSync(file, "utf8").replace(/^﻿/, ""));
        // Identity fields are not editable: they tie the config to the game and Worker.
        // The rename command changes the site name.
        return { ...next, slug: cfg.slug, fingerprint: cfg.fingerprint, storageId: cfg.storageId, retiredWorkers: cfg.retiredWorkers };
      } catch (err) {
        log.warn(`Invalid JSON (${err.message}); reopening so you can fix it.`);
      }
    }
  } finally {
    fs.rmSync(file, { force: true });
  }
}

function formatMiB(bytes) {
  return `${+(bytes / 1024 ** 2).toFixed(1)} MiB`;
}

// MV wants .m4a / .mp4 on phones; RWK_Core falls back to Ogg / WebM where the
// browser plays them, which leaves out older iPhones.
function warnMobileMedia(files) {
  const missing = mobileOnlyMissing(files);
  if (missing.audio) log.warn(`${missing.audio} audio file(s) have no .m4a version: phones whose browser cannot play Ogg (older iPhones) will have no sound for them.`);
  if (missing.movies) log.warn(`${missing.movies} movie(s) have no .mp4 version: phones whose browser cannot play WebM (older iPhones) will not show them.`);
}

function tooManyFiles(assets, count, max) {
  const byTop = new Map();
  for (const f of assets) {
    const top = f.rel.split("/")[0];
    byTop.set(top, (byTop.get(top) || 0) + 1);
  }
  const lines = [...byTop].sort((a, b) => b[1] - a[1]).map(([dir, n]) => `    ${dir}: ${n}`);
  return new Error(
    `The web build has ${count} files, over the Workers limit of ${max} (free plan).\n` +
      `${lines.join("\n")}\nAdd exclude patterns (edit-config command, e.g. "data-tw/**") and run again.`
  );
}

//---------------------------------------------------------------------------
// First-run questions
//---------------------------------------------------------------------------

async function createConfig(game, takenSlugs) {
  const slug = await ask("Site name (becomes <name>.<username>.workers.dev)", suggestSlug(game), (v) => {
    const problem = validateSlug(v);
    if (problem) return problem;
    return takenSlugs.has(v) ? `"${v}" is already used by another game; choose another name.` : null;
  });

  const include = [];
  if (game.unknownDirs.length) {
    log.info(`Non-standard folders in the game root: ${game.unknownDirs.join(", ")}`);
    for (const dir of game.unknownDirs) {
      if (await confirm(`Include "${dir}" in the web build? (yes if a plugin reads files from it)`, false)) include.push(dir);
    }
  }

  const syncEnabled = await confirm("Enable cloud save sync (continue playing on other devices)?", true);

  const cfg = {
    slug,
    title: game.title,
    engine: game.engine,
    fingerprint: game.fingerprint,
    include,
    exclude: [],
    sync: { enabled: syncEnabled },
    auth: {},
    controls: {
      enabled: false,
      showOn: "touch",
      gamepad: true,
      dpad: true,
      opacity: 0.35,
      scale: 1,
      buttons: [],
      scannedKeys: [],
    },
  };

  const keys = scanKeys(game.root);
  cfg.controls.scannedKeys = keys.map((k) => k.key);
  if (keys.length) {
    log.info("The game's plugins use keys a touch screen cannot press:");
    for (const k of keys) log.info(`    ${c.bold(k.key.padEnd(10))} ${c.dim(k.plugins.join(", "))}`);
  } else {
    log.info("No plugin uses special keys.");
  }
  if (await confirm("Add an on-screen gamepad for touch screens (D-pad, A/B/X/Y, L/R)?", true)) {
    cfg.controls.enabled = true;
    cfg.controls.dpad = await confirm("Include the D-pad? (No = move by tapping the map only)", true);
    cfg.controls.buttons = await askButtons(keys);
    log.info(c.dim("Labels, groups, size and opacity can be changed with edit-config; in game, ⚙ → Edit button layout moves buttons around."));
  }
  return cfg;
}

async function askButtons(keys) {
  // A/B/X/Y and L/R already press these.
  keys = keys.filter((k) => !GAMEPAD_KEYS.has(k.key.toLowerCase()));
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
async function addNewKeys(game, cfg) {
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
    controls.buttons.push(...(await askButtons(fresh)));
  }
}

//---------------------------------------------------------------------------
// Rename: the Worker's name is the site name, so the site moves to a new
// Worker and the old one is deleted once the new site works. Saves, older
// saves, the player list and large files stay where they are in R2
// (storageId), so nothing is copied.
//---------------------------------------------------------------------------

async function renameSite(cfg, taken) {
  log.step("New site name");
  log.info(`Now: ${cfg.url || cfg.slug}`);
  const slug = await ask("New site name (becomes <name>.<username>.workers.dev)", "", (v) => {
    if (v === cfg.slug) return "That is the current name.";
    const problem = validateSlug(v);
    if (problem) return problem;
    return taken.has(v) ? `"${v}" is already used by another game; choose another name.` : null;
  });
  const access = cfg.auth.mode === "access";
  log.info("What happens next:");
  log.info(`  1. The game is deployed as a new Worker "${slug}". Saves and older saves carry over.`);
  if (access) {
    log.info("  2. Cloudflare Access is set up again for the new address (the steps open in the browser).");
    log.info("     Emails you allowed on the old site must be allowed again in the new Access policy.");
  }
  log.info(`  ${access ? 3 : 2}. The old Worker "${cfg.slug}" is deleted: its link stops working.`);
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
    if (!(await confirm(`Delete the old Worker "${name}" now? Its link stops working; saves are kept.`, true))) {
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

async function setupAuth(cfg, account, policy) {
  log.step("Access protection");
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
    basis = await choose("Why may this game be public?", [
      { label: "I made this game, or I publish it for the people who made it", value: "author" },
      { label: "Its creators allow anyone to host it publicly (its license or their written permission says so)", value: "permission" },
      { label: "Neither: keep the site locked and use Cloudflare Access instead", value: null },
    ]);
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

function showPolicy(policy) {
  if (!policy) return;
  log.step("The game creator's hosting policy");
  log.info(`${path.basename(policy.file)}: the creator ${c.bold(describeHosting(policy.hosting))}.`);
  for (const problem of policy.problems) log.warn(`${problem}; treated as "personal".`);
  if (policy.message) log.info(`“${policy.message}”`);
  if (policy.contact) log.info(`Contact: ${policy.contact}`);
  const off = Object.keys(policy.features);
  if (off.length) log.info(`Turned off by the creator: ${off.join(", ")}`);
  if (policy.hosting === "none") {
    throw new Error(
      "The game's creator does not allow publishing this game as a website, so the toolkit stops here.\n" +
        "If you published it before, delete that Worker in the Cloudflare dashboard (Workers & Pages → the game → Settings → Delete)."
    );
  }
}

// How many emails have saves for this game, recorded by the Worker.
const SHARE_WARN_AT = 5;
async function checkPlayers(bucket, cfg, policy) {
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
    spawn("explorer.exe", [url], { detached: true, stdio: "ignore" }).unref();
  } catch {
    // The URL is printed anyway.
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
  if (!(await confirm("Upload these saves to the cloud? (overwrites cloud saves with the same name)", !cfg.savesImportedAt))) {
    if (!force) cfg.savesImportedAt = "skipped";
    return;
  }
  const email =
    cfg.auth.mode === "none"
      ? "public"
      : await ask("The email you use to sign in through Cloudflare Access", accountEmail || "", (v) => (/.+@.+/.test(v) ? null : "Invalid email"));
  const count = await importSaves({ bucket, slug: storageIdOf(cfg), email, saves, engine: game.engine, gameTitle: game.gameTitle });
  cfg.savesImportedAt = new Date().toISOString();
  log.ok(`Uploaded ${count} save(s) to the cloud`);
}
