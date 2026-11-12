// Several sites for one game: game1v1.<username>.workers.dev, game1v2.… from the same folder.
//
// The game configs in R2 are { [key]: cfg }. A game's first site has the game's
// fingerprint as its key, as before; each site added with `deploy --new-site`
// has "<fingerprint>@<its first site name>" (kept when it is renamed, like its
// storageId). Each site is a site of its own: its Worker, its settings, its
// Access application, and its own saves.
//
// From a link or a site name, a command finds the site by name (findGameBySite):
// nothing here. From the game folder, which site is meant comes from --name,
// else "name" in rwk.json, else the only site, else a question.

import { PROJECT_FILE } from "./project.js";
import { CliError, NeedsAnswer, choose, isUnattended, log } from "./ui.js";

export const siteKey = (fingerprint, firstName) => `${fingerprint}@${firstName}`;

// The game's sites -> [[key, cfg]], the first site first, then by site name.
export function sitesOfGame(configs, fingerprint) {
  const extra = (key, cfg) => key.startsWith(`${fingerprint}@`) && !!cfg && cfg.fingerprint === fingerprint;
  return Object.entries(configs)
    .filter(([key, cfg]) => key === fingerprint || extra(key, cfg))
    .sort(([a, x], [b, y]) => (a === fingerprint ? -1 : b === fingerprint ? 1 : x.slug.localeCompare(y.slug)));
}

// The key a new site of the game gets: the game's own while it has none.
export const newSiteKey = (configs, fingerprint, slug) => (sitesOfGame(configs, fingerprint).length ? siteKey(fingerprint, slug) : fingerprint);

const listOf = (sites) => sites.map(([, cfg]) => `"${cfg.slug}"`).join(", ");

// Which site of the game in the folder a command works on.
//   name     --name (a site of the game, or the new site's name with newSite)
//   project  rwk.json (its "name" picks a site; one that is none only warns)
//   newSite  deploy --new-site: a site added to a published game
//   pick     the hint for a run that cannot ask, e.g. "--name <site name>"
// -> { key, cfg, name } of a published site, or { key: null, cfg: null, name } for a
// new one (name: the site name to use without asking, or undefined to ask).
export async function siteOfFolder(configs, game, { name, project, newSite = false, folder, pick = "--name <site name>", question = choose } = {}) {
  const sites = sitesOfGame(configs, game.fingerprint);
  const fileName = project && project.name;
  const bySlug = (slug) => sites.find(([, cfg]) => cfg.slug === slug);
  const found = ([key, cfg]) => ({ key, cfg, name: cfg.slug });

  if (newSite) {
    const wanted = name ?? (fileName && !bySlug(fileName) ? fileName : undefined);
    if (wanted !== undefined && bySlug(wanted)) {
      throw new CliError(`"${wanted}" is already a site of this game.`, { hint: `Update it without --new-site, or give the new site another name: --new-site --name <new name>` });
    }
    if (sites.length) log.info(`This game is published as ${listOf(sites)}: deploying it as one more site, with its own settings and saves.`);
    return { key: null, cfg: null, name: wanted };
  }
  if (!sites.length) return { key: null, cfg: null, name: name ?? fileName };

  if (name !== undefined) {
    const site = bySlug(name);
    if (site) return found(site);
    const published = sites.length === 1 ? `already published as "${sites[0][1].slug}"` : `published as ${listOf(sites)}`;
    const hint =
      sites.length === 1
        ? `Drop --name, move the site to the new name (rwk rename "${folder}" --to ${name}), or add it as another site: --new-site --name ${name}`
        : `Name one of them with --name, or add another site: --new-site --name ${name}`;
    throw new CliError(`This game is ${published}, not "${name}".`, { hint });
  }
  if (fileName) {
    const site = bySlug(fileName);
    if (site) return found(site);
    if (sites.length === 1) {
      log.warn(`${PROJECT_FILE} says "${fileName}", but this game is published as "${sites[0][1].slug}": using "${sites[0][1].slug}". Change "name" in ${PROJECT_FILE}, move the site with rwk rename, or add it as another site with --new-site.`);
    } else {
      log.warn(`${PROJECT_FILE} says "${fileName}", which is none of this game's sites (${listOf(sites)}).`);
    }
  }
  if (sites.length === 1) return found(sites[0]);

  const hint = `This game has ${sites.length} sites (${listOf(sites)}): name one with ${pick}, or with "name" in ${PROJECT_FILE}.`;
  if (isUnattended()) throw new NeedsAnswer(`Which site of this game? It has ${sites.length}: ${listOf(sites)}.`, hint);
  const site = await question(
    `This game has ${sites.length} sites. Which one?`,
    sites.map((entry) => ({ label: `${entry[1].slug}${entry[1].url ? `  ${entry[1].url}` : ""}`, value: entry })),
    0,
    { whenUnattended: null, hint }
  );
  return found(site);
}

// The published site of the game in a folder, for a command that only updates one
// (upgrade, config): -> [key, cfg]. Throws when the game is not published.
export async function publishedSiteOf(configs, game, { project, folder, command }) {
  const site = await siteOfFolder(configs, game, { project, folder, pick: `its site name instead of the folder: rwk ${command} <site name>` });
  if (!site.cfg) {
    throw new CliError(`This game is not published yet, so ${command === "config" ? "it has no settings to edit" : "there is nothing to upgrade"}.`, { hint: `Publish it first: rwk deploy "${folder}"` });
  }
  return [site.key, site.cfg];
}
