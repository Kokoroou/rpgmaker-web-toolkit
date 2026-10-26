#!/usr/bin/env node
import { COMMANDS, commandHelp, generalHelp, parseCommandLine } from "./lib/args.js";
import { analyze } from "./commands/analyze.js";
import { deploy } from "./commands/deploy.js";
import { doctor } from "./commands/doctor.js";
import { editConfig } from "./commands/config.js";
import { exportSaves } from "./commands/saves-export.js";
import { deleteSite, list, logs, open, status } from "./commands/site.js";
import { upgrade } from "./commands/upgrade.js";
import { failedResult, publishResult, renderSummary, runResult } from "./lib/report.js";
import { TOOLKIT_VERSION } from "./lib/stage.js";
import { classifyTarget, currentGameFolder } from "./lib/target.js";
import { UsageError, ask, c, isUnattended, log, print, setColor, setQuiet, setUnattended, warnings } from "./lib/ui.js";
import { useEnvToken } from "./lib/wrangler.js";

const argv = process.argv.slice(2);
const json = argv.includes("--json");
const verbose = argv.includes("--verbose") || !!process.env.RWK_DEBUG;
let command = null;
let quiet = false;

async function main() {
  const cli = parseCommandLine(argv);
  const { spec, flags } = cli;
  command = spec ? spec.name : null;
  quiet = flags.quiet;
  if (flags.noColor) setColor(false);

  if (flags.version) {
    console.log(TOOLKIT_VERSION);
    return null;
  }
  if (flags.help) {
    console.log(spec ? commandHelp(spec, c.bold) : generalHelp(c.bold));
    return null;
  }

  const major = Number(process.versions.node.split(".")[0]);
  if (major < 22) throw new Error(`Node.js 22 or newer is required (found ${process.versions.node}).`);

  setUnattended(cli.unattended);
  setQuiet(flags.quiet);
  if (isUnattended() && useEnvToken()) log.info(c.dim("Using the Cloudflare API token in CLOUDFLARE_API_TOKEN."));

  let { target } = cli;
  let name = spec && spec.name;
  if (!spec) {
    // `rwk` alone (the one-liner): ask for the game, then do what its kind says.
    if (isUnattended()) throw new UsageError("No command given.", { hint: "Commands: rwk --help" });
    target = await ask("Drag and drop or paste the game folder path (or the game's link, if its folder is gone)", "", null);
    name = classifyTarget(target).kind === "folder" ? "deploy" : "upgrade";
    command = name;
  }

  // No target: the current directory, when it holds a game.
  if (spec && !target && spec.targets.includes("folder")) {
    const here = currentGameFolder();
    if (here) {
      target = here;
      log.info(c.dim(`Using the game in the current folder: ${here}`));
    }
  }

  switch (name) {
    case "deploy":
      return flags.dryRun ? analyze(target, { command: "deploy" }) : deploy(target);
    case "analyze":
      return analyze(target);
    case "doctor":
      return doctor({ envTokenIgnored: !isUnattended() && !!process.env.CLOUDFLARE_API_TOKEN });
    case "upgrade":
      return upgrade(target);
    case "saves import":
      return deploy(target, { importOnly: true });
    case "config":
      return editConfig(target);
    case "rename":
      return deploy(target, { rename: true, to: flags.to });
    case "status":
      return status(target);
    case "saves export":
      return exportSaves(target, { email: flags.email, out: flags.out });
    case "logs":
      return logs(target);
    case "open":
      return open(target);
    case "list":
      return list();
    case "delete":
      return deleteSite(target);
    default:
      throw new UsageError(`Unknown command "${name}".`, { hint: `Commands: ${COMMANDS.map((s) => s.name).join(", ")}` });
  }
}

process.on("SIGINT", () => {
  console.error("\nCancelled.");
  process.exit(130);
});

if (argv.includes("--no-color")) setColor(false);

// Exit codes: 0 done, 1 failed, 2 a question needs a person (non-interactive run),
// 64 wrong usage, 130 cancelled.
main().then(
  (value) => {
    if (value === null) return;
    const result = runResult(command, value, warnings);
    if (!quiet) print(renderSummary(result));
    publishResult(result, { json, quiet });
  },
  (err) => {
    log.error(err.message, err.hint);
    if (verbose) console.error(err);
    publishResult(failedResult(command, err, warnings), { json, quiet });
    process.exit(err.exitCode || 1);
  }
);
