# Edit or move a save

⏸ → **Saves**:

![The Saves panel: Export, Import and Delete per slot](/img/saves-panel.png){.shot .portrait}

| Button | Does |
|---|---|
| <span id="export">**Export**</span> | Downloads the slot as `file3.rmmzsave` (MV: `file3.rpgsave`), the same file the desktop game writes. Open it in a save editor, keep it as a backup, or drop it in the desktop game's `save/` folder |
| <span id="import">**Import**</span> | Puts a file into the slot: a desktop save, an editor's raw output, or plain JSON. The save uploads to the cloud and **the game restarts** so you can load it |
| <span id="delete">**Delete**</span> | Empties the slot, **on every device** when sync is on |

Import refuses files from the other engine, and the game's `config` and `global` files.

::: danger
Delete cannot be undone. Export first if you may want the save back.
:::
