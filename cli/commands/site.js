// Commands on a deployed site, from its link or name alone: status, list,
// open, logs, delete. The game folder is not needed, only the Cloudflare login.

import { spawn } from "node:child_process";
import { DEFAULT_BUCKET, loadSettings } from "../lib/config.js";
import { deleteWorker, loadGameConfigs, loadPlayers, probeAccess, saveGameConfigs } from "../lib/cloudflare.js";
import { findGameBySite, storageIdOf } from "../lib/game.js";
import { openUrlCommand } from "../lib/platform.js";
import { TOOLKIT_VERSION } from "../lib/stage.js";
import { expectTarget, siteNameOf } from "../lib/target.js";
import { CliError, NeedsAnswer, ask, c, log } from "../lib/ui.js";
import { wrangler } from "../lib/wrangler.js";
import { connect, siteOf } from "../lib/session.js";

// What the commands call: the Cloudflare and terminal steps, replaceable in tests.
const realDeps = { connect, loadSettings, loadGameConfigs, saveGameConfigs, deleteWorker, ask, spawn, wrangler };
const depsOf = (deps) => ({ ...realDeps, ...deps });

// The game's stored config for a link or name target. Needs the Cloudflare login (connect() first).
export async function findSite(target, deps) {
  return (await findEntry(target, deps))[1];
}

// -> [fingerprint, cfg]
async function findEntry(target, deps) {
  log.step("Finding the game");
  const entry = findGameBySite(await depsOf(deps).loadGameConfigs(DEFAULT_BUCKET), siteNameOf(target));
  log.ok(`${entry[1].engine} · ${entry[1].title}`);
  return entry;
}

async function targetOf(input, usage, deps) {
  const d = depsOf(deps);
  if (!input) {
    input = await d.ask("Paste the game's link or its site name", "", null, { hint: `Pass it after the command: ${usage}` });
  }
  const target = expectTarget(input, ["link", "name"], usage);
  await d.connect(d.loadSettings());
  return target;
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

// Deletes the Worker and forgets the game's config. Saves and large files stay in R2.
export async function deleteSite(input, deps = {}) {
  const d = depsOf(deps);
  const target = await targetOf(input, "rwk delete <game link | site name>", deps);
  const [fingerprint, cfg] = await findEntry(target, deps);

  log.warn(`This deletes the Worker "${cfg.slug}": ${cfg.url || "its link"} stops working for everyone.`);
  log.info("The saves, the save history and the large files stay in R2, so the game can be published again.");
  // No default: a run without a person stops here with exit code 2.
  await d.ask(`Type the site name (${cfg.slug}) to delete it`, "", (v) => (v === cfg.slug ? null : `That is not "${cfg.slug}".`), {
    hint: "Deleting needs a person: run it in a terminal.",
  });

  log.step("Deleting the Worker");
  if (!(await d.deleteWorker(cfg.slug))) {
    throw new CliError(`Could not delete the Worker "${cfg.slug}".`, { hint: "Delete it in the Cloudflare dashboard: Workers & Pages → the game → Settings → Delete." });
  }
  for (const name of cfg.retiredWorkers || []) {
    if (!(await d.deleteWorker(name))) log.warn(`The old Worker "${name}" could not be deleted: remove it in the dashboard.`);
  }
  const configs = await d.loadGameConfigs(DEFAULT_BUCKET);
  delete configs[fingerprint];
  await d.saveGameConfigs(DEFAULT_BUCKET, configs);
  log.ok(`Worker "${cfg.slug}" deleted`);
  return {
    ...siteOf(cfg),
    url: null,
    facts: [["Deleted", cfg.url || cfg.slug]],
    next: ["The site's Cloudflare Access application, if any, stays in the dashboard (Zero Trust → Access): delete it there."],
  };
}
