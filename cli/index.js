#!/usr/bin/env node
import { deploy } from "./commands/deploy.js";
import { updateFromLink } from "./commands/update-from-link.js";
import { failedResult, publishResult, runResult } from "./lib/report.js";
import { c, log, setJsonOutput, setUnattended, splitFlags, warnings } from "./lib/ui.js";
import { useEnvToken } from "./lib/wrangler.js";

const HELP = `
${c.bold("rpgmaker-web-toolkit")}: publish RPG Maker MZ/MV games to Cloudflare Workers

  rwk "<game folder>"                First deploy or update (uploads changed files only)
  rwk import-saves "<game folder>"   Upload local saves (the save/ folder) to the cloud
  rwk edit-config "<game folder>"    Edit the game's config stored in R2 (buttons, exclude…)
  rwk rename "<game folder>"         Change the site name (its address); saves carry over
  rwk update-from-link "<game link>" Update the toolkit of a deployed game whose folder is gone
  rwk help                           Show this help

  --yes, --non-interactive           Never ask: take each question's default, or stop with exit code 2
                                     when one has none (also when stdin is not a terminal, as in CI).
                                     Logs in with CLOUDFLARE_API_TOKEN (and CLOUDFLARE_ACCOUNT_ID) if set.
  --json                             Same as --yes, and prints the result (link, build report, warnings)
                                     as JSON on stdout; the log goes to stderr.
`;

const COMMANDS = new Set(["deploy", "import-saves", "edit-config", "rename", "update-from-link"]);
const { unattended, json, rest: args } = splitFlags(process.argv.slice(2));
const command = COMMANDS.has(args[0]) ? args[0] : "deploy";

async function main() {
  const major = Number(process.versions.node.split(".")[0]);
  if (major < 22) throw new Error(`Node.js 22 or newer is required (found ${process.versions.node}).`);

  setUnattended(unattended);
  setJsonOutput(json);
  if (unattended && useEnvToken()) log.info(c.dim("Using the Cloudflare API token in CLOUDFLARE_API_TOKEN."));
  const [first, ...rest] = args;
  switch (first) {
    case "help":
    case "--help":
    case "-h":
      console.log(HELP);
      return null;
    case "deploy":
      return deploy(rest.join(" ") || undefined);
    case "import-saves":
      return deploy(rest.join(" ") || undefined, { importOnly: true });
    case "edit-config":
      return deploy(rest.join(" ") || undefined, { editOnly: true });
    case "rename":
      return deploy(rest.join(" ") || undefined, { rename: true });
    case "update-from-link":
      return updateFromLink(rest.join(" ") || undefined);
    default:
      return deploy(args.join(" ") || undefined);
  }
}

process.on("SIGINT", () => {
  console.error("\nCancelled.");
  process.exit(130);
});

// Exit codes: 0 done, 1 failed, 2 a question needs a person (non-interactive run), 130 cancelled.
main().then(
  (value) => {
    if (value !== null) publishResult(runResult(command, value, warnings), { json });
  },
  (err) => {
    log.error(err.message);
    if (process.env.RWK_DEBUG) console.error(err);
    publishResult(failedResult(command, err, warnings), { json });
    process.exit(err.exitCode || 1);
  }
);
