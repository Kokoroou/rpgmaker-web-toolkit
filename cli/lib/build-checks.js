// Checks and messages that deploy and analyze share about the game and the web build.

import path from "node:path";
import { mobileOnlyMissing } from "./game.js";
import { checkLanguagesConfig, detectLanguages } from "./languages.js";
import { countByKind, pathWarnings, scanPaths } from "./paths.js";
import { describeHosting } from "./policy.js";
import { c, log } from "./ui.js";

export function formatMiB(bytes) {
  return `${+(bytes / 1024 ** 2).toFixed(1)} MiB`;
}

// MV wants .m4a / .mp4 on phones; RWK_Core falls back to Ogg / WebM where the
// browser plays them, which leaves out older iPhones.
export function warnMobileMedia(files) {
  const missing = mobileOnlyMissing(files);
  if (missing.audio) log.warn(`${missing.audio} audio file(s) have no .m4a version: phones whose browser cannot play Ogg (older iPhones) will have no sound for them.`);
  if (missing.movies) log.warn(`${missing.movies} movie(s) have no .mp4 version: phones whose browser cannot play WebM (older iPhones) will not show them.`);
}

// Warns about file names and references that work on Windows but not on the web (letter
// case, upper-case extensions…). Returns { checked, ...count per kind } for the JSON result.
export function warnPathProblems(files) {
  const { checked, issues } = scanPaths(files);
  for (const warning of pathWarnings(issues)) log.warn(warning);
  return { checked, ...countByKind(issues) };
}

// Lists the translations (data-<code>/) the web build will offer and warns about
// a "languages" setting that matches none. -> [{ code, dir, files, missing }]
export function warnLanguages(files, setting) {
  const languages = detectLanguages(files);
  for (const problem of checkLanguagesConfig(setting, languages)) log.warn(problem);
  if (languages.length && setting !== false) {
    const list = languages.map((l) => `${l.code} (${l.dir}${l.missing ? `, ${l.missing} file(s) fall back to data/` : ""})`);
    log.info(`Translations players can pick: ${list.join(", ")}`);
  }
  return languages.map(({ code, dir, files: names, missing }) => ({ code, dir, files: names.length, missing }));
}

export function tooManyFiles(assets, count, max) {
  const byTop = new Map();
  for (const f of assets) {
    const top = f.rel.split("/")[0];
    byTop.set(top, (byTop.get(top) || 0) + 1);
  }
  const lines = [...byTop].sort((a, b) => b[1] - a[1]).map(([dir, n]) => `    ${dir}: ${n}`);
  return new Error(
    `The web build has ${count} files, over the Workers limit of ${max} (free plan).\n` +
      `${lines.join("\n")}\nAdd exclude patterns (rwk config, or "exclude" in rwk.json, e.g. "data-tw/**") and run again.`
  );
}


export function showPolicy(policy) {
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
