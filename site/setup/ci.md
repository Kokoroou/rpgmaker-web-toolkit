---
description: "Publish an RPG Maker game from its repository on every push, with GitHub Actions, GitLab CI or any CI that has Node.js 22: no questions, a JSON result."
lang: en
---

# Publish from CI

A game kept in a Git repository can publish itself: each push to `main` updates the site, with no one at the keyboard. The CI runs the same command as on your PC, with [`--json`](/reference/commands#run-without-questions-ci): it never asks a question, and it ends with the game's link and the build report.

## Before you start

1. **Publish the game once from a terminal** ([first deploy](/setup/first-deploy)) if you can: the site name needs a person, and a run in CI that reaches that question stops with exit code 2. [Access protection](/setup/access) is set up through the API when the token has the Access permissions and the account already has a Zero Trust team.
2. **Create a Cloudflare API token** with the [permissions the toolkit needs](/reference/commands#run-without-questions-ci), for the one account, and save it in the CI's secrets as `CLOUDFLARE_API_TOKEN`. Add `CLOUDFLARE_ACCOUNT_ID` if the token reaches several accounts.
3. **Put the game in the repository**, in a folder such as `game/` (the one with `index.html` and `js/`). Large pictures and sounds fit better in [Git LFS](https://git-lfs.com).

The settings stay in your Cloudflare account, as for a deploy from your PC: change them with [`config`](/setup/configuration) on your PC. Feature settings apply at once; the others (`include`, `exclude`…) with the next CI run.

## GitHub Actions

`.github/workflows/publish.yml` in the game's repository:

```yaml
name: Publish the game
on:
  push:
    branches: [main]
    paths: ["game/**"]
  workflow_dispatch:

# One publish at a time; a newer push waits for the one running.
concurrency: publish-game
permissions:
  contents: read

jobs:
  publish:
    runs-on: ubuntu-latest
    # A fork has no secrets: never publish from one.
    if: ${{ !github.event.repository.fork }}
    steps:
      - uses: actions/checkout@v5
        with:
          lfs: true # if the game uses Git LFS
      - id: rwk
        uses: Kokoroou/rpgmaker-web-toolkit@v0.4.0 # a release tag: v0.4.0 or later
        with:
          game-folder: game
          cloudflare-api-token: ${{ secrets.CLOUDFLARE_API_TOKEN }}
          cloudflare-account-id: ${{ secrets.CLOUDFLARE_ACCOUNT_ID }}
      - run: echo "Published at $URL"
        env:
          URL: ${{ steps.rwk.outputs.url }}
```

The action installs Node.js and the toolkit at the tag you pin, then publishes the folder. Pin a release tag rather than `main`, and move it up when you want a newer toolkit. The run's page shows a summary: the link, the number of files and the warnings.

| Input | Default | |
|---|---|---|
| `game-folder` | `.` | The game folder, from the repository's root. For `upgrade`, the game's link or site name |
| `command` | `deploy` | Or `saves import`, `upgrade` |
| `cloudflare-api-token` | | Required |
| `cloudflare-account-id` | | When the token reaches several accounts |
| `node-version` | `22` | |

| Output | |
|---|---|
| `url` | The game's link |
| `site` | The site name |
| `warnings` | How many warnings the run had |
| `result` | The whole result as JSON (see [below](#the-result)) |

Do not publish on `pull_request`: a pull request would replace the live site. A build-only run for pull requests is planned.

## GitLab CI

`.gitlab-ci.yml`, with `CLOUDFLARE_API_TOKEN` as a masked CI/CD variable:

```yaml
publish-game:
  image: node:22
  rules:
    - if: $CI_COMMIT_BRANCH == $CI_DEFAULT_BRANCH
      changes: ["game/**/*"]
  variables:
    RWK_REF: v0.4.0 # a release tag: v0.4.0 or later
  script:
    - curl -fsSL "https://raw.githubusercontent.com/Kokoroou/rpgmaker-web-toolkit/$RWK_REF/run.sh" | bash -s -- deploy "$CI_PROJECT_DIR/game" --json > rwk-result.json
  artifacts:
    when: always
    paths: [rwk-result.json]
```

## Any other CI

Anything with Node.js 22 or newer, `curl` and `tar` runs the same line as GitLab, with `CLOUDFLARE_API_TOKEN` (and maybe `CLOUDFLARE_ACCOUNT_ID`) in the environment:

```sh
curl -fsSL https://raw.githubusercontent.com/Kokoroou/rpgmaker-web-toolkit/v0.4.0/run.sh | bash -s -- deploy ./game --json > rwk-result.json
```

From a clone of the toolkit: `node cli/index.js deploy ./game --json` after `npm ci`.

## The result

The log always goes to stderr. With `--json`, stdout holds one JSON object:

```json
{
  "schema": 1,
  "ok": true,
  "command": "deploy",
  "site": "my-game",
  "url": "https://my-game.alice.workers.dev",
  "locked": false,
  "build": { "files": 1834, "bytes": 412301204, "r2Files": 2, "r2Uploaded": 0 },
  "next": ["On a phone: open the link → browser menu → “Add to Home Screen” to play fullscreen."],
  "warnings": ["3 audio file(s) have no .m4a version: …"]
}
```

A failed run has `"ok": false`, `error`, `hint` (what to try, or `null`) and `exitCode` instead: `1` for a failure (Cloudflare, wrangler, a file), `2` for a question only a person can answer, `64` for a wrong command line. `schema` changes only when a field is removed or changes meaning. In GitHub Actions the toolkit also writes `ok`, `site`, `url` and `warnings` as step outputs and the summary, with or without `--json`.

## Good to know

- Each run uploads only the files that changed, as on your PC; the [free plan limits](/reference/limits) still apply.
- The game folder in the checkout is never changed. The toolkit never prints the token; keep it in the CI's secrets, never in the repository.
- Unattended, a deploy does not upload the `save/` folder (`saves import` does) and never deletes the old Worker after a [`rename`](/setup/updating#change-the-site-address): run those from a terminal.
