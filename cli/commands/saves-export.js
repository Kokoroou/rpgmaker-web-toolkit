// rwk saves export: downloads one player's cloud saves into a folder, the
// counterpart of `saves import`. The files are what the engine writes on
// desktop (.rmmzsave / .rpgsave), so they can be copied into the game's save/ folder.
// Works from the site's link or name: the game's files are not needed.

import fs from "node:fs";
import path from "node:path";
import { DEFAULT_BUCKET, loadSettings } from "../lib/config.js";
import { apiToken, userHash } from "../lib/cloudflare.js";
import { engineOf } from "../lib/engines.js";
import { storageIdOf } from "../lib/game.js";
import { getObject, listObjects } from "../lib/r2-api.js";
import { expectTarget } from "../lib/target.js";
import { CliError, ask, c, formatBytes, log } from "../lib/ui.js";
import { connect, siteOf } from "../lib/session.js";
import { findSite } from "./site.js";

export const SAVE_NAME = /^[A-Za-z0-9_.-]{1,64}$/;

// Cloud blobs are one byte per char of the engine's string; the desktop files hold that string as UTF-8.
export const toSaveFile = (blob) => Buffer.from(blob.toString("latin1"), "utf8");

// -> { name, key, size }[] : the save objects under the player's prefix, no folders below it
export function saveObjects(items, prefix) {
  return items
    .filter((item) => item.key.startsWith(prefix) && SAVE_NAME.test(item.key.slice(prefix.length)))
    .map((item) => ({ name: item.key.slice(prefix.length), key: item.key, size: item.size }));
}

export async function exportSaves(input, { email, out } = {}, deps = {}) {
  const d = { connect, loadSettings, findSite, ask, apiToken, listObjects, getObject, ...deps };
  const usage = "rwk saves export <game link | site name> [--email <address>] [--out <folder>]";
  if (!input) input = await d.ask("Paste the game's link or its site name", "", null, { hint: `Pass it after the command: ${usage}` });
  const target = expectTarget(input, ["link", "name"], usage);

  const session = await d.connect(d.loadSettings());
  const cfg = await d.findSite(target);
  if (!cfg.sync || cfg.sync.enabled === false) throw new CliError("Save sync is off for this game, so there are no cloud saves.");
  const folder = path.resolve(out || `${cfg.slug}-saves`);

  if (cfg.auth && cfg.auth.mode === "none") email = "public";
  else if (!email) {
    email = await d.ask("The email the player uses to sign in through Cloudflare Access", session.email || "", (v) => (/.+@.+/.test(v) ? null : "Invalid email"), {
      hint: "Pass it with --email <address>.",
    });
  }

  const token = await d.apiToken();
  if (!token) throw new CliError("Not logged in to Cloudflare.", { hint: "Run the command in a terminal once to log in, or set CLOUDFLARE_API_TOKEN." });
  const prefix = `saves/${userHash(email)}/${storageIdOf(cfg)}/`;

  log.step("Downloading the cloud saves");
  const accountId = session.account.id;
  const objects = saveObjects(await d.listObjects({ token, accountId, bucket: DEFAULT_BUCKET, prefix }), prefix);
  if (!objects.length) {
    throw new CliError(`No cloud saves for ${email} on "${cfg.slug}".`, { hint: "Saves are kept per email: check the address, or play once with cloud sync on." });
  }

  const extension = engineOf(cfg.engine).saveExtension;
  fs.mkdirSync(folder, { recursive: true });
  let bytes = 0;
  for (const object of objects) {
    const blob = await d.getObject({ token, accountId, bucket: DEFAULT_BUCKET, key: object.key });
    if (!blob) continue; // deleted while exporting
    fs.writeFileSync(path.join(folder, object.name + extension), toSaveFile(blob));
    bytes += blob.length;
    log.ok(`${object.name}${extension} ${c.dim(formatBytes(blob.length))}`);
  }
  return {
    ...siteOf(cfg),
    facts: [
      ["Saves", `${objects.length} (${formatBytes(bytes)})`],
      ["Folder", folder],
    ],
    next: ["Copy them into the game's save/ folder on PC, or upload them to another site with rwk saves import."],
  };
}
