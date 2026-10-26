---
description: "Change a published game's settings with the config command by answering questions: features, buttons, cloud saves and files, kept in your Cloudflare account."
lang: en
---

# Customize the game

`config` shows a menu and asks questions: no JSON to write. Pick what to change (features players can use, on-screen buttons, cloud saves, files, cache), answer, then choose **Save and finish**. Each game's settings are kept as a small JSON file in your Cloudflare account.

::: code-group
```powershell [Windows (PowerShell)]
$rwk = [scriptblock]::Create((irm https://raw.githubusercontent.com/Kokoroou/rpgmaker-web-toolkit/main/run.ps1))
& $rwk config "D:\Games\My Game"   # a menu: pick what to change, answer, save
```
```sh [macOS / Linux]
rwk() { curl -fsSL https://raw.githubusercontent.com/Kokoroou/rpgmaker-web-toolkit/main/run.sh | bash -s -- "$@"; }
rwk config ~/Games/"My Game"   # a menu: pick what to change, answer, save
```
:::

Changes to the in-game features (every key in [Common changes](#common-changes), `preset`, `players`, `controls`, `sync`) apply at once: players get them the next time they open the game, within a minute. The other keys (`include`, `exclude`, `cache`, `indexable`…) change the files of the web build, so `config` names them and you publish again (`& $rwk deploy "D:\Games\My Game"`) to apply them. A game last published with a toolkit older than this needs one more publish first; `config` says so.

The menu's last entries are **Save and finish** and **Quit without saving**. For anything the questions do not cover (limits such as `speed` or `lock`, [settings for one player](#settings-for-one-player)), pick **Advanced: edit the JSON in a text editor**: Notepad opens (TextEdit on macOS, `$EDITOR` or nano on Linux; set `EDITOR`, for example `EDITOR="code --wait"`, to use another), and a JSON mistake reopens it. The tables below show the key behind each question. `slug` and `fingerprint` cannot be changed here: the site name changes with the [`rename`](/setup/updating#change-the-site-address) command. Every key: [Config keys](/reference/config).

## Common changes

| To | Set |
|---|---|
| Remove ⚙ → Saves | `"saveTools": false` |
| Turn off using several items at once | `"itemBatch": false` |
| Turn off fast forward | `"fastForward": false` |
| No fast forward in battles, or ×3 at most | `"fastForward": { "inBattle": false }`, `"fastForward": { "maxSpeed": 3 }` |
| Always fast-forward at ×2, with no speed to pick | `"fastForward": { "speed": 2, "lock": true }` |
| Turn off message Auto and Skip | `"messageMode": false` |
| Keep Auto, turn off Skip | `"messageMode": { "skip": false }` |
| Start in Auto at a slow pace | `"messageMode": { "mode": "auto", "autoSpeed": "slow" }` (add `"lock": true` so it stays that way) |
| Remove ⚙ → Messages log, or keep more messages | `"backlog": false`, `"backlog": 200` |
| Remove ⚙ → Always dash | `"alwaysDash": false` |
| Players run unless they turn it off, or always run | `"alwaysDash": { "on": true }`, `"alwaysDash": { "on": true, "lock": true }` |
| Let players export saves but not import edited ones | `"saveTools": { "import": false }` |
| Turn off quick save / load | `"quickSave": false` |
| No quick save where the game disallows saving | `"quickSave": { "ignoreSaveLock": false }` |
| Turn off the autosave, or change how often | `"autoSave": false`, `"autoSave": { "minutes": 10 }` |
| Keep fewer older saves, or none (saves R2 space) | `"saveHistory": { "keep": 5, "days": 14 }`, `"saveHistory": false` |
| Turn on [cheats](/play/cheats), or only gold and items | `"cheats": true`, `"cheats": { "party": false, "battle": false, "switches": false, "movement": false }` |
| Cheats for you only | `"players": { "me@example.com": { "cheats": true } }` |
| Turn cloud saves off (each browser keeps its own) | `"sync": { "enabled": false }` |
| Leave files out | `"exclude": ["data-tw/**", "img/pictures/unused_*", "*.txt"]` |
| Publish a folder the first deploy skipped | `"include": ["live2d", "extra.json"]` |
| Keep files that are excluded by default | `"include": ["img/**/*.psd"]` |
| Change the on-screen buttons | `"controls"`: see [On-screen buttons](/setup/controls) |

## Presets

The first deploy asks which features players may use, and keeps the answer as `"preset"`. A preset is only a starting point: every key written in the config goes on top of it, and an object adds to the preset's (`"fastForward": { "maxSpeed": 3 }` on **Original experience** still has no fast forward in battles). `true` goes back to the toolkit's defaults.

| `preset` | For | Differs from the defaults |
|---|---|---|
| `"comfortable"` (default) | Playing alone or with family | Nothing: every convenience on |
| `"original"` | Playing the game as its creator designed it | No fast forward in battles, no Skip, no quick save where the game disallows saving, no save import. Fast forward outside battles, Auto and cloud saves stay |
| `"shared"` | Letting other people play your copy | No save export / import; older saves: 5 copies for 14 days (saves R2 space) |

Games published before presets existed have none, which is `"comfortable"`: nothing changes for them.

## Each setting: off, on, or on with limits

Each feature key takes one of three kinds of value:

- `false`: off. Not in the ⚙ menu, no keyboard shortcut.
- `true` (or no key): on, with the toolkit's defaults. Players choose the rest in their browser.
- an object: on, with your limits and starting values. `"lock": true`, where the key has it, leaves players no choice.

| Key | Object fields |
|---|---|
| `fastForward` | `maxSpeed` (2–4, default 4), `speed` (starting speed), `inBattle` (default `true`), `lock` (players cannot change the speed) |
| `messageMode` | `auto`, `skip` (default `true`), `mode` (`"normal"` or `"auto"` to start in), `autoSpeed` (`"slow"`, `"normal"`, `"fast"`), `lock` (players keep `mode` and `autoSpeed`) |
| `alwaysDash` | `on` (`true` / `false` for players who never chose), `lock` (stays at `on`; Options → Always Dash cannot change it) |
| `saveTools` | `export`, `import`, `delete` (default `true` each) |
| `cheats` | `party`, `items`, `battle`, `switches`, `movement` (default `true` each). Off when the key is missing, whatever the preset |
| `quickSave`, `autoSave`, `backlog`, `saveHistory` | See [Config keys](/reference/config) |

The game creator's [policy](/creators/policy) still wins: a feature it turns off stays off, whatever the config says.

## Settings for one player

With Cloudflare Access, `"players"` gives some emails settings of their own, on top of everything else. For example, you keep save import and older saves while friends get the **Shared with others** preset:

```json
{
  "preset": "shared",
  "players": {
    "me@example.com": { "saveTools": true, "saveHistory": { "keep": 20 } },
    "kid@example.com": { "fastForward": false }
  }
}
```

Keys that can be set per player: `fastForward`, `messageMode`, `alwaysDash`, `backlog`, `quickSave`, `autoSave`, `saveHistory`, `saveTools`, `itemBatch`, `cheats`. Emails match whatever their case. A change applies without publishing again, like the other feature settings.

The emails never reach the web build: the deploy gives the Worker only a hash of each email, with the settings that differ. When a player opens the game, the Worker checks their Access login and puts their settings in the copy of `js/plugins.js` it sends them. A public site (no Access) cannot tell players apart, so everyone gets the shared settings.

## What a setting really blocks

| Setting | Enforced by | How firm |
|---|---|---|
| `saveHistory` (also per player) | The Worker refuses the older saves API | **Blocked** |
| Fast forward, message modes, always dash, quick save, autosave, save export / import / delete, several items at once, cheats | The plugins in the browser | **Hidden**: someone who knows the browser's developer tools can still get around it. A choice about how the game plays, not security |

## Patterns

`*` matches within one folder, `**` across folders, and a pattern without `/` matches a file name anywhere. Case is ignored.

Always left out: hidden files, `Thumbs.db`, `desktop.ini`, `*.zip *.rar *.7z *.psd *.bak *.log`, and desktop-only folders (`save`, `locales`, `swiftshader`, `node_modules`…).

Over the free plan's 20,000 files? Exclude what players don't need, such as an unused translation.
