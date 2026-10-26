// The command line: which command, on what, with which flags.
//
//   rwk <command> [<target>] [flags]        flags may come before or after
//
// COMMANDS is the one list the parser, `rwk --help` and `rwk <command> --help`
// read, so a command is added here and nowhere else.

import { parseArgs } from "node:util";
import { classifyTarget } from "./target.js";
import { UsageError } from "./ui.js";

const TARGET_HELP = {
  folder: "the game folder",
  link: "the game's link",
  name: "the site name",
};

export const COMMANDS = [
  {
    name: "deploy",
    summary: "Publish a game from its folder, or update it (uploads changed files only)",
    targets: ["folder"],
    switches: { "dry-run": "Only check the game and build nothing: the warnings and the file count, no Cloudflare login (same as rwk analyze)" },
    examples: ['rwk deploy "D:\\Games\\My Game"', "rwk deploy ~/Games/'My Game' --yes", "rwk deploy --dry-run   (in the game folder)"],
  },
  {
    name: "analyze",
    summary: "Check the game without Cloudflare: warnings and file count; logs in to nothing, changes nothing",
    targets: ["folder"],
    examples: ['rwk analyze "D:\\Games\\My Game"', "rwk analyze --json   (in the game folder)"],
  },
  {
    name: "upgrade",
    summary: "Update the toolkit of a deployed game; the game files stay as uploaded",
    targets: ["link", "name"],
    examples: ["rwk upgrade https://my-game.alice.workers.dev", "rwk upgrade my-game"],
  },
  {
    name: "saves import",
    summary: "Upload the game's save/ folder to the cloud (overwrites same-name cloud saves)",
    targets: ["folder"],
    examples: ['rwk saves import "D:\\Games\\My Game"'],
  },
  {
    name: "config",
    summary: "Change the game's settings (buttons, features, files…) by answering questions",
    targets: ["folder", "link", "name"],
    examples: ['rwk config "D:\\Games\\My Game"', "rwk config my-game"],
  },
  {
    name: "rename",
    summary: "Move the site to a new name (address); saves carry over",
    targets: ["folder"],
    options: { to: "The new site name; without it the command asks" },
    examples: ['rwk rename "D:\\Games\\My Game" --to new-name'],
  },
  {
    name: "status",
    summary: "Show whether the site is up, its Access protection, and how many players have saves",
    targets: ["link", "name"],
    examples: ["rwk status my-game", "rwk status my-game --json"],
  },
  {
    name: "saves export",
    summary: "Download one player's cloud saves into a folder (the counterpart of saves import)",
    targets: ["link", "name"],
    options: { email: "The player's email (a site with Access keeps saves per email); without it the command asks", out: "The folder to write to (default: <site name>-saves)" },
    examples: ["rwk saves export my-game --email me@example.com", "rwk saves export my-game --out ./backup"],
  },
  {
    name: "logs",
    summary: "Show the site's Worker logs as they happen, until Ctrl+C",
    targets: ["link", "name"],
    examples: ["rwk logs my-game"],
  },
  {
    name: "open",
    summary: "Open the site in the browser",
    targets: ["link", "name"],
    examples: ["rwk open my-game"],
  },
  {
    name: "list",
    summary: "List the games published in this Cloudflare account",
    targets: [],
    examples: ["rwk list", "rwk list --json"],
  },
  {
    name: "delete",
    summary: "Delete the site's Worker (saves stay in R2); asks you to type the site name",
    targets: ["link", "name"],
    examples: ["rwk delete my-game"],
  },
  {
    name: "doctor",
    summary: "Check this PC: Node.js, wrangler, the Cloudflare login and the token's permissions",
    targets: [],
    examples: ["rwk doctor", "rwk doctor --json"],
  },
];

const GROUPS = [...new Set(COMMANDS.filter((cmd) => cmd.name.includes(" ")).map((cmd) => cmd.name.split(" ")[0]))];

export const FLAGS = [
  ["-y, --yes", "Never ask: take each question's default, or stop with exit code 2 when one has none"],
  ["", "(also when stdin is not a terminal, as in CI). Logs in with CLOUDFLARE_API_TOKEN if it is set"],
  ["    --json", "Same as --yes, and prints the result as JSON on stdout"],
  ["-q, --quiet", "Only warnings and errors; the result still goes to stdout"],
  ["    --verbose", "Print full error details"],
  ["    --no-color", "No colors (also NO_COLOR=1)"],
  ["-h, --help", "Show help (for a command: rwk <command> --help)"],
  ["-V, --version", "Show the toolkit version"],
];

const OPTION_VALUES = { to: "name", email: "address", out: "folder" };

const usageOf = (spec) => {
  const target = spec.targets.length ? ` <${spec.targets.map((k) => ({ folder: "game folder", link: "game link", name: "site name" })[k]).join(" | ")}>` : "";
  const options = spec.options ? Object.keys(spec.options).map((o) => ` [--${o} <${OPTION_VALUES[o] || "value"}>]`).join("") : "";
  const switches = spec.switches ? Object.keys(spec.switches).map((o) => ` [--${o}]`).join("") : "";
  return `rwk ${spec.name}${target}${options}${switches} [flags]`;
};
export const usage = (spec) => usageOf(spec);

export function generalHelp(bold = (s) => s) {
  const width = Math.max(...COMMANDS.map((cmd) => cmd.name.length)) + 2;
  const lines = [
    `${bold("rpgmaker-web-toolkit")}: publish RPG Maker MZ/MV games to Cloudflare Workers`,
    "",
    bold("Usage:"),
    "  rwk <command> [<target>] [flags]",
    "",
    bold("Commands:"),
    ...COMMANDS.map((cmd) => `  ${cmd.name.padEnd(width)}${cmd.summary}`),
    "",
    bold("The target"),
    "  One argument names the game, in any form the command accepts:",
    `    ${"folder".padEnd(8)}${"the game folder on this PC".padEnd(28)}~/Games/"My Game"`,
    `    ${"link".padEnd(8)}${"the deployed game's link".padEnd(28)}https://my-game.alice.workers.dev`,
    `    ${"name".padEnd(8)}${"the site name".padEnd(28)}my-game`,
    "  Without a target, a command that takes a folder uses the current directory when it holds a game.",
    "",
    bold("Flags (anywhere on the line):"),
    ...FLAGS.map(([flag, text]) => `  ${flag.padEnd(16)}${text}`),
    "",
    "Run `rwk <command> --help` for one command. Exit codes: 0 done, 1 failed, 2 a question needs a person, 64 wrong usage, 130 cancelled.",
  ];
  return lines.join("\n");
}

export function commandHelp(spec, bold = (s) => s) {
  const lines = [`${bold(`rwk ${spec.name}`)}: ${spec.summary}`, "", bold("Usage:"), `  ${usageOf(spec)}`];
  if (spec.targets.length) {
    lines.push("", bold("Target:"), ...spec.targets.map((k) => `  ${k.padEnd(8)}${TARGET_HELP[k]}`));
  }
  const options = { ...spec.options, ...spec.switches };
  if (Object.keys(options).length) lines.push("", bold("Options:"), ...Object.entries(options).map(([o, text]) => `  --${o.padEnd(12)}${text}`));
  lines.push("", bold("Examples:"), ...spec.examples.map((e) => `  ${e}`));
  lines.push("", "Flags: --yes, --json, --quiet, --verbose, --no-color. See `rwk --help`.");
  return lines.join("\n");
}

function distance(a, b) {
  const row = Array.from({ length: b.length + 1 }, (_, i) => i);
  for (let i = 1; i <= a.length; i++) {
    let prev = row[0];
    row[0] = i;
    for (let j = 1; j <= b.length; j++) {
      const cur = row[j];
      row[j] = Math.min(row[j] + 1, row[j - 1] + 1, prev + (a[i - 1] === b[j - 1] ? 0 : 1));
      prev = cur;
    }
  }
  return row[b.length];
}

// What an unknown first word was probably meant to be.
function unknownCommand(words) {
  const first = words[0];
  const kind = classifyTarget(words.join(" ")).kind;
  if (kind === "link" || /[\\/]/.test(first) || /^[a-z]:/i.test(first) || /^[~.]/.test(first)) {
    const command = kind === "link" ? "upgrade" : "deploy";
    return new UsageError(`Unknown command "${first}": a command comes first, then the game.`, { hint: `Did you mean: rwk ${command} "${words.join(" ")}"` });
  }
  const names = [...COMMANDS.map((cmd) => cmd.name), "help"];
  const close = names.map((n) => [n, distance(first, n.split(" ")[0])]).sort((a, b) => a[1] - b[1])[0];
  const hint = close && close[1] <= 3 ? `Did you mean "rwk ${close[0]}"? Commands: rwk --help` : "Commands: rwk --help";
  return new UsageError(`Unknown command "${first}".`, { hint });
}

// argv (process.argv after the script) ->
//   { spec, target, flags: { yes, json, quiet, verbose, noColor, dryRun, help, version, to, email, out }, unattended }
// spec is null for "no command" (and for `rwk help`, with flags.help set).
// Throws UsageError for what cannot be run.
export function parseCommandLine(argv, { stdinIsTTY = !!process.stdin.isTTY } = {}) {
  let parsed;
  try {
    parsed = parseArgs({
      args: argv,
      allowPositionals: true,
      options: {
        yes: { type: "boolean", short: "y" },
        json: { type: "boolean" },
        quiet: { type: "boolean", short: "q" },
        verbose: { type: "boolean" },
        "dry-run": { type: "boolean" },
        "no-color": { type: "boolean" },
        help: { type: "boolean", short: "h" },
        version: { type: "boolean", short: "V" },
        to: { type: "string" },
        email: { type: "string" },
        out: { type: "string" },
      },
    });
  } catch (err) {
    const option = /'?(--?[\w-]+)/.exec(err.message);
    const hint = err.code === "ERR_PARSE_ARGS_INVALID_OPTION_VALUE" ? "Give the option a value, e.g. --to new-name or --email me@example.com." : "Flags: rwk --help";
    throw new UsageError(err.code === "ERR_PARSE_ARGS_UNKNOWN_OPTION" ? `Unknown option ${option ? option[1] : ""}.` : err.message.split(". ")[0] + ".", { hint });
  }

  const { values, positionals: words } = parsed;
  const flags = {
    yes: !!values.yes,
    json: !!values.json,
    quiet: !!values.quiet,
    verbose: !!values.verbose,
    noColor: !!values["no-color"],
    dryRun: !!values["dry-run"],
    help: !!values.help,
    version: !!values.version,
    to: values.to,
    email: values.email,
    out: values.out,
  };
  // --json implies --yes: a script reads the result. No terminal on stdin means nobody to answer.
  const unattended = flags.json || flags.yes || !stdinIsTTY;
  const result = { spec: null, target: undefined, flags, unattended };

  if (flags.version) return result;
  if (words[0] === "help") {
    flags.help = true;
    words.shift();
  }
  if (!words.length) return result;

  const two = words.slice(0, 2).join(" ");
  const spec = COMMANDS.find((cmd) => cmd.name === two) || COMMANDS.find((cmd) => cmd.name === words[0]);
  if (!spec) {
    if (flags.help && words.length <= 2) {
      // `rwk help saves`: the group's commands
      if (GROUPS.includes(words[0])) return result;
    }
    if (GROUPS.includes(words[0])) {
      const options = COMMANDS.filter((cmd) => cmd.name.startsWith(`${words[0]} `)).map((cmd) => `rwk ${cmd.name}`);
      throw new UsageError(`"${words[0]}" needs a subcommand.`, { hint: `Use one of: ${options.join(", ")}` });
    }
    throw unknownCommand(words);
  }
  for (const option of ["to", "email", "out"]) {
    if (flags[option] !== undefined && !spec.options?.[option]) {
      throw new UsageError(`Unknown option --${option} for "rwk ${spec.name}".`, { hint: `Usage: ${usageOf(spec)}` });
    }
  }
  if (flags.dryRun && !spec.switches?.["dry-run"]) {
    throw new UsageError(`Unknown option --dry-run for "rwk ${spec.name}".`, { hint: `Usage: ${usageOf(spec)}` });
  }
  result.spec = spec;
  // An unquoted path with spaces arrives as several words: join them back.
  const rest = words.slice(spec.name.split(" ").length);
  result.target = rest.length ? rest.join(" ") : undefined;
  return result;
}
