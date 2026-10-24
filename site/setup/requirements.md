# Before you start

About 15 minutes the first time, mostly in the Cloudflare dashboard. After that, every update is one command.

| You need | |
|---|---|
| A **Windows** PC with PowerShell | Only to publish. Players use any browser, on any device |
| **Node.js 24+** | [nodejs.org](https://nodejs.org) (LTS), or `winget install OpenJS.NodeJS.LTS`, then reopen PowerShell |
| A free **Cloudflare** account | [Sign up](https://dash.cloudflare.com/sign-up), then turn on the two things below |
| The **game** folder | The one with `Game.exe` (or its `www/` subfolder) |

## In the Cloudflare dashboard

1. **Workers & Pages**: pick a *workers.dev subdomain* (your username, for example). Games live at `https://<game>.<subdomain>.workers.dev`.
2. **R2 Object Storage**: enable it. It holds saves, settings and files over 25 MiB. Cloudflare asks for a payment method even on the free tier; normal use stays free ([limits](/reference/limits)).

Forgot one? The deploy stops, prints the link and waits.

## Which games

| Engine | |
|---|---|
| RPG Maker **MZ** | Supported |
| RPG Maker **MV** | Supported |
| XP, VX, VX Ace, 2000, 2003 | Not supported (not web engines) |

Encrypted images and audio (`.rpgmvp`, `.png_`, `.ogg_`…) work as they are.

**Next:** [First deploy](/setup/first-deploy)
