---
description: "Machine-translate an RPG Maker web game as you play: messages, choices, names and item descriptions, with a font that has every Vietnamese mark."
lang: en
---

# Live translation

In the menu: ⚙ → **Display** → **Translate the game** and **Translate into**.

For a game in a language you do not read. **Translate the game** turns on machine translation of what the game says: messages, choices, the speaker's name, and the names and descriptions of items, weapons, armor and skills. **Translate into** picks the language, when the site offers more than one. Both are remembered in this browser, and your saves do not depend on them.

It is there only when the person who set up the game [turned it on](/reference/config) (it is off unless they do), and the game's creator can keep it off.

## What to expect

- **The original shows until a line is ready.** A message waits up to 2 seconds for its translation, then shows as the game wrote it. A line translated once comes back at once the next time, for you and for everyone who plays games on the same site, since each translated line is kept.
- **Machine translation.** Names may come out oddly, a joke may not survive, and the same word can be translated two ways in two messages. Colors, icons and names inside a message (`\C[2]`, `\I[5]`, `\N[1]`…) stay in place; the words around them are translated in pieces.
- **Lines are broken again** to fit the message window; a long translation goes on to a next page.
- **Not translated:** text drawn on pictures, menus the game builds itself (Status, Options…), scrolling text, and plugins that draw their own text.
- **A daily limit.** The translations come from Cloudflare's Workers AI, which has a free daily allowance. Past it, new lines stay in the original until the next day (a message says so once); lines already translated still show.
- **Vietnamese** uses a system font with every mark (ơ, ư, ề…), since many game fonts lack them. Turn translation off to get the game's own font back.

Turning it off puts every name back as it was. A game that ships its own translations has ⚙ → [Language](/play/language) instead: those are written by people and usually read better.
