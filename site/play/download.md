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
| **Download game (folder)** | Writes every file straight into a new folder named after the game, inside the place you pick | Chrome, Edge or Brave, and a game deployed with this toolkit version |
| **Download game (ZIP)** | Downloads the whole build as one archive | A site set up with [`"download": { "zip": true }`](/reference/config) |

## Download game (folder)

1. Open **⚙ → Share → Download game (folder)**.
2. Choose where to save (any folder, such as your Desktop or `Games`), and give the browser permission to write there. The toolkit makes a new folder inside it named after the game — `My Game` for a game titled *My Game* — and writes the build there, so it never mixes with what the folder already holds.
3. Confirm the number of files and the size, then wait. Keep the page open while it runs; the game pauses meanwhile.

While it runs the window has **Hide** and **Cancel**. **Hide** puts the toolkit away but keeps the download going: a small pill at the top-left shows the percentage and a spinner, and tapping it brings the window back. When every file has arrived the pill reads 100%, waits five seconds, and then goes. **Cancel** stops the download.

Every file is fetched from the site itself and written to the same path it has on the site, so the new folder holds the same build the site serves: `index.html`, `js/`, `data/`, `img/`, `audio/`, and so on.

**To play it, serve the folder over `http://`, do not open `index.html` by double-clicking it.** RPG Maker loads its data and plugins with `XMLHttpRequest`, which a `file://` page cannot use: Chrome and Edge block those requests, and the game shows a black screen. Any small local web server does it — for example `npx serve` or `python -m http.server` run inside the folder — then open the address it prints.

**Stopped, or the connection dropped?** Start **Download game (folder)** again and choose the same place. The toolkit finds the folder it made, and a file already there with the same size is skipped, so only what is missing is fetched. Files you added to the folder yourself are left alone.

::: tip Browsers
Only Chromium browsers (Chrome, Edge, Brave) offer this entry. Firefox and Safari have no File System Access API, so they cannot write into a folder you pick — and that is on purpose: this is a tool for a desktop, not a player feature. On those browsers the site shows no folder entry; the ZIP entry, when the site has one, works in any browser.
:::

## Download game (ZIP)

One file, `game-<site>.zip`, holding the same build. The site makes it when it is set up with [`"download": { "zip": true }`](/reference/config), because it keeps a second copy of the game in Cloudflare's storage; the folder download keeps nothing there. The game's own files are exactly what the site serves; saves are not in the archive (they live in the cloud, under your email).

::: warning Who may do this
This is redistribution of the game. Downloading it for your own use, or to work on the game you publish, is what the feature is for. Handing the build to someone who does not own the game is not.
:::
