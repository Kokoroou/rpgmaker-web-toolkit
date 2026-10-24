# Update the game

## Install a patch or a translation

1. Copy the patch or translation over the game folder on your PC, as you would for the desktop game.
2. Run the same command again and drop in the same folder:

```powershell
irm https://raw.githubusercontent.com/Kokoroou/rpgmaker-web-toolkit/main/run.ps1 | iex
```

The toolkit recognizes the game (MZ: by its game ID; MV: by its title), reuses your settings and **uploads only the files that changed**. A small patch takes a minute or two.

Players get the new version the next time they reload the page. Their saves are kept.

::: tip New keys
If the new version adds plugins that use new keys, the toolkit lists them and offers to add on-screen buttons for them.
:::

::: warning MV games whose title changes
An MV game is recognized by its title. If a translation changes the title (in `data/System.json`), the toolkit treats it as a new game and asks the first-deploy questions again. Give it the **same site name** as before to keep the same link and saves.
:::

## Publish from another PC

Download the game on the other PC, install [Node.js](/setup/requirements#_2-node-js-20-or-newer), run the same command and log in to the **same Cloudflare account**. The settings come from your account, so there are no questions to answer.

## Upload desktop saves again

To push the saves in the game's `save/` folder to the cloud again, for example after playing the desktop version for a while:

```powershell
$rwk = [scriptblock]::Create((irm https://raw.githubusercontent.com/Kokoroou/rpgmaker-web-toolkit/main/run.ps1))
& $rwk import-saves "D:\Games\My Game"
```

::: danger This overwrites cloud saves
Cloud saves with the same name (`file1`, `file2`…) are replaced by the PC's copies. To bring back a single save instead, use [Import](/play/save-files#import-a-save) in the game.
:::

## Run a fixed version of the toolkit

The command always runs the latest toolkit. To use a specific tag or branch, set `RWK_REF` first:

```powershell
$env:RWK_REF = "v1.0.0"   # a tag or branch name
irm https://raw.githubusercontent.com/Kokoroou/rpgmaker-web-toolkit/main/run.ps1 | iex
```

See [Commands](/reference/commands) for everything the toolkit can do.
