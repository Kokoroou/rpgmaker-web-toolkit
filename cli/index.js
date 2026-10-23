#!/usr/bin/env node
import { deploy } from "./commands/deploy.js";
import { c, log } from "./lib/ui.js";

const HELP = `
${c.bold("rpgmaker-web-toolkit")}: publish RPG Maker MZ/MV games to Cloudflare Workers

  rwk "<game folder>"                First deploy or update (uploads changed files only)
  rwk import-saves "<game folder>"   Upload local saves (the save/ folder) to the cloud
  rwk edit-config "<game folder>"    Edit the game's config stored in R2 (buttons, exclude…)
  rwk help                           Show this help
`;

async function main() {
  const major = Number(process.versions.node.split(".")[0]);
  if (major < 20) throw new Error(`Node.js 20 or newer is required (found ${process.versions.node}).`);

  const [first, ...rest] = process.argv.slice(2);
  switch (first) {
    case "help":
    case "--help":
    case "-h":
      console.log(HELP);
      return;
    case "deploy":
      return deploy(rest.join(" ") || undefined);
    case "import-saves":
      return deploy(rest.join(" ") || undefined, { importOnly: true });
    case "edit-config":
      return deploy(rest.join(" ") || undefined, { editOnly: true });
    default:
      return deploy(process.argv.slice(2).join(" ") || undefined);
  }
}

process.on("SIGINT", () => {
  console.log("\nCancelled.");
  process.exit(130);
});

main().catch((err) => {
  log.error(err.message);
  if (process.env.RWK_DEBUG) console.error(err);
  process.exit(1);
});
