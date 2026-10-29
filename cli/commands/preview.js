// rename --dry-run and saves import --dry-run: what the command would do, from
// the configs already read from R2, and the site name checks deploy shares with them. Nothing in the account or the game folder
// is changed. Kept apart from deploy.js, which would otherwise load the whole
// deploy command for a preview.

import { listSaveFiles } from "../lib/cloudflare.js";
import { takenNames, validateSlug } from "../lib/game.js";
import { applyPolicy } from "../lib/policy.js";
import { siteOf } from "../lib/session.js";
import { CliError, ask, log } from "../lib/ui.js";

// --name: the first deploy's site name, or a check that the published game has it.
// -> the name to use without asking, or undefined to ask. Throws when it cannot be used.
export function checkSiteName(name, cfg, taken, folder) {
  if (name === undefined) return undefined;
  if (cfg) {
    if (cfg.slug === name) return name;
    throw new CliError(`This game is already published as "${cfg.slug}", not "${name}".`, {
      hint: `Drop --name, or move the site to the new name: rwk rename "${folder}" --to ${name}`,
    });
  }
  if (taken.has(name)) throw new CliError(`"${name}" is already used by another game in this account.`, { hint: "Give another name with --name." });
  return name;
}

// The new name, from --to or asked, and what the rename will do. Changes nothing.
export async function askNewName(cfg, taken, to) {
  log.step("New site name");
  log.info(`Now: ${cfg.url || cfg.slug}`);
  const check = (v) => {
    if (v === cfg.slug) return "That is the current name.";
    const problem = validateSlug(v);
    if (problem) return problem;
    return taken.has(v) ? `"${v}" is already used by another game; choose another name.` : null;
  };
  if (to !== undefined && check(to)) throw new CliError(`Cannot rename to "${to}": ${check(to)}`, { hint: "Give another name with --to." });
  const slug =
    to !== undefined
      ? to
      : await ask("New site name (becomes <name>.<username>.workers.dev)", "", check, {
          hint: "Pass the new name: rwk rename \"<game folder>\" --to <new name>",
        });
  const access = cfg.auth.mode === "access";
  log.info("What the rename does:");
  log.info(`  1. The game is deployed as a new Worker "${slug}". Saves and older saves carry over.`);
  if (access) {
    log.info("  2. Cloudflare Access is set up again for the new address (the steps open in the browser).");
    log.info("     Emails you allowed on the old site must be allowed again in the new Access policy.");
  }
  log.info(`  ${access ? 3 : 2}. The old Worker "${cfg.slug}" is deleted: its link stops working.`);
  return slug;
}

export async function preview(game, policy, configs, { inputPath, rename, to }) {
  const cfg = configs[game.fingerprint];
  const command = rename ? "rename" : "saves import";
  if (!cfg) throw new CliError(`This game is not published yet, so there is nothing to ${rename ? "rename" : "import saves into"}.`, { hint: `Check what a first deploy would do: rwk deploy --dry-run "${inputPath}"` });
  log.ok(`Using the config saved in R2 (site name: ${cfg.slug})`);
  const done = (facts, todo) => ({ ...siteOf(cfg), dryRun: true, facts, next: [todo ? `Nothing was changed. To do it: ${todo}` : "Nothing was changed."] });

  if (rename) {
    const slug = await askNewName(cfg, takenNames(configs, game.fingerprint), to);
    return done([["New name", slug]], `rwk ${command} "${inputPath}" --to ${slug}`);
  }

  log.step("Local saves");
  if (!applyPolicy(cfg, policy).sync.enabled) {
    log.warn(cfg.sync?.enabled === false ? "Save sync is disabled for this game." : "The game's creator turned cloud save sync off for this game.");
    return done([["Saves", "none would be uploaded"]]);
  }
  const saves = game.saveDir ? listSaveFiles(game.saveDir, game.engine) : [];
  if (!saves.length) {
    log.warn(game.saveDir ? `No save files in ${game.saveDir}.` : "No save/ folder found in the game.");
    return done([["Saves", "none would be uploaded"]]);
  }
  log.info(`Found ${saves.length} save(s) in ${game.saveDir}: ${saves.map((s) => s.name).join(", ")}`);
  const owner = cfg.auth?.mode === "none" ? "the site's shared saves (a public site has no sign-in)" : "the email you sign in with through Access (asked when you run it)";
  log.info(`They would go to ${owner}, overwriting cloud saves with the same name.`);
  return done([["Saves", `${saves.length} would be uploaded`]], `rwk ${command} "${inputPath}"`);
}
