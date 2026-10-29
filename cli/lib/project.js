// The deployer's settings that travel with the game folder (a repository, a CI
// checkout), read from an optional `rwk.json` next to index.html, or in the folder
// given when the game sits in its www/. The toolkit only reads it, never writes it.
//
//   {
//     "name": "my-game",            the site name of the first deploy
//     "include": ["Fonts2"],         added to the config's include patterns
//     "exclude": ["data-tw/**"]      added to the config's exclude patterns
//   }
//
// Which value wins: a flag (--name) > rwk.json > the config saved in R2 > the defaults.
// The patterns are added to the saved config's own, for this run only: they are not
// written to R2, so removing one from the file takes effect at the next deploy.

import fs from "node:fs";
import path from "node:path";
import { resolveCI, validateSlug } from "./game.js";
import { CliError, c, log } from "./ui.js";

export const PROJECT_FILE = "rwk.json";
const KEYS = ["name", "include", "exclude"];
const HINT = `Example: { "name": "my-game", "exclude": ["data-tw/**"] }`;

// -> null (no rwk.json) | { file, name, include, exclude, problems }. Throws a CliError when the file cannot be used.
export function readProjectFile(game) {
  const file = [game.root, game.folder].map((dir) => resolveCI(dir, PROJECT_FILE)).find((f) => fs.existsSync(f));
  if (!file) return null;
  let raw;
  try {
    raw = JSON.parse(fs.readFileSync(file, "utf8").replace(/^﻿/, ""));
  } catch (err) {
    throw new CliError(`${file} is not valid JSON (${err.message}).`, { hint: HINT });
  }
  return parseProjectFile(raw, file);
}

export function parseProjectFile(raw, file = PROJECT_FILE) {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) throw new CliError(`${file} must hold a JSON object.`, { hint: HINT });
  const problems = Object.keys(raw)
    .filter((key) => !KEYS.includes(key) && key !== "$schema")
    .map((key) => `${path.basename(file)}: unknown key "${key}" is ignored (known: ${KEYS.join(", ")}).`);
  const out = { file, name: undefined, include: [], exclude: [], problems };
  if (raw.name !== undefined) {
    const problem = typeof raw.name === "string" ? validateSlug(raw.name) : "It must be text.";
    if (problem) throw new CliError(`"name" in ${file} is not a site name: ${JSON.stringify(raw.name)}.`, { hint: problem });
    out.name = raw.name;
  }
  for (const key of ["include", "exclude"]) {
    if (raw[key] === undefined) continue;
    if (!Array.isArray(raw[key]) || raw[key].some((p) => typeof p !== "string" || !p.trim())) {
      throw new CliError(`"${key}" in ${file} must be a list of patterns.`, { hint: `For example: "${key}": ["data-tw/**", "movies/*.webm"]` });
    }
    out[key] = raw[key].map((p) => p.trim());
  }
  return out;
}

export function showProjectFile(project) {
  if (!project) return;
  const parts = [project.name && `site name ${project.name}`, project.include.length && `${project.include.length} include pattern(s)`, project.exclude.length && `${project.exclude.length} exclude pattern(s)`].filter(Boolean);
  log.info(`Using ${PROJECT_FILE}${parts.length ? `: ${parts.join(", ")}` : ""} ${c.dim(`(${project.file})`)}`);
  for (const problem of project.problems) log.warn(problem);
}

// The site name to use without asking: --name, else the file's when it fits the published game.
// A published game keeps its name (rwk rename moves it), so a file that disagrees only warns.
export function siteNameFor(flag, project, cfg) {
  if (flag !== undefined || !project || !project.name) return flag;
  if (cfg && cfg.slug !== project.name) {
    log.warn(`${PROJECT_FILE} says "${project.name}", but this game is published as "${cfg.slug}": using "${cfg.slug}". Change "name" in ${PROJECT_FILE}, or move the site with rwk rename.`);
    return undefined;
  }
  return project.name;
}

// cfg with the file's patterns added to its own, for collectFiles.
export function withProjectPatterns(cfg, project) {
  if (!project) return cfg;
  const union = (a = [], b) => [...new Set([...a, ...b])];
  return { ...cfg, include: union(cfg.include, project.include), exclude: union(cfg.exclude, project.exclude) };
}
