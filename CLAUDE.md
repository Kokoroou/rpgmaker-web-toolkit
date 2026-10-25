# rpgmaker-web-toolkit

Publishes an RPG Maker MZ/MV game to Cloudflare Workers (free plan) with cloud save sync
and on-screen controls. User-facing docs: `README.md` and the guide in `site/`.

## Commands
- Install: `npm ci` (Node.js 24+)
- Test:    `npm test` (node:test, no network)
- Coverage: `node --test --experimental-test-coverage "test/*.test.js"`
- Docs site: `cd site && npm ci && npm run dev`

## Layout
- `cli/` — Node CLI run by `run.ps1` / `rwk.cmd`: analyzes the game, stages a web build, drives wrangler.
  Free plan limits are in `cli/limits.json` (fetched from `main` at each deploy): change them there and bump `updated`
- `runtime/` — `RWK_*.js` plugins injected into the game's web build (run in the browser, MZ and MV)
- `worker/` — the Cloudflare Worker shared by every game (assets, Access JWT, save API)
- `test/` — tests for `cli/` and `worker/`
- `tools/perf/` — `npm run perf -- "<game folder>"`: measures what the `runtime/` plugins cost a real game in Chrome (not shipped)
- `site/` — VitePress user guide, published to GitHub Pages by `docs.yml`

Details: `site/reference/how-it-works.md`. Contributor setup: `CONTRIBUTING.md`.

## Branches, PRs and commits
`main` is protected: every change goes through a PR, merged with **squash** only, and CI
(`quality / checks`, `pr-title`, `gitleaks`, `semgrep`) must be green.

- **The PR title is the commit message on `main`.** Squash keeps only the title, so the
  branch's own commits (wip, fix lint…) are free-form and do not reach `main` or the changelog.
- **PR title = Conventional Commit**, checked by `quality / pr-title`:
  `type(scope)?!?: description`, description starts lowercase and has no trailing period.
  - `feat:` new behaviour users see → minor bump, in the changelog
  - `fix:` bug users could hit in a released version → patch bump, in the changelog
  - `feat!:` / `fix!:` or a `BREAKING-CHANGE:` footer → breaking (minor bump while on 0.x)
  - `docs:` `ci:` `chore:` `refactor:` `test:` `build:` `perf:` `style:` → no release on their own
  - Scopes when useful: `cli`, `worker`, `runtime`, `controls`, `saves`, `site`.
- **One user-visible change per PR.** Follow-up work on the same, unreleased feature (extra
  pieces, typos it introduced) stays in its PR or is described in the PR body; it does not
  get its own changelog line.
- **Second entry in one PR (rare):** only for a small, independent `fix` of something
  already released. When merging, put it in the squash commit **body** after a blank line:
  ```
  title: feat: add A (#17)
  body:  fix: correct typo in the save panel
  ```
  release-please reads conventional lines at the end of the body. Bulleted lines
  (`* fix: …`, GitHub's "commit details" format) are ignored, and nothing checks the body,
  so anything bigger goes in its own PR.
- **After a PR is merged, its branch is finished.** Squash makes a new commit, so never keep
  committing on a merged branch: for follow-up work (even a typo) start from the latest
  `main` (`git fetch origin main && git checkout -B <branch> origin/main`) and open a new PR.
- Always branch from `main`, never from another unmerged feature branch.
- A wrong message already on `main` is fixed without rewriting history: add a
  `BEGIN_COMMIT_OVERRIDE` … `END_COMMIT_OVERRIDE` block to the merged PR's description
  before the release PR is merged.

## Releases
`release.yml` (release-please) keeps a `chore(main): release X.Y.Z` PR up to date with the
version bump and `CHANGELOG.md`. Merging it tags `vX.Y.Z` and attaches
`rpgmaker-web-toolkit-X.Y.Z.zip` to the GitHub Release. Never edit `CHANGELOG.md` or the
`version` in `package.json` by hand.
