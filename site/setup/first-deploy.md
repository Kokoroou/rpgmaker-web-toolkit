# First deploy

## Run the command

Open **PowerShell** (Start menu → type `PowerShell`) and paste:

```powershell
irm https://raw.githubusercontent.com/Kokoroou/rpgmaker-web-toolkit/main/run.ps1 | iex
```

When it asks for the game folder, **drag the folder into the window** and press Enter.

::: details Using cmd instead of PowerShell
```bat
powershell -NoProfile -ExecutionPolicy Bypass -c "irm https://raw.githubusercontent.com/Kokoroou/rpgmaker-web-toolkit/main/run.ps1 | iex"
```
:::

The script downloads the toolkit to a temporary folder, installs what it needs, runs, and deletes the temporary folder at the end. Nothing is installed permanently except a Cloudflare login and npm's download cache.

## What happens, step by step

### 1. Analyzing the game

The toolkit finds the engine (MZ or MV) and the game title. If it prints an error here, see [Troubleshooting](/setup/troubleshooting#the-game-is-not-recognized).

If the game's creator ships a [hosting policy](/creators/policy), the toolkit shows it here: what the creator allows, their message and contact, and the features they turned off.

### 2. Logging in to Cloudflare

The first time on a PC, a browser window opens to log in to Cloudflare and approve access. The toolkit only asks for these permissions:

| Permission | Used for |
|---|---|
| `account:read`, `user:read` | Finding your account and email |
| `workers:write`, `workers_scripts:write` | Publishing the game and using R2 |

The login is kept in its own profile, separate from any `wrangler login` you already have. If your login covers several Cloudflare accounts, pick the one to host on. The choice is remembered.

### 3. Answering a few questions

Only the first deploy of each game asks these. Press **Enter** to accept the suggested answer.

| Question | What to answer |
|---|---|
| **Site name** | Becomes `https://<name>.<subdomain>.workers.dev`. The suggestion comes from the folder name, without version numbers and tags like `[VH]`. Use lowercase letters, digits and `-`. |
| **Include "…" in the web build?** | Asked for each unusual folder in the game (`live2d`, `extra`…). Say **yes** if a plugin loads files from it, **no** for things like a manual or a soundtrack. |
| **Enable cloud save sync?** | **Yes** to continue on other devices. See [Saves on several devices](/play/saves). |
| **Add an on-screen gamepad for touch screens?** | **Yes** if anyone will play on a phone or tablet. |
| **Include the D-pad?** | **Yes**, unless the game is meant to be played by tapping the map. |
| **Button label for key "…"** | The toolkit lists the extra keys the game's plugins use (a quest log on `T`, for example) and what each is for. Type a short label, press Enter for the default, or type `-` to leave a key out. |

Your answers are stored in your Cloudflare account (R2), not on the PC, so you never answer them again, even from another computer. Change them later with [edit-config](/setup/configuration).

### 4. Uploading

The toolkit prepares a temporary copy of the game (hard links, so it takes no extra disk space on the same drive), uploads files over 25 MiB to R2, and publishes the rest. The first upload of a large game takes a while; later runs [upload only what changed](/setup/updating).

### 5. Protecting the site

The site is **locked** after the first upload: anyone who opens it sees *"This game is being set up"*. The toolkit then asks how to protect it. Choose **Cloudflare Access** and follow [Protect the site and invite players](/setup/access).

### 6. Uploading your existing saves

If the game folder has a `save/` folder with saves from the desktop version and sync is on, the toolkit offers to upload them. It asks for **the email you will sign in with** in the browser, since each email has its own saves.

### 7. Done

The last line prints the game's link:

```
Done! https://my-game.myname.workers.dev
```

Open it in a browser, sign in, and play. To play full screen on a phone, see [Open and play](/play/#add-it-to-the-home-screen).

## What stays on the PC

| What | Where | How to remove |
|---|---|---|
| The Cloudflare login | wrangler profile `rpgmaker-web-toolkit` | `npx wrangler auth delete rpgmaker-web-toolkit` |
| The chosen account | `%APPDATA%\rpgmaker-web-toolkit\settings.json` | Delete the file |
| npm download cache | npm's cache folder | Makes later runs faster; `npm cache clean --force` |

The temporary build folder (`<game drive>:\.rwk-build\`) is deleted at the end of each run.

**Next:** [Protect the site and invite players](/setup/access)
