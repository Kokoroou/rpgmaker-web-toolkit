---
name: rwk-paths
description: Finds and fixes file paths in an RPG Maker MZ/MV game that work on Windows but break on the web (letter case, Actor1.PNG, img/Faces, "actor1" for Actor1.png). Use when a published game shows missing pictures, sounds or plugins, before the first deploy of a big game, or when `rwk analyze` warns about letter case, upper-case extensions, engine folders or file names.
---

# rwk-paths: case-sensitive paths, from detection to fix

Windows ignores letter case, the web host (Cloudflare Workers assets) and the browser do not. A game that plays on Windows can 404 on the web for `"actor1"` → `Actor1.png`, `Actor1.PNG`, `img/Faces/`, a plugin listed as `myplugin` for `MyPlugin.js`.

Two sibling skills do the work; this one decides the level and runs them in order.

- `rwk-paths-scan`: detect (read-only), levels `quick` / `standard` / `deep`.
- `rwk-paths-fix`: fix, levels `safe` / `standard` / `thorough`. Plan first, `--apply` after, backup and rollback built in.

Scripts: `.claude/skills/rwk-paths/scripts/scan.js` and `fix.js` (they import the CLI's own scanner, `cli/lib/paths.js`, the same one behind `rwk analyze`).

## Workflow

1. **Find the game folder** (the one with `index.html` and `js/`; the user's, never a copy under `.rwk-paths-backup/`). Ask only if it is not obvious.
2. **Scan**: `node .claude/skills/rwk-paths/scripts/scan.js "<game>"` (standard). Nothing to report → say so and stop.
3. **Choose the fix level** from what the scan found and what the user asked (table below), run `fix.js` **without** `--apply`, and show the plan in a few lines: number of renames and edits, and anything skipped.
4. **Apply** with `--apply` once the user agrees. If they already asked for the fix ("fix it", "make it work online"), apply the level below without asking again: the backup makes it reversible.
5. **Verify**: the script rescans and rolls back by itself when the result is worse. Then run `rwk analyze "<game>"` (or `scan.js` again) and report what is left.
6. **Hand over what a person must decide**: `missing`, `collision`, ambiguous names (see `rwk-paths-scan`). Give the backup folder and how to undo: `node …/fix.js "<game>" --undo "<backup folder>"`.

## Which levels

| Situation | Scan | Fix |
|---|---|---|
| Default, user said "fix the paths" | `standard` | `standard` |
| Game already published and working for others, user is cautious; or the game is not theirs to rename files in | `standard` | `safe` |
| Big game, missing pictures/sounds remain after `standard`, plugins build names at run time | `deep` | `standard`, then read the `deep` list by hand |
| First look at a huge game, only want to know if names are a problem | `quick` | none |
| File names with `#`, `?`, `\`, `%41`, or the user wants the cleanest result | `standard` | `thorough` |

Never go up a level on your own to chase a leftover: report it.

## Best practice the scripts already follow

- Plan before apply; one backup folder per run in `<game>/.rwk-paths-backup/` (skipped by deploys: it starts with a dot); renames recorded for `--undo`.
- References are rewritten to the **exact name of the file**, never the file renamed to match a reference (renaming a file changes every other reference to it). The exception is the name itself being wrong for the web: extension case, engine folder case, unsafe characters.
- Only the characters of the name are replaced; JSON/JS/HTML formatting is untouched; a place whose text is not what the scan saw is skipped.
- Nothing is guessed: two possible files, or no file, means "needs a person".
- Rescan after applying; any new problem restores everything (exit code 3).

## Tell the user

- The change is in their **game folder** (not only the web build): the game still runs on Windows.
- Re-run `rwk analyze`, then deploy as usual.
- Paths built at run time (`"img/" + name`) cannot be proven by a scan; `deep` lists where to look.
