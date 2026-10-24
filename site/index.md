---
layout: home

hero:
  name: rpgmaker-web-toolkit
  text: Play your RPG Maker game in any browser
  tagline: One command publishes an RPG Maker MZ / MV game to Cloudflare Workers on the free plan, with cloud saves, an on-screen gamepad for phones and email login.
  actions:
    - theme: brand
      text: Set up a game
      link: /setup/requirements
    - theme: alt
      text: I just want to play
      link: /play/

features:
  - title: One command
    details: Paste one line into PowerShell and drop the game folder in. The toolkit analyzes the game, uploads it and gives you a link. Nothing to clone or install besides Node.js.
  - title: Saves follow you
    details: Sign in with the same email on your phone and your PC and continue where you left off. Saves made offline upload once you are back online.
  - title: Made for phones
    details: A D-pad, A / B / X / Y and L / R like JoiPlay, plus buttons for the extra keys the game's plugins use. Move or hide any button.
  - title: Private by default
    details: The site stays locked until Cloudflare Access is on, and only the emails you allow can open it.
  - title: Fast updates
    details: Copy a patch or a translation over the game folder and run the same command again. Only the files that changed are uploaded.
  - title: Your game folder is never touched
    details: The toolkit builds in a temporary folder that is deleted at the end of the run.
---

## Which page do I need?

| You are… | Start here |
|---|---|
| Putting a game online for the first time | [Before you start](/setup/requirements), then [First deploy](/setup/first-deploy) |
| Letting a friend or another of your emails play | [Protect the site and invite players](/setup/access#invite-players) |
| Installing a patch or a translation | [Update the game](/setup/updating) |
| Changing buttons, folders or features | [Customize the game](/setup/configuration) |
| Someone who got a link and wants to play | [Open and play](/play/) |
| Stuck on an error | [Troubleshooting](/setup/troubleshooting) |

::: warning Responsible use
This toolkit is for playing games **you own**, by yourself or with people close to you. Game files belong to their creators. Keep Cloudflare Access on and do not share the link publicly: a site anyone can open is redistribution of the game.
:::
