---
description: "rpgmaker-web-toolkit commands at a glance: the one-liner, syntax, targets, flags, output and exit codes, with links to each command's page."
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

::: tip More pages
[Check without publishing](/reference/commands/check) · [Manage published games](/reference/commands/sites) · [Saves commands](/reference/commands/saves) · [Logins and accounts](/reference/commands/accounts) · [Run without questions (CI)](/reference/commands/unattended) · [Cache and cleanup](/reference/commands/cache)
:::

## Command list

```
rwk <command> [<target>] [flags]
```

Flags may come before or after the command. A command comes first, then the game: `rwk "D:\Games\My Game"` alone is an error that suggests `rwk deploy …`.

| Command | Does | Details |
|---|---|---|
| `deploy <folder>` | First deploy, or update (changed files only). `--name` answers the first deploy's site name question; `--new-site --name <name>` publishes [one more site](/setup/updating#publish-a-second-site-of-the-same-game) | [First deploy](/setup/first-deploy), [Update](/setup/updating) |
| `analyze <folder>` | Checks the game without Cloudflare: warnings and file count. Nothing published. `deploy --dry-run` does the same | [Check without publishing](/reference/commands/check) |
| `fix-paths <folder>` | Fixes file paths that work on Windows only (letter case, `.PNG`, `img/Faces`, `#` in names) in the game folder: plan first, backup, `--undo last` | [Check without publishing](/reference/commands/check#fix-them-fix-paths) |
| `upgrade <game>` | Updates a deployed game's toolkit without uploading the game again; `--all` for every game | [Manage](/reference/commands/sites#upgrade) |
| `config <game>` | Changes the game's settings; `--get` / `--set` for scripts | [Manage](/reference/commands/sites#config), [Customize](/setup/configuration) |
| `rename <folder> --to <name>` | Moves the site to a new address, keeping the saves | [Manage](/reference/commands/sites#rename) |
| `status`, `logs`, `open <game>` | Site health, live Worker logs, open in the browser | [Manage](/reference/commands/sites#status) |
| `list` | Lists the games in this Cloudflare account | [Manage](/reference/commands/sites#open-and-list) |
| `delete <game>` | Deletes the site's Worker; `--purge` also deletes its R2 data | [Manage](/reference/commands/sites#delete) |
| `saves import`, `export`, `move`, `delete` | Upload desktop saves, download, move to another email, delete a player's cloud saves | [Saves commands](/reference/commands/saves) |
| `login`, `logout`, `whoami`, `profiles` | Cloudflare logins and profiles | [Logins and accounts](/reference/commands/accounts) |
| `doctor` | Checks this PC and the account before a first deploy. Reads only | [Manage](/reference/commands/sites#doctor) |

`rwk --help` lists them, `rwk <command> --help` shows one with its examples, `rwk --version` prints the toolkit version. `rwk help` and `rwk help <command>` do the same.

## The target

One argument names the game. Each command accepts the forms in its row above, and the toolkit tells them apart:

| Form | Looks like | Means |
|---|---|---|
| folder | `~/Games/"My Game"`, `D:\Games\My Game` | The game folder on this PC |
| link | `https://my-game.alice.workers.dev` | A game already deployed to your Cloudflare account |
| name | `my-game` | The same game, by the first part of its link |

A name that is also a folder in the current directory is read as the folder: give the link to mean the site.

Without a target, a command that takes a folder (`deploy`, `analyze`, `fix-paths`, `saves import`, `config`, `rename`) works on the **current directory** when it holds a game (`index.html` and `js/`, or the same in `www/`). So inside the game folder, `rwk deploy` is enough. Elsewhere it asks for the folder, or stops with exit code 2 when run unattended. An unquoted path with spaces works too (`deploy D:\Games\My Game`), though quotes are safer.

## Flags

| Flag | Effect |
|---|---|
| `-y`, `--yes` | Never asks: each question takes its default answer, or stops the run with exit code 2 when it has none. See [Run without questions](/reference/commands/unattended) |
| `--json` | Same as `--yes`, and prints the result as one JSON object on stdout. See [Publish from CI](/setup/ci#the-result) |
| `--account <ID or name>` | The Cloudflare account to work in, when the login reaches several. See [Several Cloudflare accounts](/reference/commands/accounts#several-cloudflare-accounts) |
| `--profile <name>` | The login profile (one Cloudflare login, so one email) for this run, without switching to it. Ignored with `CLOUDFLARE_API_TOKEN`. See [Several Cloudflare logins](/reference/commands/accounts#several-cloudflare-logins) |
| `-q`, `--quiet` | Prints only warnings, questions and errors. The result still reaches stdout |
| `--verbose` | Prints full error details (like `RWK_DEBUG=1`) |
| `--no-color` | No colors (also `NO_COLOR=1`; none when output is not a terminal or `TERM=dumb`) |
| `-h`, `--help` | Help for the toolkit, or for the command before it |
| `-V`, `--version` | The toolkit version |
| `--dry-run` | `deploy`: checks the game and stops before Cloudflare, like `analyze`. `rename` and `saves import`: read the game's settings in R2, say what would happen, and change nothing. See [Check without publishing](/reference/commands/check) |
| `--name <site name>` | `deploy`: the site name of a first deploy, instead of the question (from [`rwk.json`](/reference/config#rwk-json-in-the-game-folder), else the folder's name, by default). An already published game must have that name: it stops otherwise, and [`rename`](/setup/updating#change-the-site-address) moves it. For a game with [several sites](/setup/updating#publish-a-second-site-of-the-same-game), `deploy`, `rename` and `saves import` take it to say which one |
| `--cleanup` | Only the one-liner (`run.ps1`, `run.sh`): deletes the cached toolkit after the run, unless another run is using it. See [Cache and cleanup](/reference/commands/cache) |
| `--new-site` | Only `deploy`: publish the game as one more site beside the ones it has, with its own link, settings and saves. See [Publish a second site](/setup/updating#publish-a-second-site-of-the-same-game) |
| `--to <name>` | Only `rename`: the new site name |
| `--purge` | Only `delete`: also deletes what the game keeps in R2 |
| `--email <address>`, `--out <folder>` | `saves export`: whose saves, and where to write them. `saves delete`: whose saves |
| `--from <address>`, `--to <address>` | Only `saves move`: the email the saves are under now, and the one that gets them (`--to` also names the new site in `rename`) |
## What it prints

The log (steps, questions, warnings, errors) goes to **stderr**; **stdout** holds only the result. So `url=$(rwk deploy ./game --quiet)` gets the link, and `rwk deploy ./game --json > result.json` gets the [JSON result](/setup/ci#the-result). On a terminal, stdout stays empty.

Once a deploy knows which steps are left (after the questions), they carry their number: `▶ [2/3] Large files on R2`. While files upload, a terminal shows one line that updates in place: the large files going to R2 (`↑ R2 3/12 · 120.4 MB of 410.0 MB · audio/bgm/Theme.ogg`), wrangler's `Uploaded 120 of 340 assets (35%)`, and the objects `delete --purge` removes. In CI, in a pipe or log file, with `--json`, `--no-color` or `NO_COLOR=1`, nothing is rewritten: each large file uploaded gets its own line (`↑ R2 [3/12] audio/bgm/Theme.ogg (40.2 MB)`) and wrangler's lines stay as it prints them.

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
