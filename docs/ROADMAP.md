# Roadmap

Build order for the toolkit, updated after release 0.3.0 (2026-10-25). [FEATURE_IDEAS.md](FEATURE_IDEAS.md) (Vietnamese) lists the player-facing ideas ranked by value alone ("Ideas #n" below); this order also weighs what each item depends on, what players and game creators feel most today, and effort (**S** a few hours, **M** 1–3 days, **L** more than 3 days). Each row is meant to be its own PR.

## Shipped

Waves 0 and 1 of the previous plan are done (details in [CHANGELOG.md](../CHANGELOG.md)):

| Item | Release |
|---|---|
| Ogg / WebM fallback for MV on phones, plus the analyze warning for files without `.m4a` / `.mp4` | 0.2.0 |
| In-game problem report with audio diagnostics (Ideas #11) | 0.2.0 |
| Analyze-step checks: non-ASCII file names, build report at the end of a deploy | 0.2.0 |
| ⏸ menu that pauses the game, replacing the ⚙ list | 0.2.0 |
| Fast forward ×2 / ×3 / ×4 (Ideas #1), message modes (Ideas #2), always dash (Ideas #9) | 0.2.0 |
| Quick save / load, autosave, ☁ status icon (Ideas #3); save history on R2 (Ideas #4) | 0.2.0 |
| Several items at once (battle and events), simpler touch toolbar with full screen button | 0.2.0, 0.3.0 |
| CLI: rename a site and keep its saves; update the toolkit of a deployed game from its link; Access page follows Cloudflare's new flow | 0.3.0 |
| Tooling: runtime performance measurement (`npm run perf`), Node.js 22 minimum, Workers API schema check | 0.3.0 |

Not finished from those waves and moved down: `storage.persist()` in the save flow (check, then fold into #3), the "Try to continue" / "Back to a safe map" buttons and the ffmpeg audio fallback (see [Later](#later)).

## Build order

Order of work from here. P1 and P2 are small fixes for problems the performance run found; after them, the next three rows come first because each one changes what the others can rely on: the cache fixes the biggest day-to-day cost for phone players, the config tiers let creators control the features already shipped (and unblock cheats), and discoverability is cheap and independent, so it can be done in a gap between the larger items.

| # | Item | Effort | Why here |
|---|---|---|---|
| **Wave 0: performance findings** ([PERFORMANCE.md](PERFORMANCE.md), measured 2026-10-25) ||||
| P1 | `RWK_Report` keeps decoded audio alive: use `WeakRef` ([details](PERFORMANCE.md#1-rwk_report-giữ-âm-thanh-cao)) | S | A real bug in a released version (`fix(runtime)`): on MV it holds ~90 MB of decoded sound, enough to reload or crash a phone tab. Do this before anything else |
| P2 | `RWK_MobileControls`: batch the layouts on rotation ([details](PERFORMANCE.md#2-xoay-màn-hình-trung-bình)) | S | About 100 ms stutter per rotation on a slow phone (`fix(controls)`) |
| **Wave A: next up** ||||
| 1 | [Service Worker cache](#service-worker-cache-for-game-files-important-when-playing-over-4g) (core shipped in this PR; preload and clear-cache button remain) | M–L | Highest value left: 10–27 MB images are downloaded again on every launch over 4G. Also the base of #5 |
| 2 | Two-tier config, presets, per-email `/api/config` (FEATURE_IDEAS §5) | M–L | Fast forward, Skip, quick save and always dash already ship with no creator switch except the ones that exist today; cheats must not ship before this |
| 3 | [SEO / AIEO](#search-engine-and-ai-discoverability-seo--aieo) for the guide in `site/` | S–M | Cheap, independent, and nobody finds the toolkit without it. Do it in any gap between #1 and #2 |
| **Wave B: offline and cheats** ||||
| 4 | Message backlog (Ideas #10) | M | Message modes shipped; Skip makes "I skipped something, let me reread" a real need. Small and self-contained |
| 5 | Download to play offline + PWA (Ideas #6) | L | Needs #1 |
| 6 | Basic cheats (Ideas #5) | M | Needs #2 (off by default, per-player limits). Save history (#4 shipped) is the safety net |
| 7 | Advanced cheats: switches / variables, noclip, teleport (Ideas #8) | M | Extends #6 |
| **Wave C: running the toolkit anywhere** ||||
| 8 | [macOS and Linux launchers](#cross-platform-launchers-macos-linux) (`run.sh`, `rwk.sh`) | S–M | The CLI is already cross-platform; only the launchers are Windows-only |
| 9 | Enable Cloudflare Access through the API | M | Removes a manual setup step; needed for unattended CD |
| 10 | [Game CD integration](#game-cd-integration-ci): non-interactive mode, GitHub Actions and GitLab CI templates | M | Non-interactive CLI first, templates after; Linux runners need #8, unattended setup needs #9 |
| **Wave D: narrower audiences** ||||
| 11 | Gamepad / keyboard remapping (Ideas #12) | M | |
| 12 | Live translation + Vietnamese font (Ideas #7) | L | High value, but only for foreign-language games |
| **Wave E: polish and support** ||||
| 13 | [Deployment architecture diagrams](#deployment-architecture-diagrams) with the archify skill | S–M | Better "How it works" page; the skill must be vetted at that time. Best after #1, #5 and #9 change the architecture |
| 14 | [Ways to say thanks: GitHub Sponsors and Ko-fi](#ways-to-say-thanks-github-sponsors-and-ko-fi) | S | Setup is mostly accounts and links; no code in `cli/` or `worker/`. Needs the maintainer's decisions, so it can move earlier whenever those are made |
| **Later** ||||
| 15+ | The rest of [Later](#later) and Ideas group C (#13–#20) | | |

## Details

### Service Worker cache for game files (important when playing over 4G)

Right now the browser relies only on the HTTP cache on every launch. That cache is easily evicted on phones, so the 10–27 MB parallax images get downloaded again and again.

Plan:

- A build-generated `rwk-sw.js`, cache-first for `img/ audio/ effects/ data/ js/ fonts/`.
- Each build produces a `buildId` (hash of the manifest) used as the cache name. On a new deploy the Service Worker drops the old cache and **re-downloads only the files that changed** (per-file hash comparison, not a full cache wipe).
- Never cache `/api/*`. Skip files over 25 MiB, or cache them with a cap, since iOS limits storage.
- A "Preload" option in the menu: download maps and music ahead of time while on Wi-Fi.
- Risk: iOS Safari limits quota and may evict data after 7 days without a visit. Show how much is cached and offer a button to clear it.

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
- Depends on: the build report (shipped), #8 (Linux runners), and the "build only" deploy target under [Later](#later).

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

- From [PERFORMANCE.md](PERFORMANCE.md), measure first: bundle the `RWK_*.js` files into one at build time (boot +150–200 ms locally, worth it only if a real 4G / Cloudflare run shows more); time autosave with a large save (`--save <file>` in `tools/perf/`) and, if one save blocks over ~100 ms on a phone, wait for a still moment before autosaving. Re-run `npm run perf` after P1, P2 and any change to a per-frame plugin.
- Leftovers from the finished waves: "Try to continue" and "Back to a safe map" buttons on the problem report; an optional ffmpeg conversion of `ogg → m4a` / `webm → mp4` into the build folder for browsers that cannot play Ogg (older iOS). Encrypted audio (`.ogg_` / `.rpgmvo`) would need to be decrypted and re-encrypted with the game's own key, so check this against the "no decryption" stance in [IMPACT.md](IMPACT.md) first. Reference: [rpgmaker-web-port](https://github.com/rebecca-kruger/rpgmaker-web-port).
- Optionally rename non-ASCII files in the build folder and rewrite the references (the analyze step only warns today).
- Save sync for the desktop (NW.js) build: an optional plugin so the desktop version pushes and pulls saves too, using an Access service token.
- A `/` page listing all deployed games (personal hub, Ideas #18).
- Apply a patch or translation archive (`patch.zip`) to the build folder instead of copying it over the game folder, so the original stays untouched. Reference: the `patch.zip` / `CN.json` options of [rpgmaker-web-port](https://github.com/rebecca-kruger/rpgmaker-web-port).
- Other deploy targets: build only (also needed by the CD integration's pull request builds), or a local folder / LAN server, for people who do not use Cloudflare. Reference: `--deploy-target local|custom|none` in [rpgmaker-web-port](https://github.com/rebecca-kruger/rpgmaker-web-port).

## Not planned

- Decrypting game assets. Encrypted games already work as is, and the toolkit does not make asset extraction easier (see [IMPACT.md](IMPACT.md)).

## References

- [Rebecca-Kruger/rpgmaker-web-port](https://github.com/rebecca-kruger/rpgmaker-web-port) (Python, GPL-3.0): turns an MV/MZ desktop build into a web build for Cloudflare Pages, focused on iPhone / iPad. Worth reading for the audio / video conversion, file name normalization and iOS runtime fixes. No cloud saves. Read its code for ideas only: GPL-3.0 code cannot be copied into this project under its current license.
