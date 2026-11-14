// In-memory stand-ins for the Workers runtime bindings used by the tests.

import { MemoryBucket } from "../cli/lib/memory-bucket.js";

export { MemoryBucket };

export function makeEnv(overrides = {}) {
  return {
    GAME_ID: "test-game",
    AUTH_MODE: "none",
    RWK_LOCKED: "0",
    BUCKET: new MemoryBucket(),
    ASSETS: { fetch: async () => new Response("static", { status: 200 }) },
    ...overrides,
  };
}
