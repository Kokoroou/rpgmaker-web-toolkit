# Config keys

Every key of a game's settings, as [`edit-config`](/setup/configuration) shows them. Common changes have recipes on [Customize the game](/setup/configuration#common-changes).

| Key | Meaning | Editable |
|---|---|---|
| `slug` | Site name: `https://<slug>.<subdomain>.workers.dev` | No |
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
| `saveTools` | `false` removes ⏸ → Saves | Yes, unless the creator's [policy](/creators/policy) turns it off |
| `itemBatch` | `false` turns off using several items at once | Same |
| `fastForward` | `false` turns off [fast forward](/play/speed) | Same |
| `messageMode` | `false` turns off the [message modes](/play/messages) (Auto, Skip) | Same |
| `savesImportedAt` | When desktop saves were last uploaded | No need |

::: warning Changing `auth`
`{}` locks the site on the next deploy and runs the Access setup again. `{ "mode": "none" }` makes it public, after asking why.
:::

All games' settings live in `rwk/games.json` in the R2 bucket `rpgmaker-web-toolkit`, keyed by `fingerprint` ([storage](/reference/how-it-works#storage)).
