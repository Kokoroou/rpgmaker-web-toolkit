---
description: "Every command of rpgmaker-web-toolkit: deploy or update a game, edit its config, import saves, rename the site and update from a link."
lang: en
---

# Commands

The one-liner deploys, and asks for the game folder:

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

The table uses the PowerShell form (`& $rwk <command>`). On macOS and Linux, write `rwk <command>` with a path like `~/Games/"My Game"`.

| Command | Does | Guide |
|---|---|---|
| `& $rwk "D:\Games\My Game"` | First deploy, or update (changed files only) | [First deploy](/setup/first-deploy), [Update](/setup/updating) |
| `& $rwk import-saves "D:\Games\My Game"` | Uploads the game's `save/` folder, overwriting same-name cloud saves | [Update](/setup/updating#upload-desktop-saves-again) |
| `& $rwk edit-config "D:\Games\My Game"` | Edits the game's settings in Notepad (TextEdit on macOS, `$EDITOR` or nano on Linux). Feature settings apply without publishing again | [Customize](/setup/configuration) |
| `& $rwk rename "D:\Games\My Game"` | Moves the site to a new name (address), keeping the saves | [Update](/setup/updating#change-the-site-address) |
| `& $rwk update-from-link "https://my-game.alice.workers.dev"` | Updates the toolkit of a deployed game whose folder is gone; the game files stay as uploaded | [Update](/setup/updating#new-toolkit-version-game-folder-gone) |
| `& $rwk help` | Lists the commands | |
| `--yes` before any of these | Runs without questions | [Run without questions](#run-without-questions-ci) |

Each run downloads the toolkit to a temporary folder and deletes it at the end.

| Environment variable | Effect |
|---|---|
| `$env:RWK_REF = "v1.0.0"` (`export RWK_REF=v1.0.0`) | Runs that tag or branch instead of `main` |
| `$env:RWK_DEBUG = "1"` (`export RWK_DEBUG=1`) | Prints full error details |
| `$env:RWK_LIMITS_URL = "off"` (`export RWK_LIMITS_URL=off`) | Uses only the [free plan limits](/reference/limits#when-cloudflare-changes-them) shipped with the toolkit (or another URL to read them from) |

## Run without questions (CI)

`--yes` (or `--non-interactive`) runs a command with no one at the keyboard, for a game repository that redeploys itself. It is also on whenever stdin is not a terminal, as in GitHub Actions or GitLab CI.

```sh
./rwk.sh --yes ~/Games/"My Game"
```

- Each question takes its default answer, and the log shows it with `(non-interactive)`.
- A question with no safe answer stops the run with **exit code 2** and says what to do instead: a missing game folder, the site's first [access protection](/setup/access), a new site name for `rename`, `edit-config`. Do the first deploy in a terminal; later updates can run unattended.
- Two questions answer **no** when nobody is there: deleting the old Worker after a `rename` (asked again at the next run) and uploading the `save/` folder during a deploy (`import-saves --yes` uploads it).
- Exit codes: `0` done, `1` failed (Cloudflare, wrangler, a file problem), `2` a question needs a person, `130` cancelled.

Log in with an API token instead of the browser login: set `CLOUDFLARE_API_TOKEN`, plus `CLOUDFLARE_ACCOUNT_ID` when the token reaches several accounts. Only a run with `--yes` (or without a terminal) reads them, so a token set for another tool never replaces the toolkit's own login. Create the token in the dashboard (My Profile → API Tokens → Create Custom Token) with these permissions, for the one account:

| Permission | Why |
|---|---|
| Account → Account Settings → Read | Find the account |
| Account → Workers Scripts → Edit | Deploy the Worker and its files |
| Account → Workers R2 Storage → Edit | The game's settings, saves and large files in R2 |
| User → User Details → Read (optional) | The email suggested for `import-saves`; without it, `import-saves --yes` on a site with Access stops at that question |

Keep the token in the CI's secrets: the toolkit never prints it.

From a clone, `.\rwk.cmd` (Windows) or `./rwk.sh` (macOS, Linux) takes the same commands. See [CONTRIBUTING.md](https://github.com/Kokoroou/rpgmaker-web-toolkit/blob/main/CONTRIBUTING.md).
