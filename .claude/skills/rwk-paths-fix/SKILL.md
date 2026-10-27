---
name: rwk-paths-fix
description: Fixes case-sensitive path problems in an RPG Maker MZ/MV game folder at three levels (safe, standard, thorough) with a plan, a backup, an automatic rescan and rollback. Use after rwk-paths-scan found fixable issues, or when asked to fix file name case, upper-case extensions or engine folders for the web.
---

# rwk-paths-fix: fix levels

```sh
node .claude/skills/rwk-paths/scripts/fix.js "<game folder>" --level safe|standard|thorough          # plan only
node .claude/skills/rwk-paths/scripts/fix.js "<game folder>" --level standard --apply [--json]       # do it
node .claude/skills/rwk-paths/scripts/fix.js "<game folder>" --undo "<game>/.rwk-paths-backup/<time>"
```

## Levels

| Level | Does | Touches |
|---|---|---|
| `safe` | Rewrites **references** to the file's exact name: `data/*.json`, the plugin list in `js/plugins.js`, `index.html`, CSS | Only text inside strings in config/data files. No file or folder is renamed; plugin code is not edited |
| `standard` (default) | `safe` + renames **upper-case extensions** (`.PNG` → `.png`) and **engine folders** (`img/Faces` → `img/faces`) + rewrites **path literals** in `js/plugins/*.js` and `js/main.js` | Adds renames and edits to plugin source |
| `thorough` | `standard` + renames files with **URL-unsafe characters** (`a#1.png` → `a_1.png`) and rewrites the references to them | Adds renames of assets whose names the author chose |

Choose with the table in `rwk-paths`. When unsure, plan at `standard`, show the plan, and let the user decide between `safe` and `standard`.

## Before applying

1. Run without `--apply` and read the plan: `rename` lines and `edit` lines (`file where: "old" -> "new"`), and `skipped` lines.
2. Check the plan makes sense: references change to the **file's** spelling, never the other way (apart from extension, engine folder, unsafe characters). If something looks wrong (a rename of a folder the game does not own, a plugin file you do not recognize), stop and ask.
3. The game folder is the user's source of truth. If it is under git, it is fine to apply and commit the result as one change; if not, the backup folder is the safety net: tell the user where it is.

## What it will not do (leave these to a person)

- Choose between several candidate files (`collision`, ambiguous names), delete or merge files.
- Touch a `missing` reference: that file does not exist, and guessing hides the bug.
- Edit plugin code beyond whole path literals (`"Img/Pictures/Logo.png"`), or names assembled at run time. For those, read the code (`rwk-paths-scan --level deep`), then edit by hand: normalise the case in the source or lower-case the value it builds, and re-run the scan.
- Reformat anything.

## After applying

- The script rescans: new `missing`, `collision`, or `case` counts roll everything back (exit code 3; say what it reported).
- Report: renames, edits by file, what is left (`remaining`), the backup folder.
- Then `rwk analyze "<game>"` should show no path warnings, and the user can deploy.
- A big change in a git game: suggest a commit titled e.g. `fix: use the exact case of asset paths`. Do not commit or push unless asked.
- Delete `.rwk-paths-backup/` only when the user confirms the game works.

## Edge cases

- Windows/macOS disks are case-insensitive: renames use a temporary name so a change of case alone works. On a case-sensitive disk a rename onto an existing name is refused and listed as skipped.
- Encrypted assets (`.rpgmvp`, `.rpgmvo`, `.png_`) follow the same rules as their plain twins.
- Several games or translated data folders (`data-en/`) are scanned the same way; references are always checked against the files that would be published.
