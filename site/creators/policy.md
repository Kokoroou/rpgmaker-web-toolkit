# Hosting policy (`rwk-policy.json`)

A game creator can put a file named `rwk-policy.json` in the game folder, next to `index.html` (for MV, in `www/` or next to `Game.exe`). The toolkit reads it every time someone publishes the game, so a new release can change it.

```json
{
  "hosting": "personal",
  "features": { "saveTools": false },
  "message": "Thanks for buying the game! Please don't share your web copy.",
  "contact": "https://example.itch.io"
}
```

The file is not part of the web copy.

## `hosting`

| Value | The toolkit |
|---|---|
| `"none"` | Refuses to publish the game, shows your message and contact, and tells the player how to delete a site they made before |
| `"personal"` | Publishes behind Cloudflare Access only. A public site is not offered. Each deploy warns when more than one email has saves |
| `"shared"` | Publishes behind Cloudflare Access only. The player may invite people without warnings |
| `"public"` | Allows a public site, without asking the player why it may be public |

A file the toolkit cannot read (bad JSON, unknown or missing `hosting`) counts as `"personal"`.

A game with no policy file: the player chooses. A public site needs an answer to *"Why may this game be public?"* (*I made this game* or *its creators allow it*), and each deploy warns when more than 5 emails have saves.

## `features`

Set a feature to `false` to turn it off in every web copy. The player cannot turn it back on with `edit-config`.

| Key | Turns off |
|---|---|
| `saveTools` | 💾 Saves in the ⏸ menu: exporting, importing and deleting save files |
| `itemBatch` | Using several items at once, from the item menu and in battle |
| `fastForward` | [Fast forward](/play/speed), e.g. for a game built around timing |
| `messageMode` | [Message modes](/play/messages): Auto, Skip, and a tap ending pauses in the text |
| `alwaysDash` | ⏸ → [Always dash](/play/dash). The game's own Options menu still has it unless the game removed it |
| `quickSave` | [Quick save / load](/play/quick-save), e.g. for a game that disallows saving in some places on purpose |
| `autoSave` | The toolkit's [autosave](/play/quick-save#autosave). The game's own autosave is not affected |
| `sync` | Cloud save sync: each browser keeps its own saves |

Keys the toolkit does not know yet are ignored, so you can already list features from later versions.

## `message` and `contact`

Shown to the player when they publish the game. Use them to say what you allow, where to buy the game, or where an official mobile version is.

## What a policy can and cannot do

The policy is a request the toolkit honours. It is not DRM: anyone can delete the file, or change the toolkit, since its code is public. It works for the people who want to respect your wishes, which is most of them, and it states your wishes clearly when you need to send a takedown request.
