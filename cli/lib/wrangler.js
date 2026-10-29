import { spawn } from "node:child_process";
import path from "node:path";
import { TOOLKIT_ROOT } from "./config.js";
import { isQuiet, progressLine } from "./ui.js";

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

// wrangler deploy prints "Uploaded 12 of 340 assets" after each batch. On a terminal
// those lines become one line that updates in place, and any other line ends it and
// prints as usual. Elsewhere (CI, a pipe) the output passes through unchanged.
const UPLOADED = /^\s*Uploaded (\d+) of (\d+) assets?\s*$/;
export function assetProgress(write, bar = progressLine()) {
  if (!bar.live) return { push: write, raw: write, end: () => {} };
  let rest = "";
  const line = (text) => {
    const m = UPLOADED.exec(text.replace(/\x1b\[[0-9;]*m/g, ""));
    if (!m) {
      bar.end();
      return write(text + "\n");
    }
    const [done, total] = [Number(m[1]), Number(m[2])];
    bar.update(`Uploaded ${done} of ${total} assets (${total ? Math.floor((done * 100) / total) : 100}%)`);
  };
  return {
    // wrangler's stderr (warnings) ends the progress line too.
    raw(chunk) {
      bar.end();
      write(chunk);
    },
    push(chunk) {
      const lines = (rest + chunk).split("\n");
      rest = lines.pop();
      lines.forEach(line);
    },
    end() {
      if (rest) line(rest);
      rest = "";
      bar.end();
    },
  };
}

// Runs the toolkit's pinned wrangler (no shell, so paths with spaces are safe).
// Every command runs under PROFILE; `auth` commands name it themselves.
// interactive: hand the terminal to wrangler (login prompts).
// quiet: capture output without echoing it.
// progress: wrangler deploy's asset upload counts as one line (assetProgress).
export function wrangler(args, { interactive = false, quiet = false, progress = false, cwd = TOOLKIT_ROOT } = {}) {
  return new Promise((resolve, reject) => {
    const run = wranglerRun(args);
    const child = spawn(process.execPath, [WRANGLER_BIN, ...run.args], {
      cwd,
      stdio: interactive ? "inherit" : ["inherit", "pipe", "pipe"],
      env: run.env,
    });
    let stdout = "";
    let stderr = "";
    const write = (d) => process.stderr.write(d);
    const echo = progress ? assetProgress(write) : { push: write, raw: write, end: () => {} };
    if (!interactive) {
      child.stdout.on("data", (d) => {
        stdout += d;
        // stdout is for the run's result: wrangler's output goes to stderr with the rest.
        if (!quiet && !isQuiet()) echo.push(String(d));
      });
      child.stderr.on("data", (d) => {
        stderr += d;
        if (!quiet && !isQuiet()) echo.raw(d);
      });
    }
    child.on("error", reject);
    child.on("close", (code) => {
      echo.end();
      resolve({ code, stdout, stderr, output: stdout + stderr });
    });
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
