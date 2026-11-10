// The toolkit's part of js/plugins.js, and serving a newer toolkit over a web
// build that is already deployed (`rwk upgrade`, when the game
// folder is gone). That deploy keeps the uploaded files (keep_assets), so the
// Worker serves the new RWK_*.js plugins itself and rewrites js/plugins.js:
// the game's own part stays, the toolkit's part is replaced.

export const TOOLKIT_MARKER = "// ---- rpgmaker-web-toolkit (web build only) ----";

// The script that runs before the game's plugins (runtime/rwk-guard.js), and
// the tag index.html gets for it. Served by the Worker on `rwk upgrade` too,
// so games deployed before it existed get it as well.
export const GUARD_REL = "js/rwk-guard.js";
const GUARD_TAG = `<script src="${GUARD_REL}"></script>`;

// index.html with the guard in front of the game's plugins.
export function guardInto(html) {
  if (html.includes(GUARD_REL)) return html;
  const plugins = /<script[^>]*\ssrc=["']js\/plugins\.js["'][^>]*>\s*<\/script>/i;
  if (plugins.test(html)) return html.replace(plugins, (tag) => `${GUARD_TAG}\n${tag}`);
  return html.replace(/<\/head>/i, `${GUARD_TAG}\n</head>`);
}

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

// The game's own plugin list, parsed. The toolkit's part is cut off first:
// its entries carry "]" inside a string (the "[rpgmaker-web-toolkit]"
// description), so reading up to the last "]" of the file takes that one for
// the end of the array and the slice no longer parses. A downloaded web build
// is such a file, and deploying one is what this is for.
export function parsePluginList(pluginsJs) {
  const { game } = splitToolkit(pluginsJs);
  const start = game.indexOf("[");
  const end = game.lastIndexOf("]");
  if (start < 0 || end < start) throw new Error("Could not parse js/plugins.js");
  return JSON.parse(game.slice(start, end + 1));
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
  // "/" as well: a browser asking for the start page does not match the
  // "/index.html" rule, and would get the page without the guard.
  return ["/js/plugins.js", "/", "/index.html", `/${GUARD_REL}`, ...Object.keys(toolkit.plugins).map((name) => `/js/plugins/${name}.js`)];
}

// toolkit: { names, plugins: { name: source }, config, keepOff, guard }
// -> Response, or null to fall through to static assets
export async function serveToolkit(request, env, rel, toolkit) {
  if (request.method !== "GET" && request.method !== "HEAD") return null;
  let body;
  let type = "text/javascript; charset=utf-8";
  if (rel === GUARD_REL) {
    if (!toolkit.guard) return null;
    body = toolkit.guard;
  } else if (rel === "index.html" || rel === "") {
    // Upgrade: the deployed page gets the guard in front of the game's plugins.
    if (!toolkit.guard) return null;
    const original = await env.ASSETS.fetch(new Request(new URL("/index.html", request.url), { method: "GET" }));
    if (!original.ok) return null;
    const html = await original.text();
    const patched = guardInto(html);
    if (patched === html) return null;
    body = patched;
    type = "text/html; charset=utf-8";
  } else if (rel === "js/plugins.js") {
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
    headers: { "content-type": type, "cache-control": "no-cache" },
  });
}
