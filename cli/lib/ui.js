import readline from "node:readline/promises";

// The log (steps, questions, warnings, the closing summary) goes to stderr and
// stdout carries only the run's result: a script reads `--json`, or the link
// when stdout is piped (report.js).
export const print = (msg = "") => {
  clearProgress();
  console.error(msg);
};

// Colour: NO_COLOR or --no-color switch it off, FORCE_COLOR on; otherwise
// only on a terminal that is not "dumb".
let colorOff = false;
export const setColor = (on) => (colorOff = !on);
export function useColor(env = process.env, isTTY = !!process.stderr.isTTY) {
  if (colorOff || env.NO_COLOR) return false;
  if (env.FORCE_COLOR && env.FORCE_COLOR !== "0") return true;
  return isTTY && env.TERM !== "dumb";
}
const color = (code) => (s) => (useColor() ? `\x1b[${code}m${s}\x1b[0m` : String(s));
export const c = {
  bold: color(1),
  dim: color(2),
  red: color(31),
  green: color(32),
  yellow: color(33),
  cyan: color(36),
};

// Symbols fall back to ASCII where the terminal may not draw them (RWK_ASCII=1,
// TERM=dumb, or a locale that is set but not UTF-8).
export function supportsUnicode(env = process.env) {
  if (env.RWK_ASCII || env.TERM === "dumb") return false;
  const locale = env.LC_ALL || env.LC_CTYPE || env.LANG || "";
  return !locale || /utf-?8/i.test(locale);
}
const UNICODE = { step: "▶", ok: "✓", warn: "!", error: "✗", ask: "?", arrow: "→", up: "↑" };
const ASCII = { step: ">", ok: "+", warn: "!", error: "x", ask: "?", arrow: "->", up: "^" };
export const sym = supportsUnicode() ? UNICODE : ASCII;

// --quiet: only warnings, questions and errors; the result still reaches stdout.
let quiet = false;
export const setQuiet = (on) => (quiet = !!on);
export const isQuiet = () => quiet;
const say = (msg) => {
  if (!quiet) print(msg);
};

// Every warning of the run, repeated in the deploy's build report.
export const warnings = [];

// [n/N] on the steps once a command knows how many are left: planSteps(N)
// numbers the next N steps, and the ones after them print as before.
let plan = null;
export function planSteps(total) {
  plan = total > 0 ? { at: 0, total } : null;
}
function stepNumber() {
  if (!plan) return "";
  const n = ++plan.at;
  const { total } = plan;
  if (n >= total) plan = null;
  return c.dim(`[${n}/${total}]`) + " ";
}

export const log = {
  step: (msg) => say(`\n${c.cyan(sym.step)} ${stepNumber()}${c.bold(msg)}`),
  info: (msg) => say(`  ${msg}`),
  ok: (msg) => say(`  ${c.green(sym.ok)} ${msg}`),
  warn: (msg) => {
    warnings.push(msg);
    print(`  ${c.yellow(sym.warn)} ${msg}`);
  },
  // What went wrong, then what to do about it.
  error: (msg, hint) => {
    print(`${c.red(sym.error)} ${msg}`);
    if (hint) print(`  ${c.cyan(sym.arrow)} ${hint}`);
  },
};

// A line rewritten in place (upload progress) only on a terminal, without
// NO_COLOR / --no-color, outside CI and without --json (setLive(false)).
let liveOff = false;
export const setLive = (on) => (liveOff = !on);
export function useLive(env = process.env, isTTY = !!process.stderr.isTTY) {
  if (liveOff || colorOff || env.NO_COLOR || env.CI) return false;
  return isTTY && env.TERM !== "dumb";
}

// The progress line on screen, erased before anything else is printed.
let shownLine = null;
function clearProgress() {
  if (!shownLine) return;
  shownLine.write("\r\x1b[2K");
  shownLine = null;
}

// -> { live, update(text), end() }. On a terminal (live) each update replaces the
// last one, cut to the width; elsewhere every update is a plain line, as a log
// file keeps them all. Nothing with --quiet.
export function progressLine({ live = useLive(), write = (s) => process.stderr.write(s), columns = () => process.stderr.columns || 80 } = {}) {
  const line = {
    live,
    write,
    update(text) {
      if (quiet) return;
      if (!live) return print(`  ${text}`);
      const chars = [...`  ${text}`];
      const width = Math.max(10, columns() - 1);
      const shown = chars.length > width ? chars.slice(0, width - 1).join("") + "…" : chars.join("");
      if (shownLine && shownLine !== line) clearProgress();
      write(`\r\x1b[2K${shown}`);
      shownLine = line;
    },
    end() {
      if (shownLine === line) clearProgress();
    },
  };
  return line;
}

// A failure the user can act on. exitCode: 1 failed, 2 a question needs a
// person, 64 wrong usage. hint: the next thing to try.
export class CliError extends Error {
  constructor(message, { hint, exitCode = 1 } = {}) {
    super(message);
    this.hint = hint;
    this.exitCode = exitCode;
  }
}

export class UsageError extends CliError {
  constructor(message, { hint } = {}) {
    super(message, { hint, exitCode: 64 });
  }
}

export class UserAbort extends Error {}

// A run with no one at the keyboard (CI, --yes): no question waits for an
// answer. Each takes the answer it would default to, or the one its caller
// gives for an unattended run; a question with neither stops the run with
// NeedsAnswer (exit code 2) instead of hanging.
let unattended = false;
export const setUnattended = (on) => (unattended = !!on);
export const isUnattended = () => unattended;

export class NeedsAnswer extends CliError {
  constructor(message, hint) {
    super(message, { hint, exitCode: 2 });
  }
}

function noAnswer(text, hint) {
  throw new NeedsAnswer(`Nobody can answer "${text}" in a non-interactive run.`, hint);
}

const answered = (text, answer) => print(`  ${c.yellow(sym.ask)} ${text}: ${answer} ${c.dim("(non-interactive)")}`);

// A fresh interface per question so child processes (wrangler login) can
// own stdin in between prompts.
async function question(text) {
  const rl = readline.createInterface({ input: process.stdin, output: process.stderr });
  try {
    return await rl.question(text);
  } finally {
    rl.close();
  }
}

// Terminal rows a printed line takes, wrapping included.
const rowsOf = (line, columns) => Math.max(1, Math.ceil([...String(line).replace(/\x1b\[[0-9;]*m/g, "")].length / columns));

// Erases the last `lines` printed lines (a question and its answer) so a menu
// shown in a loop does not pile up. Only on a real terminal; elsewhere (a pipe,
// a log file) the lines stay, as they are the record.
export function eraseLines(lines) {
  if (!process.stderr.isTTY || process.env.TERM === "dumb" || !(lines > 0)) return;
  process.stderr.write("\x1b[1A\x1b[2K".repeat(lines) + "\r");
}

// hint: what to do instead, when an unattended run cannot take the default.
// clear: erase the question and its answer once answered.
export async function ask(text, defaultValue = "", validate, { hint, clear = false } = {}) {
  if (unattended) {
    if (defaultValue === "" || (validate && validate(defaultValue))) noAnswer(text, hint);
    answered(text, defaultValue);
    return defaultValue;
  }
  const columns = process.stderr.columns || 80;
  let rows = 0;
  for (;;) {
    const hint = defaultValue !== "" ? c.dim(` [${defaultValue}]`) : "";
    const prompt = `  ${c.yellow(sym.ask)} ${text}${hint}: `;
    const answer = (await question(prompt)).trim();
    rows += rowsOf(prompt + answer, columns);
    const value = answer === "" ? defaultValue : answer;
    const problem = validate ? validate(value) : null;
    if (!problem) {
      if (clear) eraseLines(rows);
      return value;
    }
    log.warn(problem);
    rows += rowsOf(`  ! ${problem}`, columns);
  }
}

// whenUnattended: the answer with no one there (default: defaultYes).
export async function confirm(text, defaultYes = true, { whenUnattended = defaultYes, clear = false } = {}) {
  if (unattended) {
    answered(text, whenUnattended ? "yes" : "no");
    return whenUnattended;
  }
  const prompt = `  ${c.yellow(sym.ask)} ${text} ${c.dim(defaultYes ? "[Y/n]" : "[y/N]")}: `;
  const raw = await question(prompt);
  if (clear) eraseLines(rowsOf(prompt + raw, process.stderr.columns || 80));
  const answer = raw.trim().toLowerCase();
  if (answer === "") return defaultYes;
  return answer === "y" || answer === "yes";
}

// options: [{ label, value }] -> value
// whenUnattended: the option's index with no one there (default: defaultIndex), null: stop the run.
// clear: erase the menu once a choice is made.
export async function choose(text, options, defaultIndex = 0, { whenUnattended = defaultIndex, hint, clear = false } = {}) {
  if (unattended) {
    if (whenUnattended === null) noAnswer(text, hint);
    answered(text, options[whenUnattended].label);
    return options[whenUnattended].value;
  }
  const columns = process.stderr.columns || 80;
  const lines = [
    `  ${c.yellow(sym.ask)} ${text}`,
    ...options.map((o, i) => `     ${i + 1}) ${o.label}${i === defaultIndex ? c.dim("  (default)") : ""}`),
  ];
  lines.forEach((l) => print(l));
  const answer = await ask(
    "Enter a number",
    String(defaultIndex + 1),
    (v) => {
      const n = Number(v);
      return Number.isInteger(n) && n >= 1 && n <= options.length ? null : `Enter a number from 1 to ${options.length}`;
    },
    { clear }
  );
  if (clear) eraseLines(lines.reduce((n, l) => n + rowsOf(l, columns), 0));
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
