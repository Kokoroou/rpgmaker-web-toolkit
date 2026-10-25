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
