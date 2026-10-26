---
description: "Every config key of an RPG Maker web game published with rpgmaker-web-toolkit, with defaults and recipes for common changes."
lang: en
---

# Config keys

Every key of a game's settings, as [`config`](/setup/configuration) shows them. Common changes have recipes on [Customize the game](/setup/configuration#common-changes).

| Key | Meaning | Editable |
|---|---|---|
| `slug` | Site name: `https://<slug>.<subdomain>.workers.dev` | With the [`rename`](/setup/updating#change-the-site-address) command |
| `storageId` | Set by `rename`: the first site name, under which saves and large files stay in R2 | No |
| `retiredWorkers` | Set by `rename`: old Workers to delete once the new site works | No |
| `fingerprint` | Identifies the game. MZ: `mz:<advanced.gameId>`; MV: `mv:<game title>` | No |
| `title`, `engine`, `url` | For reference, filled in by the toolkit | No effect |
| `include` | Extra top-level folders / files to publish, or patterns of files to keep | Yes |
| `exclude` | Patterns of files to leave out | Yes |
| `sync.enabled` | Cloud save sync | Yes |
| `auth` | `{ "mode": "access", "teamDomain", "aud" }`, or public: `{ "mode": "none", "basis", "since" }`. Filled in by the [Access setup](/setup/access) | With care |
| `auth.basis` | Why a public site may be public: `"author"`, `"permission"` or `"creator-policy"` | Through the deploy |
| `indexable` | `true` lets search engines list a public site | Yes |
| `controls` | [On-screen buttons](/setup/controls) | Yes |
| `controls.scannedKeys` | Plugin keys already seen, so updates only ask about new ones | No need |
| `preset` | `"comfortable"` (default), `"original"` or `"shared"`: the starting point under the keys below ([Presets](/setup/configuration#presets)) | Yes |
| `players` | `{ "<email>": { <key>: value } }`: settings for one player, on top of the rest. Needs Cloudflare Access ([Settings for one player](/setup/configuration#settings-for-one-player)) | Yes |
| `saveTools` | `false` removes ⚙ → Saves; `{ "export": true, "import": false, "delete": true }` keeps only some of its buttons | Yes, unless the creator's [policy](/creators/policy) turns it off |
| `itemBatch` | `false` turns off using several items at once (item menu, battle and events that ask for an item) | Same |
| `fastForward` | `false` turns off [fast forward](/play/speed); `{ "maxSpeed": 3, "speed": 2, "inBattle": false, "lock": true }` sets the top speed (2–4, default 4), the starting speed, whether it works in battles, and whether players may change the speed | Same |
| `messageMode` | `false` turns off the [message modes](/play/messages) (Auto, Skip); `{ "auto": true, "skip": false, "mode": "auto", "autoSpeed": "slow", "lock": true }` picks the modes offered, the mode and Auto speed to start in, and whether players may change them | Same |
| `backlog` | `false` removes ⚙ → [Messages log](/play/messages#messages-log); a number (10–500, default 100) sets how many messages it keeps | Same |
| `remap` | `false` removes ⚙ → [Keys and buttons](/play/keys); `{ "keyboard": true, "gamepad": false }` lets players remap only the keyboard (or only the gamepad) | Same |
| `alwaysDash` | `false` removes ⚙ → [Always dash](/play/dash); `{ "on": true }` makes players who never chose run; `{ "on": true, "lock": true }` keeps it on (no switch) | Same |
| `quickSave` | `false` turns off [quick save / load](/play/quick-save); `{ "ignoreSaveLock": false }` keeps it off where the game disallows saving | Same |
| `autoSave` | `false` turns off the [autosave](/play/quick-save#autosave); `{ "minutes": 10 }` changes how often (1–60, default 5) | Same |
| `saveHistory` | `false` keeps no [older saves](/play/saves#bring-back-an-older-save); `{ "keep": 5, "days": 14 }` changes how many copies each save keeps (1–50, default 10) and for how long (1–365 days, default 30). Enforced by the Worker | Yes |
| `cheats` | Off unless set. `true` turns on ⚙ → [Cheats](/play/cheats); `{ "party": true, "items": true, "battle": false }` keeps only some sections (party: heal, god mode, level; items: gold and items; battle: win now; switches: switches and variables; movement: walk through walls, teleport). Best given to [one player](/setup/configuration#settings-for-one-player) | Same |
| `cache` | `false` stops the browser keeping the game's pictures, sounds and data between launches (files over 25 MiB are never kept) | Yes |
| `savesImportedAt` | When desktop saves were last uploaded | No need |

::: warning Changing `auth`
`{}` locks the site on the next deploy and runs the Access setup again. `{ "mode": "none" }` makes it public, after asking why.
:::

All games' settings live in `rwk/games.json` in the R2 bucket `rpgmaker-web-toolkit`, keyed by `fingerprint` ([storage](/reference/how-it-works#storage)).
