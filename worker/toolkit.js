// The toolkit's part of js/plugins.js, and serving a newer toolkit over a web
// build that is already deployed (`rwk upgrade`, when the game
// folder is gone). That deploy keeps the uploaded files (keep_assets), so the
// Worker serves the new RWK_*.js plugins itself and rewrites js/plugins.js:
// the game's own part stays, the toolkit's part is replaced.

export const TOOLKIT_MARKER = "// ---- rpgmaker-web-toolkit (web build only) ----";

// Features a game creator's policy can turn off (cli/lib/policy.js).
const FEATURES = ["saveTools", "itemBatch", "fastForward", "messageMode", "alwaysDash", "backlog", "remap", "quickSave", "autoSave", "cheats", "offline", "translate"];

// names: RWK_* plugin names in load order; config: RWK_Core's runtime config.
export function appendToolkit(pluginsJs, names, config) {
  const entries = names.map((name) => ({
    name,
    status: true,
    description: "[rpgmaker-web-toolkit]",
    parameters: name === "RWK_Core" ? { config: JSON.stringify(config) } : {},
  }));
  return (
    `${pluginsJs.replace(/\s*$/, "")}\n\n${TOOLKIT_MARKER}\n` +
    entries.map((e) => `$plugins.push(${JSON.stringify(e)});`).join("\n") +
    "\n"
  );
}

// -> { game: the game's own plugins.js, config: the deployed RWK_Core config or null }
export function splitToolkit(pluginsJs) {
  const at = pluginsJs.indexOf(TOOLKIT_MARKER);
  if (at < 0) return { game: pluginsJs, config: null };
  let config = null;
  for (const line of pluginsJs.slice(at).split("\n")) {
    const m = /^\$plugins\.push\((.*)\);\s*$/.exec(line);
    if (!m) continue;
    try {
      const entry = JSON.parse(m[1]);
      if (entry.name === "RWK_Core") config = JSON.parse(entry.parameters.config);
    } catch {
      // Not one of ours: dropped with the rest of the toolkit's part.
    }
  }
  return { game: pluginsJs.slice(0, at), config };
}

// One player's settings (players.js) on top of the RWK_Core config of a
// toolkit build's plugins.js. patch: { key: runtime value }
export function patchConfig(pluginsJs, patch) {
  const at = pluginsJs.indexOf(TOOLKIT_MARKER);
  if (at < 0) return pluginsJs;
  const lines = pluginsJs.slice(at).split("\n").map((line) => {
    const m = /^\$plugins\.push\((.*)\);\s*$/.exec(line);
    if (!m) return line;
    try {
      const entry = JSON.parse(m[1]);
      if (entry.name !== "RWK_Core") return line;
      entry.parameters.config = JSON.stringify({ ...JSON.parse(entry.parameters.config), ...patch });
      return `$plugins.push(${JSON.stringify(entry)});`;
    } catch {
      return line;
    }
  });
  return pluginsJs.slice(0, at) + lines.join("\n");
}

// What only the deployed build knows: whether MV's phone audio / movies are
// missing and which translations the game has (both from the game files), and, for builds made before the toolkit kept
// the creator's policy, the features it turned off.
export function mergeConfig(next, deployed, keepOff) {
  const out = { ...next };
  if (!deployed) return out;
  if (deployed.media && !out.media) out.media = deployed.media;
  if (deployed.languages && !out.languages) out.languages = deployed.languages;
  if (keepOff) {
    for (const key of FEATURES) if (deployed[key] === false) out[key] = false;
    if (deployed.sync && deployed.sync.enabled === false) out.sync = { ...out.sync, enabled: false };
  }
  return out;
}

// Paths the Worker must see before static assets (run_worker_first).
export function toolkitRoutes(toolkit) {
  return ["/js/plugins.js", ...Object.keys(toolkit.plugins).map((name) => `/js/plugins/${name}.js`)];
}

// toolkit: { names, plugins: { name: source }, config, keepOff }
// -> Response, or null to fall through to static assets
export async function serveToolkit(request, env, rel, toolkit) {
  if (request.method !== "GET" && request.method !== "HEAD") return null;
  let body;
  if (rel === "js/plugins.js") {
    // Without the browser's conditional headers, so the original always has a body.
    const original = await env.ASSETS.fetch(new Request(request.url));
    if (!original.ok) return null; // served as a plain static asset
    const { game, config } = splitToolkit(await original.text());
    body = appendToolkit(game, toolkit.names, mergeConfig(toolkit.config, config, toolkit.keepOff));
  } else {
    const m = /^js\/plugins\/(RWK_\w+)\.js$/.exec(rel);
    if (!m || !Object.hasOwn(toolkit.plugins, m[1])) return null;
    body = toolkit.plugins[m[1]];
  }
  return new Response(request.method === "HEAD" ? null : body, {
    headers: { "content-type": "text/javascript; charset=utf-8", "cache-control": "no-cache" },
  });
}
