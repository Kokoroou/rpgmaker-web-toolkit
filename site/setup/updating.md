# Update the game

## Install a patch or a translation

Copy it over the game folder, then run the [same command](/setup/first-deploy) on the same folder. Only changed files upload; players get the update on their next reload and keep their saves.

New plugin keys? The toolkit offers buttons for them.

::: warning MV games whose title changes
MV games are recognized by their title (MZ: by their game ID). If a translation changes it, the toolkit asks the first-deploy questions again: give the **same site name** to keep the link and saves.
:::

## From another PC

Install [Node.js](/setup/requirements), run the same command and log in to the **same Cloudflare account**. The settings come from your account: no questions.

## Upload desktop saves again

```powershell
$rwk = [scriptblock]::Create((irm https://raw.githubusercontent.com/Kokoroou/rpgmaker-web-toolkit/main/run.ps1))
& $rwk import-saves "D:\Games\My Game"
```

::: danger This overwrites cloud saves
Cloud saves with the same name (`file1`…) are replaced. For a single save, use [Import](/play/save-files#import) in the game instead.
:::

Other commands, and running a fixed toolkit version: [Commands](/reference/commands).
