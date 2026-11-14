---
description: "Check an RPG Maker game for the web with rwk analyze (warnings, file count, file paths; nothing published) and fix its file paths with rwk fix-paths."
lang: en
---

# Check without publishing

Part of the [commands reference](/reference/commands).

`analyze` (or `deploy --dry-run`) runs the same checks a deploy starts with, and stops there:

- It reads the game folder and the creator's [hosting policy](/creators/policy), lists the warnings (MV phone audio and video, non-ASCII file names, feature settings) and counts the files against the [free plan limits](/reference/limits).
- It checks the file paths (see [File paths](#file-paths-that-work-on-windows-only)): the names in the game against the references to them.
- It never logs in to Cloudflare, never uses R2 and builds no staging folder: the game folder and the account stay as they are.
- It uses the first-deploy defaults, plus the game's [`rwk.json`](/reference/config#rwk-json-in-the-game-folder) (site name, `include` and `exclude`) when it has one. A game whose `exclude` patterns are kept only in R2 may therefore count more files than its real deploy: put them in `rwk.json` to count the same.
- It fails (exit code `1`) when the build is over the file limit or the creator does not allow publishing, so a CI job can use it as a check.

```
✓ rpgmaker-web-toolkit: checked, nothing published
  Files    1834 (412.3 MB)
  Game     MZ · My Game
  Warnings none
```

With `--json` the result has `"dryRun": true`, the `build` report and `game: { title, engine }`, and no `site` or `url`.

`rename --dry-run` and `saves import --dry-run` go one step further: they log in and read the game's settings in R2 (a game that is not published yet stops there), but create, upload and delete nothing, not even the R2 bucket.

- `rename --dry-run --to new-name` checks the name (format, current name, used by another game) and lists what the rename would do.
- `saves import --dry-run` lists the saves in `save/` that would go up, and where: the email you sign in with, or the shared saves of a public site. Nothing is asked about the email.

Their result has `"dryRun": true` with the site's current `site` and `url`.

### File paths that work on Windows only

Windows ignores letter case; the web host and the browser do not. A game can run on Windows with `"actor1"` in `Actors.json` for `img/characters/Actor1.png` and show nothing online. `analyze` and `deploy` warn about, one line per kind:

- **Letter case or Unicode form**: a reference in `data/*.json`, the plugin list (`js/plugins.js`), `index.html`, a CSS file or a path written in a plugin differs from the file's name only by case (or accents saved in another Unicode form).
- **A folder written in code** (`loadBitmap('img/menus/CG/', name)` for a folder named `cg`): every picture in it is missing online, and an RPG Maker menu that waits for them never starts — the browser stays on the "Now Loading" screen. This is checked apart from the line above because it has no file name to compare.
- **Upper-case extension** (`Actor1.PNG`) and **engine folders** spelled differently (`img/Faces`, `audio/BGM`): the engine asks for lower case.
- **Live2D model file** spelled differently from its folder (`Model_01/model_01.model3.json`): Live2D plugins ask for `Model_01/Model_01.model3.json`. Also checked in folders the build leaves out, since the model folder is one of them until you include it.
- **Files that differ only by case**, and names with `#`, `?`, `\` or `%XX`, which break a web address.
- **References to files that are not in the game**: often unused, so only a warning.

With `--json` the result has `paths: { checked, case, unicode, missing, ext, folder, collision, unsafe, model }`. A name assembled by a plugin at run time cannot be checked.

### Fix them: fix-paths

`fix-paths` fixes them in the game folder, then a deploy publishes the fix:

```powershell
& $rwk fix-paths "D:\Games\My Game"                  # asks the level, shows the plan, asks before changing anything
& $rwk fix-paths "D:\Games\My Game" --level safe --apply
& $rwk deploy "D:\Games\My Game"                     # a published game: only the changed files are uploaded
```

| Level | Changes |
|---|---|
| `safe` | Only the **references** (`data/*.json`, the plugin list, `index.html`, CSS) are rewritten to the file's exact name. No file is renamed, plugin code is not edited |
| `standard` (default) | `safe` + renames **upper-case extensions** (`.PNG` → `.png`) **engine folders** (`img/Faces` → `img/faces`) and **Live2D model files** (`Model_01/model_01.model3.json` → `Model_01.model3.json`), and rewrites whole path literals in `js/plugins/*.js` and `js/main.js` |
| `thorough` | `standard` + renames files with `#`, `?`, `\` or `%XX` in the name (`a#1.png` → `a_1.png`) and rewrites the references to them |

- It always shows the plan first. In a terminal it then asks; with `--yes` or `--json` it only shows the plan unless `--apply` is given. Without `--level`, a terminal asks for one and an unattended run uses `standard`.
- Before changing anything it copies each edited file to `.rwk-paths-backup/<time>/` in the game (a hidden folder, never uploaded) and records the renames there. Then it scans again: if the result is worse, everything is put back and the command fails.
- Only the characters of a name change: the files are not reformatted.
- `--undo last` (or `--undo <backup folder>`) puts the game back as it was before a fix. Delete `.rwk-paths-backup/` once the game works.
- It leaves to a person what has no single answer: a reference to a file that is not in the game, several files that differ only by case, and names a plugin builds at run time. `analyze` lists them.

With `--json` the result has `fix: { level, applied, renames, edits, skipped, before, remaining, backup }`.

In [Claude Code](https://claude.com/claude-code), the `rwk-paths` skills (`.claude/skills/`) do the same fix, and can also scan plugin code that builds names at run time (`--level deep`) for you to edit by hand.
