# Roadmap

Build order for the toolkit. [FEATURE_IDEAS.md](FEATURE_IDEAS.md) (Vietnamese) lists the player-facing ideas ranked by value alone ("Ideas #n" below); this order also weighs bugs that block play today, what each item depends on, and effort (**S** a few hours, **M** 1–3 days, **L** more than 3 days). Each row is meant to be its own PR.

## Build order

| # | Item | Effort | Why here |
|---|---|---|---|
| **Wave 0: fixes and small wins** ||||
| 1 | [Audio and video on phones (MV)](#audio-and-video-on-phones-mv): runtime patch + analyze warning | S | A bug, not a feature: an MV game that ships only `.ogg` has no sound on phones |
| 2 | [Error report and audio diagnostics](#error-report-and-audio-diagnostics) (Ideas #11) | S | Players can then send useful reports for everything that follows |
| 3 | [Analyze-step checks](#analyze-step-checks): non-ASCII file names, build report | S | Cheap, catches problems before deploying |
| **Wave 1: playing (Ideas group A)** ||||
| 4 | New toolbar + ⏸ quick menu (game paused while open), FEATURE_IDEAS §4 | M | Every later feature adds a menu entry; the flat ⚙ list would pass 15 items |
| 5 | Fast forward ×2 / ×3 / ×4 (Ideas #1) | S | The most requested feature |
| 6 | Message modes: tap to finish, Auto, Skip (Ideas #2) | S | Second most common complaint |
| 7 | Always dash (Ideas #9) | S | Very cheap, sits next to fast forward |
| 8 | Safe saves: quick save / load, autosave, ☁ status icon, `storage.persist()` (Ideas #3) | M | Builds on `RWK_SaveSync` |
| 9 | Save history on R2 (Ideas #4) | M | Last safety net for #8 |
| **Wave 2: offline and config** ||||
| 10 | [Service Worker cache](#service-worker-cache-for-game-files-important-when-playing-over-4g) | M–L | Helps over 4G right away, and is the base of #11 |
| 11 | Download to play offline + PWA (Ideas #6) | L | Needs #10 |
| 12 | Two-tier config, presets, per-email `/api/config` (FEATURE_IDEAS §5) | M–L | Cheats are off by default and need per-player limits |
| 13 | Basic cheats (Ideas #5) | M | Needs #4 and #12 |
| 14 | Advanced cheats: switches / variables, noclip, teleport (Ideas #8) | M | Extends #13 |
| **Wave 3: narrower audiences** ||||
| 15 | Message backlog (Ideas #10) | M | Goes with #6 |
| 16 | macOS and Linux launcher (`run.sh`) | S–M | The CLI is already cross-platform |
| 17 | Gamepad / keyboard remapping (Ideas #12) | M | |
| 18 | Live translation + Vietnamese font (Ideas #7) | L | High value, but only for foreign-language games |
| 19 | Enable Cloudflare Access through the API | M | Removes a manual setup step |
| **Later** ||||
| 20+ | The rest of [Later](#later) and Ideas group C (#13–#20) | | |

## Wave 0

### Audio and video on phones (MV)

On a mobile device MV asks for `.m4a` audio (`AudioManager.audioFileExt`) and `.mp4` movies instead of `.ogg` / `.webm`, even when the browser can play Ogg. A game that ships only `.ogg` may then have no sound on phones. MZ is not affected: it decodes Ogg itself (WebAssembly).

Plan:

- Analyze step: count `.ogg` files without an `.m4a` twin (and `.webm` without `.mp4`) and warn before deploying.
- First fix, runtime only: an MV patch that keeps `.ogg` / `.webm` when the browser reports it can play them. No file conversion, nothing changes on desktop.
- Fallback for browsers that cannot play Ogg (older iOS): optional conversion with ffmpeg into the build folder only (the game folder stays untouched). Encrypted audio (`.ogg_` / `.rpgmvo`) would need to be decrypted and re-encrypted with the game's own key, so check this against the "no decryption" stance in [IMPACT.md](IMPACT.md) before doing it.
- Reference: [rpgmaker-web-port](https://github.com/rebecca-kruger/rpgmaker-web-port) converts `ogg → m4a` for iOS, `webm → mp4`, and validates the audio output before deploying.

### Error report and audio diagnostics

Merges Ideas #11 with the audio diagnostics idea.

- A game that crashes on a phone often shows only a black screen or the engine's error text. Show a clear panel instead: the error, the plugin it most likely came from, and a "Copy report" button (toolkit version, engine, browser, device, recent errors).
- An audio section in the same report (and `?rwkDebug=audio`): which audio format the engine picked, the WebAudio state (locked / running) and the files that failed to load, so players can report phone audio bugs. Reference: the `?audioDebug=1` panel of [rpgmaker-web-port](https://github.com/rebecca-kruger/rpgmaker-web-port).
- Later: "Try to continue" and "Back to a safe map" buttons.

### Analyze-step checks

- Warn about non-ASCII file names (Chinese, Japanese…) in `audio/`, `img/`, `movies/`, which some browsers or URL encodings handle badly. Later, optionally rename them in the build folder and rewrite the references (as [rpgmaker-web-port](https://github.com/rebecca-kruger/rpgmaker-web-port) does).
- Print a short build report at the end of a run: file count, size, files sent to R2, warnings.

## Wave 2

### Service Worker cache for game files (important when playing over 4G)

Right now the browser relies only on the HTTP cache on every launch. That cache is easily evicted on phones, so the 10–27 MB parallax images get downloaded again and again.

Plan:

- A build-generated `rwk-sw.js`, cache-first for `img/ audio/ effects/ data/ js/ fonts/`.
- Each build produces a `buildId` (hash of the manifest) used as the cache name. On a new deploy the Service Worker drops the old cache and **re-downloads only the files that changed** (per-file hash comparison, not a full cache wipe).
- Never cache `/api/*`. Skip files over 25 MiB, or cache them with a cap, since iOS limits storage.
- A "Preload" option in the menu: download maps and music ahead of time while on Wi-Fi.
- Risk: iOS Safari limits quota and may evict data after 7 days without a visit. Show how much is cached and offer a button to clear it.

## Later

- Save sync for the desktop (NW.js) build: an optional plugin so the desktop version pushes and pulls saves too, using an Access service token.
- A `/` page listing all deployed games (personal hub, Ideas #18).
- Apply a patch or translation archive (`patch.zip`) to the build folder instead of copying it over the game folder, so the original stays untouched. Reference: the `patch.zip` / `CN.json` options of [rpgmaker-web-port](https://github.com/rebecca-kruger/rpgmaker-web-port).
- Other deploy targets: build only, or a local folder / LAN server, for people who do not use Cloudflare. Reference: `--deploy-target local|custom|none` in [rpgmaker-web-port](https://github.com/rebecca-kruger/rpgmaker-web-port).

## Not planned

- Decrypting game assets. Encrypted games already work as is, and the toolkit does not make asset extraction easier (see [IMPACT.md](IMPACT.md)).

## References

- [Rebecca-Kruger/rpgmaker-web-port](https://github.com/rebecca-kruger/rpgmaker-web-port) (Python, GPL-3.0): turns an MV/MZ desktop build into a web build for Cloudflare Pages, focused on iPhone / iPad. Worth reading for the audio / video conversion, file name normalization and iOS runtime fixes. No cloud saves. Read its code for ideas only: GPL-3.0 code cannot be copied into this project under its current license.
