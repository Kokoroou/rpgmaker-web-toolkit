import { spawn } from "node:child_process";
import path from "node:path";
import { TOOLKIT_ROOT } from "./config.js";

const WRANGLER_BIN = path.join(TOOLKIT_ROOT, "node_modules", "wrangler", "bin", "wrangler.js");

// The toolkit's own wrangler auth profile, so its narrow-scoped login never
// replaces (or borrows) the user's default `wrangler login`.
export const PROFILE = "rpgmaker-web-toolkit";

// Least privilege: deploy a Worker (static assets, workers.dev, R2 binding)
// and read/write its R2 bucket. wrangler always adds offline_access.
export const SCOPES = ["account:read", "user:read", "workers:write", "workers_scripts:write"];

// Credentials in the environment would override the profile's token.
const ENV_CREDENTIALS = ["CLOUDFLARE_API_TOKEN", "CF_API_TOKEN", "CLOUDFLARE_API_KEY", "CF_API_KEY", "CLOUDFLARE_EMAIL", "CF_EMAIL", "CF_ACCOUNT_ID"];

let accountId = null;
export function useAccount(id) {
  accountId = id;
}

// Non-interactive runs (CI) may log in with an API token instead of the
// profile: CLOUDFLARE_API_TOKEN, read only when the CLI says so, since an
// interactive run must not pick up a token the user set for something else.
let envToken = null;
export function useEnvToken(env = process.env) {
  envToken = env.CLOUDFLARE_API_TOKEN || null;
  return !!envToken;
}
export const envApiToken = () => envToken;

// The environment and the extra arguments of one wrangler run.
export function wranglerRun(args, base = process.env) {
  const env = { ...base, WRANGLER_SEND_METRICS: "false" };
  for (const name of ENV_CREDENTIALS) delete env[name];
  if (envToken) env.CLOUDFLARE_API_TOKEN = envToken;
  if (accountId) env.CLOUDFLARE_ACCOUNT_ID = accountId;
  else delete env.CLOUDFLARE_ACCOUNT_ID;
  // With a token, wrangler reads it from the environment; a profile would win over it.
  const extra = args[0] === "auth" || envToken ? [] : ["--profile", PROFILE];
  return { env, args: [...args, ...extra] };
}

// Runs the toolkit's pinned wrangler (no shell, so paths with spaces are safe).
// Every command runs under PROFILE; `auth` commands name it themselves.
// interactive: hand the terminal to wrangler (login prompts).
// quiet: capture output without echoing it.
export function wrangler(args, { interactive = false, quiet = false, cwd = TOOLKIT_ROOT } = {}) {
  return new Promise((resolve, reject) => {
    const run = wranglerRun(args);
    const child = spawn(process.execPath, [WRANGLER_BIN, ...run.args], {
      cwd,
      stdio: interactive ? "inherit" : ["inherit", "pipe", "pipe"],
      env: run.env,
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
    throw new Error(`wrangler ${args.slice(0, 3).join(" ")} failed (exit code ${result.code})\n${tail}`);
  }
  return result;
}
