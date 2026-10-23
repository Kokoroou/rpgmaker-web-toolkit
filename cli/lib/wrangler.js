import { spawn } from "node:child_process";
import path from "node:path";
import { TOOLKIT_ROOT } from "./config.js";

const WRANGLER_BIN = path.join(TOOLKIT_ROOT, "node_modules", "wrangler", "bin", "wrangler.js");

let accountId = null;
export function useAccount(id) {
  accountId = id;
}

// Runs the toolkit's pinned wrangler (no shell, so paths with spaces are safe).
// interactive: hand the terminal to wrangler (login prompts).
// quiet: capture output without echoing it.
export function wrangler(args, { interactive = false, quiet = false, cwd = TOOLKIT_ROOT } = {}) {
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, [WRANGLER_BIN, ...args], {
      cwd,
      stdio: interactive ? "inherit" : ["inherit", "pipe", "pipe"],
      env: {
        ...process.env,
        WRANGLER_SEND_METRICS: "false",
        ...(accountId && { CLOUDFLARE_ACCOUNT_ID: accountId }),
      },
    });
    let stdout = "";
    let stderr = "";
    if (!interactive) {
      child.stdout.on("data", (d) => {
        stdout += d;
        if (!quiet) process.stdout.write(d);
      });
      child.stderr.on("data", (d) => {
        stderr += d;
        if (!quiet) process.stderr.write(d);
      });
    }
    child.on("error", reject);
    child.on("close", (code) => resolve({ code, stdout, stderr, output: stdout + stderr }));
  });
}

export async function wranglerOrThrow(args, options) {
  const result = await wrangler(args, options);
  if (result.code !== 0) {
    const tail = result.output.trim().split("\n").slice(-6).join("\n");
    throw new Error(`wrangler ${args.slice(0, 3).join(" ")} thất bại (mã ${result.code})\n${tail}`);
  }
  return result;
}
