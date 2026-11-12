// Login profiles: login, logout, whoami, profiles, profiles use.
//
// A profile is one Cloudflare login (one email) kept by the toolkit, with the
// account chosen in it. --account picks among the accounts of one login; an
// account under another email needs its own profile. Runs use the profile
// chosen with `rwk profiles use`, `rwk login`, or --profile for one run.

import { DEFAULT_PROFILE, activeProfile, loadState, saveState, validateProfileName } from "../lib/config.js";
import { logIn, logOut, pickAccount, whoami } from "../lib/cloudflare.js";
import { CliError, NeedsAnswer, UsageError, c, confirm, isUnattended, log } from "../lib/ui.js";
import { envApiToken } from "../lib/wrangler.js";

const realDeps = { loadState, saveState, logIn, logOut, whoami, pickAccount, confirm };
const depsOf = (deps) => ({ ...realDeps, ...deps });

// One profile's line: "work  me@example.com · Team (0123…)"
const describe = (entry = {}) => {
  const account = entry.accountName ? `${entry.accountName}${entry.accountId ? ` (${entry.accountId})` : ""}` : entry.accountId || "";
  return [entry.email || c.dim("email not known yet"), account].filter(Boolean).join(" · ");
};

const tokenNote = () => {
  if (envApiToken()) log.warn("This run uses CLOUDFLARE_API_TOKEN, not a login profile: the profiles below are not used by it.");
};

// rwk login [--profile <name>]: logs in to the profile (makes it, or logs in again, perhaps
// as another email), chooses its account, and makes it the profile later runs use.
export async function login(deps = {}) {
  const d = depsOf(deps);
  const { name } = activeProfile();
  if (isUnattended()) throw new NeedsAnswer("rwk login opens the browser, so it needs a terminal.", "In CI, set CLOUDFLARE_API_TOKEN (and CLOUDFLARE_ACCOUNT_ID, or --account) instead.");
  const state = d.loadState();
  const before = state.profiles[name];
  log.step(`Login profile: ${name}`);
  if (before && before.email) {
    log.info(`Logged in now as ${before.email}.`);
    if (!(await d.confirm("Log in again? (in the browser, choose the Cloudflare login this profile should use)", true))) {
      return profileResult(name, before);
    }
  }
  log.info("A browser window will open to log in to Cloudflare…");
  log.info(c.dim("For another email than the browser's, log out of dash.cloudflare.com there first."));
  const who = await d.logIn(name);
  // Another login: the account chosen with the old one may not be there. (An entry
  // from before profiles has no email: its account is kept when the login reaches it.)
  const sameLogin = before && (!before.email || before.email === who.email);
  const settings = sameLogin ? { accountId: before.accountId } : {};
  // --account chooses it without the question.
  const account = await d.pickAccount(who.accounts || [], settings);
  const entry = { accountId: account.id, accountName: account.name, ...(who.email ? { email: who.email } : {}) };
  const next = d.loadState();
  next.profiles[name] = entry;
  next.profile = name;
  d.saveState(next);
  log.ok(`Logged in${who.email ? ` as ${who.email}` : ""}, account ${account.name}`);
  log.info(`Commands now use the profile "${name}". Another one for a single run: --profile <name>; switch back: rwk profiles use <name>.`);
  return profileResult(name, entry);
}

// rwk logout [--profile <name>]: logs the profile out and forgets it.
export async function logout(deps = {}) {
  const d = depsOf(deps);
  const { name } = activeProfile();
  if (envApiToken()) throw new CliError("rwk logout does not run with CLOUDFLARE_API_TOKEN: the token is not a profile's login.", { hint: "Run it in a terminal without --yes or --json, or delete the token in the Cloudflare dashboard." });
  const state = d.loadState();
  const entry = state.profiles[name];
  const existed = await d.logOut(name);
  if (!existed && !entry) throw new CliError(`No login profile "${name}" on this PC.`, { hint: "List the profiles: rwk profiles" });
  const next = d.loadState();
  delete next.profiles[name];
  if (next.profile === name) next.profile = DEFAULT_PROFILE;
  d.saveState(next);
  log.ok(`Logged out of the profile "${name}"${entry && entry.email ? ` (${entry.email})` : ""}`);
  if (state.profile === name && name !== DEFAULT_PROFILE) log.info(`Commands now use the profile "${DEFAULT_PROFILE}".`);
  log.info(c.dim(`Its games stay published: log in again to manage them (rwk login${name === DEFAULT_PROFILE ? "" : ` --profile ${name}`}).`));
  return { facts: [["Profile", `${name}: logged out`]] };
}

// rwk whoami: the profile this run uses, its login and accounts, asked to Cloudflare.
export async function whoamiCommand(deps = {}) {
  const d = depsOf(deps);
  const profile = activeProfile();
  const entry = d.loadState().profiles[profile.name] || {};
  log.step("Cloudflare login");
  const who = await d.whoami();
  const source = envApiToken() ? "CLOUDFLARE_API_TOKEN" : `profile ${profile.name}${profile.from === "--profile" ? ", from --profile" : ""}`;
  if (!who.loggedIn) {
    throw new CliError(`Not logged in (${source}).`, { hint: `Log in: rwk login${profile.name === DEFAULT_PROFILE ? "" : ` --profile ${profile.name}`}` });
  }
  log.ok(`${source}: ${who.email || "email not readable with this token"}`);
  for (const a of who.accounts) log.info(`${a.id === entry.accountId ? c.green("•") : " "} ${a.name} (${a.id})`);
  return {
    profile: envApiToken() ? null : profile.name,
    email: who.email || null,
    accounts: who.accounts,
    accountId: entry.accountId || null,
    facts: [
      ["Login", source],
      ["Email", who.email || "unknown"],
      ["Accounts", String(who.accounts.length)],
    ],
  };
}

// rwk profiles: the login profiles on this PC.
export async function profiles(deps = {}) {
  const d = depsOf(deps);
  tokenNote();
  const state = d.loadState();
  const used = activeProfile({ state }).name;
  const names = Object.keys(state.profiles);
  if (!names.includes(DEFAULT_PROFILE)) names.unshift(DEFAULT_PROFILE);
  names.sort((a, b) => (a === DEFAULT_PROFILE ? -1 : b === DEFAULT_PROFILE ? 1 : a.localeCompare(b)));
  log.step("Login profiles");
  const width = Math.max(...names.map((n) => n.length)) + 2;
  for (const name of names) {
    const entry = state.profiles[name];
    const mark = name === used ? c.green("•") : " ";
    log.info(`${mark} ${name.padEnd(width)}${entry ? describe(entry) : c.dim("not logged in yet")}`);
  }
  log.info(c.dim("(• the one commands use) Add one: rwk login --profile <name>. Switch: rwk profiles use <name>."));
  return {
    profile: used,
    profiles: names.map((name) => ({ name, current: name === used, email: state.profiles[name]?.email || null, accountId: state.profiles[name]?.accountId || null, accountName: state.profiles[name]?.accountName || null })),
    facts: [["Using", used]],
  };
}

// rwk profiles use <name>: the profile later runs use.
export async function useProfile(name, deps = {}) {
  const d = depsOf(deps);
  if (!name) throw new UsageError("Which profile? rwk profiles use <name>", { hint: "List them: rwk profiles" });
  const problem = validateProfileName(name);
  if (problem) throw new UsageError(`Bad profile name "${name}": ${problem}`, { hint: "List them: rwk profiles" });
  const state = d.loadState();
  if (name !== DEFAULT_PROFILE && !state.profiles[name]) {
    throw new CliError(`No login profile "${name}" on this PC.`, { hint: `Make it (opens the browser): rwk login --profile ${name}. List the profiles: rwk profiles` });
  }
  state.profile = name;
  d.saveState(state);
  tokenNote();
  log.ok(`Commands now use the profile "${name}"${state.profiles[name]?.email ? ` (${state.profiles[name].email})` : ""}`);
  return profileResult(name, state.profiles[name]);
}

function profileResult(name, entry = {}) {
  return {
    profile: name,
    email: entry.email || null,
    accountId: entry.accountId || null,
    facts: [
      ["Profile", name],
      ["Login", entry.email || "unknown"],
      ...(entry.accountName || entry.accountId ? [["Account", entry.accountName || entry.accountId]] : []),
    ],
  };
}
