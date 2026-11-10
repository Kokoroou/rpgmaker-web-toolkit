# Lessons

Engineering lessons from bugs that reached a release or a real game, written down
so the same mistake is not made twice. Each one names the bug, the cause, and the
rule that follows.

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
