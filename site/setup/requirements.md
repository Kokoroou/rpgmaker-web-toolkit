# Before you start

You need four things. The first deploy takes about 15 minutes, most of it in the Cloudflare dashboard. After that, updates are a single command.

## 1. A Windows PC

The toolkit runs from **PowerShell** on Windows. macOS and Linux are not supported yet.

You only need the PC to publish and update the game. Players open it in any browser, on any device.

## 2. Node.js 20 or newer

Install the LTS version from [nodejs.org](https://nodejs.org), or run this in PowerShell:

```powershell
winget install OpenJS.NodeJS.LTS
```

Close and reopen PowerShell afterwards, then check:

```powershell
node --version   # v20.x or newer
```

## 3. A Cloudflare account

A free account at [dash.cloudflare.com](https://dash.cloudflare.com/sign-up) is enough. Before the first deploy, turn on two things once:

### A workers.dev subdomain

Your games will live at `https://<game>.<subdomain>.workers.dev`.

1. Open the dashboard and go to **Workers & Pages**.
2. If it asks you to pick a subdomain, choose one (your username, for example).

If you skip this, the deploy stops with *"The account has no workers.dev subdomain yet"* and tells you where to go.

### R2 storage

R2 stores the saves, the game's settings and any file larger than 25 MiB.

1. Open **R2 Object Storage** in the dashboard.
2. Click to enable it. Cloudflare asks for a payment method even on the free tier (10 GB free per month). Normal use stays inside the free tier; see [Free plan limits](/reference/limits).

If R2 is not enabled yet, the toolkit notices, prints the link to the R2 page and waits for you.

## 4. The game

| Engine | Status |
|---|---|
| RPG Maker **MZ** | Supported and tested |
| RPG Maker **MV** | Supported, not yet tested on a real game |
| RPG Maker XP, VX, VX Ace, 2000, 2003 | Not supported (they are not web engines) |

Use the folder that contains `Game.exe`. The toolkit looks for `index.html` and a `js/` folder there, or in its `www/` subfolder (MV), so either folder works.

::: tip Encrypted games work as is
Games whose images and audio are encrypted (`.rpgmvp`, `.png_`, `.ogg_`…) work without any change: the browser build reads them the same way the desktop game does.
:::

**Next:** [First deploy](/setup/first-deploy)
