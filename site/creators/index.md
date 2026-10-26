---
description: "For RPG Maker game creators: what the toolkit does with a copy of your game, what it never does, and how to allow, limit or forbid web hosting."
lang: en
---

# For game creators

A player runs the toolkit on their copy of your game. It puts that copy on **their own** Cloudflare account, behind an email login by default, with [touch controls](/play/controls) and [cloud saves](/play/saves).

| It does | It does not |
|---|---|
| Upload the game's files as they are, plus its own plugins in the web copy's `js/plugins.js` | Decrypt or extract images and audio (the engine decrypts them in the browser, as on desktop) |
| Keep the site locked until Cloudflare Access is on | Remove DRM, or change the original game folder |
| Mark each copy with `<meta name="generator" content="rpgmaker-web-toolkit">` and keep search engines out | Run a catalogue or any way to find other people's sites |
| Label error screens and the console, so its bugs are not reported to you | Collect anything for the toolkit's author |

A public or widely shared site is redistribution, and only you can allow that.

## Say what you allow

Ship an [`rwk-policy.json`](/creators/policy) with the game: no web copies, personal copies only, shared or public, and features to turn off.

## Use it for your own game

The license's [game creators permission](https://github.com/Kokoroou/rpgmaker-web-toolkit/blob/main/LICENSE) allows **any use, commercial included**, for a game you own or publish:

| Use | How |
|---|---|
| Closed playtest | Keep Access on and [invite testers](/setup/access#invite-players). Each has their own saves and can [export one](/play/save-files#export) for a bug report |
| Supporters / early access | The same with supporters' emails (50 on the free plan) |
| Free public release or demo | *No protection* → *I made this game*; search engines may list it |
| Try it on phones | Check touch controls, plugin keys and huge images before an official port |
| Ship the touch controls | Copy [`runtime/`](https://github.com/Kokoroou/rpgmaker-web-toolkit/tree/main/runtime) into your own build, even a paid one. Keep each file's `Required Notice:` line |

It does not cover hosting other people's games or offering the toolkit as a hosting service.

## Someone hosts your game without asking

Each site is a Worker on a `*.workers.dev` address, on the account of whoever ran the toolkit. Its author cannot see or remove them.

1. Send a copyright notice through Cloudflare's [abuse form](https://abuse.cloudflare.com/) (*DMCA / copyright*) with the address.
2. Add an `rwk-policy.json` to your next release so later deploys stop.
3. Optionally, [open an issue](https://github.com/Kokoroou/rpgmaker-web-toolkit/issues) to let the author know.

**Next:** [Hosting policy](/creators/policy)
