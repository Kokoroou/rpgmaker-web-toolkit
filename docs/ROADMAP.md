# Roadmap

Build order for the toolkit, updated 2026-10-26 (after release 0.3.0 and the work merged since). [FEATURE_IDEAS.md](FEATURE_IDEAS.md) (Vietnamese) lists the player-facing ideas ranked by value alone ("Ideas #n" below); this order also weighs what each item depends on, what players and game creators feel most today, and effort (**S** a few hours, **M** 1–3 days, **L** more than 3 days). Each row is meant to be its own PR.

## Shipped

Waves 0 and 1 of the previous plan are done, and so is most of the next wave (details in [CHANGELOG.md](../CHANGELOG.md)):

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
| Performance fixes P1 (`RWK_Report` keeps decoded audio through `WeakRef`) and P2 (one layout per rotation) | next |
| Service Worker cache for the game's files (#1, core: cache-first, per-file versions, 25 MiB cap, `cache: false`) | next |
| Presets, per-feature limits and per-player settings (#2, FEATURE_IDEAS §5, for the features that exist) | next |
| SEO / AIEO for the guide: sitemap, social tags, JSON-LD, `robots.txt`, `llms.txt`, Search Console tag (#3) | next |
| Messages log players can reopen (#4, Ideas #10) | next |
| macOS and Linux launchers `run.sh` / `rwk.sh`, tests on three OSes (#8) | next |
| ⚙ → Game files on this device: what the cache holds, and a button to clear it (#1b) | next |
| Basic cheats, off unless the deployer turns them on, per player too (#6, Ideas #5) | next |
| Non-interactive CLI (`--yes`, or no terminal), exit code 2 when a question needs a person, `CLOUDFLARE_API_TOKEN` login (#10a) | next |
| Game CD (#10): `--json` result, `$GITHUB_OUTPUT` / `$GITHUB_STEP_SUMMARY`, the `action.yml` GitHub Action, GitLab CI and generic shell examples in `site/setup/ci.md` | next |
| Advanced cheats (#7, Ideas #8): switches and variables by id or name, walk through walls, teleport and remembered places | next |
| Settings without a redeploy (#2b): feature settings are edited in R2 and read by the Worker (`worker/settings.js`) | next |
| Larger touch targets and a pull-down settings sheet for phones | next |
| `config` asks questions (a wizard in `cli/lib/config-wizard.js`) instead of opening a JSON file | next |
| Fixes: the missing `print` import that failed every deploy at its end, and credentials sent when fetching the web manifest | next |
| CLI syntax and output standardized (#16a): `rwk <command> [<target>] [flags]`, a folder, link or site name as the target, per-command `--help`, log on stderr and result on stdout, one closing summary, hints on errors, exit code 64 for wrong usage. Breaking: `update-from-link` → `upgrade`, `import-saves` → `saves import`, `edit-config` → `config`, `site rename` → `rename --to`, `rwk <path>` → `rwk deploy <path>` | next |
| CLI from a link (#16b): `status`, `saves export` (via the R2 API: `cli/lib/r2-api.js`), `logs`, `open`, `list` and `delete` take a link or site name, no folder needed | next |
| CLI from the game folder (#17): `analyze` / `deploy --dry-run` (warnings and file count, no Cloudflare login, nothing written), `doctor` (Node.js, wrangler, login, token permissions), the current directory as the default target when it holds a game; `analyze` in the GitHub Action for pull requests | next |
| Key and gamepad remapping (#11, Ideas #12): ⚙ → Keys and buttons, kept per device, `remap` config key and policy switch | next |
| Access through the API (#9): the first deploy creates the Access application and an Allow policy (the account's email plus `players`) with `cli/lib/access-api.js`, so `--yes` / CI answers the Access question; the dashboard steps remain the fallback in a terminal when the token lacks the Access permissions or Zero Trust has no team yet | next |
| Download to play offline + PWA (#5, Ideas #6): ⚙ → Play offline (`RWK_Offline`) downloads every file, big ones from R2 included, into the Service Worker's cache; resumable, with progress, a free-space check and a screen wake lock. The page itself opens from the cache without a connection, a cached file answers `Range` requests, the web manifest carries the icon's real size so browsers offer to install, and `offline` is a feature key (preset `shared` and the creator's policy can turn it off). Diagrams redrawn | next |
| Deployment architecture diagrams (#13): architecture, deploy and first-load / save-sync sequence on "How it works", as light and dark SVG drawn by `site/diagrams/build.mjs`; the archify skill was checked and not used (see Details) | next |

"next" is merged on `main` and goes out with the next release. `storage.persist()` is asked for by the save flow (`RWK_SafeSaves`). Still open from the finished waves: the "Try to continue" / "Back to a safe map" buttons and the ffmpeg audio fallback (see [Later](#later)).

## Build order

Order of work from here. Row numbers stay as they were, so "needs #n" still points at the same item. Waves A and B are done: #5, #17, the CLI from the game folder, #16 (apart from `rename` without the folder, see Details), #9, #10, #7 and #2b all shipped.

| # | Item | Effort | Why here |
|---|---|---|---|
| **Wave D: narrower audiences** ||||
| 12 | Live translation + Vietnamese font (Ideas #7) | L | High value, but only for foreign-language games |
| **Wave E: polish and support** ||||
| 14 | [Ways to say thanks: GitHub Sponsors and Ko-fi](#ways-to-say-thanks-github-sponsors-and-ko-fi) | S | Setup is mostly accounts and links; no code in `cli/` or `worker/`. Needs the maintainer's decisions, so it can move earlier whenever those are made |
| **Later** ||||
| 15+ | The rest of [Later](#later) and Ideas group C (#13–#20) | | |

## Details

### CLI commands: from a folder and from a link

The toolkit works two ways, and the command line is shaped for both: `rwk <command> [<target>] [flags]`, where the target is a game **folder** on this PC, a deployed game's **link**, or its **site name** (`cli/lib/target.js`). Each command lists the kinds it accepts (`cli/lib/args.js`, the one list that `--help`, the parser and the docs read). Shipped as #16a:

| Command | Folder | Link / name |
|---|---|---|
| `deploy` | yes | no (needs the game files) |
| `upgrade` | not yet | yes |
| `saves import` | yes (reads `save/`) | no |
| `config` | yes | yes |
| `rename` | yes | not yet |
| `status`, `saves export`, `logs`, `open`, `delete` | no | yes |
| `list` | no target: every site in the account | |

Not built yet, in the order they would pay off:

- **From a link or name** (#16b, shipped): `status`, `saves export`, `logs`, `open`, `list`, `delete`. `status` also shows the site's toolkit version (`toolkitVersion` in the stored config, written by each deploy and upgrade). Left: `rename` without the folder (needs the Workers API to create a Worker with the existing static files, as `upgrade` already patches one); `upgrade` with a folder target, to take the site name from the game's config; `delete --purge` for the saves and large files in R2.
- **From a folder** (#17, shipped): `analyze` / `deploy --dry-run` (the warnings and the file count, without logging in to Cloudflare or touching anything; it uses the first-deploy defaults, as the saved config is in R2), `doctor`, and the current directory as the default target when it holds a game (`cli/lib/target.js`). Left: a `rwk.json` next to `index.html` with the site name and exclude patterns, so a repository carries them (and so the dry run can count what the real deploy will); `config get` / `config set <key> <value>` without an editor, for scripts; `doctor` checks of the R2 bucket and the workers.dev subdomain.
- **Everywhere**: `--account` to pick one of several Cloudflare accounts; `--dry-run` for `rename` and `saves import`; progress for uploads (one line that updates in place on a terminal, plain lines in CI); `[n/N]` on the steps once their number is known; shell completion; and a `--yes` flag per first-deploy question other than Access (the site name).
- **Deploy from a download link** (to decide before building): a game that is not on this PC but at a URL (a zip), with the questions of who may redistribute it that [the hosting policy](../site/creators/policy.md) already raises.

### Service Worker cache for game files (important when playing over 4G)

Before this, the browser relied only on the HTTP cache on every launch. That cache is easily evicted on phones, so the 10–27 MB parallax images got downloaded again and again.

Status: shipped, "Preload" included (#5: ⚙ → Play offline; one cache, `rwk-files`, whose per-file versions replace a cache per `buildId`; ⚙ → Game files on this device shows its size and clears it).

Plan:

- A build-generated `rwk-sw.js`, cache-first for `img/ audio/ effects/ data/ js/ fonts/`.
- Each build produces a `buildId` (hash of the manifest) used as the cache name. On a new deploy the Service Worker drops the old cache and **re-downloads only the files that changed** (per-file hash comparison, not a full cache wipe).
- Never cache `/api/*`. Skip files over 25 MiB, or cache them with a cap, since iOS limits storage.
- A "Preload" option in the menu: download maps and music ahead of time while on Wi-Fi. **Shipped (#5)** as ⚙ → Play offline: it takes the whole file list, files over 25 MiB included.
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

- **Non-interactive mode** (do this first): a `--yes` / `--non-interactive` flag, or automatic when stdin is not a TTY, so the CLI never prompts. Every choice a prompt makes today gets a flag or a `config` value, and a missing answer is an error with a clear message instead of a hang. Exit codes distinguish "bad input" from "deploy failed". Credentials come from `CLOUDFLARE_API_TOKEN` and `CLOUDFLARE_ACCOUNT_ID`; document the minimal token permissions. **Shipped (#10a)**: questions take their default or stop with exit code 2, and only unattended runs read the token. Access is answered through the API since #9. Not done: a flag per first-deploy question other than Access (the site name), and a check of the documented token permissions, the Access ones included, against a real account.
- **Machine-readable output**: `--json` (final URL, build report, warnings) and `$GITHUB_OUTPUT` / `$GITHUB_STEP_SUMMARY` support, plus no ANSI colours when not a TTY. **Shipped (#10)** in `cli/lib/report.js`, with a `::warning::` annotation per warning and `::error::` for a failed run (on stderr).
- **Reusable GitHub Action** (**shipped (#10)**: `action.yml`, composite) that checks out the toolkit at a pinned ref, installs it, runs the CLI on the game folder and exposes the URL as an output. A copy-paste workflow example in `site/` (on push to `main`: deploy; on pull request: build only, then post the build report).
- **GitLab CI and generic shell** examples built on `run.sh`, so any CI with Node.js 22+ works. **Shipped (#10)** in `site/setup/ci.md`.
- **Pull request previews** (later): deploy each PR to a preview URL such as `<game>-pr-<n>`, and clean it up when the PR closes. Needs decisions on the Worker's shared-assets model and Access policy.
- **Safety**: never print tokens, skip deploy on forks, and keep the "game folder stays untouched" rule. The game's own assets are big, so document how to cache `node_modules` and the staged build between runs, and that the Workers free plan limits in `cli/limits.json` still apply.
- The build-only run for pull requests is `analyze` (**shipped (#17)**: `command: analyze` in the Action, no token needed). Still open: pull request previews, and a check of the token permissions (the Access ones of #9 included) against a real CI run.

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

Shipped as #13. The "How it works" page has an architecture diagram, a deploy diagram and a first-load / save-sync sequence, each with alt text and a text description. They are static SVG in `site/public/img/` (one light and one dark file, shown by theme in `site/.vitepress/theme/style.css`) and are drawn by `site/diagrams/build.mjs`, which has no dependencies. Update the script and the SVGs in the same PR as any change to the architecture.

The [archify](https://github.com/tt-a1i/archify) skill was looked at (Apache-2.0, pinned `81c6be8`, v3.2.0) and not used: it writes explorable standalone HTML with its own themes rather than a static SVG that follows the guide's light / dark switch, its `finalize` step needs a real browser, its update check calls a remote manifest and keeps a cache in the home folder, and its `SKILL.md` can add a line to the agent's global rules. Hand-drawn SVG avoids all of that. If a skill is tried again, vet it first: license, what `SKILL.md` asks the agent to do, scripts' network / file / environment access, dependencies and install hooks, and that its HTML loads nothing remote; run it in a throwaway folder, with no Cloudflare credentials.

### Settings page redesign

Planned 2026-10-28, decisions made the same day; **nothing built**. "Settings page" is the in-game ⚙ menu (F1, `openTools` in `runtime/RWK_Core.js`), the one place players reach every toolkit option, and the guide pages that explain it.

Why: the menu grew one feature at a time. Tools register with `RWK.addTool({ icon, label, detail, onSelect, keepOpen, group, quick })` and are listed under fixed `GROUPS` (Play, Saves, Cheats, Controls, Display, Offline, Help, then "More"). Counting `group:` in `runtime/` shows **9 of 17 tools sit in "Play"**, so that group is a long mixed list; every toggle, choice and action is the same kind of row; a sub-choice (speed, language, message mode) opens another dialog or cycles on tap.

Decisions:

- **Sub-pages first.** The first screen shows the quick tiles and one row per group, each with a one-line summary of its state (for example "Speed ×2 · Auto on"). A group row opens its own page with a back button (and Esc / the Back key go up one level, then close). No tabs.
- **Search when the list is long.** A search box appears only when the menu has more rows than a limit (start with about 15 across all pages; decide the number after step 1). It searches labels and details across every page and shows matching rows with their group; hidden below the limit so small installs stay uncluttered. Matching uses the language handling that already translates the labels.
- **Row types** so a choice does not need a dialog: switch for on/off, segmented control for 2–4 options (speed ×1–×4, message mode), slider for numbers, plain row with a chevron for actions and panels (Saves, Keys, Language).
- **The guide follows the menu** (see below).

Constraints (existing behaviour to keep):

- The game pauses while the menu is open; music keeps playing. The phone layout is a bottom sheet, landscape is a side drawer; touch targets stay at least 44 px; safe-area insets stay.
- Tools keep registering through `addTool`, so the other plugins and `RWK.removeTool` need no change; new fields (`type: "switch" | "choice" | "action"`, `options`) are optional and old tools render as they do now. A tool with no known group still lands under "More".
- Features the creator's policy turns off (the `features` keys) stay out of the menu, and a group with no tool left disappears; per-player settings and presets are untouched.
- Light and dark themes, keyboard use (arrows, Enter, Esc), `aria` roles and labels, and the page title announced when a sub-page opens; text comes from the existing language handling, not hard-coded in new places.

Guide (`site/`):

- `site/play/` has 13 pages in a flat sidebar list (`site/.vitepress/config.mjs`). Reorganise it to mirror the menu: a **Menu map** page (one screenshot of the first screen, one line per group, where each setting lives, how to search), then one section per group with its feature pages inside, instead of one long list. Split a page when it covers more than one menu entry (`controls.md` mixes touch buttons and the toolbar; `saves.md` mixes sync, history and conflicts) and merge tiny ones when they share a page in the menu (`dash.md`, `language.md` are 12 lines).
- Keep old URLs working: when a page moves, leave the old path as a short page that points to the new one, or add a redirect, so links in the README, CHANGELOG, `llms.txt` and sitemap do not break.
- Every feature page starts with "Menu → Group → Item" so the reader can find it in the game; update the screenshots (light and dark) and the `lang`/`description` front matter that the SEO work reads.
- Check the sidebar on a phone width and run the docs build (`cd site && npm run build`) for dead links.

Order, each its own PR:

1. **Audit** (S): list every tool with its group, kind (toggle / choice / action / panel) and how often it is used (Ideas §2 gives the order), decide the new group names and the search limit, and sketch the first screen and one sub-page, light and dark, phone and desktop. Output: a short design note in `docs/`; `npm run perf` baseline for menu open time.
2. **Regroup** (S): move the nine "Play" tools into clearer groups without touching the look (for example Speed and reading, Messages, Movement). Data-only change. **Shipped**: Speed and movement (fast forward, its speed, always dash), Messages (mode, auto speed, log), Items (the three "several at once" switches); `play` stays a known group for other plugins.
3. **Sub-pages** (M): a page stack in `openTools` (first screen = tiles + group rows with summaries, back button, Esc, focus handling). **Shipped**: a group with one tool shows that tool on the first screen; summaries come from an optional `summary` on each tool (else the tools' names). The phone's Back key (and the browser's) does what Esc does: a same-URL history entry while the menu is open, taken back when the menu closes another way.
4. **Row types** (M): switch / segmented / slider / chevron renderers; move the toggles and choices onto them one plugin at a time. **Shipped**: `type: "switch"` (`checked`) and `type: "choice"` (`options`, `selected`, `onChoose`; ← / → pick the next option), a chevron on rows that close the menu; Speed, Dash, Messages and ItemBatch moved onto them. Not done: the slider, as no tool has a number to set yet.
5. **Search** (S–M): the box, shown above the row limit. **Shipped**: above 15 rows (`SEARCH_MIN_ROWS` in `RWK_Core.js`), on the first screen; every word must be in the label, detail or group name, without regard to case or accents; results are grouped under their group's name; Esc clears the search first.
6. **Guide** (M): the Menu map page, the regrouped `site/play/` sections, redirects, new screenshots. Can ship with step 3 if the menu changes first; the docs must never describe a menu that has not been released.

Steps 3–5 change what players see (`feat(runtime)`); step 2 is a `refactor`, 1 and 6 are `docs`.

Not tested: no mock-up exists yet; the group counts above are from a search of `runtime/`, and the page list from `site/play/`.

### Other RPG Maker versions

Evaluated 2026-10-28; **nothing built**. The toolkit only knows MZ and MV: `analyzeGame` (`cli/lib/game.js`) looks for `js/rmmz_core.js` or `js/rpg_core.js` and stops with "Unknown engine" otherwise, the save extensions (`.rmmzsave`, `.rpgsave`) are chosen in `game.js` and `cloudflare.js`, and every `runtime/RWK_*.js` plugin hooks classes of the JS engine (`Window_Message`, `Input`, `ConfigManager`, `Game_Actor`…). What does not depend on the engine and can be reused: `worker/` (assets, Access, save API with `If-Match`, history, players, settings), the deploy flow and R2 for large files, `cli/limits.json`, the Service Worker cache, Play offline and the web manifest.

| Version | How it would run on the web | Verdict |
|---|---|---|
| Pixel Game Maker MV | Same JS core as MV (unverified) | Try first: one real game, no code if it already passes `analyze` |
| RPG Maker 2000 / 2003 | [EasyRPG Player](https://easyrpg.org/player/guide/webplayer/) (Emscripten build, `?game=<folder>`, saves in IndexedDB) | Feasible, as its own item |
| XP / VX / VX Ace (RGSS, Ruby) | Community ports only: [mkxp-web](https://github.com/pulsejet/mkxp) (last pushed over two years ago, per a third-party index), [mkxp-z libretro Emscripten](https://white-axe.github.io/mkxp-z-libretro-emscripten) (still a proposal; RTP must be copied into the game; no way to upload saves) | Not planned until a port is maintained |
| RPG Maker Unite (Unity) | Unity WebGL export, a different pipeline (not researched) | Not planned |

Order, each its own PR:

1. **Engine table** (S–M, worth doing on its own): replace the `engine === "MZ" ? … : …` checks in `game.js`, `cloudflare.js` and `stage.js` with one per-engine description (marker files, web folders, save extension, runtime plugin set). No change in behaviour; `npm test` stays green. **Shipped**: `cli/lib/engines.js` (marker file, save extension, gameId, phone media check, MV `global` retitle); web folders and the runtime plugin set stay shared until an engine needs its own.
2. **Pixel Game Maker MV check** (S): run `analyze` and a deploy on one real game; if it works, allow it in the detection and the docs, otherwise record why.
3. **EasyRPG adapter** (L): detect by `RPG_RT.ldb` / `RPG_RT.lmt`; stage the EasyRPG web player with the game's files and its asset index; a small wrapper script instead of the `RWK_*` plugins that mirrors the `Save*.lsd` files between IndexedDB and the save API (binary, no decoding), plus the Service Worker cache. Touch controls would send keyboard events to the player. Open points: letter-case of file names (the `rwk-paths` checks assume MZ/MV folders), RTP for 2000/2003 games, the player's licence (GPL; check how it is bundled and whether it fits the project's licence before copying anything), and a maintainer for a second runtime.
4. **XP / VX / Ace**: revisit only if a maintained web port appears. Until then say in the README that these engines are not supported.

Not tested: no EasyRPG or mkxp build was run; the verdicts come from their documentation.

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
- Redesign of the in-game settings page (the ⚙ / F1 menu: sub-pages, search, guide reorganised): planned 2026-10-28, not started. See [Settings page redesign](#settings-page-redesign).
- Other RPG Maker versions (2000/2003 through EasyRPG, Pixel Game Maker MV; XP/VX/Ace and Unite not planned): evaluated 2026-10-28, not started. See [Other RPG Maker versions](#other-rpg-maker-versions).
- Other deploy targets: build only (also needed by the CD integration's pull request builds), or a local folder / LAN server, for people who do not use Cloudflare. Reference: `--deploy-target local|custom|none` in [rpgmaker-web-port](https://github.com/rebecca-kruger/rpgmaker-web-port).

## Not planned

- Decrypting game assets. Encrypted games already work as is, and the toolkit does not make asset extraction easier (see [IMPACT.md](IMPACT.md)).

## References

- [Rebecca-Kruger/rpgmaker-web-port](https://github.com/rebecca-kruger/rpgmaker-web-port) (Python, GPL-3.0): turns an MV/MZ desktop build into a web build for Cloudflare Pages, focused on iPhone / iPad. Worth reading for the audio / video conversion, file name normalization and iOS runtime fixes. No cloud saves. Read its code for ideas only: GPL-3.0 code cannot be copied into this project under its current license.
