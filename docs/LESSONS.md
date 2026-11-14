# Lessons

Engineering lessons from bugs that reached a release or a real game, written down
so the same mistake is not made twice. Each one names the bug, the cause, and the
rule that follows. Problems in a game's own files that break only on the web go in
[WEB_FIX_LESSONS.md](WEB_FIX_LESSONS.md).

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

