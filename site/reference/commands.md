---
description: "Every rpgmaker-web-toolkit command: deploy, analyze, doctor, upgrade, config, saves, status, logs, rename and delete, with flags and exit codes."
lang: en
---

# Commands

The one-liner asks for the game (its folder, or its link), then deploys or upgrades it:

```powershell
irm https://raw.githubusercontent.com/Kokoroou/rpgmaker-web-toolkit/main/run.ps1 | iex
```

On macOS and Linux:

```sh
curl -fsSL https://raw.githubusercontent.com/Kokoroou/rpgmaker-web-toolkit/main/run.sh | bash
```

To pass arguments, load it once per window:

::: code-group
```powershell [Windows (PowerShell)]
$rwk = [scriptblock]::Create((irm https://raw.githubusercontent.com/Kokoroou/rpgmaker-web-toolkit/main/run.ps1))
```
```sh [macOS / Linux]
rwk() { curl -fsSL https://raw.githubusercontent.com/Kokoroou/rpgmaker-web-toolkit/main/run.sh | bash -s -- "$@"; }
```
:::

The examples use the PowerShell form (`& $rwk <command>`). On macOS and Linux, write `rwk <command>` with a path like `~/Games/"My Game"`.

## Syntax

```
rwk <command> [<target>] [flags]
```

Flags may come before or after the command. A command comes first, then the game: `rwk "D:\Games\My Game"` alone is an error that suggests `rwk deploy …`.

| Command | Does | Target | Guide |
|---|---|---|---|
| `& $rwk deploy "D:\Games\My Game"` | First deploy, or update (changed files only) | folder | [First deploy](/setup/first-deploy), [Update](/setup/updating) |
| `& $rwk analyze "D:\Games\My Game"` | Checks the game without Cloudflare: the warnings and the file count. No login, nothing published, nothing written. `deploy --dry-run` does the same | folder | [Publish from CI](/setup/ci#check-pull-requests-without-publishing) |
| `& $rwk upgrade my-game` | Updates the toolkit of a deployed game whose folder is gone; the game files stay as uploaded | link, name | [Update](/setup/updating#new-toolkit-version-game-folder-gone) |
| `& $rwk saves import "D:\Games\My Game"` | Uploads the game's `save/` folder, overwriting same-name cloud saves. `--dry-run` lists them and uploads nothing | folder | [Update](/setup/updating#upload-desktop-saves-again) |
| `& $rwk config "D:\Games\My Game"` | Changes the game's settings by answering questions (the JSON in Notepad, TextEdit or `$EDITOR` is one menu entry away). `--get <key>` prints one setting; `--set <key>=<value>` (repeatable) changes one without questions, also unattended. Feature settings apply without publishing again | folder, link, name | [Customize](/setup/configuration) |
| `& $rwk rename "D:\Games\My Game" --to new-name` | Moves the site to a new name (address), keeping the saves. Without `--to` it asks. `--dry-run` checks the name and changes nothing | folder | [Update](/setup/updating#change-the-site-address) |
| `& $rwk status my-game` | Whether the site is up, whether Access is in front of it, how many emails have saves, and which toolkit version it runs (recorded from this version on) | link, name | |
| `& $rwk saves export my-game --email me@example.com` | Downloads that player's cloud saves into `my-game-saves/` (`--out <folder>` to choose), as `.rmmzsave` / `.rpgsave` files. Needs the token permission *Workers R2 Storage → Read* when you use `CLOUDFLARE_API_TOKEN` | link, name | |
| `& $rwk logs my-game` | Shows the Worker's requests and errors as they happen, until Ctrl+C (terminal only) | link, name | |
| `& $rwk open my-game` | Opens the site in the browser | link, name | |
| `& $rwk list` | Lists the games published in this Cloudflare account | none | |
| `& $rwk delete my-game` | Deletes the site's Worker after you type its name. Saves and large files stay in R2, so the game can be published again; `--purge` deletes them too (every player's saves and older saves, the settings, the player list, the large files), which cannot be undone: `saves export` first keeps a player's saves. The Access application stays in the dashboard. Never runs with `--yes` | link, name | |
| `& $rwk doctor` | Checks this PC: Node.js version, wrangler, the Cloudflare login, and what the login or `CLOUDFLARE_API_TOKEN` may do (Workers, R2, and Access for a token), and what the account needs before a first deploy: R2 switched on, a workers.dev subdomain, and whether the toolkit's R2 bucket exists yet. Reads only; exits with `1` when something needed is missing | none | [Troubleshooting](/setup/troubleshooting) |

`rwk --help` lists them, `rwk <command> --help` shows one with its examples, `rwk --version` prints the toolkit version. `rwk help` and `rwk help <command>` do the same.

## The target

One argument names the game. Each command accepts the forms in its row above, and the toolkit tells them apart:

| Form | Looks like | Means |
|---|---|---|
| folder | `~/Games/"My Game"`, `D:\Games\My Game` | The game folder on this PC |
| link | `https://my-game.alice.workers.dev` | A game already deployed to your Cloudflare account |
| name | `my-game` | The same game, by the first part of its link |

A name that is also a folder in the current directory is read as the folder: give the link to mean the site.

Without a target, a command that takes a folder (`deploy`, `analyze`, `saves import`, `config`, `rename`) works on the **current directory** when it holds a game (`index.html` and `js/`, or the same in `www/`). So inside the game folder, `rwk deploy` is enough. Elsewhere it asks for the folder, or stops with exit code 2 when run unattended. An unquoted path with spaces works too (`deploy D:\Games\My Game`), though quotes are safer.

## Flags

| Flag | Effect |
|---|---|
| `-y`, `--yes` | Never asks: each question takes its default answer, or stops the run with exit code 2 when it has none. See [Run without questions](#run-without-questions-ci) |
| `--json` | Same as `--yes`, and prints the result as one JSON object on stdout. See [Publish from CI](/setup/ci#the-result) |
| `-q`, `--quiet` | Prints only warnings, questions and errors. The result still reaches stdout |
| `--verbose` | Prints full error details (like `RWK_DEBUG=1`) |
| `--no-color` | No colors (also `NO_COLOR=1`; none when output is not a terminal or `TERM=dumb`) |
| `-h`, `--help` | Help for the toolkit, or for the command before it |
| `-V`, `--version` | The toolkit version |
| `--dry-run` | `deploy`: checks the game and stops before Cloudflare, like `analyze`. `rename` and `saves import`: read the game's settings in R2, say what would happen, and change nothing. See [Check without publishing](#check-without-publishing) |
| `--to <name>` | Only `rename`: the new site name |
| `--purge` | Only `delete`: also deletes what the game keeps in R2 |
| `--email <address>`, `--out <folder>` | Only `saves export`: whose saves, and where to write them |

## Check without publishing

`analyze` (or `deploy --dry-run`) runs the same checks a deploy starts with, and stops there:

- It reads the game folder and the creator's [hosting policy](/creators/policy), lists the warnings (MV phone audio and video, non-ASCII file names, feature settings) and counts the files against the [free plan limits](/reference/limits).
- It checks the file paths (see [below](#file-paths-that-work-on-windows-only)): the names in the game against the references to them.
- It never logs in to Cloudflare, never uses R2 and builds no staging folder: the game folder and the account stay as they are.
- It uses the first-deploy defaults. A game already published with `exclude` patterns or other settings kept in R2 may therefore count more files than its real deploy.
- It fails (exit code `1`) when the build is over the file limit or the creator does not allow publishing, so a CI job can use it as a check.

```
✓ rpgmaker-web-toolkit: checked, nothing published
  Files    1834 (412.3 MB)
  Game     MZ · My Game
  Warnings none
```

With `--json` the result has `"dryRun": true`, the `build` report and `game: { title, engine }`, and no `site` or `url`.

`rename --dry-run` and `saves import --dry-run` go one step further: they log in and read the game's settings in R2 (a game that is not published yet stops there), but create, upload and delete nothing, not even the R2 bucket.

- `rename --dry-run --to new-name` checks the name (format, current name, used by another game) and lists what the rename would do.
- `saves import --dry-run` lists the saves in `save/` that would go up, and where: the email you sign in with, or the shared saves of a public site. Nothing is asked about the email.

Their result has `"dryRun": true` with the site's current `site` and `url`.

### File paths that work on Windows only

Windows ignores letter case; the web host and the browser do not. A game can run on Windows with `"actor1"` in `Actors.json` for `img/characters/Actor1.png` and show nothing online. `analyze` and `deploy` warn about, one line per kind:

- **Letter case or Unicode form**: a reference in `data/*.json`, the plugin list (`js/plugins.js`), `index.html`, a CSS file or a path written in a plugin differs from the file's name only by case (or accents saved in another Unicode form).
- **Upper-case extension** (`Actor1.PNG`) and **engine folders** spelled differently (`img/Faces`, `audio/BGM`): the engine asks for lower case.
- **Files that differ only by case**, and names with `#`, `?`, `\` or `%XX`, which break a web address.
- **References to files that are not in the game**: often unused, so only a warning.

With `--json` the result has `paths: { checked, case, unicode, missing, ext, folder, collision, unsafe }`. A name assembled by a plugin at run time cannot be checked.

To fix them, open the toolkit folder in [Claude Code](https://claude.com/claude-code) and ask it to fix the game's file paths: the `rwk-paths` skills (`.claude/skills/`) scan at three depths (`quick`, `standard`, `deep`) and fix at three levels (`safe` rewrites references, `standard` also renames extensions and engine folders and rewrites path literals in plugins, `thorough` also renames unsafe names). Every run prints a plan first, backs up what it edits in `.rwk-paths-backup/` of the game, scans again and restores everything if the result is worse.

## What it prints

The log (steps, questions, warnings, errors) goes to **stderr**; **stdout** holds only the result. So `url=$(rwk deploy ./game --quiet)` gets the link, and `rwk deploy ./game --json > result.json` gets the [JSON result](/setup/ci#the-result). On a terminal, stdout stays empty.

Every command ends with the same summary:

```
✓ my-game: deployed
  Link     https://my-game.alice.workers.dev
  Files    1834 (412.3 MB), 2 on R2 (0 uploaded)
  Warnings 1
    ! 3 audio file(s) have no .m4a version: …
  Next     On a phone: open the link → browser menu → “Add to Home Screen”.
```

An error says what went wrong and what to try:

```
✗ This game is not published yet, so it has no site to rename.
  → Publish it first: rwk deploy "D:\Games\My Game"
```

Symbols fall back to ASCII where the terminal may not draw them (`TERM=dumb`, a non-UTF-8 locale, or `RWK_ASCII=1`).

## Exit codes

| Code | Meaning |
|---|---|
| `0` | Done |
| `1` | Failed (Cloudflare, wrangler, a file problem) |
| `2` | A question needs a person (non-interactive run) |
| `64` | Wrong command line: unknown command or flag, or a target the command does not take |
| `130` | Cancelled |

Each run downloads the toolkit to a temporary folder and deletes it at the end.

| Environment variable | Effect |
|---|---|
| `$env:RWK_REF = "v1.0.0"` (`export RWK_REF=v1.0.0`) | Runs that tag or branch instead of `main` |
| `$env:RWK_DEBUG = "1"` (`export RWK_DEBUG=1`) | Prints full error details (same as `--verbose`) |
| `$env:RWK_ASCII = "1"` (`export RWK_ASCII=1`) | ASCII symbols instead of ✓ ▶ → |
| `$env:RWK_LIMITS_URL = "off"` (`export RWK_LIMITS_URL=off`) | Uses only the [free plan limits](/reference/limits#when-cloudflare-changes-them) shipped with the toolkit (or another URL to read them from) |

## Run without questions (CI)

`--yes` runs a command with no one at the keyboard, for a game repository that redeploys itself. It is also on whenever stdin is not a terminal, as in GitHub Actions or GitLab CI.

```sh
./rwk.sh deploy ~/Games/"My Game" --yes
```

- Each question takes its default answer, and the log shows it with `(non-interactive)`.
- A question with no safe answer stops the run with **exit code 2** and says what to do instead: a missing game folder, a first [access protection](/setup/access) the API cannot set up (no Zero Trust team yet, or a token without the Access permissions), `config` without `--get` / `--set` (it asks questions). `rename` takes its new name from `--to`. Do the first deploy in a terminal; later updates can run unattended.
- Two questions answer **no** when nobody is there: deleting the old Worker after a `rename` (asked again at the next run) and uploading the `save/` folder during a deploy (`saves import --yes` uploads it).
- [Exit codes](#exit-codes) tell a script what happened.
- `--json` does the same and prints the [result](/setup/ci#the-result) (link, build report, warnings) as one JSON object on stdout. In GitHub Actions, every run also writes the step outputs and summary. Ready-made setups: [Publish from CI](/setup/ci).

Log in with an API token instead of the browser login: set `CLOUDFLARE_API_TOKEN`, plus `CLOUDFLARE_ACCOUNT_ID` when the token reaches several accounts. Only a run with `--yes` (or without a terminal) reads them, so a token set for another tool never replaces the toolkit's own login. Create the token in the dashboard (My Profile → API Tokens → Create Custom Token) with these permissions, for the one account:

| Permission | Why |
|---|---|
| Account → Account Settings → Read | Find the account |
| Account → Workers Scripts → Edit | Deploy the Worker and its files |
| Account → Workers R2 Storage → Edit | The game's settings, saves and large files in R2 |
| Account → Access: Apps and Policies → Edit | Protect the site with [Cloudflare Access](/setup/access) on its first deploy |
| Account → Access: Organizations, Identity Providers, and Groups → Read | Find the Zero Trust team's login domain |
| User → User Details → Read (optional) | The email suggested for `saves import`; without it, `saves import --yes` stops at that question, and the first Access policy has no email to allow unless `players` lists some |

Keep the token in the CI's secrets: the toolkit never prints it.

From a clone, `.\rwk.cmd` (Windows) or `./rwk.sh` (macOS, Linux) takes the same commands. See [CONTRIBUTING.md](https://github.com/Kokoroou/rpgmaker-web-toolkit/blob/main/CONTRIBUTING.md).
