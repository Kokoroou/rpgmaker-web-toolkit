# Commands

## Without cloning (the usual way)

The one-line command runs a deploy and asks for the game folder:

```powershell
irm https://raw.githubusercontent.com/Kokoroou/rpgmaker-web-toolkit/main/run.ps1 | iex
```

To pass arguments, load the script as a scriptblock once per PowerShell window, then call it:

```powershell
$rwk = [scriptblock]::Create((irm https://raw.githubusercontent.com/Kokoroou/rpgmaker-web-toolkit/main/run.ps1))

& $rwk "D:\Games\My Game"                 # deploy or update, without the folder prompt
& $rwk import-saves "D:\Games\My Game"    # upload the save/ folder to the cloud again
& $rwk edit-config "D:\Games\My Game"     # edit the game's settings in Notepad
& $rwk help                               # list the commands
```

| Command | Does | Page |
|---|---|---|
| *(folder)* or `deploy` *(folder)* | First deploy, or update an existing game (uploads changed files only) | [First deploy](/setup/first-deploy), [Update](/setup/updating) |
| `import-saves` *(folder)* | Uploads the saves in the game's `save/` folder, overwriting cloud saves with the same name | [Update](/setup/updating#upload-desktop-saves-again) |
| `edit-config` *(folder)* | Opens the game's settings in Notepad and saves them to your account | [Customize](/setup/configuration) |
| `help` | Lists the commands | |

Every command downloads the toolkit into a temporary folder, runs, and deletes the folder.

## Environment variables

| Variable | Effect |
|---|---|
| `RWK_REF` | Runs a tag or branch of the toolkit instead of `main`, e.g. `$env:RWK_REF = "v1.0.0"` |
| `RWK_DEBUG` | `1` prints full error details |

## From a clone

When working on the toolkit itself:

```powershell
git clone https://github.com/Kokoroou/rpgmaker-web-toolkit
cd rpgmaker-web-toolkit
.\rwk.cmd "D:\Games\My Game"            # same commands as above
npm test                                # CLI + Worker tests, no network needed
```

`rwk.cmd` installs the dependencies on its first run.
