import readline from "node:readline/promises";

const color = (code) => (s) => (process.stdout.isTTY ? `\x1b[${code}m${s}\x1b[0m` : String(s));
export const c = {
  bold: color(1),
  dim: color(2),
  red: color(31),
  green: color(32),
  yellow: color(33),
  cyan: color(36),
};

export const log = {
  step: (msg) => console.log(`\n${c.cyan("▶")} ${c.bold(msg)}`),
  info: (msg) => console.log(`  ${msg}`),
  ok: (msg) => console.log(`  ${c.green("✓")} ${msg}`),
  warn: (msg) => console.log(`  ${c.yellow("!")} ${msg}`),
  error: (msg) => console.error(`${c.red("✗")} ${msg}`),
};

export class UserAbort extends Error {}

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

export async function ask(text, defaultValue = "", validate) {
  for (;;) {
    const hint = defaultValue !== "" ? c.dim(` [${defaultValue}]`) : "";
    const answer = (await question(`  ${c.yellow("?")} ${text}${hint}: `)).trim();
    const value = answer === "" ? defaultValue : answer;
    const problem = validate ? validate(value) : null;
    if (!problem) return value;
    log.warn(problem);
  }
}

export async function confirm(text, defaultYes = true) {
  const answer = (await question(`  ${c.yellow("?")} ${text} ${c.dim(defaultYes ? "[Y/n]" : "[y/N]")}: `))
    .trim()
    .toLowerCase();
  if (answer === "") return defaultYes;
  return answer === "y" || answer === "yes" || answer === "c" || answer === "co" || answer === "có";
}

// options: [{ label, value }] -> value
export async function choose(text, options, defaultIndex = 0) {
  console.log(`  ${c.yellow("?")} ${text}`);
  options.forEach((o, i) => console.log(`     ${i + 1}) ${o.label}${i === defaultIndex ? c.dim("  (mặc định)") : ""}`));
  const answer = await ask("Chọn số", String(defaultIndex + 1), (v) => {
    const n = Number(v);
    return Number.isInteger(n) && n >= 1 && n <= options.length ? null : `Nhập số từ 1 đến ${options.length}`;
  });
  return options[Number(answer) - 1].value;
}

export async function pause(text = "Nhấn Enter để tiếp tục") {
  await question(`  ${c.dim(text)} `);
}

export function formatBytes(n) {
  if (n >= 1024 ** 3) return (n / 1024 ** 3).toFixed(2) + " GB";
  if (n >= 1024 ** 2) return (n / 1024 ** 2).toFixed(1) + " MB";
  if (n >= 1024) return (n / 1024).toFixed(0) + " KB";
  return n + " B";
}
