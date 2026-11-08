---
description: "How rpgmaker-web-toolkit works: the CLI analyzes the game, builds a web copy, deploys a shared Worker, serves files, checks Access and syncs saves."
lang: en
---

# How it works

## The pieces

![Four layers. The player's device holds the game with the RWK plugins, a Service Worker and Cache Storage, and the local saves. Requests pass Cloudflare Access, then reach one Worker (index.js, auth.js, saves.js, players.js, settings.js, toolkit.js), which reads Static Assets and one R2 bucket.](/img/architecture-light.svg){.diagram .light-only}
![Four layers. The player's device holds the game with the RWK plugins, a Service Worker and Cache Storage, and the local saves. Requests pass Cloudflare Access, then reach one Worker (index.js, auth.js, saves.js, players.js, settings.js, toolkit.js), which reads Static Assets and one R2 bucket.](/img/architecture-dark.svg){.diagram .dark-only}

In words, top to bottom:

- **The player's device.** The game runs with the `RWK_*` plugins added to its `js/plugins.js`. A Service Worker (`rwk-sw.js`) answers requests for pictures, sounds, data and scripts from Cache Storage, and for the page itself when there is no connection. Saves live in the browser first (localforage on MZ, `localStorage` on MV), and `RWK_SaveSync` mirrors them to the cloud.
- **Cloudflare Access.** It sits in front of the site and lets in only the emails you invited. It adds a signed login (a JWT) to each request.
- **One Worker.** `index.js` routes the request. `auth.js` checks the login's signature and reads the email. `saves.js` is the save API and the save history. `players.js` counts the emails that saved. `settings.js` reads the settings from R2, and `toolkit.js` serves the toolkit's part of `js/plugins.js`.
- **Storage.** Static Assets hold the game files under 25 MiB. One R2 bucket holds the larger files, the saves and their history, the settings and the list of players (details in [Storage](#storage)).

The same Worker serves every game you deploy; each game has its own site name and its own folders in R2.

## What a deploy does

![The creator's PC: the CLI reads the game folder without writing to it, makes a temporary build of hard links plus the RWK plugins and the Service Worker file, and hands it to wrangler. Cloudflare receives the Worker with static assets, files over 25 MiB in R2, and the settings file in R2.](/img/deploy-light.svg){.diagram .light-only}
![The creator's PC: the CLI reads the game folder without writing to it, makes a temporary build of hard links plus the RWK plugins and the Service Worker file, and hands it to wrangler. Cloudflare receives the Worker with static assets, files over 25 MiB in R2, and the settings file in R2.](/img/deploy-dark.svg){.diagram .dark-only}

In words: the CLI analyzes the game folder and never writes to it. It builds a temporary copy (hard links, plus the plugins and `rwk-sw.js`), then sends three things to Cloudflare: the Worker with the other files as static assets, the files over 25 MiB to R2, and the settings as a JSON file in R2. The temporary copy is deleted at the end. [The build](#the-build) lists each step.

## First load and save sync

![Sequence between the browser, Access, the Worker and R2. First load: the site opens, Access asks for a login and sets a signed cookie, the Worker serves the page and the game files (large ones from R2), and adds this player's settings to js/plugins.js. Save sync: the plugin lists the saves, keeps the newer copy of each, and uploads a save with If-Match; the Worker keeps the old save in history and answers with a new ETag, or 412 when another device changed it.](/img/sequence-light.svg){.diagram .light-only}
![Sequence between the browser, Access, the Worker and R2. First load: the site opens, Access asks for a login and sets a signed cookie, the Worker serves the page and the game files (large ones from R2), and adds this player's settings to js/plugins.js. Save sync: the plugin lists the saves, keeps the newer copy of each, and uploads a save with If-Match; the Worker keeps the old save in history and answers with a new ETag, or 412 when another device changed it.](/img/sequence-dark.svg){.diagram .dark-only}

In words: the first request is stopped by Access, which asks the player to sign in and sets a cookie. After that the Worker serves the page and game files, and reads `js/plugins.js` with the settings from R2 merged in ([Settings per player](#settings-per-player)); the Service Worker starts keeping files for the next launch. At boot, before the engine reads a save, the plugin lists the cloud saves and keeps the newer of each local / cloud pair, asking when both changed. A save then uploads about a second after it is written, with `If-Match`; the Worker keeps the old copy in the history and answers with a new ETag, or `412` when another device changed it first ([Save sync](#save-sync)).

These pictures are drawn by `site/diagrams/build.mjs` (run `node site/diagrams/build.mjs`, no dependencies); edit that file when the architecture changes, and commit the SVGs it writes to `site/public/img/`.

## Files

```
run.ps1 ─► cli/            Node CLI: analyzes the game, builds a temporary web build, drives wrangler
           runtime/        Scripts injected into the web build
             rwk-guard.js        loaded from index.html before the game's plugins: the game's own listeners skip taps and keys, and the page gets the `process` object NW.js has
                                 meant for the toolkit's buttons and dialogs
             RWK_Core            config, device id, toasts, dialogs, ⚙ menu, web build label
             RWK_Language        ⚙ → Language: points data/ requests (XMLHttpRequest) at data-<code>/ files, file by file
             RWK_Translate       live translation, off by default: messages wait in Window_Message.canStart for /api/translate,
                                 control codes kept; item / skill names in $data*; a full Vietnamese font
             RWK_SaveSync        save sync (MZ: localforage, MV: localStorage)
             RWK_MobileControls  on-screen buttons, driven through Input._currentState
             RWK_SafeSaves       quick save / load and autosave in slots of their own, ☁ sync state, storage.persist()
             RWK_Speed           fast forward: the scene updates 2–4 times per frame
             RWK_Message         message modes: tap to finish, Auto, Skip (Window_Message)
             RWK_Backlog         message backlog: last messages kept in memory, shown in a panel (Window_Message.startMessage)
             RWK_Dash            always dash switch (ConfigManager.alwaysDash)
             RWK_Remap           key and gamepad remapping: edits Input.keyMapper / Input.gamepadMapper, choices in localStorage
             RWK_SaveTools       save export / import / delete (desktop save file format)
             RWK_SaveHistory     older saves from the cloud: list and restore
             RWK_ItemBatch       use several items at once (MZ / MV adapter for the common event queue)
             RWK_Cheats          cheats, off by default: party, gold and items, win a battle, switches and variables, movement
                                 (god mode: Game_Actor.setHp; walk through walls: Game_Player.isDebugThrough)
             RWK_Lens            ⚙ → Share → MakerLens link: the owner makes and stops read-only links (/api/lens)
             RWK_Offline         ⚙ → Play offline: downloads every file in the Service Worker's list into its cache, resumable
             RWK_Report          problem report: latest errors, audio state, files that failed to load
           worker/         One Worker shared by every game
             index.js            static files + large files from R2 (with Range) + /api, each player's settings
             auth.js             verifies Cloudflare Access logins (JWT)
             saves.js            save API, with ETag overwrite protection, and save history
             players.js          counts the emails that save, for the deploy's reminder
             toolkit.js          the toolkit's part of js/plugins.js, and the guard in index.html; serves a newer toolkit after upgrade
             settings.js         the deployer's settings from R2, so config applies without a redeploy
             lens.js             /_lens/* read-only files for MakerLens (share token) and /api/lens for the owner
             download.js         /api/download: the build's ZIP from R2, for the host only
             translate.js        POST /api/translate: Workers AI (env.AI), each line kept in R2, a daily character cap
```

## The build

The game folder is never written to. Each run:

1. Picks the files: the standard RPG Maker folders, plus `include`, minus `exclude`.
2. **Hard-links** them into `<game drive>:\.rwk-build\` (no extra disk space; copies on another drive).
3. Adds the plugins to the build's copy of `js/plugins.js`, loads `js/rwk-guard.js` from `index.html` before them, and marks the page with `<meta name="generator" content="rpgmaker-web-toolkit">`. Unless a public site asked to be listed: a `noindex` meta tag, `X-Robots-Tag: noindex` and a `robots.txt`.
   The guard also gives the page a `process` object, which NW.js (the game's own `Game.exe`) always has. A game plugin that reads `process.versions` at the top level throws in a browser, and the rest of its file never runs — a plugin that draws a HUD, or patches the menu, silently disappears. The object is not a Node.js one: no `require`, and no `versions["node-webkit"]`, so `Utils.isNwjs()` stays false and the plugins that open files on the desktop still skip that part in a browser.
   Also writes `rwk-sw.js`, a Service Worker that keeps the pictures, sounds, data and scripts (each under 25 MiB) in the browser's Cache Storage, so a phone does not download them at every launch. It never touches `/api/`. A new deploy lists each file's version (size and modified time); on the next launch after all tabs of the game close, the worker drops only the files that changed. Players see what it holds, and can empty it, in ⚙ → **Help** → **Game files on this device**. Turn it off with [`cache`](/reference/config).

   The worker also lists the files over 25 MiB (a second list, `LARGE`, from R2). It never stores those on its own: only ⚙ → [Play offline](/play/offline) does. `RWK_Offline` asks the worker for the list over a message channel, compares it with the keys in the cache, and downloads what is missing, three files at a time, with a request header that makes the worker leave them alone. It counts bytes through a `TransformStream`, so a big file moves the bar while it downloads, and stores each file only after a plain 200 from this site (never a login page Access redirected to). `index.html`, `js/plugins.js` and `rwk.webmanifest` are answered from the network first and the cache when there is none (or after 4 seconds), so an installed copy opens offline. A cached file answers a `Range` request with a 206 (movies, streamed audio). `rwk.webmanifest` carries the icon's real size, `scope` and `display: fullscreen`, which is what lets a browser offer to install the game.
4. Uploads files over 25 MiB to R2, skipping unchanged ones by hash. The limits come from [`cli/limits.json`](/reference/limits#when-cloudflare-changes-them), downloaded from `main` on each run.
5. Makes the build's ZIP (`cli/lib/zip.js`) and uploads it to R2, unless the files it would hold are the ones the archive in R2 was made from. It is what the host downloads in ⚙ → **Share** → **Download game**.
6. Deploys the Worker with the rest as static files (wrangler also uploads only changes).
7. Deletes the build folder.

## Settings per player

The shared settings are written into `js/plugins.js` at build time. A config with [`players`](/setup/configuration#settings-for-one-player) also gives the Worker a table `{ <hash of the email>: <settings that differ> }` (`player-settings.json` next to `worker.js`), and routes `js/plugins.js` through the Worker. For each request of that file, the Worker verifies the Access login, looks up the hash, and merges that player's settings into the `RWK_Core` config it sends, with `Cache-Control: private, no-cache`. No login, or no entry: the file as built. `GET /api/config` returns the same entry, and the save API applies the player's `saveHistory`.

## Settings without a redeploy

Each deploy, and each `config` after it, also writes the settings to R2 as `rwk/settings/<game>.json`: `{ "config": <everyone's RWK_Core settings>, "players": <the table above> }`. The `config` part leaves out what the build itself is made of (toolkit version, game id, engine, `cache`, MV's media flags). The Worker always runs first for `js/plugins.js`: it reads that file (at most once every 30 seconds per Worker instance), puts `config` and then the player's own entry over the `RWK_Core` config it sends, and the save API takes `saveHistory` from it. The file wins over what the deploy built in; without one (R2 unreachable on the first read, or a game last deployed before this), the Worker uses the build's own settings. The creator's [policy](/creators/policy) is applied before the file is written, so it still wins.

## Update from the link

[`upgrade`](/setup/updating#new-toolkit-version-game-folder-gone) works without the game folder. Cloudflare cannot hand back a Worker's static files, and `wrangler deploy` always replaces all of them. So the CLI calls the Workers API itself: `PATCH /accounts/{id}/workers/workers/{name}/versions/latest?deploy=true` creates a new version from the latest one, and every field the patch leaves out (the static files among them) carries over.

The patch holds the new Worker, with the new `RWK_*.js` plugins inside it, and sets the asset routing so the Worker runs first for `js/plugins.js` and those plugins. The Worker serves the plugins itself and rewrites `js/plugins.js`: the game's own part stays, and the toolkit's part (after the `rpgmaker-web-toolkit` marker) is replaced. MV's phone audio / movie flags come from the deployed copy.

A script upload with `keep_assets: true` also keeps the files, but it keeps the old routing too, so the Worker never sees `js/plugins.js`.

`WORKERS_API` in `cli/lib/workers-api.js` records the endpoints and fields used, and the date they were checked. `scripts/check-workers-api.js` compares them with [Cloudflare's published OpenAPI schema](https://github.com/cloudflare/api-schemas). The [Workers API workflow](https://github.com/Kokoroou/rpgmaker-web-toolkit/actions/workflows/workers-api.yml) runs it every Monday. When something the command relies on has changed, it opens one issue (label `workers-api`) that mentions the repository owner, and stays quiet until that issue is closed; it closes the issue itself once the check passes again. At run time, an API error, or a `Deprecation` / `Sunset` header from Cloudflare, prints that date.

## Storage

Static files are **Workers Static Assets** (free, unmetered bandwidth). One R2 bucket, `rpgmaker-web-toolkit`, holds the rest:

```
rwk/games.json                       settings of every game (keyed by fingerprint)
assets/<slug>/<path>                 files over 25 MiB
assets/<slug>/.rwk-manifest.json     hashes of those files
assets/<slug>/rwk.zip                the whole web build, for the host's ⚙ → Share → Download game
assets/<slug>/rwk.zip.json           what that archive holds, so a deploy with no change skips it
saves/<sha256(email)>/<slug>/<name>  saves (config, global, file1…)
history/<sha256(email)>/<slug>/<name>/<time>
                                     older copies of those saves (not config and global)
rwk/players/<slug>.json              hashes of the emails that saved, with the first save time
rwk/translate/<model>/<from>-<to>/<sha256(text)>.txt
                                     live translations, shared by every game (one per line of text)
rwk/translate/usage/<day>.json       characters sent to Workers AI that day (UTC), for the daily cap
```

`<slug>` is the site name the game was first deployed under (`storageId` after a [rename](/setup/updating#change-the-site-address)), so a rename moves nothing.

Saves are stored under a hash of the email, never the email itself.

The archive is made by the CLI at deploy (`cli/lib/zip.js`), not by the Worker: reading a game's thousands of files from inside a Worker would use one subrequest per file, and the free plan allows 50 outside Cloudflare and 1,000 to its own services per request. It is one object, served with `Range`, so a dropped download resumes instead of starting again. A game deployed before this existed has no archive (the entry stays hidden) until it is deployed again. It follows the files in R2: a very large build counts against the free plan's 10 GB.

## Save sync

At boot, before the engine reads a save, the plugin keeps the newer of each local / cloud pair and asks when both changed. Each save uploads about a second later with `If-Match`, so it never silently overwrites another device. What players see: [Cloud saves](/play/saves).

Before the Worker overwrites or deletes a save, it copies the old one to `history/`: at most once per 15 minutes per save, unless another device or a delete replaces it. It then drops copies past `saveHistory` (`keep` per save, `days` old). Restoring copies one back over the save, after keeping the save it replaces.

## Look at the game in MakerLens

The game's owner can open the game in [MakerLens Assets and Events](https://makerlens.kokoroou.workers.dev/) while it stays private behind Access, from the game itself: **⚙ → Share → MakerLens link**. The entry shows only for the owner's emails.

- **Who is an owner.** The email of the Cloudflare account that deployed, plus the emails in the config's `"lens": { "owners": ["a@example.com"] }`. A player who was invited to play is not an owner, so cannot hand the game to someone who was not. `"lens": false` turns it off. Owners are written to the Worker at deploy as hashes (`RWK_LENS_OWNERS`); a public game (no Access) has none.
- **The link.** `https://makerlens.kokoroou.workers.dev/assets/#game=<site>&t=<token>`, for Assets and for Events. The token is after the `#`, so the browser never sends it to MakerLens or in a Referer; it goes only to your game's Worker, as `Authorization: Bearer`. It is shown once, when the link is made.
- **The token.** `<id>.<secret>`. R2 keeps only the SHA-256 of the secret, the expiry and the note (`rwk/lens/<game>/<id>.json`). The owner picks 1 hour to 30 days (a day by default), has up to 20 links at a time, and stops one from the same panel: the record is deleted and the Worker forgets that token at once.
- **What it opens.** Three routes, `/_lens/ping`, `/_lens/manifest` (names and sizes from `rwk-lens.json`, written at each deploy) and `/_lens/file/<path>`, which serves only `data/`, `img/`, `audio/` and `js/plugins.js` (large files from R2 too, with `Range`). It never opens the save API, the owner's API or any other file.
- **Access.** `/_lens` is the one path left outside the sign-in: `rwk deploy` creates a second Access application on `<site>/_lens` with a Bypass policy (the most specific path wins; the rest of the site stays protected). The token check in the Worker is then the only gate there. If the API token cannot make it, deploy prints the dashboard steps, and the panel warns when a new link cannot get through.
- **CORS** on `/_lens` is `*` without credentials: no cookie is involved, so the token, not the caller's origin, is what protects the files. The owner's API (`/api/lens`) needs the Access login and a JSON body, so another site cannot make links.
- A game deployed before this needs `rwk deploy` once more (it adds the file list, the owner list and the bypass); `rwk upgrade` alone adds the entry and the owner list but not the file list.

## Security

- **Cloudflare Access** blocks requests at Cloudflare's edge; the Worker also checks the login's signature to learn the email.
- Until Access is set up, every request gets the [*being set up*](/setup/first-deploy#lock-protect-play) page.
- Preview URLs are off (they bypass Access).
- The Cloudflare login has only the permissions it needs, in its own wrangler profile.

A game's [`rwk-policy.json`](/creators/policy) is read on every run and can stop the deploy, keep the site private or turn features off.

Planned work: [ROADMAP.md](https://github.com/Kokoroou/rpgmaker-web-toolkit/blob/main/docs/ROADMAP.md). Working on the toolkit: [CONTRIBUTING.md](https://github.com/Kokoroou/rpgmaker-web-toolkit/blob/main/CONTRIBUTING.md).
