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
| Access through the API (#9): the first deploy creates the Access application and an Allow policy (the account's email plus `players`) with `cli/lib/access-api.js`, so `--yes` / CI answers the Access question; the dashboard steps remain the fallback in a terminal when the token lacks the Access permissions or Zero Trust has no team yet | next |

"next" is merged on `main` and goes out with the next release. `storage.persist()` is asked for by the save flow (`RWK_SafeSaves`). Still open from the finished waves: the "Try to continue" / "Back to a safe map" buttons and the ffmpeg audio fallback (see [Later](#later)).

## Build order

Order of work from here. Row numbers stay as they were, so "needs #n" still points at the same item. Wave A is down to #17, the CLI from the game folder (#16 and #9 shipped); the build-only run it adds is also what the CD page still lacks for pull requests.

| # | Item | Effort | Why here |
|---|---|---|---|
| **Wave A: next up** ||||
| 17 | [CLI: from the game folder, without Cloudflare](#cli-commands-from-a-folder-and-from-a-link): `analyze` / `deploy --dry-run`, `doctor`, the current folder as the default target | S | Same parser; the analysis already runs before the first Cloudflare call. `deploy --dry-run` is also the "build only" run the CI page still lacks for pull requests |
| **Wave B: offline** ||||
| 5 | Download to play offline + PWA (Ideas #6), with the "Preload" of #1 | L | Needs #1 (shipped) |
| **Wave D: narrower audiences** ||||
| 11 | Gamepad / keyboard remapping (Ideas #12) | M | |
| 12 | Live translation + Vietnamese font (Ideas #7) | L | High value, but only for foreign-language games |
| **Wave E: polish and support** ||||
| 13 | [Deployment architecture diagrams](#deployment-architecture-diagrams) with the archify skill | S–M | Better "How it works" page; the skill must be vetted at that time. Best after #1 and #5 change the architecture |
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

- **From a link or name** (#16b, shipped): `status`, `saves export`, `logs`, `open`, `list`, `delete`. Left: `rename` without the folder (needs the Workers API to create a Worker with the existing static files, as `upgrade` already patches one); `upgrade` with a folder target, to take the site name from the game's config; the site's toolkit version in `status` (nothing records it yet: a `toolkitVersion` in the stored config at each deploy / upgrade would do); `delete --purge` for the saves and large files in R2.
- **From a folder** (#17): `analyze` / `deploy --dry-run` (the warnings and the file count, without logging in to Cloudflare or touching anything); `doctor` (Node.js version, login, token permissions, wrangler); the current directory as the default target when it holds a game; a `rwk.json` next to `index.html` with the site name and exclude patterns, so a repository carries them; `config get` / `config set <key> <value>` without an editor, for scripts.
- **Everywhere**: `--account` to pick one of several Cloudflare accounts; `--dry-run` for `rename` and `saves import`; progress for uploads (one line that updates in place on a terminal, plain lines in CI); GitHub Actions annotations (`::warning::`) for the run's warnings; `[n/N]` on the steps once their number is known; shell completion; and a `--yes` flag per first-deploy question other than Access (the site name).
- **Deploy from a download link** (to decide before building): a game that is not on this PC but at a URL (a zip), with the questions of who may redistribute it that [the hosting policy](../site/creators/policy.md) already raises.

### Service Worker cache for game files (important when playing over 4G)

Before this, the browser relied only on the HTTP cache on every launch. That cache is easily evicted on phones, so the 10–27 MB parallax images got downloaded again and again.

Status: shipped except "Preload", which goes with #5 (one cache, `rwk-files`, whose per-file versions replace a cache per `buildId`; ⚙ → Game files on this device shows its size and clears it).

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

- **Non-interactive mode** (do this first): a `--yes` / `--non-interactive` flag, or automatic when stdin is not a TTY, so the CLI never prompts. Every choice a prompt makes today gets a flag or a `config` value, and a missing answer is an error with a clear message instead of a hang. Exit codes distinguish "bad input" from "deploy failed". Credentials come from `CLOUDFLARE_API_TOKEN` and `CLOUDFLARE_ACCOUNT_ID`; document the minimal token permissions. **Shipped (#10a)**: questions take their default or stop with exit code 2, and only unattended runs read the token. Access is answered through the API since #9. Not done: a flag per first-deploy question other than Access (the site name), and a check of the documented token permissions, the Access ones included, against a real account.
- **Machine-readable output**: `--json` (final URL, build report, warnings) and `$GITHUB_OUTPUT` / `$GITHUB_STEP_SUMMARY` support, plus no ANSI colours when not a TTY. **Shipped (#10)** in `cli/lib/report.js`.
- **Reusable GitHub Action** (**shipped (#10)**: `action.yml`, composite) that checks out the toolkit at a pinned ref, installs it, runs the CLI on the game folder and exposes the URL as an output. A copy-paste workflow example in `site/` (on push to `main`: deploy; on pull request: build only, then post the build report).
- **GitLab CI and generic shell** examples built on `run.sh`, so any CI with Node.js 22+ works. **Shipped (#10)** in `site/setup/ci.md`.
- **Pull request previews** (later): deploy each PR to a preview URL such as `<game>-pr-<n>`, and clean it up when the PR closes. Needs decisions on the Worker's shared-assets model and Access policy.
- **Safety**: never print tokens, skip deploy on forks, and keep the "game folder stays untouched" rule. The game's own assets are big, so document how to cache `node_modules` and the staged build between runs, and that the Workers free plan limits in `cli/limits.json` still apply.
- Still open: pull request previews and the build-only run for pull requests (needs #17's `--dry-run` or the "build only" target under [Later](#later)), and a check of the token permissions (the Access ones of #9 included) against a real CI run.

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
