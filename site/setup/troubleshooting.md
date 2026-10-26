# Troubleshooting

Full error details: set `$env:RWK_DEBUG = "1"` in PowerShell (`export RWK_DEBUG=1` on macOS / Linux), then run the command again.

## Running the command

| Message | Fix |
|---|---|
| `Node.js 22 or newer is required` | [Install Node.js](/setup/requirements), then **close and reopen** PowerShell or Terminal |
| `npm ci failed` | A network problem. Run again, or try another network than a company one |
| `Folder not found` | Drag the folder into the window instead of typing the path |
| `No index.html + js/ in …` | Use the folder with `Game.exe` (or its `www/`). XP / VX / VX Ace are not supported |
| `Unknown engine` | Only MZ (`js/rmmz_core.js`) and MV (`js/rpg_core.js`) games work |
| `The game's creator does not allow publishing this game as a website` | The game's [`rwk-policy.json`](/creators/policy) says so. Play the desktop version, or ask the creator (contact printed above) |

## Cloudflare

| Message | Fix |
|---|---|
| `R2 is not enabled for this account` | Open the printed link, enable R2, choose **Yes, try again** |
| `The account has no workers.dev subdomain yet` | Dashboard → **Workers & Pages** → pick a subdomain, run again |
| Logged in to the wrong account | `npx wrangler auth delete rpgmaker-web-toolkit`, run again. Other account, same login: delete `%APPDATA%\rpgmaker-web-toolkit\settings.json` |

## Uploading

| Message | Fix |
|---|---|
| `The web build has N files, over the Workers limit of 20000` | [Exclude](/setup/configuration#common-changes) what players don't need (the message lists the biggest folders) |
| A file over about 300 MiB fails | The upload tool's limit. Exclude it if the game works without it (usually a movie) |
| `Hard links were not possible… files were copied` | Not an error: slower, and uses temporary disk space |

## Access

| Message | Fix |
|---|---|
| The page says *This game is being set up* | Access is not finished. Run the deploy again and [turn on Access](/setup/access#turn-on-access) |
| `The site is not protected by Access yet` | Check that the Worker's **Access** page says **All traffic** (not **Previews only**), wait a minute, **Check again**, or enter the team domain and AUD manually |
| `Cloudflare Access is NO LONGER protecting the site!` | Worker → **Access**: [turn Access back on](/setup/access#turn-on-access), scope **All traffic** |
| `N different emails have saves for this game` | A reminder: sharing a copy is redistribution. Remove emails from the [policy](/setup/access#invite-players) (removed ones still count) |
| A friend never gets the code | Their email is not allowed yet: [add it](/setup/access#invite-players) |

## In the game

| Problem | Fix |
|---|---|
| `Login expired: reload the page to sync saves` | Reload and sign in. Saves made meanwhile upload afterwards |
| `Offline: using this device's saves` | Keep playing; saves upload once back online |
| Saves gone after clearing browser data | With sync on, reload: they come back. Without it they are lost, so [export](/play/save-files#export) important ones |
| Black screen or an error | Does the desktop version show it too? If not, it comes from the web copy: [report it here](https://github.com/Kokoroou/rpgmaker-web-toolkit/issues) with the engine and the error, **not to the game's creator** |
