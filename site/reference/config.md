# Config keys

Every key of a game's settings, as shown by [`edit-config`](/setup/configuration#edit-the-settings).

| Key | Meaning | Editable |
|---|---|---|
| `slug` | Site name: `https://<slug>.<subdomain>.workers.dev` | No |
| `fingerprint` | Identifies the game on later runs. MZ: `mz:<advanced.gameId>`; MV: `mv:<game title>` | No |
| `title`, `engine` | The game's title and engine, for reference | No effect |
| `url` | The game's link, filled in after a deploy | No effect |
| `include` | Extra top-level folders / files to publish, or patterns of files to keep. See [Add folders](/setup/configuration#add-folders-the-toolkit-skipped) | Yes |
| `exclude` | Patterns of files to leave out. See [Leave files out](/setup/configuration#leave-files-out) | Yes |
| `sync.enabled` | Cloud save sync on / off | Yes |
| `auth` | `{ "mode": "access", "teamDomain", "aud" }` or `{ "mode": "none" }`. Filled in by the [Access setup](/setup/access) | Yes, with care |
| `controls` | On-screen buttons. See [On-screen buttons](/setup/controls) | Yes |
| `controls.scannedKeys` | Plugin keys already seen, so updates only ask about new ones | No need |
| `saveTools` | `false` removes 💾 Saves from the ⚙ tools menu | Yes |
| `itemBatch` | `false` turns off using several items at once | Yes |
| `savesImportedAt` | When the desktop saves were last uploaded, so the deploy does not offer it again | No need |

::: warning Changing `auth`
Setting `auth` back to `{}` locks the site on the next deploy and runs the Access setup again. `{ "mode": "none" }` makes the site public.
:::

## Where the settings live

All games share one R2 bucket, `rpgmaker-web-toolkit`, in your Cloudflare account. The settings of every game are in `rwk/games.json`, keyed by `fingerprint`. See [How it works](/reference/how-it-works#storage).
