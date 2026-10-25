# Commands

The one-liner deploys, and asks for the game folder:

```powershell
irm https://raw.githubusercontent.com/Kokoroou/rpgmaker-web-toolkit/main/run.ps1 | iex
```

To pass arguments, load it once per PowerShell window:

```powershell
$rwk = [scriptblock]::Create((irm https://raw.githubusercontent.com/Kokoroou/rpgmaker-web-toolkit/main/run.ps1))
```

| Command | Does | Guide |
|---|---|---|
| `& $rwk "D:\Games\My Game"` | First deploy, or update (changed files only) | [First deploy](/setup/first-deploy), [Update](/setup/updating) |
| `& $rwk import-saves "D:\Games\My Game"` | Uploads the game's `save/` folder, overwriting same-name cloud saves | [Update](/setup/updating#upload-desktop-saves-again) |
| `& $rwk edit-config "D:\Games\My Game"` | Edits the game's settings in Notepad | [Customize](/setup/configuration) |
| `& $rwk rename "D:\Games\My Game"` | Moves the site to a new name (address), keeping the saves | [Update](/setup/updating#change-the-site-address) |
| `& $rwk help` | Lists the commands | |

Each run downloads the toolkit to a temporary folder and deletes it at the end.

| Environment variable | Effect |
|---|---|
| `$env:RWK_REF = "v1.0.0"` | Runs that tag or branch instead of `main` |
| `$env:RWK_DEBUG = "1"` | Prints full error details |
| `$env:RWK_LIMITS_URL = "off"` | Uses only the [free plan limits](/reference/limits#when-cloudflare-changes-them) shipped with the toolkit (or another URL to read them from) |

From a clone, `.\rwk.cmd` takes the same commands. See [CONTRIBUTING.md](https://github.com/Kokoroou/rpgmaker-web-toolkit/blob/main/CONTRIBUTING.md).
