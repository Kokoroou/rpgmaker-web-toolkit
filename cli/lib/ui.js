import readline from "node:readline/promises";

// --json: stdout carries only the run's result (report.js), so the log goes
// to stderr.
let jsonOutput = false;
export const setJsonOutput = (on) => (jsonOutput = !!on);
export const isJsonOutput = () => jsonOutput;
const stream = () => (jsonOutput ? process.stderr : process.stdout);
// A line of the log.
export const print = (msg = "") => (jsonOutput ? console.error(msg) : console.log(msg));

const color = (code) => (s) => (stream().isTTY ? `\x1b[${code}m${s}\x1b[0m` : String(s));
export const c = {
  bold: color(1),
  dim: color(2),
  red: color(31),
  green: color(32),
  yellow: color(33),
  cyan: color(36),
};

// Every warning of the run, repeated in the deploy's build report.
export const warnings = [];

export const log = {
  step: (msg) => print(`\n${c.cyan("▶")} ${c.bold(msg)}`),
  info: (msg) => print(`  ${msg}`),
  ok: (msg) => print(`  ${c.green("✓")} ${msg}`),
  warn: (msg) => {
    warnings.push(msg);
    print(`  ${c.yellow("!")} ${msg}`);
  },
  error: (msg) => console.error(`${c.red("✗")} ${msg}`),
};

export class UserAbort extends Error {}

// A run with no one at the keyboard (CI, --yes): no question waits for an
// answer. Each takes the answer it would default to, or the one its caller
// gives for an unattended run; a question with neither stops the run with
// NeedsAnswer (exit code 2) instead of hanging.
let unattended = false;
export const setUnattended = (on) => (unattended = !!on);
export const isUnattended = () => unattended;

export class NeedsAnswer extends Error {
  constructor(message) {
    super(message);
    this.exitCode = 2;
  }
}

// args (process.argv after the script) -> { unattended, json, rest }: --yes,
// -y, --non-interactive and --json are flags, the rest is the command and its
// folder / link. --json implies --yes: a script reads the result.
export function splitFlags(args, { stdinIsTTY = !!process.stdin.isTTY } = {}) {
  const flags = new Set(["--yes", "-y", "--non-interactive"]);
  const json = args.includes("--json");
  const rest = args.filter((a) => !flags.has(a) && a !== "--json");
  return { unattended: json || args.some((a) => flags.has(a)) || !stdinIsTTY, json, rest };
}

function noAnswer(text, hint) {
  throw new NeedsAnswer(`Nobody can answer "${text}" in a non-interactive run.${hint ? ` ${hint}` : ""}`);
}

const answered = (text, answer) => print(`  ${c.yellow("?")} ${text}: ${answer} ${c.dim("(non-interactive)")}`);

// A fresh interface per question so child processes (wrangler login) can
// own stdin in between prompts.
async function question(text) {
  const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
  try {
    return await rl.question(text);
  } finally {
    rl.close();
  }
}

// hint: what to do instead, when an unattended run cannot take the default.
export async function ask(text, defaultValue = "", validate, { hint } = {}) {
  if (unattended) {
    if (defaultValue === "" || (validate && validate(defaultValue))) noAnswer(text, hint);
    answered(text, defaultValue);
    return defaultValue;
  }
  for (;;) {
    const hint = defaultValue !== "" ? c.dim(` [${defaultValue}]`) : "";
    const answer = (await question(`  ${c.yellow("?")} ${text}${hint}: `)).trim();
    const value = answer === "" ? defaultValue : answer;
    const problem = validate ? validate(value) : null;
    if (!problem) return value;
    log.warn(problem);
  }
}

// whenUnattended: the answer with no one there (default: defaultYes).
export async function confirm(text, defaultYes = true, { whenUnattended = defaultYes } = {}) {
  if (unattended) {
    answered(text, whenUnattended ? "yes" : "no");
    return whenUnattended;
  }
  const answer = (await question(`  ${c.yellow("?")} ${text} ${c.dim(defaultYes ? "[Y/n]" : "[y/N]")}: `))
    .trim()
    .toLowerCase();
  if (answer === "") return defaultYes;
  return answer === "y" || answer === "yes";
}

// options: [{ label, value }] -> value
// whenUnattended: the option's index with no one there (default: defaultIndex), null: stop the run.
export async function choose(text, options, defaultIndex = 0, { whenUnattended = defaultIndex, hint } = {}) {
  if (unattended) {
    if (whenUnattended === null) noAnswer(text, hint);
    answered(text, options[whenUnattended].label);
    return options[whenUnattended].value;
  }
  print(`  ${c.yellow("?")} ${text}`);
  options.forEach((o, i) => print(`     ${i + 1}) ${o.label}${i === defaultIndex ? c.dim("  (default)") : ""}`));
  const answer = await ask("Enter a number", String(defaultIndex + 1), (v) => {
    const n = Number(v);
    return Number.isInteger(n) && n >= 1 && n <= options.length ? null : `Enter a number from 1 to ${options.length}`;
  });
  return options[Number(answer) - 1].value;
}

export async function pause(text = "Press Enter to continue", { hint } = {}) {
  if (unattended) noAnswer(text, hint);
  await question(`  ${c.dim(text)} `);
}

export function formatBytes(n) {
  if (n >= 1024 ** 3) return (n / 1024 ** 3).toFixed(2) + " GB";
  if (n >= 1024 ** 2) return (n / 1024 ** 2).toFixed(1) + " MB";
  if (n >= 1024) return (n / 1024).toFixed(0) + " KB";
  return n + " B";
}
