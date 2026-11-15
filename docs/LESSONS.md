# Lessons

Engineering lessons from bugs that reached a release or a real game, written down
so the same mistake is not made twice. Each one names the bug, the cause, and the
rule that follows. Problems in a game's own files that break only on the web go in
[WEB_FIX_LESSONS.md](WEB_FIX_LESSONS.md).

## Two games, one site: the MZ game ID is not unique

**Where:** which site a deploy from a game folder updates (`cli/lib/sites.js`, the
fingerprint in `cli/lib/game.js`). Found 2026-11-15 on four real MZ games.

**The bug:** deploying a game overwrote the site of *another* game: both had the same
`advanced.gameId` in `data/System.json` (two pairs of games, each pair from one
developer). A MZ game is identified as `mz:<gameId>`, so the second game was taken for
a new version of the first: same Worker, same settings, same cloud saves, no question.
RPG Maker writes the game ID when a project is *created*, and a developer who starts
the next game from a copy of the last one keeps it. The ID was chosen because it does
not change between versions (the title often does: "… 1.00"), and that same property
is what makes it shared.

**The rule:** an identifier the toolkit did not make is a *hint* of identity, not a
proof. Before an action that overwrites something (a site, saves), check a second,
independent field, and when they disagree, ask instead of picking. Here the second
field is the title without its version and tags (`titleKey`): same ID and same title
updates as before, same ID and another title asks "a different game or a new version?"
(`--new-site` / `--name <site>` when it cannot ask). The stored title follows each
deploy, so a game renamed on purpose is asked about once.

## "Nothing to change" while the title screen fails to load

**Where:** the path scan (`cli/lib/paths.js`). Found 2026-11-15 on a deployed MZ game.

**The bug:** the published game showed the engine's error screen on the title
(`img/titles2/particles3.png` 404, the file is `Particles3.png_`), and `rwk fix-paths`
said *Nothing to change*. The name was a plugin parameter. The scan read the data
files, the plugin *names* in `js/plugins.js` and path literals in plugin code, but not
the parameters, though the plugin manager writes them from the same kind of file picker
as the database (`@type file`, `@dir`). A whole class of references was never looked at,
and "nothing found" read as "nothing wrong".

**The rule:** list every place the engine or a plugin turns a stored name into a
request, and scan each one, or say in the report which ones are not scanned. When a
real game 404s and the scan is clean, the first question is *which source did the scan
not read*, before *why did the check miss it*. `rwk test` on the game folder is the
quickest way to get that 404 without deploying.

**Again, the same day:** an MV game stopped at boot on `img/system/Window.png` (the file
is `window.png`) after `fix-paths` had run. This time the unread source was **the engine's
own scripts**: `rpg_core.js` asks for `"img/system/Window.png"` (unencrypted, its
`Decrypter._ignoreList`) and `rpg_windows.js` for `loadSystem('Window')`. No game file
names them, so a scan of the game's references can never see them. `rwk test` even
said "Fix it with rwk fix-paths", which then found nothing. Now scanned (kind `engine`,
fixed by renaming the file, since the engine is not the game's to edit). Still not
scanned: a plugin's own `ImageManager.loadX("name")` calls.

**A third time, the next deploy:** that gap, as written down. An MV game 404'd on
`img/titles2/Title.png` (a plugin's `loadTitle2("Title")`, the file is `title.png`) after
`fix-paths`. And `rwk test` found a worse one the deploy log never reached, because the
player had not opened the menu yet: the menu stopped on the error screen for
`img/menus/faces/faces3/actor_1.png`, built as `loadMenusFaces3("actor_" + id)` with a
loader the plugin adds itself. Both now scanned (kind `case`, the plugin's literal is
rewritten). A known gap in this list is not a note, it is the next bug: when one is
written down, add the check, or say it in what `analyze` prints.

**The rule, for names built in code:** a name the code builds is still checkable when its
**constant part** is written down. `"actor_" + id` cannot say which file it wants, but if
no file in the folder starts with `actor_` and some start with `Actor_`, it is wrong in
every case. And a console log is only what the player reached: run `rwk test` before
calling a game fixed.

## A control that is rebuilt under the user's finger never gets its click

**Where:** the folder download's progress panel (`runtime/RWK_Download.js`), and
`RWK_Offline`'s panel the same way. Found 2026-11-10, in the first days of the
folder download (after #123).

**The bug:** during a download the panel redraws its progress every 200 ms, and
each redraw emptied the button row (`actions.textContent = ""`) and built new
`Hide` and `Cancel` buttons. A browser sends `click` only when the press and the
release land on **the same element**: a button removed between the two never gets
one. So pressing `Hide` — or `Cancel`, to stop a download that was going wrong —
did nothing at all. The slower the connection, the more certain the redraw lands
inside the press.

**Why it looked like a repeat of #119:** that PR fixed the same *symptom* (dead
toolkit buttons) from the opposite direction. There, the **game's** plugins ate
the toolkit's events, and `rwk-guard.js` made their listeners skip a press that
started on `[data-rwk-ui]`. Here the toolkit itself took the element away, so the
guard never sees a game listener to skip, and nothing in it can help. The rule it
left behind still holds: *a press that starts on the toolkit belongs to the
toolkit, release included* — the toolkit must not break that from its own side.

**The rule:** a redraw that runs while the user can be pressing something must
only change **text and visibility**, never the identity of the controls. Build
the buttons once, keep the nodes, and show or hide them (`hidden = …`) on each
render. Rebuilding a row is fine when it follows a real interaction (the settings
menu redraws after a switch is flipped), never on a timer.

**The test:** `test/runtime-download.test.js` drives a real run over a fake DOM and
asserts the `Hide` node after the run is **the same node** the confirmation had.
The old fake DOM could not have caught this: its `textContent = ""` did not remove
children, so the redraw looked harmless. A fake that does not model the thing the
bug depends on proves nothing — check that the fake removes children, fires
`click` only on the same node, and has the real API's methods (here,
`FileSystemWritableFileStream.write()` / `close()`, not just a `WritableStream`).

## Check a file the engine reads with the engine's own reader

**Where:** the MV save import (`retitleMvGlobal` in `cli/lib/cloudflare.js`), shipped
2026-10-25. Found 2026-11-15 on two MV games whose saves did not show on the web.

**The bug:** to let saves made under an older game title load in a browser, the
import decodes `global.rpgsave`, sets the current title and encodes it again, with
the `lz-string` 1.5.0 package. MV's engine reads it with its own
`js/libs/lz-string.js`, which is 1.3. The two `compressToBase64` are **not the same
format**: 1.3 base64-encodes the UTF-16 output of `compress()` as big-endian bytes,
1.5 packs the bits 6 at a time. 1.5 reads both; 1.3 reads only about 4 strings in 5
of 1.5's and returns `""` for the rest. The engine then sees an empty `global`, and
every save is hidden: the very bug the import was meant to fix, now on games where
it had worked before the "fix". One game passed by luck, which made it look done.

**Why the test missed it:** it encoded and decoded with the same library. A round
trip through one implementation proves the code is consistent with itself, not that
the other side can read it. The first check of the real games made the same mistake:
it decoded the cloud copy with lz-string 1.5 and called it fine.

**The rule:** when the toolkit writes something the game's engine (or a plugin) will
read, check it with **the reader that will read it** — the engine's own decoder, or a
copy of its algorithm in the test — and when in doubt, run the real game on it. A
package with the same name is not the same format across major versions; pin the
format, not the package. Here the fix encodes in the 1.3 format by hand
(`mvCompressToBase64`), which is byte for byte what the engine itself writes.

**The test:** `test/cli.test.js` decodes the retitled `global` with a re-implementation
of 1.3's `decompressFromBase64`, and asserts that the same decoder rejects some 1.5
strings, so the test cannot quietly stop testing anything. Checked by hand as well
against the three `lz-string.js` variants found in 25 real games (identical output on
2,000 strings each) and by loading the saves in the real games in Chrome.

## Say what a risk is attached to, or it is just noise

**Where:** the design discussion of `www/save/` in the folder download, 2026-11-10.
No code was wrong; the *explanation* was.

**The mistake:** I warned that putting saves in `www/save/` "makes them public"
and left it at that. Read plainly, that says the toolkit publishes them — and the
next step anyone would take is to check `rwk deploy`, which **overrides nothing**:
`cli/lib/game.js` skips a `save` folder by name (`RUNTIME_DIRS`), at any depth.
The risk only exists for someone who copies `www/` to a host by hand, which is
what the guide's "upload the contents of `www/`" line is about. The person whose
workflow is `rwk deploy` only heard a warning about something that cannot happen
to them, and the real, small caveat (manual uploads) went unread.

**The rule:** when a risk is a reason to choose A over B, name **the action that
creates it**, in the same sentence — here "if you copy `www/` to a host by hand,
delete `save/` first". A risk with no actor is a vague one, and a vague one gets
argued with instead of acted on.

**The same shape, in code:** a local server standing in for the cloud API must
copy the parts of the protocol the client *checks*, not just the parts it *uses*.
`rwk-serve.mjs` served `/api/saves` without an `etag`, and `RWK_SaveSync` compares
etags to tell "unchanged since last sync" from "something else rewrote this
file": every launch would have looked like a conflict, asking the player to pick
between two identical saves. The list is what it uses; the etag is what it
checks. When re-implementing an endpoint, grep the client for every header and
field it reads, not only the ones it needs to get the work done.

