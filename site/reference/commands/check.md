---
description: "Check an RPG Maker game for the web with rwk analyze or deploy --dry-run: warnings, file count, file path problems, no login, nothing published."
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
- **Files that differ only by case**, and names with `#`, `?`, `\` or `%XX`, which break a web address.
- **References to files that are not in the game**: often unused, so only a warning.

With `--json` the result has `paths: { checked, case, unicode, missing, ext, folder, collision, unsafe }`. A name assembled by a plugin at run time cannot be checked.

To fix them, open the toolkit folder in [Claude Code](https://claude.com/claude-code) and ask it to fix the game's file paths: the `rwk-paths` skills (`.claude/skills/`) scan at three depths (`quick`, `standard`, `deep`) and fix at three levels (`safe` rewrites references, `standard` also renames extensions and engine folders and rewrites path literals in plugins, `thorough` also renames unsafe names). Every run prints a plan first, backs up what it edits in `.rwk-paths-backup/` of the game, scans again and restores everything if the result is worse.
