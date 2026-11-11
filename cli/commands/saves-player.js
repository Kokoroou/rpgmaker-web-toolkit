// rwk saves move / rwk saves delete: what to do with one player's cloud data when
// the player's email changes or they leave. Saves are kept per email (the key holds
// the email's hash), so changing the address in Access leaves the old saves behind.
//
//   saves/<hash>/<game>/   the saves        history/<hash>/<game>/   their older copies
//   rwk/players/<game>.json   { [hash]: first save time }, the count `rwk status` shows

import { DEFAULT_BUCKET, loadSettings } from "../lib/config.js";
import { apiToken, userHash } from "../lib/cloudflare.js";
import { storageIdOf } from "../lib/game.js";
import { deleteObject, getObject, listObjects, putObject } from "../lib/r2-api.js";
import { expectTarget } from "../lib/target.js";
import { CliError, ask, c, formatBytes, log } from "../lib/ui.js";
import { connect, siteOf } from "../lib/session.js";
import { findSite } from "./site.js";

const EMAIL = /^[^@\s]+@[^@\s]+$/;
const checkEmail = (v) => (EMAIL.test(v.trim()) ? null : "Invalid email");

// The prefixes one player's data sits under, for one game.
export const playerPrefixes = (email, gameId) => {
  const hash = userHash(email);
  return { hash, prefixes: [`saves/${hash}/${gameId}/`, `history/${hash}/${gameId}/`] };
};

async function prepare(input, usage, deps) {
  const d = { connect, loadSettings, findSite, ask, apiToken, listObjects, getObject, putObject, deleteObject, ...deps };
  if (!input) input = await d.ask("Paste the game's link or its site name", "", null, { hint: `Pass it after the command: ${usage}` });
  const target = expectTarget(input, ["link", "name"], usage);
  const session = await d.connect(d.loadSettings());
  const cfg = await d.findSite(target);
  if (!cfg.sync || cfg.sync.enabled === false) throw new CliError("Save sync is off for this game, so there are no cloud saves.");
  if (cfg.auth && cfg.auth.mode === "none") throw new CliError("This site is public: saves are not tied to an email, so there is nothing to move or delete per player.");
  const token = await d.apiToken();
  if (!token) throw new CliError("Not logged in to Cloudflare.", { hint: "Run the command in a terminal once to log in, or set CLOUDFLARE_API_TOKEN." });
  return { d, cfg, token, where: { token, accountId: session.account.id, bucket: DEFAULT_BUCKET }, gameId: storageIdOf(cfg) };
}

async function objectsOf(d, where, email, gameId) {
  const { prefixes } = playerPrefixes(email, gameId);
  const all = [];
  for (const prefix of prefixes) for (const item of await d.listObjects({ ...where, prefix })) all.push({ ...item, prefix });
  return all;
}

// The player list `rwk status` counts: best effort, the saves are what matters.
async function updatePlayers(d, where, gameId, change) {
  const key = `rwk/players/${gameId}.json`;
  try {
    const blob = await d.getObject({ ...where, key });
    if (!blob) return;
    const players = JSON.parse(blob.toString("utf8"));
    change(players);
    await d.putObject({ ...where, key, body: JSON.stringify(players), contentType: "application/json" });
  } catch (err) {
    log.warn(`The player list was not updated (${err.message}): "rwk status" may count the old email until the player saves again.`);
  }
}

export async function movePlayerSaves(input, { from, to } = {}, deps = {}) {
  const usage = "rwk saves move <game link | site name> --from <email> --to <email>";
  const { d, cfg, where, gameId } = await prepare(input, usage, deps);
  if (!from) from = await d.ask("The email the saves are under now", "", checkEmail, { hint: "Pass it with --from <address>." });
  if (!to) to = await d.ask("The email that gets the saves", "", checkEmail, { hint: "Pass it with --to <address>." });
  if (checkEmail(from) || checkEmail(to)) throw new CliError("--from and --to need email addresses.", { hint: usage });
  if (userHash(from) === userHash(to)) throw new CliError("--from and --to are the same email.");

  const objects = await objectsOf(d, where, from, gameId);
  if (!objects.length) throw new CliError(`No cloud saves for ${from} on "${cfg.slug}".`, { hint: "Saves are kept per email: check the address." });
  const target = playerPrefixes(to, gameId);
  const existing = await objectsOf(d, where, to, gameId);
  const saves = objects.filter((o) => o.prefix.startsWith("saves/"));
  log.warn(`${to} already has ${existing.filter((o) => o.prefix.startsWith("saves/")).length} cloud save(s) on "${cfg.slug}": same-name ones are replaced.`);
  // The sign-in of the new email is the deployer's to allow: saves follow whoever Access lets in.
  log.step(`Moving ${saves.length} save(s) and ${objects.length - saves.length} older copy(ies) to ${to}`);

  let bytes = 0;
  for (const object of objects) {
    const blob = await d.getObject({ ...where, key: object.key });
    if (!blob) continue; // deleted meanwhile
    const key = target.prefixes[object.prefix.startsWith("saves/") ? 0 : 1] + object.key.slice(object.prefix.length);
    await d.putObject({ ...where, key, body: blob });
    bytes += blob.length;
  }
  // Delete the old copies only once every new one is written, so a failed run can be repeated.
  for (const object of objects) await d.deleteObject({ ...where, key: object.key });
  await updatePlayers(d, where, gameId, (players) => {
    const first = players[userHash(from)];
    delete players[userHash(from)];
    if (first && !players[target.hash]) players[target.hash] = first;
  });
  log.ok(`${objects.length} object(s) moved (${formatBytes(bytes)})`);
  return {
    ...siteOf(cfg),
    facts: [
      ["From", from],
      ["To", to],
      ["Saves", `${saves.length} (+${objects.length - saves.length} older)`],
    ],
    next: [`Make sure ${to} may sign in (the "players" list in the config, then rwk upgrade).`],
  };
}

export async function deletePlayerSaves(input, { email } = {}, deps = {}) {
  const usage = "rwk saves delete <game link | site name> [--email <address>]";
  const { d, cfg, where, gameId } = await prepare(input, usage, deps);
  if (!email) email = await d.ask("The email whose cloud saves are deleted", "", checkEmail, { hint: "Pass it with --email <address>." });
  if (checkEmail(email)) throw new CliError("--email needs an email address.", { hint: usage });

  const objects = await objectsOf(d, where, email, gameId);
  if (!objects.length) throw new CliError(`No cloud saves for ${email} on "${cfg.slug}".`, { hint: "Saves are kept per email: check the address." });
  const bytes = objects.reduce((sum, o) => sum + (o.size || 0), 0);
  log.warn(`This deletes ${objects.length} object(s) (${formatBytes(bytes)}): every cloud save and older save of ${email} on "${cfg.slug}". This cannot be undone.`);
  log.info(c.dim(`To keep a copy, first run: rwk saves export ${cfg.slug} --email ${email}`));
  // No default: a run without a person stops here with exit code 2.
  await d.ask(`Type the email (${email}) to delete its saves`, "", (v) => (v.trim().toLowerCase() === email.trim().toLowerCase() ? null : `That is not "${email}".`), {
    hint: "Deleting needs a person: run it in a terminal.",
  });
  log.step("Deleting the player's saves");
  for (const object of objects) await d.deleteObject({ ...where, key: object.key });
  await updatePlayers(d, where, gameId, (players) => {
    delete players[userHash(email)];
  });
  log.ok(`${objects.length} object(s) deleted`);
  return { ...siteOf(cfg), facts: [["Email", email], ["Deleted", `${objects.length} (${formatBytes(bytes)})`]], next: ["Remove the email from the Access policy too, or the player can start over on the next save."] };
}
