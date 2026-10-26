---
description: "Every rpgmaker-web-toolkit command: deploy a game, upgrade it from its link, edit its config, import saves, rename the site; flags, targets and exit codes."
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
| `& $rwk upgrade my-game` | Updates the toolkit of a deployed game whose folder is gone; the game files stay as uploaded | link, name | [Update](/setup/updating#new-toolkit-version-game-folder-gone) |
| `& $rwk saves import "D:\Games\My Game"` | Uploads the game's `save/` folder, overwriting same-name cloud saves | folder | [Update](/setup/updating#upload-desktop-saves-again) |
| `& $rwk config "D:\Games\My Game"` | Changes the game's settings by answering questions (the JSON in Notepad, TextEdit or `$EDITOR` is one menu entry away). Feature settings apply without publishing again | folder, link, name | [Customize](/setup/configuration) |
| `& $rwk rename "D:\Games\My Game" --to new-name` | Moves the site to a new name (address), keeping the saves. Without `--to` it asks | folder | [Update](/setup/updating#change-the-site-address) |

`rwk --help` lists them, `rwk <command> --help` shows one with its examples, `rwk --version` prints the toolkit version. `rwk help` and `rwk help <command>` do the same.

## The target

One argument names the game. Each command accepts the forms in its row above, and the toolkit tells them apart:

| Form | Looks like | Means |
|---|---|---|
| folder | `~/Games/"My Game"`, `D:\Games\My Game` | The game folder on this PC |
| link | `https://my-game.alice.workers.dev` | A game already deployed to your Cloudflare account |
| name | `my-game` | The same game, by the first part of its link |

A name that is also a folder in the current directory is read as the folder: give the link to mean the site. An unquoted path with spaces works too (`deploy D:\Games\My Game`), though quotes are safer.

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
| `--to <name>` | Only `rename`: the new site name |

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
- A question with no safe answer stops the run with **exit code 2** and says what to do instead: a missing game folder, the site's first [access protection](/setup/access), `config` (it asks questions). `rename` takes its new name from `--to`. Do the first deploy in a terminal; later updates can run unattended.
- Two questions answer **no** when nobody is there: deleting the old Worker after a `rename` (asked again at the next run) and uploading the `save/` folder during a deploy (`saves import --yes` uploads it).
- [Exit codes](#exit-codes) tell a script what happened.
- `--json` does the same and prints the [result](/setup/ci#the-result) (link, build report, warnings) as one JSON object on stdout. In GitHub Actions, every run also writes the step outputs and summary. Ready-made setups: [Publish from CI](/setup/ci).

Log in with an API token instead of the browser login: set `CLOUDFLARE_API_TOKEN`, plus `CLOUDFLARE_ACCOUNT_ID` when the token reaches several accounts. Only a run with `--yes` (or without a terminal) reads them, so a token set for another tool never replaces the toolkit's own login. Create the token in the dashboard (My Profile → API Tokens → Create Custom Token) with these permissions, for the one account:

| Permission | Why |
|---|---|
| Account → Account Settings → Read | Find the account |
| Account → Workers Scripts → Edit | Deploy the Worker and its files |
| Account → Workers R2 Storage → Edit | The game's settings, saves and large files in R2 |
| User → User Details → Read (optional) | The email suggested for `saves import`; without it, `saves import --yes` on a site with Access stops at that question |

Keep the token in the CI's secrets: the toolkit never prints it.

From a clone, `.\rwk.cmd` (Windows) or `./rwk.sh` (macOS, Linux) takes the same commands. See [CONTRIBUTING.md](https://github.com/Kokoroou/rpgmaker-web-toolkit/blob/main/CONTRIBUTING.md).
