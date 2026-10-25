# Config keys

Every key of a game's settings, as [`edit-config`](/setup/configuration) shows them. Common changes have recipes on [Customize the game](/setup/configuration#common-changes).

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
| `saveTools` | `false` removes ⚙ → Saves | Yes, unless the creator's [policy](/creators/policy) turns it off |
| `itemBatch` | `false` turns off using several items at once (item menu, battle and events that ask for an item) | Same |
| `fastForward` | `false` turns off [fast forward](/play/speed) | Same |
| `messageMode` | `false` turns off the [message modes](/play/messages) (Auto, Skip) | Same |
| `alwaysDash` | `false` removes ⚙ → [Always dash](/play/dash) | Same |
| `quickSave` | `false` turns off [quick save / load](/play/quick-save); `{ "ignoreSaveLock": false }` keeps it off where the game disallows saving | Same |
| `autoSave` | `false` turns off the [autosave](/play/quick-save#autosave); `{ "minutes": 10 }` changes how often (1–60, default 5) | Same |
| `saveHistory` | `false` keeps no [older saves](/play/saves#bring-back-an-older-save); `{ "keep": 5, "days": 14 }` changes how many copies each save keeps (1–50, default 10) and for how long (1–365 days, default 30). Enforced by the Worker | Yes |
| `savesImportedAt` | When desktop saves were last uploaded | No need |

::: warning Changing `auth`
`{}` locks the site on the next deploy and runs the Access setup again. `{ "mode": "none" }` makes it public, after asking why.
:::

All games' settings live in `rwk/games.json` in the R2 bucket `rpgmaker-web-toolkit`, keyed by `fingerprint` ([storage](/reference/how-it-works#storage)).
