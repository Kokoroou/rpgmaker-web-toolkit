// Remembers which emails (as the same hash the saves use) have saved this
// game, so the CLI can tell the deployer how many people play their copy.
//
//   rwk/players/<GAME_ID>.json   { [userHash]: first save time (ms) }
//
// One small read per isolate and player, one write per new player.

const seen = new Set(); // `${GAME_ID}/${hash}` already recorded

export async function recordPlayer(env, hash) {
  const id = `${env.GAME_ID}/${hash}`;
  if (seen.has(id)) return;
  const key = `rwk/players/${env.GAME_ID}.json`;
  try {
    for (let attempt = 0; attempt < 3; attempt++) {
      const obj = await env.BUCKET.get(key);
      const players = obj ? JSON.parse(new TextDecoder().decode(await obj.arrayBuffer())) : {};
      if (players[hash]) break;
      players[hash] = Date.now();
      const options = { httpMetadata: { contentType: "application/json" } };
      // Two first saves at once: the loser re-reads and adds itself again.
      if (obj) options.onlyIf = { etagMatches: obj.etag };
      if (await env.BUCKET.put(key, JSON.stringify(players), options)) break;
    }
    seen.add(id);
  } catch (err) {
    // Counting players must never break saving.
    console.error("[rwk] player count", err);
  }
}
