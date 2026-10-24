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

### Audio and video on phones (MV)

On a mobile device MV asks for `.m4a` audio (`AudioManager.audioFileExt`) and `.mp4` movies instead of `.ogg` / `.webm`, even when the browser can play Ogg. A game that ships only `.ogg` may then have no sound on phones. MZ is not affected: it decodes Ogg itself (WebAssembly).

Plan:

- Analyze step: count `.ogg` files without an `.m4a` twin (and `.webm` without `.mp4`) and warn before deploying.
- First fix, runtime only: an MV patch that keeps `.ogg` / `.webm` when the browser reports it can play them. No file conversion, nothing changes on desktop.
- Fallback for browsers that cannot play Ogg (older iOS): optional conversion with ffmpeg into the build folder only (the game folder stays untouched). Encrypted audio (`.ogg_` / `.rpgmvo`) would need to be decrypted and re-encrypted with the game's own key, so check this against the "no decryption" stance in [IMPACT.md](IMPACT.md) before doing it.
- Reference: [rpgmaker-web-port](https://github.com/rebecca-kruger/rpgmaker-web-port) converts `ogg → m4a` for iOS, `webm → mp4`, and validates the audio output before deploying.

### Analyze-step checks

- Warn about non-ASCII file names (Chinese, Japanese…) in `audio/`, `img/`, `movies/`, which some browsers or URL encodings handle badly. Later, optionally rename them in the build folder and rewrite the references (as [rpgmaker-web-port](https://github.com/rebecca-kruger/rpgmaker-web-port) does).
- Print a short build report at the end of a run: file count, size, files sent to R2, warnings.

### Audio diagnostics on the device

A ⚙ tool (or `?rwkDebug=audio`) that shows which audio format the engine picked, the WebAudio state (locked / running) and the files that failed to load, so players can report phone audio bugs. Reference: the `?audioDebug=1` panel of [rpgmaker-web-port](https://github.com/rebecca-kruger/rpgmaker-web-port).

## Phase 3

- Save sync for the desktop (NW.js) build: an optional plugin so the desktop version pushes and pulls saves too, using an Access service token.
- Enable Cloudflare Access automatically through the API (needs an API token with Access permissions) instead of the manual dashboard step.
- macOS and Linux support (`run.sh`). The CLI is already cross-platform; it mainly needs a launcher script and a way to open the browser.
- A `/` page listing all deployed games (personal hub).
- Apply a patch or translation archive (`patch.zip`) to the build folder instead of copying it over the game folder, so the original stays untouched. Reference: the `patch.zip` / `CN.json` options of [rpgmaker-web-port](https://github.com/rebecca-kruger/rpgmaker-web-port).
- Other deploy targets: build only, or a local folder / LAN server, for people who do not use Cloudflare. Reference: `--deploy-target local|custom|none` in [rpgmaker-web-port](https://github.com/rebecca-kruger/rpgmaker-web-port).

## Not planned

- Decrypting game assets. Encrypted games already work as is, and the toolkit does not make asset extraction easier (see [IMPACT.md](IMPACT.md)).

## References

- [Rebecca-Kruger/rpgmaker-web-port](https://github.com/rebecca-kruger/rpgmaker-web-port) (Python, GPL-3.0): turns an MV/MZ desktop build into a web build for Cloudflare Pages, focused on iPhone / iPad. Worth reading for the audio / video conversion, file name normalization and iOS runtime fixes. No cloud saves. Read its code for ideas only: GPL-3.0 code cannot be copied into this project under its current license.
