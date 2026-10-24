# Customize the game

Each game's settings are a small JSON file in your Cloudflare account.

```powershell
$rwk = [scriptblock]::Create((irm https://raw.githubusercontent.com/Kokoroou/rpgmaker-web-toolkit/main/run.ps1))
& $rwk edit-config "D:\Games\My Game"   # 1. Notepad opens: edit, Ctrl+S, close
& $rwk "D:\Games\My Game"               # 2. publish again to apply
```

A JSON mistake reopens Notepad. `slug` and `fingerprint` cannot be changed. Every key: [Config keys](/reference/config).

## Common changes

| To | Set |
|---|---|
| Remove ⏸ → Saves | `"saveTools": false` |
| Turn off using several items at once | `"itemBatch": false` |
| Turn off fast forward | `"fastForward": false` |
| Turn off message Auto and Skip | `"messageMode": false` |
| Remove ⏸ → Always dash | `"alwaysDash": false` |
| Turn off quick save / load | `"quickSave": false` |
| No quick save where the game disallows saving | `"quickSave": { "ignoreSaveLock": false }` |
| Turn off the autosave, or change how often | `"autoSave": false`, `"autoSave": { "minutes": 10 }` |
| Turn cloud saves off (each browser keeps its own) | `"sync": { "enabled": false }` |
| Leave files out | `"exclude": ["data-tw/**", "img/pictures/unused_*", "*.txt"]` |
| Publish a folder the first deploy skipped | `"include": ["live2d", "extra.json"]` |
| Keep files that are excluded by default | `"include": ["img/**/*.psd"]` |
| Change the on-screen buttons | `"controls"`: see [On-screen buttons](/setup/controls) |

## Patterns

`*` matches within one folder, `**` across folders, and a pattern without `/` matches a file name anywhere. Case is ignored.

Always left out: hidden files, `Thumbs.db`, `desktop.ini`, `*.zip *.rar *.7z *.psd *.bak *.log`, and desktop-only folders (`save`, `locales`, `swiftshader`, `node_modules`…).

Over the free plan's 20,000 files? Exclude what players don't need, such as an unused translation.
