# Roadmap

## Phase 2: high priority

### Service Worker cache for game files (important when playing over 4G)

Right now the browser relies only on the HTTP cache on every launch. That cache is easily evicted on phones, so the 10–27 MB parallax images get downloaded again and again.

Plan:

- A build-generated `rwk-sw.js`, cache-first for `img/ audio/ effects/ data/ js/ fonts/`.
- Each build produces a `buildId` (hash of the manifest) used as the cache name. On a new deploy the Service Worker drops the old cache and **re-downloads only the files that changed** (per-file hash comparison, not a full cache wipe).
- Never cache `/api/*`. Skip files over 25 MiB, or cache them with a cap, since iOS limits storage.
- A "Preload" option in the menu: download maps and music ahead of time while on Wi-Fi.
- Risk: iOS Safari limits quota and may evict data after 7 days without a visit. Show how much is cached and offer a button to clear it.

### MV testing

The MV adapter (`RWK_SaveSync`: localStorage `RPG File%d`; boot gate through `SceneManager.run`) is written but has not been tested on a real game.

## Phase 3

- Save sync for the desktop (NW.js) build: an optional plugin so the desktop version pushes and pulls saves too, using an Access service token.
- Enable Cloudflare Access automatically through the API (needs an API token with Access permissions) instead of the manual dashboard step.
- macOS and Linux support (`run.sh`). The CLI is already cross-platform; it mainly needs a launcher script and a way to open the browser.
- A `/` page listing all deployed games (personal hub).
