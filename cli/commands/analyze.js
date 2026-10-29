// analyze and deploy --dry-run: what a deploy would find in the game, without Cloudflare.
// No login, no R2, no build folder, nothing written: the game's warnings and file count,
// for the first deploy's defaults (a config already saved in R2 is not read, as that needs the login).

import { collectFiles, nonAsciiPaths, analyzeGame, suggestSlug } from "../lib/game.js";
import { baseConfig, checkFeatureConfig } from "../lib/features.js";
import { loadLimits } from "../lib/limits.js";
import { applyPolicy, readPolicy } from "../lib/policy.js";
import { generatedFiles } from "../lib/stage.js";
import { expectTarget } from "../lib/target.js";
import { ask, c, formatBytes, log } from "../lib/ui.js";
import { formatMiB, showPolicy, tooManyFiles, warnLanguages, warnMobileMedia, warnPathProblems } from "../lib/build-checks.js";
import { engineOf } from "../lib/engines.js";

export async function analyze(inputPath, { command = "analyze", name } = {}) {
  const usage = command === "deploy" ? 'rwk deploy --dry-run "<game folder>"' : 'rwk analyze "<game folder>"';
  if (!inputPath) {
    inputPath = await ask("Drag and drop or paste the game folder path", "", null, { hint: `Pass it after the command, or run it in the game folder: ${usage}` });
  }
  inputPath = expectTarget(inputPath, ["folder"], usage).value;

  log.step("Analyzing the game");
  const game = analyzeGame(inputPath);
  log.ok(`${game.engine} · ${game.title}`);
  log.info(c.dim(game.root));
  const policy = readPolicy(game);
  showPolicy(policy);

  // Whether the name is free is only known with the login: the real deploy checks it.
  const cfg = baseConfig(game, { slug: name ?? suggestSlug(game) });
  for (const problem of checkFeatureConfig(cfg)) log.warn(problem);
  if (game.unknownDirs.length) {
    log.info(`Non-standard folders in the game root, left out unless included with rwk config: ${game.unknownDirs.join(", ")}`);
  }

  log.step("Checking the web build");
  // No cache file: the limits are only read, never written to the PC.
  const limits = await loadLimits({});
  const { maxFiles, maxFileBytes } = limits.assets;
  const files = collectFiles(game, cfg);
  const overflow = files.filter((f) => f.size > maxFileBytes);
  const assets = files.filter((f) => f.size <= maxFileBytes);
  const generated = generatedFiles(game, applyPolicy(cfg, policy), files);
  const assetCount = new Set([...assets.map((f) => f.rel), ...generated.keys()]).size;
  const totalBytes = files.reduce((sum, f) => sum + f.size, 0);
  log.info(`${files.length} files, ${formatBytes(totalBytes)} (${overflow.length} file(s) over ${formatMiB(maxFileBytes)} would go to R2)`);
  if (assetCount > maxFiles) throw tooManyFiles(assets, assetCount, maxFiles);
  log.ok(`${assetCount} of ${maxFiles} files the free plan allows`);
  if (engineOf(game.engine).mobileMedia) warnMobileMedia(files);
  const languages = warnLanguages(files, cfg.languages);
  const oddNames = nonAsciiPaths(files);
  if (oddNames.length) {
    const shown = oddNames.slice(0, 3).join(", ") + (oddNames.length > 3 ? ", …" : "");
    log.warn(`${oddNames.length} file name(s) have non-ASCII characters (${shown}). If a picture or sound is missing in the browser, check these first.`);
  }

  log.step("Checking file paths");
  const paths = warnPathProblems(files);
  log.info(`${paths.checked} references checked`);

  return {
    dryRun: true,
    game: { title: game.title, engine: game.engine },
    paths,
    languages,
    build: { files: files.length, bytes: totalBytes, r2Files: overflow.length, r2Uploaded: 0 },
    facts: [["Game", `${game.engine} · ${game.title}`], ...(name ? [["Site name", `${name} (on a first deploy, if no other game uses it)`]] : [])],
    next: [`Nothing was published. To publish: rwk deploy "${inputPath}"${name ? ` --name ${name}` : ""}`],
  };
}
