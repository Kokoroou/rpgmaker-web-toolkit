# Web fix lessons

What we learned fixing real RPG Maker MZ/MV games so they play on the web: problems in
**the game's own files** that do not show on Windows (Game.exe, NW.js) and break in a
browser. Bugs in the toolkit itself go in [LESSONS.md](LESSONS.md).

The point is to stop doing the same fix by hand on every game. Each lesson ends with
**Toolkit**: what already finds or fixes it, or what is still manual. Something still
manual is a candidate for `rwk analyze` / `rwk fix-paths` / the runtime.

## Writing an entry

- **No game names.** Leave out the title, folder, developer, character names, and any
  file name that identifies the game. Describe the game by engine and size ("an MV game,
  ~10,000 references, encrypted assets"). Use generic names in examples (`Actor1.png`,
  `img/pictures/Event_01.png`).
- One lesson per problem, not one per game. If a new game hits a lesson that is already
  here, add what was new (another variant, a better way to detect it) to that lesson.
- Say how sure you are. Mark a cause you only guessed at as **unconfirmed** and keep it in
  [To investigate](#to-investigate) until a game confirms it.
- Template:

  ```md
  ## <the problem, in one line>

  **On the web:** what the player sees (404 in the console, black screen, "Now Loading", no sound).
  **Why Windows hides it:** …
  **Detect:** the command or check that finds it.
  **Fix:** what to change in the game folder, and what not to touch.
  **Toolkit:** done by … / manual; idea: …
  ```

## File paths and names

### A reference spelled with a different letter case

**On the web:** a picture, sound or face is missing; the console shows a 404 for
`img/faces/actor1.png` while the file is `Actor1.png`.
**Why Windows hides it:** NTFS ignores letter case. Cloudflare's asset host and the URL do not.
**Detect:** `rwk analyze` (kind `case`).
**Fix:** change the **reference** to the file's exact name. Do not rename the file to match
the reference: other references may already use the right spelling.
**Toolkit:** done by `rwk fix-paths --level safe` (data JSON, `js/plugins.js` and plugin file parameters, `index.html`, CSS).

### Upper-case extension (`Actor1.PNG`)

**On the web:** that file is never found. The engine always asks for `.png` / `.ogg`.
**Why Windows hides it:** letter case again.
**Detect:** `rwk analyze` (kind `ext`); reading file names is enough.
**Fix:** rename the file to the lower-case extension, unless that name is taken. **Only for
files the engine adds the extension to** (pictures, sounds, movies, effects, `data/*.json`,
plugins). A font is asked for by its whole name (`mainFontFilename: "FRADM.TTF"` in MZ's
`System.json`, a plugin's own font list): `fonts/FRADM.TTF` is right as it is, and renaming it
to `.ttf` broke every font of an MZ game (404, then `LoadError` at boot).
**Toolkit:** done by `rwk fix-paths --level standard`, for those files only. The fonts in
`System.json` are checked for letter case like any other reference.

### Engine folder spelled differently (`img/Faces`, `audio/BGM`)

**On the web:** every file in that folder 404s.
**Detect:** `rwk analyze` (kind `folder`).
**Fix:** rename the folder to the engine's spelling (`img/faces`).
**Toolkit:** done by `rwk fix-paths --level standard`.

### A plugin listed with the wrong case in `js/plugins.js`

**On the web:** the plugin does not load. When other plugins or events depend on it, the
game may not start at all. This one does the most damage of all the path problems.
**Detect:** `rwk analyze` (kind `case`, source `js/plugins.js`).
**Fix:** change the `name` in `js/plugins.js` to the file's exact name.
**Toolkit:** done by `rwk fix-paths --level safe`.

### A file name in a plugin parameter with the wrong case

Example: a title-screen particle plugin with `"P3 File Name":"particles3"` in
`js/plugins.js`, its header saying `@type file` / `@dir img/titles2/`, and the file
`img/titles2/Particles3.png_` (an MZ game, encrypted assets, ~80,000 references).
**On the web:** worse than a missing picture. An MZ picture that fails to load shows the
engine's error screen ("Failed to load img/titles2/particles3.png"): here on the title
screen, so the game could not be started at all. The console shows only the 404.
**Why Windows hides it:** letter case. The plugin manager writes whatever the developer
typed, and a plugin's own defaults are often lower-case while the files are not.
**Detect:** `rwk analyze` (kind `case`, source `js/plugins.js`, site `plugin "…" parameter "…"`).
The scan reads each enabled plugin's header for parameters typed `file` (with `@dir`),
also inside `struct<…>` and lists, where the value is a JSON string in a string.
`rwk test` shows the 404 and the error screen from a real play.
**Fix:** change the value in `js/plugins.js` to the file's exact name, not the file.
**Toolkit:** done by `rwk fix-paths --level safe`. A value with a quote or a backslash, or
written a different number of times than the scan found, is reported without a fix.
A parameter typed `string` that a plugin uses as a file name is not seen: the header is
all the scan knows.

### A file the engine asks for by name, spelled differently (`img/system/window.png`)

Example: an MV game (encrypted assets, ~5,000 references) with `img/system/window.png` and
`window.rpgmvp`, while the engine loads `Window`. A plugin also loads `"window"`, which is
why the lower-case spelling looked right.
**On the web:** the game never leaves Scene_Boot: "Loading Error / Failed to load:
img/system/Window.png / Retry", and four 404s for `Window.png` in the console.
**Why Windows hides it:** letter case. And on MV it is always the **plain** `.png`: `rpg_core.js`
lists `"img/system/Window.png"` in `Decrypter._ignoreList`, so the engine reads it unencrypted
even in an encrypted game. `window.rpgmvp` does not help.
**Detect:** `rwk analyze` (kind `engine`). The scan reads the engine's own scripts
(`js/rpg_*.js`, `js/rmmz_*.js`): the paths written whole there (that ignore list) and the
names in `ImageManager.loadSystem('IconSet')` / `reserveSystem(…)` calls, with the extension the
encryption gives (`.rpgmvp` MV, `.png_` MZ, else `.png`). No game file writes these names, so
the reference scan never saw them. `rwk test` shows the error screen.
**Fix:** rename the **file** to the engine's spelling (`window.png` → `Window.png`), not the
engine. Only the file the engine reads: here the plugin's `"window"` still finds `window.rpgmvp`.
**Toolkit:** done by `rwk fix-paths --level standard`. A plugin's own `loadSystem("name")`
calls: see the next lesson.

### A name a plugin loads by itself, spelled differently (`loadTitle2("Title")`)

Two variants from one MV game (~10,000 files, a MOG title and menu set):
- `ImageManager.loadTitle2("Title")` in a title-screen plugin, the file `img/titles2/title.png`.
  **On the web:** the title picture is missing, two 404s for `Title.png`.
- `ImageManager.loadMenusFaces3("actor_" + actorId)`, a loader the menu plugin adds
  (`ImageManager.loadMenusFaces3 = function(filename) { return this.loadBitmap('img/menus/faces/faces3/', filename, 0, true); }`),
  the files `Actor_1.png`, `Actor_2.png`… **On the web:** opening the menu stops the game on
  "Loading Error / Failed to load: img/menus/faces/faces3/actor_1.png". The same plugins load
  `"Actor_" + id` everywhere else, which is why it looked right.
**Why Windows hides it:** letter case. No data file or path literal names these files.
**Detect:** `rwk analyze` (kind `case`, source the plugin, `ref` `Title` or `actor_…`). The scan
reads `ImageManager.<loader>("name")` and `("prefix" + …)` in `js/plugins/*.js`, for the engine's
loaders and for those a plugin defines as `return this.loadBitmap('img/…/', filename, …)`. A
prefix is wrong when no file in the folder starts with it and some do in another case. `rwk test`
shows the menu one (the deploy log did not: the player had not opened the menu).
**Fix:** change the literal in the plugin (`"actor_"` → `"Actor_"`), not the files.
**Toolkit:** done by `rwk fix-paths --level standard`. Not seen: a name from a variable or a
plugin parameter used as a string, and loaders defined some other way.

### Plugin errors at boot that Windows has too

Two seen in the same MV game (core 1.6.1): `DataManager.setAutoSaveFileId is not a function`
(a newer `Community_Basic.js` than the core, it throws on its last lines, after the screen size
is set) and `DotMoveSystemClassAlias is not defined` (`DotMoveSystem_FunctionEx.js` enabled
without the `DotMoveSystem.js` it extends: the add-on does nothing).
**On the web:** two uncaught errors in the console and in `rwk test`; the game plays.
**Why it is not a web problem:** the same scripts throw the same way in NW.js.
**Detect:** the plugin's code against the engine (`grep setAutoSaveFileId js/rpg_*.js`) or the
plugin list (is the base plugin there?).
**Fix:** none needed. Do not "fix" it by adding the missing plugin: that changes how the game plays.
**Toolkit:** reported by `rwk test`, as it cannot tell. Idea: say "also on Windows" when the
error is a missing function of the engine or a missing base plugin.

### A folder written in plugin code with the wrong case

Example: `loadBitmap('img/menus/CG/', name)` when the folder is `img/menus/cg`.
**On the web:** not one missing picture but the whole folder. A scene that waits for those
pictures never starts: the browser stays on "Now Loading" while the console fills with 404s.
**Detect:** `rwk analyze` (kind `case`, `ref` ending in `/`), since #127.
**Fix:** change the literal in the plugin to the folder's spelling.
**Toolkit:** detected by `analyze`. `fix-paths --level standard` rewrites path literals in
`js/plugins/*.js`. A folder that does not exist at all is not reported (the plugin may be
turned off): read the `deep` list.

### A file name built at run time

`"img/pictures/" + name`, names from variables, note tags, event scripts.
**On the web:** missing files that a static scan says are fine.
**Detect:** `rwk-paths-scan --level deep` gives a reading list of the code that builds
paths. It cannot prove anything about them.
**Fix:** by hand. Find the values the variable takes, and either fix the case at the source
or lower-case the name the code builds.
**Toolkit:** manual. Idea: log the 404s the game requests in the browser (runtime) and map
each one back to the file under another case, so that `doctor` can report them from a real
play session.

### A Live2D model file spelled differently from its folder

Example: `live2dModel/Model_01/model_01.model3.json`, while the folder and every other file
in it use `Model_01`.
**On the web:** the first scene that shows the model stops the game with the plugin's own
"model load error". The console shows a 404 for `live2dModel/Model_01//Model_01.model3.json`,
then `Cannot read properties of undefined (reading 'at')` inside the Live2D plugin.
**Why Windows hides it:** letter case. The plugin builds the name at run time from the
model's folder (`<folder>/<folder>.model3.json`); the events only name the folder
(`… Model_01 …` in a plugin command).
**Detect:** `rwk analyze` (kind `model`), since #162: a `*.model3.json` / `*.model.json` whose
name differs from its folder only by case. It also looks in the folders the build leaves out.
Seen in an MV game with an obfuscated commercial Live2D plugin (Cubism 4).
**Fix:** rename the **file** to the folder's spelling (an exception to "change the
reference": the reference is in plugin code you may not edit). Windows still finds it.
The model folder sits outside the engine's folders: answer yes when the first deploy asks
whether to include it (`include` in the config), or every model is missing.
**Toolkit:** done by `rwk fix-paths --level standard` (#162).

### The same name in two Unicode forms (NFC / NFD)

**On the web:** a file with accents or Japanese kana is "missing" although it is right
there. Archives made on macOS store names in NFD.
**Detect:** `rwk analyze` (kind `unicode`).
**Fix:** change the reference to the file's exact bytes.
**Toolkit:** done by `rwk fix-paths --level safe`.

### Two files whose names differ only by case

**On the web:** unpredictable. Both exist on a case-sensitive disk, but Windows shows only
one of them. This happens when the game was unzipped on Linux/macOS, or when two patches
were merged.
**Detect:** `rwk analyze` (kind `collision`).
**Fix:** a person picks which file to keep (compare sizes and dates, or open both).
**Toolkit:** manual on purpose: there is nothing to go on to choose automatically.

### `%`, `#`, `?` in a file name

**On the web:** `#` and `?` end the path in a URL, so the file is never asked for. With `%`,
the deploy itself failed: Cloudflare reads asset paths as percent-encoded
(`goblin133%.png` is refused, `a%20b.png` would mean `a b.png`).
**Detect:** `rwk analyze` (kind `unsafe`).
**Fix:** rename the file and its references (`a#1.png` → `a_1.png`).
**Toolkit:** files with `%` go to R2 by themselves (#154). `fix-paths --level thorough`
renames `#`, `?`, `%XX` and spaces at the ends of names.

### Non-ASCII file names

**On the web:** usually fine, but these are the first suspects when something is missing.
Look here before anything else.
**Detect:** `rwk analyze` warns with the count and a few examples.
**Toolkit:** warning only.

## The engine and NW.js

### A plugin reads `process` when the page loads

**On the web:** that plugin file throws on its first line in a browser, and **every plugin
after it in the same file** is gone too. On MZ, the engine's own `main.js` also reads
`process.mainModule.filename` as soon as `process` exists: a black screen before Scene_Boot.
**Why Windows hides it:** NW.js always has a Node.js `process`.
**Toolkit:** done by `runtime/rwk-guard.js` (#120, #141). It gives the page a `process` object
that is **not** Node.js: no `require`, `versions` without `node-webkit`, so
`Utils.isNwjs()` still says "browser". Keep it that way, because a plugin that thinks it is
in NW.js calls `require('fs')`.

### A plugin calls `require('fs')` without checking for NW.js

**On the web:** `ReferenceError: require is not defined` in the console. Where it happens
decides the damage: in a plugin command run by an event, the error can stop the game; in an
override that has already done its main work, it is only a console line.
**Why Windows hides it:** NW.js always has Node.js `require`.
**Toolkit:** cannot be fixed globally. A page-wide `require` would make the engine's
`Utils.isNwjs()` (MV: `typeof require === 'function' && typeof process === 'object'`) say
"desktop", and saves would then go to `fs`. Patching the plugin is the only fix, and
obfuscated commercial plugins often forbid it: check whether the game still plays.
Seen in an MV Live2D plugin: once at `SceneManager.run` and in each "add model" command.
In both places the game went on and the model showed (checked in Chrome).

Two more variants, from an MV game with a text-script (ADV) system:
- **Extra save data in its own file.** A "common save" plugin (flags shared by every slot)
  writes `save/common.rpgsave` with `fs`. Its `load()` catches the `require` error, but assigns
  an undeclared `json` inside the `try` and reads it after: on NW.js that is a sloppy-mode
  global, in a browser a second `ReferenceError` outside the `try`, thrown from
  `DataManager.createGameObjects`. The game stops at boot. **Read past the first error**: a
  `catch` around the `require` does not mean the plugin survives it.
  Fix: in the plugin, `if (!Utils.isNwjs())` keep the data in `localStorage` (one key of its
  own), and declare the variable. The toolkit syncs only `fileN`, `global` and `config`, so
  that data stays in the browser and is not in the cloud saves.
- **Script files read from beside Game.exe.** The ADV plugin reads its scenario files
  (`scenario/*.sl`, ~380 files) with `fs.readFileSync` from `scenario/` next to `Game.exe`,
  **outside `www/`** (it builds the folder from `process.argv[0]`). The first event that runs a
  script stops the game. The web build cannot reach that folder at all.
  Fix: copy `scenario/` into `www/scenario/` (Game.exe still reads the old one), add
  `{"include": ["scenario"]}` to `rwk.json` in the game folder (not an engine folder, so the
  build leaves it out otherwise), and in the plugin `if (!Utils.isNwjs())` read
  `'scenario/' + name` with a synchronous `XMLHttpRequest` (`overrideMimeType('text/plain;
  charset=utf-8')`, so the bytes decode as `fs` decoded them). The plugin's code is synchronous;
  a `fetch` would mean rewriting its callers.
Keep the original plugin outside `www/` (`<game>/<plugin>.js.orig`) so it is not uploaded.
**Detect:** `rwk test` (the error screen names the plugin); `grep -l "require(" js/plugins/*.js`,
then keep the enabled plugins whose call is not behind `Utils.isNwjs()` (the common
`require('nw.gui')` in a `catch` behind `$gameTemp.isPlaytest() && Utils.isNwjs()` is fine).
Idea: `rwk analyze` could list them, and the top-level folders beside `www/` that a plugin reads.

### A plugin for the game's own phone app calls its native bridge on any phone

**On the web:** fine on a computer; on a phone (or Chrome's phone mode) the game never gets
past "Now Loading" and shows `ReferenceError: ExternalStorage is not defined`.
**Why Windows hides it:** `Utils.isMobileDevice()` is false on Windows. Seen in an MZ game
that also ships an Android app: its save plugin treats every mobile device as that app and
calls the app's JavaScript bridge (an `ExternalStorage` global) from `ConfigManager.load`,
so a phone browser stops at boot.
**Detect:** `rwk test` (the "phone" step); `grep -n "isMobileDevice" js/plugins` and read what
each branch calls.
**Fix:** in that plugin, a local `const isAndroidApp = () => Utils.isMobileDevice() && typeof
ExternalStorage !== "undefined";` and use it in place of `Utils.isMobileDevice()`: a phone
browser then saves like a computer's (localforage, synced by the toolkit). Keep the original
beside the game, outside the build (`<game>/<plugin>.js.orig`).
**Toolkit:** manual. Idea: `rwk analyze` could list plugin code that calls an undefined global
behind `isMobileDevice()`.

### Game plugins that eat touches and clicks

**On the web (phone):** the toolkit's buttons and dialogs do not respond. The game cancels
`touchend`, swallows `click`, or captures the pointer on its canvas.
**Toolkit:** done by `rwk-guard.js` (#119): the game's listeners skip any press that starts
on `[data-rwk-ui]`.

### MV saves made before an update that changed the game title

**On the web:** the Load screen shows the save slots as empty or greyed out, although the
`fileN.rpgsave` files were imported. Seen on 3 of the 25 games scanned on 2026-11-15, all MV
whose title carries the version (`… v1.04` → `… v1.07`).
**Why Windows hides it:** MV's `DataManager.isThisGameFile` checks that the slot's `title` in
`global.rpgsave` equals `$dataSystem.gameTitle` only when `StorageManager.isLocalMode()` is
false, that is, in a browser. MZ does not check the title.
**Detect:** decode `save/global.rpgsave` (LZString base64) and compare each slot's `title` with
`gameTitle` in `data/System.json`.
**Fix:** do not change `System.json`; give the slots the current title in the copy that goes to
the web. Encode it again **in the engine's LZString 1.3 format**: lz-string 1.5's
`compressToBase64` output is often read by MV as an empty `global`, which hides every save
(see [LESSONS.md](LESSONS.md)).
**Toolkit:** done by the save import (`rwk saves import`, or the question on the first deploy):
`retitleMvGlobal`. The files in the game folder are not changed.

## Media and size

### Ogg-only audio, WebM-only movies

**On the web:** no sound or no movie on phones that cannot play Ogg/WebM (older iPhones).
**Detect:** `rwk analyze` counts the audio with no `.m4a` and the movies with no `.mp4`.
**Toolkit:** warning only. Idea: convert them (ffmpeg) as a separate, opt-in command.

### Too many files, or files that are too big

**Limits:** 20,000 files and 25 MiB per file on the free plan (`cli/limits.json`).
**Toolkit:** files that are too big go to R2 by themselves. Over 20,000 files, deploy stops and
lists the folders: exclude what the game does not need (`exclude` in `rwk.json`, for
example an unused `data-xx/` translation).

## Missing files

### Most `missing` references are not web problems

In the first scan of 25 games (2026-11-14, `rwk analyze`), 24 had `missing` references, from
1 to 4,335 per game. In all but one of them, `missing` was the **only** kind found.
`fix-paths` does not touch them, and it should not: there is no file to point to.
**Before treating one as a bug,** check:
- Is the map or event actually used? Old test maps and removed scenes keep their references.
- Is there an encrypted twin (`.rpgmvp`, `.rpgmvo`, `.png_`)? The scanner counts those as the
  file, so a twin is not the cause. If it still says missing, the name really differs.
- Is there a file with a close name (typo, other extension)?
A file that is also missing on Windows is not a web problem. The scan reports it anyway,
because it cannot tell the difference.
**Toolkit:** reported, never fixed. Idea: group `missing` by map and say which maps are
reachable (transfer commands from the start map), so that the long list gets shorter.

## To investigate

- **What a Live2D plugin loses when `require` fails (unconfirmed).** In the MV Live2D
  plugin above, the "add model" command throws in its `setMotionSeData` step on the web.
  The model shows and moves, but the sounds tied to motions (a `voice.csv` in some model
  folders) may never play. Still to check: play a scene with motion sounds and compare
  with Game.exe.

- **Asset names translated together with the text (unconfirmed).** An English MV game
  (~11,000 references, encrypted assets) had 4,335 `missing` references, mostly sound
  effects in event commands. The references are English words close to the real files
  (`Heart sounds` for `Heartbeat`, `Insertion 2` for `Insert 2`). A translation tool that
  translates `data/*.json` may also translate the `name` of audio and pictures in event
  commands. Still to check: does the Windows build play those sounds (in which case
  something maps the names), or is it broken there too? If confirmed, the fix is to restore
  the names from the original-language `data/`, never to rename files.
