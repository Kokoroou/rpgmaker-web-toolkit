// rwk lens: a read-only link to open a deployed game in MakerLens (Assets and
// Events) without making it public. The link carries a token that the game's
// Worker checks (worker/lens.js); it is in the URL's # part, so it never goes
// to any server except the game's own, as a header. Works from the site's
// link or name: the game's files are not needed.

import crypto from "node:crypto";
import { DEFAULT_BUCKET, loadSettings } from "../lib/config.js";
import { AccessApiError, enableLensBypass } from "../lib/access-api.js";
import { apiToken, saveLensToken } from "../lib/cloudflare.js";
import { storageIdOf } from "../lib/game.js";
import { deleteObject, getObject, listObjects } from "../lib/r2-api.js";
import { expectTarget } from "../lib/target.js";
import { CliError, ask, c, log } from "../lib/ui.js";
import { connect, siteOf } from "../lib/session.js";
import { findSite } from "./site.js";
import { LENS_DEFAULT_HOURS, LENS_MAX_HOURS, lensKey, sha256Hex } from "../../worker/lens.js";

export const MAKERLENS = "https://makerlens.kokoroou.workers.dev";
const ID = /^[0-9a-f]{12}$/;

// -> { id, secret }
export function newToken() {
  return { id: crypto.randomBytes(6).toString("hex"), secret: crypto.randomBytes(24).toString("base64url") };
}

// The two viewers' links: the game's address and the token, after the # so no server sees them in a request.
export function viewerLinks(siteUrl, token, base = MAKERLENS) {
  const hash = `#game=${encodeURIComponent(new URL(siteUrl).origin)}&t=${encodeURIComponent(token)}`;
  return { assets: `${base}/assets/${hash}`, events: `${base}/events/${hash}` };
}

export function parseHours(value) {
  if (value === undefined) return LENS_DEFAULT_HOURS;
  const hours = Number(value);
  if (!Number.isInteger(hours) || hours < 1 || hours > LENS_MAX_HOURS) {
    throw new CliError(`--hours must be a whole number from 1 to ${LENS_MAX_HOURS}.`, { hint: "For example --hours 72." });
  }
  return hours;
}

const when = (exp) => new Date(exp * 1000).toISOString().replace("T", " ").slice(0, 16) + " UTC";

// What a request to /_lens/ping with the token answers.
// -> "ok" | "old" (the Worker has no lens routes / manifest) | "access" (Access answers first) | "error: …"
export async function probeLens(siteUrl, token, fetchImpl = fetch) {
  try {
    const res = await fetchImpl(new URL("/_lens/ping", siteUrl), { headers: { authorization: `Bearer ${token}` }, redirect: "manual" });
    if (res.status >= 300 && res.status < 400) return "access";
    if (res.status === 200) {
      const manifest = await fetchImpl(new URL("/_lens/manifest", siteUrl), { headers: { authorization: `Bearer ${token}` }, redirect: "manual" });
      return manifest.status === 200 ? "ok" : "manifest";
    }
    if (res.status === 404) return "old";
    return `error: HTTP ${res.status}`;
  } catch (err) {
    return `error: ${err.message}`;
  }
}

export async function lens(input, { hours, label, revoke, list } = {}, deps = {}) {
  const d = { connect, loadSettings, findSite, ask, apiToken, listObjects, getObject, deleteObject, saveLensToken, enableLensBypass, probeLens, now: () => Date.now(), ...deps };
  const usage = "rwk lens <game link | site name> [--hours <n>] [--label <note>] [--list] [--revoke <id>]";
  if (!input) input = await d.ask("Paste the game's link or its site name", "", null, { hint: `Pass it after the command: ${usage}` });
  const target = expectTarget(input, ["link", "name"], usage);
  const lifetime = revoke || list ? null : parseHours(hours);
  if (revoke !== undefined && !ID.test(revoke)) throw new CliError(`"${revoke}" is not a link id.`, { hint: "rwk lens <game> --list shows them." });

  const session = await d.connect(d.loadSettings());
  const cfg = await d.findSite(target);
  const gameId = storageIdOf(cfg);
  const token = await d.apiToken();
  if (!token) throw new CliError("Not logged in to Cloudflare.", { hint: "Run the command in a terminal once to log in, or set CLOUDFLARE_API_TOKEN." });
  const where = { token, accountId: session.account.id, bucket: DEFAULT_BUCKET };
  const prefix = `rwk/lens/${gameId}/`;

  if (list || revoke) {
    const items = (await d.listObjects({ ...where, prefix })).filter((item) => ID.test(item.key.slice(prefix.length).replace(/\.json$/, "")));
    if (revoke) {
      if (!items.some((item) => item.key === lensKey(gameId, revoke))) throw new CliError(`No link ${revoke} on "${cfg.slug}".`, { hint: "rwk lens <game> --list shows them." });
      await d.deleteObject({ ...where, key: lensKey(gameId, revoke) });
      log.ok(`Link ${revoke} revoked`);
      return { ...siteOf(cfg), facts: [["Revoked", revoke]], next: ["The Worker remembers a valid link for up to a minute."] };
    }
    log.step("Links of this game");
    const rows = [];
    for (const item of items) {
      const blob = await d.getObject({ ...where, key: item.key });
      let record = {};
      try {
        record = JSON.parse(blob.toString("utf8"));
      } catch {
        // Unreadable: listed without details.
      }
      const id = item.key.slice(prefix.length).replace(/\.json$/, "");
      const expired = typeof record.exp === "number" && record.exp * 1000 <= d.now();
      rows.push({ id, label: record.label || "", exp: record.exp || 0, expired });
      log.info(`${id}  ${(record.label || "").padEnd(16)} ${record.exp ? (expired ? c.dim(`expired ${when(record.exp)}`) : `until ${when(record.exp)}`) : c.dim("unreadable")}`);
    }
    if (!rows.length) log.info("None yet: rwk lens " + cfg.slug);
    return { ...siteOf(cfg), links: rows, facts: [["Links", String(rows.length)]], next: [] };
  }

  if (!cfg.url) throw new CliError(`No link is recorded for "${cfg.slug}".`, { hint: "Deploy it again from the game folder." });

  log.step("Creating the link");
  const { id, secret } = newToken();
  const exp = Math.floor(d.now() / 1000) + lifetime * 3600;
  await d.saveLensToken(DEFAULT_BUCKET, gameId, id, { h: await sha256Hex(secret), exp, label: (label || "").slice(0, 60), created: Math.floor(d.now() / 1000) });
  log.ok(`Link ${id} valid until ${when(exp)}`);

  if (cfg.auth && cfg.auth.mode === "access") {
    log.step("Letting the link past Cloudflare Access");
    try {
      await d.enableLensBypass({ token, accountId: session.account.id, slug: cfg.slug, url: cfg.url });
    } catch (err) {
      if (!(err instanceof AccessApiError)) throw err;
      log.warn(`Could not set the Access bypass: ${err.message}. In Zero Trust → Access controls → Applications add a self-hosted application on ${new URL(cfg.url).hostname}/_lens with a Bypass policy (Include: Everyone).`);
    }
  }

  log.step("Checking the link");
  const token_ = `${id}.${secret}`;
  const state = await d.probeLens(cfg.url, token_);
  const advice = {
    ok: null,
    old: `The site does not know MakerLens links yet: run rwk deploy on the game folder (rwk upgrade alone cannot add the file list).`,
    manifest: "The site answers, but has no file list: run rwk deploy on the game folder again.",
    access: "Cloudflare Access still answers /_lens: add the Bypass application (see above) and try the link again.",
  }[state] ?? `Could not check the link (${state}).`;
  if (advice) log.warn(advice);
  else log.ok("The site answers with the link");

  const links = viewerLinks(cfg.url, token_);
  return {
    ...siteOf(cfg),
    linkId: id,
    expires: exp,
    links,
    facts: [
      ["Assets", links.assets],
      ["Events", links.events],
      ["Valid", `${lifetime} h, read-only: data, pictures and audio. Saves and the rest of the site stay behind Access`],
    ],
    next: [`Anyone with the link can look at the game's files until ${when(exp)}. Stop it now with: rwk lens ${cfg.slug} --revoke ${id}`],
  };
}
