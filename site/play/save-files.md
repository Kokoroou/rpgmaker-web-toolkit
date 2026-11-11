---
description: "Export, import or delete an RPG Maker save slot in the web copy, and move a save between the web game and the desktop game or a save editor."
lang: en
---

# Save files: export, import, delete

In the menu: ⚙ → **Saves** → **Saves** opens this panel:

![The Saves panel: Export, Import and Delete per slot](/img/saves-panel.png){.shot .portrait}

| Button | Does |
|---|---|
| <span id="export">**Export**</span> | Downloads the slot as `file3.rmmzsave` (MV: `file3.rpgsave`), the same file the desktop game writes. Open it in a save editor, keep it as a backup, or drop it in the desktop game's `save/` folder |
| <span id="import">**Import**</span> | Puts a file into the slot: a desktop save, an editor's raw output, or plain JSON. The save uploads to the cloud and **the game restarts** so you can load it |
| <span id="delete">**Delete**</span> | Empties the slot, **on every device** when sync is on |

**Export all** (below the list) downloads the whole save folder as one ZIP, `saves-<date>.zip`:

- `save/`: every filled slot plus `config` (the game's options) and `global` (the slot list), named as on desktop, so the folder can replace the desktop game's `save/` folder
- `rwk-environment.json`: where the saves come from (engine, game, page, whether cloud sync was on, the device, the date)

Import refuses files from the other engine, and the game's `config` and `global` files.

::: danger
With cloud saves on, a deleted save can come back from ⚙ → **Saves** → [Older saves](/play/older-saves) (for 30 days by default). Otherwise Delete cannot be undone: export first if you may want the save back.
:::
