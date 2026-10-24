# For game creators

This page is for the people who make RPG Maker games. It covers what the toolkit does with your game, how you can use it for your own releases, and what you can do when someone hosts your game without asking.

## What the toolkit does with a game

A player runs the toolkit on a game folder on their PC. It puts a copy of the game on **their own** Cloudflare account and serves it as a website, with an on-screen gamepad and cloud saves.

| It does | It does not |
|---|---|
| Upload the game's files as they are, and add its own plugins to the web copy's `js/plugins.js` | Decrypt or extract images and audio. Encrypted files stay encrypted, and the engine decrypts them in the browser as the desktop version does |
| Lock the site until Cloudflare Access (email login) is on, by default | Remove DRM, or change the original game folder |
| Mark every web copy with `<meta name="generator" content="rpgmaker-web-toolkit">` and keep search engines out by default | Run a catalogue, a search, or any way to find other people's sites |
| Label error screens and the browser console, so bugs in its own plugins are not reported to you | Collect anything about the game or the player for the toolkit's author |

The toolkit is meant for one person playing a game they own on their own devices. A public site, or one shared with many people, is redistribution, and only you can allow that.

## Tell the toolkit what you allow

Ship a small `rwk-policy.json` with your game and the toolkit follows it. You can ask for no web copies at all, for personal copies only, or allow public sites. You can also turn off some of its features. See [Hosting policy](/creators/policy).

## Use it for your own game

The license has an [extra permission for game creators](https://github.com/Kokoroou/rpgmaker-web-toolkit/blob/main/LICENSE): for your own game you may use the toolkit for **any purpose, including commercial use**. Some uses:

| Use | How |
|---|---|
| **Closed playtest** | Keep Cloudflare Access on and [invite your testers' emails](/setup/access#invite-players). Each tester has their own saves and can [export a save](/play/save-files) to attach to a bug report. Patches upload only the files that changed |
| **Web version for supporters or early access** | The same, with your supporters' emails. Up to 50 people on the Cloudflare free plan |
| **Free public release or demo** | Choose *No protection*, then *I made this game*. You can let search engines list it |
| **Try the game on phones** | Check the touch controls, the plugin keys and very large images before deciding on an official mobile port |
| **Ship the touch controls yourself** | You may copy the plugins in [`runtime/`](https://github.com/Kokoroou/rpgmaker-web-toolkit/tree/main/runtime) into your own web or mobile build and sell it. Keep the `Required Notice:` line at the top of each file |

The permission covers games you own or publish with the owner's permission. It does not cover hosting other people's games, or offering the toolkit as a hosting service.

## If someone hosts your game without asking

Every site the toolkit makes is a Cloudflare Worker on a `*.workers.dev` address, on the account of the person who ran it. The toolkit's author cannot see or remove those sites.

1. Cloudflare stores the files of a Worker, so it can take them down. Send a copyright notice through Cloudflare's [abuse form](https://abuse.cloudflare.com/) (type *DMCA / copyright*) with the site's address.
2. Add an `rwk-policy.json` to your next release, so later versions of the toolkit stop at deploy time.
3. You can also [open an issue](https://github.com/Kokoroou/rpgmaker-web-toolkit/issues) to tell the toolkit's author about it, or about anything the toolkit should handle better for creators.

**Next:** [Hosting policy](/creators/policy)
