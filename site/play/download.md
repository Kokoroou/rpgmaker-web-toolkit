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
| **Download game (folder)** | Writes the whole build into a new folder named after the game, inside the place you pick, with a launcher that plays it on its own | Chrome, Edge or Brave, and a game deployed with this toolkit version. On unless the site is set up with [`"download": { "folder": false }`](/reference/config) |
| **Download game (ZIP)** | Downloads the whole build as one archive | A site set up with [`"download": { "zip": true }`](/reference/config) |

## Download game (folder)

1. Open **⚙ → Share → Download game (folder)**.
2. Choose where to save (any folder, such as your Desktop or `Games`), and give the browser permission to write there. The toolkit makes a new folder inside it named after the game — `My Game` for a game titled *My Game* — and writes the build there, so it never mixes with what the folder already holds.
3. Confirm the number of files and the size, and whether to copy your cloud saves too (see below). Then wait. Keep the page open while it runs; the game pauses meanwhile.
While it runs the window has **Hide** and **Cancel**. **Hide** puts the toolkit away but keeps the download going: a small pill at the top-left shows the percentage and a spinner, and tapping it brings the window back. When every file has arrived the pill reads 100%, waits five seconds, and then goes. **Cancel** stops the download.

### What the folder holds

The folder has the **same layout as a desktop copy of the game**, which differs between the two engines. The web build (exactly as the site serves it) goes where that engine's desktop game keeps it, and the saves go where that engine writes them. So the folder can be dropped beside or over a desktop game's files, and [`rwk deploy`](/reference/commands) can publish it again like any game.

::: code-group
```text [MZ]
My Game/
├── index.html      the whole web build, as beside an MZ game's Game.exe
├── js/  data/  img/  audio/  …
├── save/           this copy's saves, when you play it (see below)
├── Game.bat        Windows: double-click to play
├── Game.command    macOS: double-click to play
├── Game.sh         Linux: run "sh Game.sh"
├── rwk-serve.mjs   the small server the launchers use
└── README.txt
```

```text [MV]
My Game/
├── www/            the whole web build, as beside an MV game's Game.exe
│   ├── index.html
│   ├── js/  data/  img/  audio/  …
│   └── save/       this copy's saves, when you play it (see below)
├── Game.bat        Windows: double-click to play
├── Game.command    macOS: double-click to play
├── Game.sh         Linux: run "sh Game.sh"
├── rwk-serve.mjs   the small server the launchers use
└── README.txt
```
:::

An MZ game downloaded with an older toolkit version has its build in `www/`. Download it again into the same place: the build now goes at the top of the folder, and the confirmation says the old `www/` can be deleted.

### Playing it

**Double-click `Game.bat` (Windows) or `Game.command` (macOS), or run `sh Game.sh` (Linux).** The launcher starts a small web server and opens the game in your browser. It needs [Node.js](https://nodejs.org) 18 or newer, or Python 3 — either one is enough. `README.txt` says the same in the folder itself.

The game cannot run by opening `index.html` (MV: `www/index.html`) directly: RPG Maker loads its data and plugins with `XMLHttpRequest`, which a `file://` page cannot use, and the game shows a black screen. Any local web server does the same job — for example `npx serve` in the folder that holds `index.html`, or `python -m http.server`.

### Playing it without the site

The copy plays on its own: **no internet, no sign-in, no cloud**. Its saves are files in `save/` (MV: `www/save/`), and the launcher's server answers the game's save calls from that folder, so saving works exactly as on a desktop game.

Only Node.js does that: the Python fallback serves files but has no save API, so the game keeps its saves in the browser's storage there. If saving matters, install Node.js.

What the copy does not have, because it needs the site: cloud saves (there is one account per copy — yours, on this PC), the older copies of a save (⚙ → Saves → Older saves), and live translation. Play here, then copy a save over if you want to continue with your account.

⚙ → Saves → **Cloud saves** still says *In sync* in a downloaded copy: the line reports whether the saves are written, and here they go to `save/` (MV: `www/save/`) instead of the cloud. There is nothing to sign in to and no upload anywhere.

### Publishing it on a domain

Upload the build to the new domain: for **MZ**, the folder **without** `Game.bat`, `Game.command`, `Game.sh`, `rwk-serve.mjs` and `README.txt`; for **MV**, the **contents of `www/`** (or point the web root at `www/`). The launchers and `README.txt` are only for playing on this PC, and are not part of the build.

**Leave out `save/` (MV: `www/save/`)**, or this copy's saves go up with the game. Uploading with the toolkit instead is unaffected: `rwk deploy` never publishes a `save` folder.

### Your saves

`save/` (MZ) or `www/save/` (MV) holds one file per slot (`fileN.rmmzsave` for MZ, `fileN.rpgsave` for MV), written the way and in the place a desktop RPG Maker game writes them. Copy them into the desktop game's own save folder (the same path beside its `Game.exe`) to continue there, or copy that folder's saves in.

When the download included your cloud saves (the checkbox, ticked by default), they are written there too, so the copy starts with your progress.

The checkbox only appears when the game has cloud saves for your account. Leave it off to download only the build.

**Stopped, or the connection dropped?** Press **Start again** in the download window (or start **Download game (folder)** again) and choose the same place. The toolkit finds the folder it made, and a file already there with the same size is skipped, so only what is missing is fetched. Files you added to the folder yourself are left alone.

**A few files did not download?** The window names them, and the launchers are written anyway, so the game can already be played; **Start again** retries only those files. Empty files in the game (a plugin's blank `.ini`, for example) are created in the folder directly, without asking the site for them.

**Files ending in `.rwk-file`?** Chrome does not let a web page write some file names: on Windows, `.ini`, `.cfg`, `.dll`, `.manifest` and a few more, which some plugins ship. The download saves such a file as `<name>.rwk-file` and lists it in `rwk-renames.json`; `Game.bat` / `Game.sh` gives it its real name the first time it starts (with Node.js). Without Node.js, rename those files yourself by removing the `.rwk-file` ending.

::: tip Browsers
Only Chromium browsers (Chrome, Edge, Brave) offer this entry. Firefox and Safari have no File System Access API, so they cannot write into a folder you pick — and that is on purpose: this is a tool for a desktop, not a player feature. On those browsers the site shows no folder entry; the ZIP entry, when the site has one, works in any browser.
:::

## Download game (ZIP)

One file, `game-<site>.zip`, holding the same build. The site makes it when it is set up with [`"download": { "zip": true }`](/reference/config), because it keeps a second copy of the game in Cloudflare's storage; the folder download keeps nothing there. The game's own files are exactly what the site serves; saves are not in the archive (they live in the cloud, under your email).

::: warning Who may do this
This is redistribution of the game. Downloading it for your own use, or to work on the game you publish, is what the feature is for. Handing the build to someone who does not own the game is not.
:::
