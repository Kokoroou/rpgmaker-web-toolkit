# rpgmaker-web-toolkit

Publish an **RPG Maker MZ** game (MV: adapter included, not yet tested) to **Cloudflare Workers on the free plan** with a single command:

- Play in a browser anywhere: `https://<game-name>.<username>.workers.dev`
- **Cloud save sync**: sign in with the same email and continue on any device
- **On-screen gamepad on phones** (D-pad, A/B/X/Y, L/R, like JoiPlay), plus buttons for the keys the game's plugins use (R, T, Q, E…)
- **Save export / import / delete**: download a save slot as a normal desktop save file, change it with any save editor, import it back, or delete a slot
- **Use several items at once**: pick a quantity in the item menu instead of using a stack one by one
- Advanced tools sit behind a single ⚙ button, so they don't crowd the screen
- Re-run as often as you like: later runs **upload only the files that changed** (handy for patches and translation updates)
- **The original game folder is never modified**, and no clone is needed: the toolkit runs from a temp folder and cleans up after itself

Windows only for now.

**User guide: https://kokoroou.github.io/rpgmaker-web-toolkit/** (setting up a game, inviting players, updating, playing on a phone, troubleshooting).

## Quick start

The only requirement is [Node.js](https://nodejs.org) 20+ (LTS, or `winget install OpenJS.NodeJS.LTS`).

Open **PowerShell** and paste:

```powershell
irm https://raw.githubusercontent.com/Kokoroou/rpgmaker-web-toolkit/main/run.ps1 | iex
```

The script asks for the game folder (drag and drop the folder into the window). It downloads the toolkit to a temp folder, installs wrangler, runs, then **deletes** the temp folder. From `cmd` instead of PowerShell:

```bat
powershell -NoProfile -ExecutionPolicy Bypass -c "irm https://raw.githubusercontent.com/Kokoroou/rpgmaker-web-toolkit/main/run.ps1 | iex"
```

On the first run the script will:

1. Open a browser to log in to Cloudflare (once per machine). The login asks only for `account:read`, `user:read`, `workers:write` and `workers_scripts:write`, and is kept in its own wrangler profile (`rpgmaker-web-toolkit`), separate from any `wrangler login` you already have.
2. Analyze the game (MZ/MV, plugins, special keys) and ask a few questions: site name, whether to enable save sync, a label for each on-screen button.
   The answers are stored **in R2** (`rwk/games.json` in the bucket), not on the machine.
3. Upload files larger than 25 MiB to R2, then deploy the Worker with all the game files.
4. Walk you through enabling **Cloudflare Access** (email login). Until it is enabled the site stays **locked** and nobody can open it.
5. Offer to upload the saves already on the machine (the `save/` folder) to the cloud.

When a patch comes out: copy it over the game folder and run the same command again. Only changed files are uploaded. If the new version uses new keys, the script offers to add buttons for them.

On another machine: download the game, run the same command and log in to the same Cloudflare account. The config comes from R2, so there are no questions to answer again.

What stays on the machine: the toolkit's wrangler profile (remove it with `npx wrangler auth delete rpgmaker-web-toolkit`), the chosen account (`%APPDATA%\rpgmaker-web-toolkit\settings.json`) and the npm cache (makes later runs faster). The build folder lives in `<game drive>:\.rwk-build\` so it can hard-link the game files instead of copying them, and it is deleted when the run ends.

### Other commands

To pass arguments, call the script as a scriptblock:

```powershell
$rwk = [scriptblock]::Create((irm https://raw.githubusercontent.com/Kokoroou/rpgmaker-web-toolkit/main/run.ps1))
& $rwk "D:\Games\My Game"                 # deploy without the path prompt
& $rwk import-saves "D:\Games\My Game"    # upload local saves again (overwrites same-name cloud saves)
& $rwk edit-config "D:\Games\My Game"     # edit the config (buttons, exclude…) in Notepad
& $rwk help
```

Set `$env:RWK_REF = "v1.0.0"` to run a fixed tag or branch instead of `main`.

When working on the toolkit itself, clone the repo and use `rwk.cmd` with the same commands.

## Game config (`edit-config`)

| Key | Meaning |
|---|---|
| `slug` | Worker name, becomes `<slug>.<username>.workers.dev` |
| `fingerprint` | Identifies the game on later runs (MZ: `advanced.gameId`, MV: game title) |
| `include` | Non-standard top-level folders/files to publish (e.g. `"live2d"`), or globs of files to keep despite the excludes (e.g. `"img/**/*.psd"`) |
| `exclude` | Globs to skip, e.g. `"data-tw/**"`. `*.zip *.rar *.7z *.psd *.bak *.log` and hidden files are skipped by default |
| `sync.enabled` | Turns save sync on or off |
| `auth` | `{ "mode": "access", "teamDomain", "aud" }` or `{ "mode": "none" }`. Filled in by the script |
| `controls` | On-screen buttons, see below |
| `saveTools` | `false` removes 💾 Saves (export / import / delete) from the ⚙ tools menu (on by default) |
| `itemBatch` | `false` turns off using several items at once (on by default) |

### On-screen buttons (`controls`)

```json
"controls": {
  "enabled": true,
  "showOn": "touch",
  "gamepad": true,
  "dpad": true,
  "opacity": 0.35,
  "scale": 1,
  "extras": ["fullscreen", "editLayout"],
  "buttons": [
    { "key": "t", "label": "T", "hint": "Quest journal" },
    { "key": "r", "label": "Inspect", "pin": true },
    { "label": "Popup", "keys": [{ "key": "f", "label": "F" }, "e", "q"] }
  ]
}
```

The layout follows emulator apps such as JoiPlay: a D-pad bottom-left, A/B/X/Y bottom-right, L/R above them. The buttons press the same keys RPG Maker maps a real controller to:

| Button | Key | Does |
|---|---|---|
| A | `ok` | Confirm, talk, interact |
| B | `cancel` | Back / close |
| X | `shift` | Dash (hold) |
| Y | `menu` | Open the menu |
| L / R | `pageup` / `pagedown` | Previous / next page (switch actor in menus) |

- `gamepad`: A/B/X/Y and L/R. `dpad`: the D-pad (slide your thumb to change direction). Either can be `false`.
- `buttons` are extra keys the game's plugins use. They live in the **⌨ Game keys** panel of the toolbar, each with its `hint`
  (filled from the description of the plugin that reads the key), so they don't crowd the screen.
  `"pin": true` keeps a button on screen as a keycap (portrait: above L/R; landscape: down the right edge); so do groups, and all buttons when `gamepad` is `false`.
  Buttons for keys the gamepad already presses (`ok`, `escape`, `pageup`…) are hidden while `gamepad` is on.
- `key` is an RPG Maker logical key name or a key name a plugin registers itself (`r`, `t`…).
  A numeric keyCode also works; its name is then looked up in `Input.keyMapper`.
- An entry with `keys` is a **button group**: tap it to open its sub-buttons.
- `showOn`: `touch` (touch devices only), `always` or `never`. `scale` multiplies the button size.
- In portrait the game is centered in the space above the controls.
- ⛶ fullscreen also turns a landscape game sideways (where the browser allows locking the orientation).
- Toolbar, in the top corners in landscape and next to L and R in portrait: on the left ⚙ tools (see below) and ⌨ game keys (tap it again to close); on the right ⛶ fullscreen and an eye that shows / hides all the controls (the eye is crossed out while they are hidden).
- **✥ Edit button layout** (in ⚙): drag buttons to new positions, − hides a button you never use (such as L/R), + brings it back; ↺ resets the positions, ✓ saves. Saved per browser, positions per orientation.
- The controls fade after a few seconds without a touch, so the game stays easy to see; the next touch brings them back.

## Tools menu (⚙)

The advanced tools open from one ⚙ button: in the toolbar on phones, a faint button in the top-left corner on desktop.

| Tool | Does |
|---|---|
| Edit button layout | Move or hide the on-screen buttons (only with the touch controls) |
| Saves | Export / import / delete save slots, see [Editing saves](#editing-saves) |
| Use several items at once | On / off switch for [using several items at once](#using-several-items-at-once), remembered per browser |

## Using several items at once

Choosing a consumable item you hold more than one of in the item menu first asks **how many** to use (1 by default, up to 99). The item is then used that many times:

- Items with direct effects (healing, stat growth…) are applied once per item, and stop early when one more would do nothing (an actor at full HP). Unused items are kept.
- Items that run a **common event** run it that many times in a row. Only the last run shows its messages; the earlier runs also skip sounds and waits, so ten study books give ten times the effect and one message.
- Items whose common event (or a common event it calls) shows choices, asks for a number or an item, transfers the player, starts a battle, opens a shop, the menu or the save screen, or ends the game are always used one at a time.

It works with any MV or MZ game that uses the standard item menu, including menus restyled by plugins.

## Editing saves

**Saves** in the ⚙ tools menu lists the save slots:

- **Export** downloads the slot as `file3.rmmzsave` (MV: `file3.rpgsave`), byte for byte what the desktop game writes. Open it in any RPG Maker save editor.
- **Import** puts a file back into a slot: the desktop format, the raw bytes some editors write, or plain JSON. The save list entry (party, playtime) is refreshed, the save is uploaded to the cloud when sync is on, and the game restarts so you can load it.
- **Delete** empties the slot after a confirmation. With sync on, the cloud copy is deleted too, so the slot disappears on every device. Export first if you may want it back.

A file that is not a game save of the same engine (config, global, another engine) is refused.

## Architecture

```
run.ps1 ─► cli/            Node CLI: analyzes the game, builds a temporary web build, drives wrangler
           runtime/        Plugins injected into the web build (appended to the build's js/plugins.js)
             RWK_Core            config, deviceId, toasts, dialogs, ⚙ tools menu
             RWK_SaveSync        save sync (MZ adapter: localforage, MV: localStorage)
             RWK_MobileControls  on-screen buttons, driven through Input._currentState
             RWK_SaveTools       save export / import / delete (desktop save file format)
             RWK_ItemBatch       use several items at once (MZ / MV adapter for the common event queue)
           worker/         One Worker shared by every game
             index.js            static assets + large files from R2 (with Range) + /api
             auth.js             verifies Cloudflare Access JWTs
             saves.js            save API, ETag-based overwrite protection
```

**Storage.** Static files live in Workers Static Assets (free, unmetered bandwidth, up to 20,000 files and 25 MiB per file). Only files over 25 MiB go to R2. All games share one R2 bucket, `rpgmaker-web-toolkit`:

```
rwk/games.json                     config for every game (keyed by fingerprint)
assets/<slug>/<path>               files > 25 MiB
assets/<slug>/.rwk-manifest.json   hashes of those files, so only changed ones are re-uploaded
saves/<sha256(email)>/<slug>/<name>  saves (config, global, file1…)
```

**Save sync.**

- When the game boots (before the engine reads any save), the plugin compares local saves with the cloud copies and takes the newer one. If a save changed in both places, the player chooses which copy to keep.
- Each time the game writes a save, the plugin uploads it after about a second, with `If-Match` so it never overwrites another device's changes.
- While offline, saves stay on the device and are uploaded once the connection is back.
- If another device saved within the last 5 minutes, the game warns the player so two devices do not overwrite each other.

**Security.** Cloudflare Access blocks every request at the network edge. The Worker also verifies the JWT signature itself to learn the player's email. Preview URLs are disabled (`preview_urls: false`) because they fall outside Access protection.

## Free plan limits to know

| Service | Limit | Notes |
|---|---|---|
| Workers Static Assets | 20,000 files, 25 MiB per file | Over 20,000 files, use `exclude` (e.g. drop unused languages) |
| Workers requests | 100,000/day | Only `/api/*` and R2-served files count; static files do not |
| R2 | 10 GB, 1M writes, 10M reads per month | Enabling R2 requires a payment method on the account, even on the free tier |
| Cloudflare Access | 50 users | Plenty for personal use |
| `wrangler r2 object put` | About 300 MiB per file | Larger files fail to upload |

## Responsible use

This toolkit is meant for playing games **you own**, for yourself. Game files are copyrighted by their creators. Keep Cloudflare Access enabled and do not share the link publicly: a site anyone can open is redistribution of the game.

## Development

```powershell
npm test          # CLI + Worker tests (node:test, no network needed)
```

See also [docs/ROADMAP.md](docs/ROADMAP.md). The user guide's source is in `site/` (VitePress): `cd site && npm ci && npm run dev`.

## License

[PolyForm Noncommercial License 1.0.0](LICENSE). Free for personal and other noncommercial use; commercial use is not permitted.
