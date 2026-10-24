# Customize the game

Each game's settings are a small JSON file stored in your Cloudflare account. You change them with `edit-config`, then publish again to apply them.

## Edit the settings

```powershell
$rwk = [scriptblock]::Create((irm https://raw.githubusercontent.com/Kokoroou/rpgmaker-web-toolkit/main/run.ps1))
& $rwk edit-config "D:\Games\My Game"
```

1. Notepad opens with the settings.
2. Make your changes, save with **Ctrl+S** and **close Notepad**.
3. The toolkit saves the settings to your account. If the JSON has a mistake, it says so and reopens Notepad.
4. **Publish again** to apply the changes:

```powershell
& $rwk "D:\Games\My Game"
```

::: tip
`slug` (the site name) and `fingerprint` cannot be changed here: they tie the settings to the game and its link. Any change to them is ignored.
:::

The full list of keys is in [Config keys](/reference/config). The sections below cover the common changes.

## Turn a feature off

Two in-game tools are on by default. Set them to `false` to remove them:

```json
"saveTools": false,
"itemBatch": false
```

| Key | Removes |
|---|---|
| `saveTools` | **Saves** in the ⚙ tools menu (export, import and delete save slots) |
| `itemBatch` | Using several items at once from the item menu |

To turn cloud save sync off or on:

```json
"sync": { "enabled": false }
```

With sync off, each browser keeps its own saves.

## Leave files out

A game can have more files than the free plan allows (20,000), or carry files players don't need, such as an unused language. Add patterns to `exclude`:

```json
"exclude": ["data-tw/**", "img/pictures/unused_*", "*.txt"]
```

| Pattern | Matches |
|---|---|
| `data-tw/**` | Everything in the `data-tw` folder |
| `img/pictures/unused_*` | Files in `img/pictures` whose name starts with `unused_` |
| `*.txt` | Every `.txt` file, in any folder (a pattern without `/` matches the file name anywhere) |

`*` matches within one folder, `**` crosses folders, and matching ignores upper / lower case.

These are always left out: hidden files, `Thumbs.db`, `desktop.ini`, `*.zip`, `*.rar`, `*.7z`, `*.psd`, `*.bak`, `*.log`, and the desktop-only folders (`save`, `locales`, `swiftshader`, `node_modules`…).

## Add folders the toolkit skipped

The web build contains the standard RPG Maker folders (`audio`, `css`, `data`, `effects`, `fonts`, `icon`, `img`, `js`, `movies`, and translated data like `data-en`) plus `index.html`. The first deploy asks about any other folder. To change your answer later, edit `include`:

```json
"include": ["live2d", "extra.json"]
```

| Entry | Effect |
|---|---|
| A plain name (`live2d`, `extra.json`) | Adds that folder or file from the game's top level |
| A pattern with `*` (`img/**/*.psd`) | Keeps files that would otherwise be left out by the always-excluded list or by `exclude` |

## Change the on-screen buttons

See [On-screen buttons](/setup/controls).
