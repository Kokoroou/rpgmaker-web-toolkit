// Checks and messages that deploy and analyze share about the game and the web build.

import path from "node:path";
import { mobileOnlyMissing } from "./game.js";
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

export function tooManyFiles(assets, count, max) {
  const byTop = new Map();
  for (const f of assets) {
    const top = f.rel.split("/")[0];
    byTop.set(top, (byTop.get(top) || 0) + 1);
  }
  const lines = [...byTop].sort((a, b) => b[1] - a[1]).map(([dir, n]) => `    ${dir}: ${n}`);
  return new Error(
    `The web build has ${count} files, over the Workers limit of ${max} (free plan).\n` +
      `${lines.join("\n")}\nAdd exclude patterns (rwk config, e.g. "data-tw/**") and run again.`
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
