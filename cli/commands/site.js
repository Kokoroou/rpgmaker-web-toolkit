// Commands on a deployed site, from its link or name alone: status, list,
// open, logs, delete. The game folder is not needed, only the Cloudflare login.

import { spawn } from "node:child_process";
import { DEFAULT_BUCKET, loadSettings } from "../lib/config.js";
import { apiToken, deleteWorker, loadGameConfigs, loadPlayers, probeAccess, saveGameConfigs } from "../lib/cloudflare.js";
import { deleteObject, listObjects } from "../lib/r2-api.js";
import { settingsKey } from "../../worker/settings.js";
import { findGameBySite, storageIdOf } from "../lib/game.js";
import { openUrlCommand } from "../lib/platform.js";
import { TOOLKIT_VERSION } from "../lib/stage.js";
import { expectTarget, siteNameOf } from "../lib/target.js";
import { CliError, NeedsAnswer, ask, c, formatBytes, log, planSteps, progressLine } from "../lib/ui.js";
import { wrangler } from "../lib/wrangler.js";
import { connect, siteOf } from "../lib/session.js";

// What the commands call: the Cloudflare and terminal steps, replaceable in tests.
const realDeps = { connect, loadSettings, loadGameConfigs, saveGameConfigs, deleteWorker, ask, spawn, wrangler, apiToken, listObjects, deleteObject };
const depsOf = (deps) => ({ ...realDeps, ...deps });

// The game's stored config for a link or name target. Needs the Cloudflare login (connect() first).
export async function findSite(target, deps) {
  return (await findEntry(target, deps))[1];
}

// -> [fingerprint, cfg, configs]
async function findEntry(target, deps) {
  log.step("Finding the game");
  const configs = await depsOf(deps).loadGameConfigs(DEFAULT_BUCKET);
  const entry = findGameBySite(configs, siteNameOf(target));
  log.ok(`${entry[1].engine} · ${entry[1].title}`);
  return [...entry, configs];
}

async function targetOf(input, usage, deps) {
  return (await sessionOf(input, usage, deps)).target;
}

async function sessionOf(input, usage, deps) {
  const d = depsOf(deps);
  if (!input) {
    input = await d.ask("Paste the game's link or its site name", "", null, { hint: `Pass it after the command: ${usage}` });
  }
  const target = expectTarget(input, ["link", "name"], usage);
  const session = await d.connect(d.loadSettings());
  return { target, session };
}

const ACCESS_WORDS = { access: "Cloudflare Access (sign-in by email)", none: "none: anyone with the link can play" };

// What the site is, from the stored config and a request to it.
// -> { facts: [[label, text]], up: boolean | null }
export async function describeSite(cfg, { probe = probeAccess, players = loadPlayers } = {}) {
  const facts = [["Game", `${cfg.title} (${cfg.engine})`]];
  let up = null;
  if (cfg.url) {
    const result = await probe(cfg.url);
    up = !result.error && (!!result.protected || (result.status >= 200 && result.status < 400));
    facts.push(["Site", result.error ? c.yellow(`not reachable: ${result.error}`) : result.protected ? "up, behind Cloudflare Access" : `up (HTTP ${result.status})`]);
    if (cfg.auth && cfg.auth.mode === "access" && !result.protected && !result.error) {
      facts.push(["Access", c.yellow("set up, but NOT protecting the site: check the dashboard (Worker → Access)")]);
    } else {
      facts.push(["Access", (cfg.auth && ACCESS_WORDS[cfg.auth.mode]) || "not set up yet"]);
    }
  }
  try {
    const count = Object.keys(await players(DEFAULT_BUCKET, storageIdOf(cfg))).length;
    facts.push(["Players", `${count} email(s) have saves`]);
  } catch {
    // Only information.
  }
  facts.push(["Cloud sync", cfg.sync && cfg.sync.enabled === false ? "off" : "on"]);
  facts.push(["Toolkit", toolkitFact(cfg.toolkitVersion)]);
  return { facts, up };
}

// "1.2.3" -> -1, 0, 1 against another version; pre-release tags are ignored.
function compareVersions(a, b) {
  const parts = (v) => String(v).split("-")[0].split(".").map((n) => parseInt(n, 10) || 0);
  const [x, y] = [parts(a), parts(b)];
  for (let i = 0; i < Math.max(x.length, y.length); i++) {
    if ((x[i] || 0) !== (y[i] || 0)) return (x[i] || 0) < (y[i] || 0) ? -1 : 1;
  }
  return 0;
}

// The site's toolkit (recorded by deploy and upgrade) against this CLI's.
export function toolkitFact(siteVersion, cliVersion = TOOLKIT_VERSION) {
  if (!siteVersion) return `not recorded (deployed before it was); this CLI is ${cliVersion}, rwk upgrade brings the site to it`;
  const order = compareVersions(siteVersion, cliVersion);
  if (order === 0) return `${siteVersion}, the same as this CLI`;
  if (order < 0) return c.yellow(`${siteVersion}; this CLI is ${cliVersion}: rwk upgrade brings the site to it`);
  return `${siteVersion}, newer than this CLI (${cliVersion}): update the toolkit before rwk upgrade`;
}

export async function status(input, deps = {}) {
  const target = await targetOf(input, "rwk status <game link | site name>", deps);
  const cfg = await findSite(target, deps);
  log.step("Checking the site");
  const { facts, up } = await describeSite(cfg, deps);
  return { ...siteOf(cfg), engine: cfg.engine, title: cfg.title, toolkitVersion: cfg.toolkitVersion || null, up, facts, next: [] };
}

export async function list(deps = {}) {
  const d = depsOf(deps);
  await d.connect(d.loadSettings());
  const configs = await d.loadGameConfigs(DEFAULT_BUCKET);
  const games = Object.values(configs).sort((a, b) => a.slug.localeCompare(b.slug));
  log.step("Games in this account");
  for (const cfg of games) log.info(`${cfg.slug.padEnd(24)} ${cfg.engine}  ${cfg.url || c.dim("(no link recorded)")}`);
  if (!games.length) log.info("None yet: rwk deploy <game folder>");
  return {
    sites: games.map((cfg) => ({ site: cfg.slug, url: cfg.url || null, engine: cfg.engine, title: cfg.title })),
    facts: [["Games", String(games.length)]],
    next: [],
  };
}

export async function open(input, deps = {}) {
  const target = await targetOf(input, "rwk open <game link | site name>", deps);
  const cfg = await findSite(target, deps);
  if (!cfg.url) throw new CliError(`No link is recorded for "${cfg.slug}".`, { hint: "Deploy it again from the game folder." });
  const { cmd, args } = openUrlCommand(cfg.url);
  // A missing opener (xdg-open on a bare server) reports through 'error', not by throwing.
  depsOf(deps).spawn(cmd, args, { detached: true, stdio: "ignore" }).on("error", () => {}).unref();
  log.ok(`Opening ${cfg.url}`);
  return { ...siteOf(cfg), next: [] };
}

// Streams the Worker's logs (wrangler tail) until Ctrl+C.
export async function logs(input, deps = {}) {
  if (!process.stdin.isTTY) throw new NeedsAnswer("logs streams until you stop it with Ctrl+C.", "Run it in a terminal.");
  const target = await targetOf(input, "rwk logs <game link | site name>", deps);
  const cfg = await findSite(target, deps);
  log.info(c.dim("Showing requests and errors as they happen. Press Ctrl+C to stop."));
  // Ctrl+C ends wrangler, not the toolkit with "Cancelled".
  process.removeAllListeners("SIGINT");
  process.on("SIGINT", () => {});
  const res = await depsOf(deps).wrangler(["tail", cfg.slug, "--format", "pretty"], { interactive: true });
  if (res.code && res.code !== 130) throw new CliError(`wrangler tail stopped with exit code ${res.code}.`);
  return null;
}

// What a game keeps in R2 under its storage id, from listings of saves/, history/
// and assets/<id>/: the keys to delete for delete --purge. Saves and older saves sit
// under saves/<player>/<id>/ and history/<player>/<id>/.
// -> [{ key, size }]
export function purgeObjects(listed, gameId) {
  const own = (item) => {
    const parts = item.key.split("/");
    if (parts[0] === "saves" || parts[0] === "history") return parts[2] === gameId && parts.length > 3;
    return item.key.startsWith(`assets/${gameId}/`);
  };
  const singles = [`rwk/players/${gameId}.json`, settingsKey(gameId)].map((key) => ({ key, size: 0 }));
  return listed.filter(own).concat(singles);
}

// The objects delete --purge would remove, listed before anything is deleted.
async function listPurge(fingerprint, configs, session, d) {
  const cfg = configs[fingerprint];
  const gameId = storageIdOf(cfg);
  const sharing = Object.entries(configs).find(([key, other]) => key !== fingerprint && storageIdOf(other) === gameId)?.[1];
  if (sharing) throw new CliError(`The game "${sharing.slug}" uses the same storage as "${cfg.slug}", so --purge would delete its saves too.`, { hint: "Delete without --purge." });
  const token = await d.apiToken();
  if (!token) throw new CliError("Not logged in to Cloudflare.", { hint: "Run the command in a terminal once to log in, or set CLOUDFLARE_API_TOKEN." });
  const where = { token, accountId: session.account.id, bucket: DEFAULT_BUCKET };
  const listed = [];
  for (const prefix of ["saves/", "history/", `assets/${gameId}/`]) listed.push(...(await d.listObjects({ ...where, prefix })));
  return { where, objects: purgeObjects(listed, gameId) };
}

// Deletes the Worker and forgets the game's config. Saves and large files stay in R2,
// unless purge: then they go too, before the config, so a failed purge can be run again.
export async function deleteSite(input, { purge = false } = {}, deps = {}) {
  const d = depsOf(deps);
  const { target, session } = await sessionOf(input, "rwk delete <game link | site name> [--purge]", deps);
  const [fingerprint, cfg, known] = await findEntry(target, deps);
  const doomed = purge ? await listPurge(fingerprint, known, session, d) : null;

  log.warn(`This deletes the Worker "${cfg.slug}": ${cfg.url || "its link"} stops working for everyone.`);
  if (doomed) {
    const files = doomed.objects.filter((o) => o.size);
    const bytes = files.reduce((sum, o) => sum + o.size, 0);
    log.warn(`--purge also deletes ${files.length} file(s) in R2 (${formatBytes(bytes)}): every player's saves and older saves, the settings, the player list and the large files. This cannot be undone.`);
    log.info(c.dim(`To keep a player's saves, first run: rwk saves export ${cfg.slug} --email <address>`));
  } else {
    log.info("The saves, the save history and the large files stay in R2, so the game can be published again.");
  }
  // No default: a run without a person stops here with exit code 2.
  await d.ask(`Type the site name (${cfg.slug}) to delete it`, "", (v) => (v === cfg.slug ? null : `That is not "${cfg.slug}".`), {
    hint: "Deleting needs a person: run it in a terminal.",
  });

  if (doomed) planSteps(2);
  log.step("Deleting the Worker");
  if (!(await d.deleteWorker(cfg.slug))) {
    throw new CliError(`Could not delete the Worker "${cfg.slug}".`, { hint: "Delete it in the Cloudflare dashboard: Workers & Pages → the game → Settings → Delete." });
  }
  for (const name of cfg.retiredWorkers || []) {
    if (!(await d.deleteWorker(name))) log.warn(`The old Worker "${name}" could not be deleted: remove it in the dashboard.`);
  }
  if (doomed) {
    log.step("Deleting the game's files in R2");
    const bar = progressLine();
    for (const [i, object] of doomed.objects.entries()) {
      // A plain line per object would flood a log: there, only the summary below.
      if (bar.live) bar.update(`${i + 1}/${doomed.objects.length} · ${object.key}`);
      await d.deleteObject({ ...doomed.where, key: object.key });
    }
    bar.end();
    log.ok(`${doomed.objects.length} object(s) deleted`);
  }
  const configs = await d.loadGameConfigs(DEFAULT_BUCKET);
  delete configs[fingerprint];
  await d.saveGameConfigs(DEFAULT_BUCKET, configs);
  log.ok(`Worker "${cfg.slug}" deleted`);
  return {
    ...siteOf(cfg),
    url: null,
    facts: [["Deleted", cfg.url || cfg.slug], ...(doomed ? [["R2", `${doomed.objects.length} object(s) deleted`]] : [])],
    next: ["The site's Cloudflare Access application, if any, stays in the dashboard (Zero Trust → Access): delete it there."],
  };
}
