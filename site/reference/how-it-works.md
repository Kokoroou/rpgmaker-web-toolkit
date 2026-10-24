# How it works

```
run.ps1 ─► cli/            Node CLI: analyzes the game, builds a temporary web build, drives wrangler
           runtime/        Plugins injected into the web build (appended to the build's js/plugins.js)
             RWK_Core            config, device id, toasts, dialogs, ⚙ tools menu
             RWK_SaveSync        save sync (MZ: localforage, MV: localStorage)
             RWK_MobileControls  on-screen buttons
             RWK_SaveTools       save export / import / delete
             RWK_ItemBatch       use several items at once
           worker/         One Worker shared by every game
             index.js            static files + large files from R2 (with Range) + /api
             auth.js             verifies Cloudflare Access logins
             saves.js            save API, with overwrite protection
```

## The build

The CLI never writes into the game folder. Each run:

1. Picks the files of the web build (the standard RPG Maker folders, `include`, minus `exclude`).
2. Creates a temporary folder on the same drive as the game (`<drive>:\.rwk-build\`) and **hard-links** the files into it, so even a several-GB game takes no extra space. On another drive it copies instead.
3. Adds the toolkit's plugins to the build's own copy of `js/plugins.js`.
4. Uploads files over 25 MiB to R2, comparing hashes so unchanged files are skipped.
5. Deploys the Worker with the rest as static files. Wrangler also uploads only the files that changed.
6. Deletes the temporary folder.

## Storage

Static files live in **Workers Static Assets**: free, with unmetered bandwidth. Only files over 25 MiB go to R2. All games share one R2 bucket, `rpgmaker-web-toolkit`:

```
rwk/games.json                       settings of every game (keyed by fingerprint)
assets/<slug>/<path>                 files over 25 MiB
assets/<slug>/.rwk-manifest.json     hashes of those files, so only changed ones are re-uploaded
saves/<sha256(email)>/<slug>/<name>  saves (config, global, file1…)
```

Saves are stored under a hash of the player's email, never the email itself.

## Save sync

- When the game boots, before the engine reads any save, the plugin compares local saves with the cloud copies and takes the newer one. If a save changed in both places, the player chooses which copy to keep.
- Each time the game writes a save, the plugin uploads it about a second later, with `If-Match`, so it never overwrites another device's changes without asking.
- Offline, saves stay on the device and upload once the connection is back.
- If another device saved within the last 5 minutes, the game warns the player.

## Security

- **Cloudflare Access** blocks every request at Cloudflare's edge, before it reaches the game.
- The Worker also verifies the Access login's signature itself, to know the player's email.
- Preview URLs are turned off, since they fall outside Access protection.
- Until Access is set up, the Worker answers every request with the *"This game is being set up"* page.
- The toolkit's Cloudflare login only has the permissions it needs, in its own profile.

## Roadmap

Planned work is in [docs/ROADMAP.md](https://github.com/Kokoroou/rpgmaker-web-toolkit/blob/main/docs/ROADMAP.md) on GitHub.
