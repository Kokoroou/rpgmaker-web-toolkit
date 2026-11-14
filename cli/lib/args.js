// The command line: which command, on what, with which flags.
//
//   rwk <command> [<target>] [flags]        flags may come before or after
//
// COMMANDS is the one list the parser, `rwk --help` and `rwk <command> --help`
// read, so a command is added here and nowhere else.

import { parseArgs } from "node:util";
import { validateProfileName } from "./config.js";
import { validateSlug } from "./game.js";
import { classifyTarget } from "./target.js";
import { UsageError } from "./ui.js";

const TARGET_HELP = {
  folder: "the game folder",
  link: "the game's link",
  name: "the site name",
  profile: "the login profile's name",
};

// Commands by what they are for; `rwk --help` lists them in this order.
const GROUP_ORDER = ["Publish", "Manage a site", "Cloud saves", "Account"];
const GROUP_OF = {
  deploy: "Publish", analyze: "Publish", "fix-paths": "Publish", test: "Publish", upgrade: "Publish", rename: "Publish", delete: "Publish",
  list: "Manage a site", status: "Manage a site", open: "Manage a site", logs: "Manage a site", config: "Manage a site",
  "saves import": "Cloud saves", "saves export": "Cloud saves", "saves move": "Cloud saves", "saves delete": "Cloud saves",
  login: "Account", logout: "Account", whoami: "Account", profiles: "Account", "profiles use": "Account", doctor: "Account",
};

const SPECS = [
  {
    name: "deploy",
    summary: "Publish a game from its folder, or update it (uploads changed files only)",
    targets: ["folder"],
    options: { name: "The site name on the first deploy, without the question (default: the name in rwk.json, else from the folder's name); for a published game, which of its sites to update" },
    switches: {
      "new-site": "Publish the game as one more site, beside the ones it has (e.g. my-game-v2): its own link, settings and saves",
      "dry-run": "Only check the game and build nothing: the warnings and the file count, no Cloudflare login (same as rwk analyze)",
    },
    examples: ['rwk deploy "D:\\Games\\My Game"', "rwk deploy ~/Games/'My Game' --yes --name my-game", "rwk deploy ./game --new-site --name my-game-v2", "rwk deploy ./game --name my-game-v2   # update that site", "rwk deploy --dry-run   # in the game folder"],
  },
  {
    name: "analyze",
    summary: "Check a game folder for web problems: warnings and file count (no login, nothing published)",
    targets: ["folder"],
    examples: ['rwk analyze "D:\\Games\\My Game"', "rwk analyze --json   # in the game folder"],
  },
  {
    name: "fix-paths",
    summary: "Fix file paths that work on Windows but break on the web (letter case, .PNG, img/Faces, # in names), in the game folder",
    targets: ["folder"],
    options: {
      level: "How much may change: safe (references only), standard (default: + extensions, engine folders, plugin code), thorough (+ file names with # ? %)",
      undo: "Put the game back as it was before a fix: the backup folder it printed, or last",
    },
    switches: { apply: "Make the changes without asking (without it, a terminal asks after the plan; a run with --yes only shows the plan)" },
    examples: ['rwk fix-paths "D:\\Games\\My Game"', "rwk fix-paths ./game --level safe --apply", "rwk fix-paths ./game --undo last", 'rwk fix-paths ./game --apply && rwk deploy ./game'],
  },
  {
    name: "test",
    summary: "Play the first minutes of the game in a hidden Chrome and report what breaks: start, errors, missing files, save, load, menus, phone",
    targets: ["folder", "link", "name"],
    options: { out: "The folder for the screenshots and report.json (default: rwk-test-<site name>)" },
    examples: ['rwk test "D:\\Games\\My Game"   # the web build, on this PC: nothing published', "rwk test https://my-game.alice.workers.dev", "rwk test my-game --out ./test-report --json"],
  },
  {
    name: "upgrade",
    summary: "Update the toolkit of deployed games (several at once, or --all); the game files stay as uploaded",
    targets: ["folder", "link", "name"],
    multiple: true,
    switches: { all: "Update every game in this Cloudflare account, skipping the ones already on this toolkit version" },
    examples: ["rwk upgrade my-game", "rwk upgrade my-game other-game https://third.alice.workers.dev", "rwk upgrade --all", "rwk upgrade   # in the game folder: its site name, nothing uploaded"],
  },
  {
    name: "saves import",
    summary: "Upload the game's save/ folder to the cloud (overwrites same-name cloud saves)",
    targets: ["folder"],
    options: { name: "Which of the game's sites, when it has several (default: the name in rwk.json, else the question)" },
    switches: { "dry-run": "List the saves that would be uploaded and where, and upload nothing" },
    examples: ['rwk saves import "D:\\Games\\My Game"'],
  },
  {
    name: "config",
    summary: "Change the game's settings (buttons, features, files…) by questions, or one at a time with --get / --set",
    targets: ["folder", "link", "name"],
    options: {
      get: "Print one setting and change nothing, e.g. --get fastForward.maxSpeed",
      set: "Change one setting without questions, e.g. --set cheats=false (repeat it for several; null goes back to the default)",
    },
    examples: ['rwk config "D:\\Games\\My Game"', "rwk config my-game", "rwk config my-game --get cheats", "rwk config my-game --set cheats=true --set fastForward.maxSpeed=3"],
  },
  {
    name: "rename",
    summary: "Move the site to a new name (address); saves carry over",
    targets: ["folder"],
    options: { to: "The new site name; without it the command asks", name: "Which of the game's sites to rename, when it has several (default: the name in rwk.json, else the question)" },
    switches: { "dry-run": "Check the new name and say what the rename would do; changes nothing" },
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
    name: "saves move",
    summary: "Move one player's cloud saves (and older saves) to another email, e.g. after the player changed address",
    targets: ["link", "name"],
    options: { from: "The email the saves are under now", to: "The email that gets them (its own saves with the same name are replaced)" },
    examples: ["rwk saves move my-game --from old@example.com --to new@example.com"],
  },
  {
    name: "saves delete",
    summary: "Delete one player's cloud saves and older saves; asks you to type the email",
    targets: ["link", "name"],
    options: { email: "The player's email whose saves are deleted; without it the command asks" },
    examples: ["rwk saves delete my-game --email old@example.com", "rwk saves export my-game --email old@example.com && rwk saves delete my-game --email old@example.com"],
  },
  {
    name: "logs",
    summary: "Show the site's Worker logs live, until Ctrl+C",
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
    summary: "Delete the site's Worker (saves stay in R2, unless --purge); asks you to type the site name",
    targets: ["link", "name"],
    switches: { purge: "Also delete what the game keeps in R2: every player's saves and older saves, its settings, player list and large files" },
    examples: ["rwk delete my-game", "rwk saves export my-game --email me@example.com && rwk delete my-game --purge"],
  },
  {
    name: "login",
    summary: "Log in to Cloudflare in the browser, in a profile (--profile; default: the current one)",
    targets: [],
    examples: ["rwk login", "rwk login --profile work   # another email: a second login", "rwk login --profile work --account Team"],
  },
  {
    name: "logout",
    summary: "Log out of a profile (--profile; default: the current one); its games stay published",
    targets: [],
    examples: ["rwk logout --profile work"],
  },
  {
    name: "whoami",
    summary: "Show the Cloudflare login a command would use: profile, email and accounts",
    targets: [],
    examples: ["rwk whoami", "rwk whoami --profile work"],
  },
  {
    name: "profiles",
    summary: "List the login profiles on this PC (one Cloudflare login each) and the one commands use",
    targets: [],
    examples: ["rwk profiles", "rwk profiles --json"],
  },
  {
    name: "profiles use",
    summary: "Make commands use another login profile from now on",
    targets: ["profile"],
    examples: ["rwk profiles use work", "rwk profiles use default"],
  },
  {
    name: "doctor",
    summary: "Check this PC and the account (Node.js, wrangler, the login, the token's permissions, R2, the workers.dev subdomain), and a deployed game when named",
    targets: ["link", "name"],
    optionalTarget: true,
    examples: ["rwk doctor", "rwk doctor my-game", "rwk doctor https://my-game.alice.workers.dev --json"],
  },
];

// Sorted by group (the list above keeps each command's own order within it).
export const COMMANDS = SPECS.map((spec) => ({ ...spec, group: GROUP_OF[spec.name] })).sort((a, b) => GROUP_ORDER.indexOf(a.group) - GROUP_ORDER.indexOf(b.group));

const GROUPS = [...new Set(COMMANDS.filter((cmd) => cmd.name.includes(" ")).map((cmd) => cmd.name.split(" ")[0]))];

export const FLAGS = [
  ["-y, --yes", "Never ask: take each question's default, or stop with exit code 2 when one has none"],
  ["", "(also when stdin is not a terminal, as in CI). Logs in with CLOUDFLARE_API_TOKEN if it is set"],
  ["    --json", "Same as --yes, and prints the result as JSON on stdout"],
  ["    --account", "The Cloudflare account to work in, by ID or name, when the login has several"],
  ["", "(else CLOUDFLARE_ACCOUNT_ID in a run with --yes, else the last one chosen)"],
  ["    --profile", "The login profile (one Cloudflare login, one email) for this run: rwk profiles"],
  ["", "(else the one chosen with rwk profiles use or rwk login; ignored with CLOUDFLARE_API_TOKEN)"],
  ["-q, --quiet", "Only warnings and errors; the result still goes to stdout"],
  ["    --verbose", "Print full error details"],
  ["    --no-color", "No colors (also NO_COLOR=1)"],
  ["-h, --help", "Show help (for a command: rwk <command> --help)"],
  ["-V, --version", "Show the toolkit version"],
  ["    --cleanup", "One-liner (run.ps1 / run.sh) only: delete the cached toolkit after the run (kept while another run uses it)"],
];

const OPTION_VALUES = { level: "safe | standard | thorough", undo: "backup folder | last", name: "site name", to: "name", email: "address", out: "folder", get: "key", set: "key=value" };

const usageOf = (spec) => {
  const games = spec.targets.length ? ` <${spec.targets.map((k) => ({ folder: "game folder", link: "game link", name: "site name", profile: "profile" })[k]).join(" | ")}>${spec.multiple ? "..." : ""}` : "";
  const target = spec.optionalTarget ? ` [${games.trim()}]` : games;
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
    ...GROUP_ORDER.flatMap((group) => [bold(`${group}:`), ...COMMANDS.filter((cmd) => cmd.group === group).map((cmd) => `  ${cmd.name.padEnd(width)}${cmd.summary}`), ""]),
    bold("The target"),
    "  The game, in any form the command accepts (upgrade takes several links or site names):",
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
  lines.push("", "Flags: --yes, --json, --account, --profile, --quiet, --verbose, --no-color. See `rwk --help`.");
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
//   { spec, target, targets (the games named: several only for a command with `multiple`), flags: { yes, json, quiet, verbose, noColor, dryRun, purge, newSite, all, apply, help, version, account, profile, name, to, from, email, out, get, set, level, undo }, unattended }
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
        purge: { type: "boolean" },
        "new-site": { type: "boolean" },
        all: { type: "boolean" },
        apply: { type: "boolean" },
        "no-color": { type: "boolean" },
        // Read by run.ps1 / run.sh, which strip it; accepted here so rwk.cmd and rwk.sh ignore it too.
        cleanup: { type: "boolean" },
        help: { type: "boolean", short: "h" },
        version: { type: "boolean", short: "V" },
        account: { type: "string" },
        profile: { type: "string" },
        name: { type: "string" },
        to: { type: "string" },
        from: { type: "string" },
        email: { type: "string" },
        out: { type: "string" },
        get: { type: "string" },
        set: { type: "string", multiple: true },
        level: { type: "string" },
        undo: { type: "string" },
      },
    });
  } catch (err) {
    const option = /'?(--?[\w-]+)/.exec(err.message);
    const hint = err.code === "ERR_PARSE_ARGS_INVALID_OPTION_VALUE" ? "Give the option a value, e.g. --name my-game, --account <account ID>, --profile work, --to new-name, --from old@example.com, --email me@example.com or --set cheats=false." : "Flags: rwk --help";
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
    purge: !!values.purge,
    newSite: !!values["new-site"],
    all: !!values.all,
    apply: !!values.apply,
    help: !!values.help,
    version: !!values.version,
    account: values.account,
    profile: values.profile,
    name: values.name,
    to: values.to,
    from: values.from,
    email: values.email,
    out: values.out,
    get: values.get,
    set: values.set,
    level: values.level,
    undo: values.undo,
  };
  if (flags.profile !== undefined && validateProfileName(flags.profile)) throw new UsageError(`Bad profile name "${flags.profile}" for --profile: ${validateProfileName(flags.profile)}`, { hint: "List the profiles: rwk profiles" });
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
  for (const option of ["name", "to", "from", "email", "out", "get", "set", "level", "undo"]) {
    if (flags[option] !== undefined && !spec.options?.[option]) {
      throw new UsageError(`Unknown option --${option} for "rwk ${spec.name}".`, { hint: `Usage: ${usageOf(spec)}` });
    }
  }
  if (flags.name !== undefined && validateSlug(flags.name)) throw new UsageError(`Bad site name "${flags.name}" for --name: ${validateSlug(flags.name)}`, { hint: `Usage: ${usageOf(spec)}` });
  if (flags.get !== undefined && flags.set) throw new UsageError("--get and --set cannot go together.", { hint: `Usage: ${usageOf(spec)}` });
  for (const [option, on] of [["dry-run", flags.dryRun], ["purge", flags.purge], ["new-site", flags.newSite], ["all", flags.all], ["apply", flags.apply]]) {
    if (on && !spec.switches?.[option]) throw new UsageError(`Unknown option --${option} for "rwk ${spec.name}".`, { hint: `Usage: ${usageOf(spec)}` });
  }
  result.spec = spec;
  // An unquoted path with spaces arrives as several words: join them back.
  const rest = words.slice(spec.name.split(" ").length);
  result.target = rest.length ? rest.join(" ") : undefined;
  // Several games: each word is a link or a site name (a path with spaces is not).
  result.targets = rest.length ? [result.target] : [];
  if (spec.multiple && rest.length > 1 && rest.every((word) => ["link", "name"].includes(classifyTarget(word).kind))) result.targets = rest;
  if (flags.all && result.targets.length) throw new UsageError("--all takes no game: it updates every game in the account.", { hint: `Usage: ${usageOf(spec)}` });
  return result;
}
