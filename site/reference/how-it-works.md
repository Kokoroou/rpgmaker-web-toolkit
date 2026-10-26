---
description: "How rpgmaker-web-toolkit works: the CLI analyzes the game, builds a web copy, deploys a shared Worker, serves files, checks Access and syncs saves."
lang: en
---

# How it works

```
run.ps1 ─► cli/            Node CLI: analyzes the game, builds a temporary web build, drives wrangler
           runtime/        Plugins injected into the web build (appended to the build's js/plugins.js)
             RWK_Core            config, device id, toasts, dialogs, ⚙ menu, web build label
             RWK_SaveSync        save sync (MZ: localforage, MV: localStorage)
             RWK_MobileControls  on-screen buttons, driven through Input._currentState
             RWK_SafeSaves       quick save / load and autosave in slots of their own, ☁ sync state, storage.persist()
             RWK_Speed           fast forward: the scene updates 2–4 times per frame
             RWK_Message         message modes: tap to finish, Auto, Skip (Window_Message)
             RWK_Backlog         message backlog: last messages kept in memory, shown in a panel (Window_Message.startMessage)
             RWK_Dash            always dash switch (ConfigManager.alwaysDash)
             RWK_SaveTools       save export / import / delete (desktop save file format)
             RWK_SaveHistory     older saves from the cloud: list and restore
             RWK_ItemBatch       use several items at once (MZ / MV adapter for the common event queue)
             RWK_Cheats          cheats, off by default: party, gold and items, win a battle, switches and variables, movement
                                 (god mode: Game_Actor.setHp; walk through walls: Game_Player.isDebugThrough)
             RWK_Report          problem report: latest errors, audio state, files that failed to load
           worker/         One Worker shared by every game
             index.js            static files + large files from R2 (with Range) + /api, each player's settings
             auth.js             verifies Cloudflare Access logins (JWT)
             saves.js            save API, with ETag overwrite protection, and save history
             players.js          counts the emails that save, for the deploy's reminder
             toolkit.js          the toolkit's part of js/plugins.js; serves a newer toolkit after upgrade
             settings.js         the deployer's settings from R2, so config edit applies without a redeploy
```

## The build

The game folder is never written to. Each run:

1. Picks the files: the standard RPG Maker folders, plus `include`, minus `exclude`.
2. **Hard-links** them into `<game drive>:\.rwk-build\` (no extra disk space; copies on another drive).
3. Adds the plugins to the build's copy of `js/plugins.js` and marks `index.html` with `<meta name="generator" content="rpgmaker-web-toolkit">`. Unless a public site asked to be listed: a `noindex` meta tag, `X-Robots-Tag: noindex` and a `robots.txt`.
   Also writes `rwk-sw.js`, a Service Worker that keeps the pictures, sounds, data and scripts (each under 25 MiB) in the browser's Cache Storage, so a phone does not download them at every launch. It never touches `/api/`. A new deploy lists each file's version (size and modified time); on the next launch after all tabs of the game close, the worker drops only the files that changed. Players see what it holds, and can empty it, in ⚙ → **Game files on this device**. Turn it off with [`cache`](/reference/config).
4. Uploads files over 25 MiB to R2, skipping unchanged ones by hash. The limits come from [`cli/limits.json`](/reference/limits#when-cloudflare-changes-them), downloaded from `main` on each run.
5. Deploys the Worker with the rest as static files (wrangler also uploads only changes).
6. Deletes the build folder.

## Settings per player

The shared settings are written into `js/plugins.js` at build time. A config with [`players`](/setup/configuration#settings-for-one-player) also gives the Worker a table `{ <hash of the email>: <settings that differ> }` (`player-settings.json` next to `worker.js`), and routes `js/plugins.js` through the Worker. For each request of that file, the Worker verifies the Access login, looks up the hash, and merges that player's settings into the `RWK_Core` config it sends, with `Cache-Control: private, no-cache`. No login, or no entry: the file as built. `GET /api/config` returns the same entry, and the save API applies the player's `saveHistory`.

## Settings without a redeploy

Each deploy, and each `config edit` after it, also writes the settings to R2 as `rwk/settings/<game>.json`: `{ "config": <everyone's RWK_Core settings>, "players": <the table above> }`. The `config` part leaves out what the build itself is made of (toolkit version, game id, engine, `cache`, MV's media flags). The Worker always runs first for `js/plugins.js`: it reads that file (at most once every 30 seconds per Worker instance), puts `config` and then the player's own entry over the `RWK_Core` config it sends, and the save API takes `saveHistory` from it. The file wins over what the deploy built in; without one (R2 unreachable on the first read, or a game last deployed before this), the Worker uses the build's own settings. The creator's [policy](/creators/policy) is applied before the file is written, so it still wins.

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
saves/<sha256(email)>/<slug>/<name>  saves (config, global, file1…)
history/<sha256(email)>/<slug>/<name>/<time>
                                     older copies of those saves (not config and global)
rwk/players/<slug>.json              hashes of the emails that saved, with the first save time
```

`<slug>` is the site name the game was first deployed under (`storageId` after a [rename](/setup/updating#change-the-site-address)), so a rename moves nothing.

Saves are stored under a hash of the email, never the email itself.

## Save sync

At boot, before the engine reads a save, the plugin keeps the newer of each local / cloud pair and asks when both changed. Each save uploads about a second later with `If-Match`, so it never silently overwrites another device. What players see: [Saves on several devices](/play/saves).

Before the Worker overwrites or deletes a save, it copies the old one to `history/`: at most once per 15 minutes per save, unless another device or a delete replaces it. It then drops copies past `saveHistory` (`keep` per save, `days` old). Restoring copies one back over the save, after keeping the save it replaces.

## Security

- **Cloudflare Access** blocks requests at Cloudflare's edge; the Worker also checks the login's signature to learn the email.
- Until Access is set up, every request gets the [*being set up*](/setup/first-deploy#lock-protect-play) page.
- Preview URLs are off (they bypass Access).
- The Cloudflare login has only the permissions it needs, in its own wrangler profile.

A game's [`rwk-policy.json`](/creators/policy) is read on every run and can stop the deploy, keep the site private or turn features off.

Planned work: [ROADMAP.md](https://github.com/Kokoroou/rpgmaker-web-toolkit/blob/main/docs/ROADMAP.md). Working on the toolkit: [CONTRIBUTING.md](https://github.com/Kokoroou/rpgmaker-web-toolkit/blob/main/CONTRIBUTING.md).
