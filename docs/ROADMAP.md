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
| 16 | [macOS and Linux launchers](#cross-platform-launchers-macos-linux) (`run.sh`, `rwk.sh`) | S–M | The CLI is already cross-platform; only the launchers are Windows-only |
| 16b | [Game CD integration](#game-cd-integration-ci): non-interactive mode, GitHub Actions and GitLab CI templates | M | The non-interactive CLI comes first, then the templates; Linux runners need #16 |
| 17 | Gamepad / keyboard remapping (Ideas #12) | M | |
| 18 | Live translation + Vietnamese font (Ideas #7) | L | High value, but only for foreign-language games |
| 19 | Enable Cloudflare Access through the API | M | Removes a manual setup step (also needed for unattended CD) |
| **Wave 4: visibility and support** ||||
| 21 | [Search engine and AI discoverability (SEO / AIEO)](#search-engine-and-ai-discoverability-seo--aieo) for the guide in `site/` | S–M | Cheap, and nobody finds the toolkit without it |
| 22 | [Deployment architecture diagrams](#deployment-architecture-diagrams) with the archify skill | S–M | Better "How it works" page; the skill must be vetted at that time |
| 23 | [Ways to say thanks: GitHub Sponsors and Ko-fi](#ways-to-say-thanks-github-sponsors-and-ko-fi) | S | Setup is mostly accounts and links; no code in `cli/` or `worker/` |
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

- A game that crashes on a phone often shows only a black screen or the engine's error text. ⏸ → **Report a problem** (also on the engine's error screen) shows the latest errors with the plugin they most likely came from, and copies a report (toolkit version, engine, browser, screen).
- The same report has an audio section: the format the engine picked, whether the browser plays Ogg / M4A, the WebAudio state (locked / running) and the files that failed to load, so players can report phone audio bugs. Reference: the `?audioDebug=1` panel of [rpgmaker-web-port](https://github.com/rebecca-kruger/rpgmaker-web-port).
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

## Wave 3

### Cross-platform launchers (macOS, Linux)

`run.ps1` and `rwk.cmd` only cover Windows PowerShell and `cmd`. `cli/` is plain Node.js, so the work is in the launchers and in anything that assumes Windows paths.

- `run.sh`: the same job as `run.ps1` (download the toolkit into a temp folder, `npm ci`, run the CLI, clean up) with `curl` + `tar`/`unzip`, honouring `RWK_REF`. Usable as `curl -fsSL …/run.sh | bash -s -- <args>`.
- `rwk.sh`: the same job as `rwk.cmd` for a local clone (check Node.js 22+, install missing dependencies, run `cli/index.js`).
- Audit `cli/` for Windows assumptions: path separators and drive letters, case-sensitive file names (a game made on Windows may reference `Img/` and `img/`), the line endings of generated files, opening a browser (`start` vs `open` / `xdg-open`), the wrangler binary path.
- Tests: run `npm test` on `ubuntu`, `macos` and `windows` in CI (a matrix in the quality workflow), plus a smoke test of both new scripts with `shellcheck`.
- Docs: add macOS / Linux commands next to the Windows ones in the README and the setup guide in `site/`.

### Game CD integration (CI)

Goal: a game repository redeploys itself on every push (or tag), with no one at the keyboard.

- **Non-interactive mode** (do this first): a `--yes` / `--non-interactive` flag, or automatic when stdin is not a TTY, so the CLI never prompts. Every choice a prompt makes today gets a flag or a `config` value, and a missing answer is an error with a clear message instead of a hang. Exit codes distinguish "bad input" from "deploy failed". Credentials come from `CLOUDFLARE_API_TOKEN` and `CLOUDFLARE_ACCOUNT_ID` (already read in `cli/lib/wrangler.js`); document the minimal token permissions.
- **Machine-readable output**: `--json` (final URL, build report, warnings) and `$GITHUB_OUTPUT` / `$GITHUB_STEP_SUMMARY` support, plus no ANSI colours when not a TTY (already the case in `cli/lib/ui.js`).
- **Reusable GitHub Action** (`action.yml`, composite) that checks out the toolkit at a pinned ref, installs it, runs the CLI on the game folder and exposes the URL as an output. A copy-paste workflow example in `site/` (on push to `main`: deploy; on pull request: build only, then post the build report).
- **GitLab CI and generic shell** examples built on `run.sh`, so any CI with Node.js 22+ works.
- **Pull request previews** (later): deploy each PR to a preview URL such as `<game>-pr-<n>`, and clean it up when the PR closes. Needs decisions on the Worker's shared-assets model and Access policy.
- **Safety**: never print tokens, skip deploy on forks, and keep the "game folder stays untouched" rule. The game's own assets are big, so document how to cache `node_modules` and the staged build between runs, and that the Workers free plan limits in `cli/limits.json` still apply.
- Depends on: #3 (the build report), #16 (Linux runners), and the "build only" deploy target under [Later](#later).

## Wave 4

Planned only; nothing here is started.

### Search engine and AI discoverability (SEO / AIEO)

Goal: the guide at `kokoroou.github.io/rpgmaker-web-toolkit/` shows up for searches such as "play RPG Maker MZ on phone", "host RPG Maker game on Cloudflare", and is quotable by AI assistants (AIEO: answer-engine optimization).

Plan:

- Basics in `site/.vitepress/config.mjs`: `sitemap: { hostname }`, a `lang`/`description` per page in the front matter, `transformPageData` to add a canonical link, Open Graph and Twitter card tags (with a 1200×630 `og:image` in `site/public/img/`), and `head` JSON-LD (`SoftwareApplication` for the toolkit, `HowTo` for the first-deploy page, `FAQPage` where a page really is a Q&A).
- `site/public/robots.txt` that allows crawlers and points to `sitemap.xml`. Also decide on AI crawlers explicitly (`GPTBot`, `ClaudeBot`, `PerplexityBot`…): allowing them is the point of AIEO, but it is a policy choice to confirm first.
- `llms.txt` (and optionally `llms-full.txt`) generated at build time from the page titles and descriptions, so assistants get a clean summary of what the tool does, its limits and the key pages.
- Content: write each page's first paragraph as a self-contained answer (what, for whom, limits), use question-style headings on the FAQ-like pages, keep titles under ~60 characters and descriptions under ~160, add alt text to every image.
- Repository: GitHub description, topics (`rpg-maker`, `rpgmaker-mz`, `rpgmaker-mv`, `cloudflare-workers`, `pwa`…), the guide URL as the repository "website", and a social preview image.
- Submit the site in Google Search Console and Bing Webmaster Tools (a verification file or meta tag goes in `site/public/` or `head`).
- Check: Lighthouse SEO score, rich results test for the JSON-LD, `curl` on `robots.txt`, `sitemap.xml` and `llms.txt` after the `docs.yml` deploy. A test in `test/` can assert the sitemap and structured data exist if the build output is cheap to run.
- Keep honest: the [hosting policy](https://kokoroou.github.io/rpgmaker-web-toolkit/creators/policy) and "games you own" wording stay prominent; no keyword stuffing about pirated games.

### Deployment architecture diagrams

Goal: a clear picture of what a deploy creates (Worker, static assets, R2 for large files, Access in front, save API, browser runtime plugins) on the "How it works" page.

Plan:

- Use the [archify](https://github.com/tt-a1i/archify) skill to draw `architecture` (components and boundaries) and perhaps `sequence` (first load with Access login, save sync) diagrams from `site/reference/how-it-works.md`, `worker/` and `cli/`. Export as static SVG/PNG into `site/public/img/` (plus the standalone HTML if it can be linked), so the published guide does not depend on the skill or on scripts at view time. Give each diagram a text description next to it (also good for SEO / AIEO).
- **Vet the skill first, at the time of the work, not before.** It is third-party code that runs in the agent's shell and may have changed since it was first looked at. Pin the commit or release tag being used, and check at least:
  - the license (and that using its output in this project is allowed);
  - what `SKILL.md` tells the agent to do beyond drawing (writing outside the working folder, editing global agent rules, installing or updating things);
  - the scripts it runs: child processes, network access (update checks, brand-mark fetching), file writes and where, environment variables it reads;
  - dependencies and lockfiles, and any `postinstall`-style hooks;
  - that the generated HTML loads nothing remote.
  Run it in a throwaway folder with network off if possible, never with Cloudflare credentials in the environment, and write the result in the PR description. If the check fails, hand-draw the SVG instead.
- Keep the source JSON of each diagram in the repository (for example `site/diagrams/`) so it can be regenerated, and update it in the same PR as any architecture change.

### Ways to say thanks: GitHub Sponsors and Ko-fi

The toolkit stays free to use under its [license](../LICENSE). Support is a thank-you, never a purchase: no feature, priority or support is tied to it, and nothing in the toolkit asks for money.

Plan:

- Create the accounts: a [GitHub Sponsors](https://github.com/sponsors) profile (needs eligibility and a payout setup) and a [Ko-fi](https://ko-fi.com) page (one-time and monthly, no GitHub account needed for supporters). Decide which email and name appear publicly.
- `.github/FUNDING.yml` with `github:` and `ko_fi:` entries, which adds the **Sponsor** button to the repository.
- A short "Support the project" section in `README.md` and a page in `site/` (link in the footer and the Credits page), with plain wording: what the money pays for (time, a Cloudflare test account), and that it is optional.
- Optionally a thank-you list of sponsors who agree to be named, kept in `site/` and updated by hand.
- Check the [license](../LICENSE) (PolyForm Noncommercial) and the [hosting policy](https://kokoroou.github.io/rpgmaker-web-toolkit/creators/policy): donations must not turn the toolkit into a paid hosting service, and sponsors do not get to host other people's games. Mention this on the support page.
- Check the tax and payout rules for the maintainer's country before switching it on.
- Never put sponsor links in the CLI output or in the `runtime/` plugins inside games: players of someone's game did not ask for them.

## Later

- Save sync for the desktop (NW.js) build: an optional plugin so the desktop version pushes and pulls saves too, using an Access service token.
- A `/` page listing all deployed games (personal hub, Ideas #18).
- Apply a patch or translation archive (`patch.zip`) to the build folder instead of copying it over the game folder, so the original stays untouched. Reference: the `patch.zip` / `CN.json` options of [rpgmaker-web-port](https://github.com/rebecca-kruger/rpgmaker-web-port).
- Other deploy targets: build only (also needed by the CD integration's pull request builds), or a local folder / LAN server, for people who do not use Cloudflare. Reference: `--deploy-target local|custom|none` in [rpgmaker-web-port](https://github.com/rebecca-kruger/rpgmaker-web-port).

## Not planned

- Decrypting game assets. Encrypted games already work as is, and the toolkit does not make asset extraction easier (see [IMPACT.md](IMPACT.md)).

## References

- [Rebecca-Kruger/rpgmaker-web-port](https://github.com/rebecca-kruger/rpgmaker-web-port) (Python, GPL-3.0): turns an MV/MZ desktop build into a web build for Cloudflare Pages, focused on iPhone / iPad. Worth reading for the audio / video conversion, file name normalization and iOS runtime fixes. No cloud saves. Read its code for ideas only: GPL-3.0 code cannot be copied into this project under its current license.
