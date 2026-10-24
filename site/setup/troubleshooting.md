# Troubleshooting

To see full error details, run with `RWK_DEBUG` set:

```powershell
$env:RWK_DEBUG = "1"
irm https://raw.githubusercontent.com/Kokoroou/rpgmaker-web-toolkit/main/run.ps1 | iex
```

## Running the command

### "Node.js 20 or newer is required"

Install Node.js ([Before you start](/setup/requirements#_2-node-js-20-or-newer)), then **close and reopen** PowerShell so it finds the new `node`.

### "npm ci failed"

Usually a network problem while downloading the toolkit's dependencies. Run the command again. Behind a company proxy or firewall, try another network.

### The game is not recognized

| Message | Fix |
|---|---|
| `Folder not found` | Drag the folder into the window again rather than typing the path |
| `No index.html + js/ in …` | Use the folder that contains `Game.exe` (or its `www` subfolder). XP, VX and VX Ace games are not supported |
| `Unknown engine` | Only MZ (`js/rmmz_core.js`) and MV (`js/rpg_core.js`) games are supported |

### "The game's creator does not allow publishing this game as a website"

The game ships an `rwk-policy.json` with `"hosting": "none"`. The toolkit respects it and stops. Play the desktop version, or ask the creator (the contact is printed above the error). See [Hosting policy](/creators/policy).

## Cloudflare

### "R2 is not enabled for this account"

Open the link the toolkit prints, enable R2 (a payment method is required even on the free tier), then choose **Yes, try again**.

### "The account has no workers.dev subdomain yet"

In the dashboard, open **Workers & Pages** and register a subdomain, then run again.

### Logged in with the wrong account

Remove the toolkit's login and run again; it asks you to log in:

```powershell
npx wrangler auth delete rpgmaker-web-toolkit
```

To pick another account from the same login, delete `%APPDATA%\rpgmaker-web-toolkit\settings.json`.

## Uploading

### "The web build has N files, over the Workers limit of 20000"

The message lists the folders with the most files. Leave out what players don't need with `exclude` ([Leave files out](/setup/configuration#leave-files-out)), for example an unused translation (`data-tw/**`).

### A file over about 300 MiB fails to upload

Large files go to R2, and the upload tool used by the toolkit is limited to about 300 MiB per file. Such files are rare (usually a movie); leave it out with `exclude` if the game works without it.

### "Hard links were not possible… files were copied"

Not an error. The toolkit could not create its temporary folder on the game's drive, so it copied the files instead. It takes longer and uses temporary disk space.

## Access protection

### The page says "This game is being set up"

Access protection is not finished, so the site is locked. Run the deploy command again and complete [Turn on Access](/setup/access#turn-on-access).

### "The site is not protected by Access yet"

Wait a minute after turning Access on, then choose **Check again**. If it keeps failing, enter the team domain and AUD manually ([how](/setup/access#turn-on-access)).

### "Cloudflare Access is NO LONGER protecting the site!"

Access was turned off in the dashboard. Turn it on again: the game's Worker → **Settings** → **Domains & Routes** → **workers.dev** row.

### "N different emails have saves for this game"

A reminder, not an error: sharing your copy with many people is redistribution of the game. Remove emails you did not mean to allow from the Access policy ([Invite players](/setup/access#invite-players)). The count includes every email that ever saved, so a removed email still counts.

### A friend cannot sign in or never gets the code

Their email is not in the application's policy. Add it ([Invite players](/setup/access#invite-players)). Cloudflare does not send a code to emails that are not allowed.

## In the game

### "Login expired: reload the page to sync saves"

The Access login ran out. Reload the page and sign in again. Saves made meanwhile are kept on the device and upload after the reload.

### "Offline: using this device's saves"

The device has no connection. Play normally; saves upload when it is back online. See [Saves on several devices](/play/saves).

### The game shows a black screen or an error

Check that the desktop version works with the same files. Then reload the page; if the error mentions a plugin, that plugin may not support browsers. Report it on [GitHub Issues](https://github.com/Kokoroou/rpgmaker-web-toolkit/issues) with the game's engine and the error text.

If the desktop version does not have the error, it comes from the web copy, so report it here and **not to the game's creator**. The error screen says so too.

### Saves disappeared after clearing the browser data

With cloud sync on, reload the page: the saves come back from the cloud. Without sync, saves only live in the browser and are lost when its data is cleared. Export important saves with [Saves](/play/save-files#export-a-save).
