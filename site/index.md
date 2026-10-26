---
description: "Publish an RPG Maker MZ or MV game to Cloudflare Workers on the free plan, with cloud saves, an on-screen gamepad for phones and email login. For games you own."
lang: en
layout: home

hero:
  name: rpgmaker-web-toolkit
  text: Play your RPG Maker game in any browser
  tagline: One command publishes an RPG Maker MZ / MV game to Cloudflare Workers on the free plan, with cloud saves, an on-screen gamepad for phones and email login.
  image:
    src: /hero.svg
    alt: A phone running an RPG with on-screen buttons, next to a cloud that syncs its saves
  actions:
    - theme: brand
      text: Set up a game
      link: /setup/requirements
    - theme: alt
      text: I just want to play
      link: /play/

features:
  - icon: '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><polyline points="4 17 10 11 4 5"/><line x1="12" x2="20" y1="19" y2="19"/></svg>'
    title: One command
    link: /setup/first-deploy
    linkText: First deploy
    details: Paste one line into PowerShell (Windows) or Terminal (macOS, Linux) and drop the game folder in. The toolkit analyzes the game, uploads it and gives you a link. Nothing to clone or install besides Node.js.
  - icon: '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M17.5 19H9a7 7 0 1 1 6.71-9h1.79a4.5 4.5 0 1 1 0 9Z"/><path d="m10 14 2-2 2 2"/></svg>'
    title: Saves follow you
    link: /play/saves
    linkText: How saves sync
    details: Sign in with the same email on your phone and your PC and continue where you left off. Saves made offline upload once you are back online.
  - icon: '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><line x1="6" x2="10" y1="11" y2="11"/><line x1="8" x2="8" y1="9" y2="13"/><line x1="15" x2="15.01" y1="12" y2="12"/><line x1="18" x2="18.01" y1="10" y2="10"/><path d="M17.32 5H6.68a4 4 0 0 0-3.978 3.59C2.604 9.416 2 14.456 2 16a3 3 0 0 0 3 3c1 0 1.5-.5 2-1l1.414-1.414A2 2 0 0 1 9.828 16h4.344a2 2 0 0 1 1.414.586L17 18c.5.5 1 1 2 1a3 3 0 0 0 3-3c0-1.545-.604-6.584-.685-7.258A4 4 0 0 0 17.32 5z"/></svg>'
    title: Made for phones
    link: /play/controls
    linkText: Touch controls
    details: A D-pad, A / B / X / Y and L / R like JoiPlay, plus buttons for the extra keys the game's plugins use. Move or hide any button.
  - icon: '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><rect width="18" height="11" x="3" y="11" rx="2" ry="2"/><path d="M7 11V7a5 5 0 0 1 10 0v4"/></svg>'
    title: Private by default
    link: /setup/access
    linkText: Protect the site
    details: The site stays locked until Cloudflare Access is on, and only the emails you allow can open it.
  - icon: '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M3 12a9 9 0 0 1 9-9 9.75 9.75 0 0 1 6.74 2.74L21 8"/><path d="M21 3v5h-5"/><path d="M21 12a9 9 0 0 1-9 9 9.75 9.75 0 0 1-6.74-2.74L3 16"/><path d="M8 16H3v5"/></svg>'
    title: Fast updates
    link: /setup/updating
    linkText: Update the game
    details: Copy a patch or a translation over the game folder and run the same command again. Only the files that changed are uploaded.
  - icon: '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M20 20a2 2 0 0 0 2-2V8a2 2 0 0 0-2-2h-7.9a2 2 0 0 1-1.69-.9L9.6 3.9A2 2 0 0 0 7.93 3H4a2 2 0 0 0-2 2v13a2 2 0 0 0 2 2Z"/><path d="m9 13 2 2 4-4"/></svg>'
    title: Your game folder is never touched
    link: /reference/how-it-works
    linkText: How it works
    details: The toolkit builds in a temporary folder that is deleted at the end of the run.
---

## What players get

<div class="shots">

![A game on a phone in landscape, with the on-screen gamepad](/img/controls-landscape.png){.shot .landscape}

![The same game in portrait](/img/controls-portrait.png){.shot .portrait}

</div>

The game is [*GameDev: The Beginning*](https://yancharkin.itch.io/gamedev-the-beginning) by yancharkin. Its screenshots are under CC BY-SA 4.0: see [credits](/reference/credits).

## Which page do I need?

| You are… | Start here |
|---|---|
| Putting a game online for the first time | [Before you start](/setup/requirements) |
| New to Cloudflare, or wondering about the card it asks for | [Set up Cloudflare](/setup/cloudflare) |
| Letting a friend or another of your emails play | [Invite players](/setup/access#invite-players) |
| Installing a patch or a translation | [Update the game](/setup/updating) |
| Changing buttons, folders or features | [Customize the game](/setup/configuration) |
| Someone who got a link and wants to play | [Open and play](/play/) |
| Stuck on an error | [Troubleshooting](/setup/troubleshooting) |
| The person who made the game | [For game creators](/creators/) |

::: warning Responsible use
For playing a game **you own**, on your own devices. Keep Cloudflare Access on: a public or widely shared site is redistribution, which only the game's creators can allow, and you are responsible for what your Cloudflare account publishes. The toolkit follows a creator's [hosting policy](/creators/policy). Made the game yourself? Anything goes, selling access included: [For game creators](/creators/).
:::
