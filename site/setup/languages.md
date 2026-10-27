---
description: "Publish an RPG Maker game with several translations: how to name the data-vi, data-en folders, how players pick a language, and the languages setting."
lang: en
---

# Translations

A game can ship more than one language. Put each translation in a copy of `data/` named `data-<code>`, next to the original:

```text
My Game/
├─ data/          the game as it is (any language)
├─ data-vi/       Vietnamese
├─ data-en/       English
└─ data_zh-tw/    Traditional Chinese
```

The toolkit publishes them all, and players pick one with ⚙ → **Language** ([how that looks](/play/language)). Nothing else to set up.

## Naming a translation

| Folder | Counts as a translation? |
|---|---|
| `data-vi`, `data_en`, `data-zh-tw`, `data_zh_TW` | Yes: a **two-letter** language code (`vi`, `en`, `ja`, `ko`…), then an optional region |
| `data-backup`, `data-old`, `data-new` | No: published like any `data-*` folder, but not offered as a language |
| `data` | The game as it is. It is the fallback for every file a translation lacks |

Case does not matter (`data-VI` is `vi`), and `-` and `_` mean the same. The code is only used to name the language in the menu, in the language itself (`vi` → Tiếng Việt, `ja` → 日本語). The folders Vietnamese and Chinese translators often use for the same languages, `vn`, `jp`, `cn`, `tw`, `kr`, are named correctly too.

A translation only needs the files it changes. Translated `System.json` and `Map012.json`, nothing else? Every other file comes from `data/`. `analyze` tells you how many files each translation lacks:

```text
Translations players can pick: vi (data-vi, 12 file(s) fall back to data/), en (data-en)
```

Only `.json` files directly in the folder count (`data-vi/Map001.json`). Pictures, audio, fonts and plugins are shared by all languages: a translation that draws text on pictures (a title screen, say) still shows the original ones.

## How it works in the browser

`RWK_Language` sits between the game and its data. The engine and most plugins ask for `data/Map001.json`; when the player's language has a `Map001.json`, the request goes to `data-vi/Map001.json` instead. The data is read once at start-up, so changing language restarts the game (the menu says so: progress since the last save is lost).

The choice is kept in the browser, per game. It is not part of the cloud save, so a phone and a PC can play in different languages from the same save.

## The `languages` setting

Without it, players start in the original and can pick any translation found. Set it with `config` → **Advanced: edit the JSON**:

| To | Set |
|---|---|
| Start players in Vietnamese (they can still pick another) | `"languages": { "default": "vi" }` |
| Everyone plays in Vietnamese, no menu entry | `"languages": { "default": "vi", "lock": true }` |
| Name the original in the menu (Japanese, say) | `"languages": { "original": "ja" }` |
| Ignore the translations: no menu entry, original only | `"languages": false` |
| Leave one translation out | `"exclude": ["data-tw/**"]` |

`default` is the folder's code, as typed in the folder name (`vn` for `data-vn`). A code with no folder is reported at the next deploy, and players start in the original. Changing `languages` or the folders changes the web build, so publish again to apply it.

Over the free plan's file limit? Each translation adds one file per `data/` file it translates; `exclude` the ones you do not need.

## For translators

If you ship a translation of someone else's game, check the [creator's policy](/creators/policy) first: it says whether the game may be published at all, and by whom. The folder convention above is the same whether you publish with the toolkit or give friends a patch: copy `data/` to `data-<code>`, translate the copy, and leave `data/` untouched, so the original can always be restored. A patch is only the `data-<code>` folder.
