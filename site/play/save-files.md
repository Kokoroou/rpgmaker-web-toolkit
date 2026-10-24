# Edit or move a save

⚙ → **💾 Saves** lists the game's save slots. For each slot you can:

## Export a save

**Export** downloads the slot as a file, byte for byte what the desktop game writes:

| Engine | File |
|---|---|
| MZ | `file3.rmmzsave` |
| MV | `file3.rpgsave` |

Use it to:

- Keep a backup of an important save.
- Edit the save in any RPG Maker save editor.
- Continue in the desktop version: put the file in the game's `save/` folder.

## Import a save

**Import** puts a file into a slot. It accepts:

- A desktop save file (`.rmmzsave` / `.rpgsave`), including one from the desktop game's `save/` folder.
- The raw format some save editors write.
- Plain JSON.

After importing, the slot's details in the save list (party, play time) are refreshed, the save uploads to the cloud when sync is on, and **the game restarts** so you can load it.

A file that is not a save of the same engine is refused, and so are the game's `config` and `global` files.

## Delete a save

**Delete** empties the slot after you confirm. With sync on, the cloud copy is deleted too, so the slot disappears **on every device**.

::: danger
Deleting cannot be undone. Export the slot first if you may want it back.
:::
