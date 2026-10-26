---
description: "What you need to publish an RPG Maker game with the toolkit: a Windows PC, Node.js 22+, a free Cloudflare account and a payment method. About 15 minutes."
lang: en
---

# Before you start

About 15 minutes the first time, mostly in the Cloudflare dashboard. After that, every update is one command.

| You need | |
|---|---|
| A **Windows** PC with PowerShell | Only to publish. Players use any browser, on any device |
| **Node.js 22+** | [nodejs.org](https://nodejs.org) (LTS), or `winget install OpenJS.NodeJS.LTS`, then reopen PowerShell |
| A free **Cloudflare** account | With a workers.dev subdomain and R2 turned on: [Set up Cloudflare](/setup/cloudflare) |
| A **payment method** | Visa, Mastercard, PayPal… Cloudflare asks for one to turn on R2 and Access, even for free use: [what it costs](/setup/cloudflare#what-it-costs) |
| The **game** folder | The one with `Game.exe` (or its `www/` subfolder) |

## In the Cloudflare dashboard

New to Cloudflare? [Set up Cloudflare](/setup/cloudflare) goes through every step. Already have an account:

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

On phones, MV plays `.m4a` audio and `.mp4` movies. An MV game that ships only `.ogg` / `.webm` still plays them on phones whose browser supports those formats; the deploy warns about files that older iPhones cannot play.

**Next:** [Set up Cloudflare](/setup/cloudflare), or straight to the [First deploy](/setup/first-deploy) if your account is ready
