---
name: rwk-paths-scan
description: Detects file path problems in an RPG Maker MZ/MV game that break on the web but not on Windows (letter case, upper-case extensions, engine folder spelling, case-only duplicates, URL-unsafe characters, missing files), at three depths: quick, standard, deep. Read-only. Use to diagnose missing pictures, sounds or plugins in a published game, or to see what `rwk analyze` warned about.
---

# rwk-paths-scan: detection levels

```sh
node .claude/skills/rwk-paths/scripts/scan.js "<game folder>" [--level quick|standard|deep] [--json]
```

Read-only. Exit code 1 when anything other than `missing` is found.

## Levels

| Level | Looks at | Cost | Use when |
|---|---|---|---|
| `quick` | File and folder **names** only: `ext`, `folder`, `collision`, `unsafe` | Reads no file | A first look at a very large game |
| `standard` (default) | `quick` + every **static reference**: `data/*.json` (pictures, faces, battlers, tilesets, parallaxes, BGM/BGS/ME/SE, movies, event commands 101/231/241/245/249/250/261/283/284/322, move routes), the plugin list in `js/plugins.js`, `index.html`, CSS `url()`, and path literals in `js/plugins/*.js` | Reads data and scripts | Normal case, same check as `rwk analyze` |
| `deep` | `standard` + a list of **plugin code that builds paths at run time** (`ImageManager.load…`, `"img/" + name`, `fetch`, `new Audio`…) | Same | Pictures or sounds are still missing after `standard`, or the game uses many plugins |

## Issue kinds

| Kind | Meaning | Automatic fix |
|---|---|---|
| `case` / `unicode` | The reference names a file that exists under another letter case or Unicode form (NFC/NFD) | Yes, when exactly one file matches (`fix: reference`) |
| `ext` | Extension has upper-case letters (`Actor1.PNG`); the engine asks for lower case | Yes (`fix: file`) unless the lower-case name is taken |
| `folder` | Engine folder spelled differently (`img/Faces`, `audio/BGM`) | Yes (`fix: file`) |
| `unsafe` | Name has `#`, `?`, `\`, `%XX`, or spaces at the ends | Only `thorough` |
| `collision` | Two files differ only by case (possible when a game was unzipped on Linux/macOS) | No: a person picks the one to keep |
| `missing` | The reference matches no file at all, even ignoring case | No |

## Reading the result

- Group by kind and by source file; quote 2-3 examples with their `where` (`data/Actors.json $[3].characterName`), not the whole list.
- `missing` is often harmless (references in unused maps, deleted assets). Check before calling it a bug: is the reference in a map or event the game uses? Is there a file with a similar name (a typo, a different extension, an encrypted `.rpgmvp` twin)? Say what you found; do not rename files to match a guess.
- `case` on a plugin name (`js/plugins.js`) is the most damaging: that plugin does not load, and the game may not start.
- `deep` output is a reading list, not findings. Open the flagged lines: if the name comes from a plugin parameter or database field, the standard scan already covered it; if it is assembled from a variable the player or script controls, check what values it takes and whether those files exist under that exact spelling.

## Limits to state when reporting

A clean `standard` scan proves every static reference matches. It cannot prove names assembled in code, in event scripts (`$gameVariables`), or in plugin note tags. Say so when the user still sees a missing file.
