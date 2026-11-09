---
description: "Save a published RPG Maker game's web build to a folder on your PC, or as a ZIP, from ⚙ → Share → Download game. For the game's host."
lang: en
---

# Download game

**⚙ → Share → Download game** saves the complete web build of a game to your PC, to play it locally, look at its files or find a bug outside the browser. It shows only to the game's owner: the emails the site was set up with (and any the config adds under [`download`](/reference/config)). A player who was invited to play does not see it.

![⚙ → Share, with Download game (folder)](/img/tools-menu.png){.shot .portrait}

There are two entries, and which ones appear depends on the site:

| Entry | What it does | Needs |
|---|---|---|
| **Download game (folder)** | Writes every file straight into a folder you pick, as a second browser tab is not involved | Chrome, Edge or Brave, and a game deployed with this toolkit version |
| **Download game (ZIP)** | Downloads the whole build as one archive | A site set up with [`"download": { "zip": true }`](/reference/config) |

## Download game (folder)

1. Open **⚙ → Share → Download game (folder)**.
2. Choose the folder to write into (create a new one, such as `My Game Web`), and give the browser permission to write there.
3. Confirm the number of files and the size, then wait. Keep the page open while it runs; the game pauses meanwhile.

Every file is fetched from the site itself and written to the same path it has on the site, so the folder holds the same build the site serves: `index.html`, `js/`, `data/`, `img/`, `audio/`, and so on. Opening `index.html` from that folder in a browser plays the game from the local copy.

**Stopped, or the connection dropped?** Start **Download game (folder)** again and choose the same folder. A file already there with the same size is skipped, so only what is missing is fetched. Files you added to the folder yourself are left alone.

::: tip Browsers
Only Chromium browsers (Chrome, Edge, Brave) offer this entry. Firefox and Safari have no File System Access API, so they cannot write into a folder you pick — and that is on purpose: this is a tool for a desktop, not a player feature. On those browsers the site shows no folder entry; the ZIP entry, when the site has one, works in any browser.
:::

## Download game (ZIP)

One file, `game-<site>.zip`, holding the same build. The site makes it when it is set up with [`"download": { "zip": true }`](/reference/config), because it keeps a second copy of the game in Cloudflare's storage; the folder download keeps nothing there. The game's own files are exactly what the site serves; saves are not in the archive (they live in the cloud, under your email).

::: warning Who may do this
This is redistribution of the game. Downloading it for your own use, or to work on the game you publish, is what the feature is for. Handing the build to someone who does not own the game is not.
:::
