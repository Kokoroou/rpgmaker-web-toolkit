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
| `& $rwk edit-config "D:\Games\My Game"` | Edits the game's settings in Notepad (TextEdit on macOS, `$EDITOR` or nano on Linux) | [Customize](/setup/configuration) |
| `& $rwk rename "D:\Games\My Game"` | Moves the site to a new name (address), keeping the saves | [Update](/setup/updating#change-the-site-address) |
| `& $rwk update-from-link "https://my-game.alice.workers.dev"` | Updates the toolkit of a deployed game whose folder is gone; the game files stay as uploaded | [Update](/setup/updating#new-toolkit-version-game-folder-gone) |
| `& $rwk help` | Lists the commands | |

Each run downloads the toolkit to a temporary folder and deletes it at the end.

| Environment variable | Effect |
|---|---|
| `$env:RWK_REF = "v1.0.0"` (`export RWK_REF=v1.0.0`) | Runs that tag or branch instead of `main` |
| `$env:RWK_DEBUG = "1"` (`export RWK_DEBUG=1`) | Prints full error details |
| `$env:RWK_LIMITS_URL = "off"` (`export RWK_LIMITS_URL=off`) | Uses only the [free plan limits](/reference/limits#when-cloudflare-changes-them) shipped with the toolkit (or another URL to read them from) |

From a clone, `.\rwk.cmd` (Windows) or `./rwk.sh` (macOS, Linux) takes the same commands. See [CONTRIBUTING.md](https://github.com/Kokoroou/rpgmaker-web-toolkit/blob/main/CONTRIBUTING.md).
