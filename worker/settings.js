// The deployer's settings, changed without a redeploy (`rwk edit-config`).
// The CLI writes them to R2 at every deploy and every edit:
//
//   rwk/settings/<GAME_ID>.json   { config: { key: runtime value }, players: { [userHash]: { key: runtime value } } }
//
// config: everyone's RWK_Core settings (all but what the build is made of);
// players: the same as playerSettings (index.js). When the file is there it
// wins over what the deploy put in js/plugins.js and in the Worker.
//
// Read at most once per TTL_MS per isolate, so an edit reaches players
// within a minute and a launch costs no R2 read most of the time.

export const SETTINGS_TTL_MS = 30 * 1000;
const cache = new WeakMap(); // env.BUCKET -> Map<GAME_ID, { at, value }>

export const settingsKey = (gameId) => `rwk/settings/${gameId}.json`;

// -> { config, players } | null (no file, or no bucket)
export async function liveSettings(env) {
  if (!env.BUCKET) return null;
  let games = cache.get(env.BUCKET);
  if (!games) cache.set(env.BUCKET, (games = new Map()));
  const hit = games.get(env.GAME_ID);
  if (hit && Date.now() - hit.at < SETTINGS_TTL_MS) return hit.value;

  let text = null;
  try {
    const obj = await env.BUCKET.get(settingsKey(env.GAME_ID));
    if (obj) text = new TextDecoder().decode(await obj.arrayBuffer());
  } catch (err) {
    // R2 unreachable: what was read last, or the deploy's own settings.
    console.error("[rwk] settings", err);
    return hit ? hit.value : null;
  }
  const value = text === null ? null : parse(text);
  games.set(env.GAME_ID, { at: Date.now(), value });
  return value;
}

const isObject = (v) => !!v && typeof v === "object" && !Array.isArray(v);

// A file that is not what the CLI writes counts as none: the deploy's own settings.
function parse(text) {
  let data;
  try {
    data = JSON.parse(text);
  } catch {
    return null;
  }
  if (!isObject(data) || !isObject(data.config)) return null;
  return { config: data.config, players: isObject(data.players) ? data.players : {} };
}
