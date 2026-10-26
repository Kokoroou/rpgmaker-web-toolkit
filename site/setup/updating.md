---
description: "Update a published RPG Maker web game after a patch or translation: copy the files over the game folder and run the same command. Saves are kept."
lang: en
---

# Update the game

## Install a patch or a translation

Copy it over the game folder, then run the [same command](/setup/first-deploy) on the same folder. Only changed files upload; players get the update on their next reload and keep their saves.

New plugin keys? The toolkit offers buttons for them.

::: warning MV games whose title changes
MV games are recognized by their title (MZ: by their game ID). If a translation changes it, the toolkit asks the first-deploy questions again: give the **same site name** to keep the link and saves.
:::

## From another PC

Install [Node.js](/setup/requirements), run the same command and log in to the **same Cloudflare account**. The settings come from your account: no questions.

## New toolkit version, game folder gone

Deleted the game from your PC? Paste the game's link instead of the folder:

```powershell
$rwk = [scriptblock]::Create((irm https://raw.githubusercontent.com/Kokoroou/rpgmaker-web-toolkit/main/run.ps1))
& $rwk update-from-link "https://my-game.alice.workers.dev"
```

(Or run the one-liner and paste the link when it asks for the folder.)

Log in to the **same Cloudflare account**. The toolkit finds the game from its link and updates the Worker and the in-game plugins (on-screen controls, save sync, the ⚙ menu…) to the new version. It uses the settings stored in your account, including what you changed with [`edit-config`](/setup/configuration). Players get the new version on their next reload and keep their saves.

What stays as it was:

- **The game files you uploaded.** Nothing is downloaded or uploaded from your PC. To install a patch or a translation, you need the game folder again.
- **`index.html`, `robots.txt` and the icon**, from the last deploy from the folder. A [public site](/setup/access) that changes whether search engines may list it needs a deploy from the folder.
- **Features the game's creator turned off** stay off. If its last deploy from the folder used a toolkit from before this command, every feature that was off then also stays off: deploy once from the folder to turn one back on.

The site must already be set up (Access, or public). This command calls the Cloudflare API directly instead of going through wrangler, because wrangler always replaces every file. If it fails with a Cloudflare API error, deploy from the game folder and [report it](https://github.com/Kokoroou/rpgmaker-web-toolkit/issues). The next deploy from the folder puts everything back the usual way.

## Upload desktop saves again

```powershell
$rwk = [scriptblock]::Create((irm https://raw.githubusercontent.com/Kokoroou/rpgmaker-web-toolkit/main/run.ps1))
& $rwk import-saves "D:\Games\My Game"
```

::: danger This overwrites cloud saves
Cloud saves with the same name (`file1`…) are replaced. For a single save, use [Import](/play/save-files#import) in the game instead.
:::

## Change the site address

```powershell
& $rwk rename "D:\Games\My Game"
```

It asks for the new site name, then deploys the game under it. Saves and [older saves](/play/saves#bring-back-an-older-save) carry over: nothing is copied.

1. With [Cloudflare Access](/setup/access), the new address needs it turned on again: the steps open in the browser, as on the first deploy. Emails you allowed on the old site must be allowed again.
2. Once the new site works, the toolkit deletes the old Worker, after asking: the old link stops working. Answer no to keep it a while; the next deploy asks again.
3. The old site's Access application stays in [Zero Trust](https://one.dash.cloudflare.com) → **Access controls** → **Applications**. Delete it there.

Players open the new link. On their devices, saves come from the cloud on the first visit; saves that were never uploaded (made offline) stay on the old address.

Other commands, and running a fixed toolkit version: [Commands](/reference/commands).
