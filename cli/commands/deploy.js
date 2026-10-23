import { spawn, spawnSync } from "node:child_process";
import crypto from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { DEFAULT_BUCKET, TOOLKIT_ROOT, createBuildDir, loadSettings, saveSettings } from "../lib/config.js";
import {
  deployWorker,
  ensureBucket,
  ensureLogin,
  importSaves,
  listSaveFiles,
  loadGameConfigs,
  probeAccess,
  saveGameConfigs,
  syncOverflow,
  writeWorkerProject,
} from "../lib/cloudflare.js";
import { MAX_ASSET_BYTES, MAX_ASSET_FILES, analyzeGame, collectFiles, suggestSlug, validateSlug } from "../lib/game.js";
import { GAMEPAD_KEYS, defaultLabel, scanKeys } from "../lib/keys.js";
import { generatedFiles, syncPublicDir } from "../lib/stage.js";
import { ask, c, choose, confirm, formatBytes, log, pause } from "../lib/ui.js";

export async function deploy(inputPath, { importOnly = false, editOnly = false } = {}) {
  if (!inputPath) inputPath = await ask("Drag and drop or paste the game folder path");
  inputPath = inputPath.replace(/^["']|["']$/g, "");

  //-------------------------------------------------------------------------
  log.step("Analyzing the game");
  const game = analyzeGame(inputPath);
  log.ok(`${game.engine} · ${game.title}`);
  log.info(c.dim(game.root));
  if (game.engine === "MV") log.warn("MV game: the adapter exists but has not been tested on a real game yet.");

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
  } else {
    log.info("First deploy of this game: answer a few questions (Enter = use the default).");
    const taken = new Set(Object.values(configs).map((other) => other.slug));
    cfg = await createConfig(game, taken);
  }
  await addNewKeys(game, cfg);
  await saveGameConfig();

  if (editOnly) {
    cfg = editInNotepad(cfg);
    await saveGameConfig();
    log.ok("Config saved to R2. Run the deploy command again to apply it.");
    return;
  }

  if (importOnly) {
    await offerSaveImport(game, cfg, bucket, email, true);
    await saveGameConfig();
    return;
  }

  //-------------------------------------------------------------------------
  log.step("Preparing the web build");
  const buildDir = createBuildDir(game.root, cfg.slug);
  const files = collectFiles(game, cfg);
  const overflow = files.filter((f) => f.size > MAX_ASSET_BYTES);
  const assets = files.filter((f) => f.size <= MAX_ASSET_BYTES);
  const generated = generatedFiles(game, cfg);
  const assetCount = new Set([...assets.map((f) => f.rel), ...generated.keys()]).size;
  const totalBytes = files.reduce((sum, f) => sum + f.size, 0);
  log.info(`${files.length} files, ${formatBytes(totalBytes)} (${overflow.length} file(s) over 25 MiB go to R2)`);
  if (assetCount > MAX_ASSET_FILES) throw tooManyFiles(assets, assetCount);

  const stats = syncPublicDir(path.join(buildDir, "public"), assets, generated);
  log.ok(`Temporary build ready (${stats.linked} hard links, ${stats.copied} copies)`);
  log.info(c.dim(buildDir));
  if (stats.copied) log.info(c.dim("Hard links were not possible (different drive, or the drive root is not writable), so files were copied."));

  //-------------------------------------------------------------------------
  if (overflow.length) {
    log.step("Large files on R2");
    const res = await syncOverflow({ bucket, slug: cfg.slug, files: overflow });
    log.ok(`Uploaded ${res.uploaded}, unchanged ${res.unchanged}, removed ${res.removed}`);
  }

  //-------------------------------------------------------------------------
  log.step("Deploying the Worker (wrangler uploads changed files only)");
  const project = {
    buildDir,
    slug: cfg.slug,
    bucket,
    overflowRels: overflow.map((f) => f.rel),
    toolkitRoot: TOOLKIT_ROOT,
  };
  const authReady = isAuthReady(cfg.auth);
  let url = await deployWorker(writeWorkerProject({ ...project, auth: cfg.auth, locked: !authReady }));
  if (url) cfg.url = url;
  await saveGameConfig();

  if (!authReady) {
    await setupAuth(cfg, account);
    await saveGameConfig();
    if (isAuthReady(cfg.auth)) {
      log.step("Redeploying with access protection");
      url = await deployWorker(writeWorkerProject({ ...project, auth: cfg.auth, locked: false }));
    } else {
      log.warn("The site is still locked. Run this command again to finish setting up access protection.");
    }
  } else if (cfg.auth.mode === "access" && cfg.url) {
    const probe = await probeAccess(cfg.url);
    if (probe.protected) log.ok("Cloudflare Access is protecting the site");
    else log.warn(c.yellow("Cloudflare Access is NO LONGER protecting the site! Check the dashboard (Worker → Settings → Domains & Routes)."));
  }

  //-------------------------------------------------------------------------
  if (cfg.sync.enabled && isAuthReady(cfg.auth)) await offerSaveImport(game, cfg, bucket, email, false);
  await saveGameConfig();

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
        return { ...next, slug: cfg.slug, fingerprint: cfg.fingerprint };
      } catch (err) {
        log.warn(`Invalid JSON (${err.message}); reopening so you can fix it.`);
      }
    }
  } finally {
    fs.rmSync(file, { force: true });
  }
}

function tooManyFiles(assets, count) {
  const byTop = new Map();
  for (const f of assets) {
    const top = f.rel.split("/")[0];
    byTop.set(top, (byTop.get(top) || 0) + 1);
  }
  const lines = [...byTop].sort((a, b) => b[1] - a[1]).map(([dir, n]) => `    ${dir}: ${n}`);
  return new Error(
    `The web build has ${count} files, over the Workers limit of ${MAX_ASSET_FILES} (free plan).\n` +
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
      opacity: 0.5,
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
    log.info(c.dim("Labels, groups, size and opacity can be changed with edit-config; in game, the ✥ button lets you drag buttons around."));
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
  // Configs made before hints existed: say what each key is for.
  for (const b of controls.buttons || []) {
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
// Access protection
//---------------------------------------------------------------------------

async function setupAuth(cfg, account) {
  log.step("Access protection");
  log.info("The site is locked for now. Choose how to protect it:");
  const mode = await choose("Option", [
    { label: "Cloudflare Access: email login, saves tied to the email (recommended)", value: "access" },
    { label: "No protection: anyone with the link can play, and everyone shares saves", value: "none" },
    { label: "Later (keep the site locked)", value: "later" },
  ]);
  if (mode === "later") return;
  if (mode === "none") {
    if (await confirm("Really make the site public?", false)) cfg.auth = { mode: "none" };
    return;
  }

  if (!cfg.url) cfg.url = await ask("Worker URL (https://<name>.<username>.workers.dev)");
  const dash = `https://dash.cloudflare.com/${account.id}/workers/services/view/${cfg.slug}/production/settings`;
  log.info("Follow these steps in the browser (opening the Worker's Settings page):");
  log.info(`  1. Under ${c.bold("Domains & Routes")}, on the ${c.bold("workers.dev")} row, enable ${c.bold("Cloudflare Access")}.`);
  log.info("  2. If this is your first time using Zero Trust: pick a team name and the Free plan.");
  log.info("  3. By default only the Cloudflare account's email may sign in. To allow other emails:");
  log.info("     Zero Trust → Access → Applications → the Worker's app → Policies.");
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
  const count = await importSaves({ bucket, slug: cfg.slug, email, saves });
  cfg.savesImportedAt = new Date().toISOString();
  log.ok(`Uploaded ${count} save(s) to the cloud`);
}
