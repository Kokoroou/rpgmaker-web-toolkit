// Steps shared by the commands that talk to Cloudflare, kept apart from the
// deploy command so a command that does not deploy does not load it.

import { saveSettings } from "./config.js";
import { ensureLogin } from "./cloudflare.js";
import { log } from "./ui.js";

// The run's result (cli/lib/report.js) for a command that stops before the build.
export const siteOf = (cfg) => ({ site: cfg.slug, url: cfg.url || null });

export async function connect(settings) {
  log.step("Cloudflare");
  const session = await ensureLogin(settings);
  saveSettings({ accountId: settings.accountId });
  log.ok(`Account: ${session.account.name}`);
  return session;
}
