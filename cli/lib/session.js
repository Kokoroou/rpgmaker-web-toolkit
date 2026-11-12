// Steps shared by the commands that talk to Cloudflare, kept apart from the
// deploy command so a command that does not deploy does not load it.

import { DEFAULT_PROFILE, activeProfile, saveSettings } from "./config.js";
import { envApiToken } from "./wrangler.js";
import { ensureLogin } from "./cloudflare.js";
import { log } from "./ui.js";

// The run's result (cli/lib/report.js) for a command that stops before the build.
export const siteOf = (cfg) => ({ site: cfg.slug, url: cfg.url || null });

export async function connect(settings) {
  log.step("Cloudflare");
  const session = await ensureLogin(settings);
  const profile = activeProfile();
  // A CI token is not a profile's login: it leaves the profiles as they are.
  if (!envApiToken()) {
    saveSettings({ accountId: settings.accountId, accountName: session.account.name, ...(session.email ? { email: session.email } : {}) }, profile.name);
  }
  const login = envApiToken() ? "" : profile.name !== DEFAULT_PROFILE ? ` (profile ${profile.name}${session.email ? `, ${session.email}` : ""})` : session.email ? ` (${session.email})` : "";
  log.ok(`Account: ${session.account.name}${login}`);
  return session;
}
