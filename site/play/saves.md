---
description: "Cloud save sync for an RPG Maker web game: saves follow your email, so you can save on a phone and continue on a PC. "
lang: en
---

# Saves on several devices

With **cloud save sync** on, your saves follow your email. Save on your phone, continue on your PC. Nothing to do: save in the game as usual.

| When | What happens |
|---|---|
| The game opens | It keeps the newer copy of each save, this device's or the cloud's (*☁ Saves are in sync*) |
| You save | The save uploads a second later (*☁ Saved to the cloud*) |
| You are offline | You play with this device's saves; they upload when you are back online |

## The ☁ icon

⚙ → **Cloud saves** shows where your saves are, with this icon and in words. Tap it to upload waiting saves.

| Icon | Means |
|---|---|
| ☁ with a tick | Every save is in the cloud |
| ☁ with an arrow | Uploading |
| ☁ crossed out | Offline or a network problem: saves stay on this device and upload later |
| Red ☁ with ! | Login expired, or a save differs from the cloud: see below |

## If the game asks

<div class="shots">

![The game may be open on another device](/img/sync-recent.png){.shot .portrait}

![This device's saves differ from the cloud](/img/sync-conflict.png){.shot .portrait}

</div>

| Message | Do |
|---|---|
| **The game may be open on another device** | Another device saved in the last 5 minutes. Close the game there, then **Got it** |
| **This device's saves differ from the cloud** | A save changed in both places. **Use the cloud's** takes your other device's copies; **Keep this device's** uploads these. Not sure? [Export](/play/save-files#export) the one you might lose first |
| **The cloud has a newer save** | Another device updated the slot you just saved. **Overwrite cloud** keeps yours; **Later** asks again next time the game opens |
| **Login expired** | Reload the page and sign in. Saves made in the meantime are kept and upload after the reload |

## Bring back an older save

![⚙ → Older saves](/img/save-history.png){.shot .portrait}

The cloud keeps older copies of your saves: one when a save is overwritten (at most every 15 minutes, or when another device saves over it) and one when it is deleted. By default up to 10 per save, for 30 days.

Tap ⚙ → **Older saves**, pick a copy, then **Restore**. It replaces that save on every device, and the game restarts. The save it replaced is kept in the list, so you can change your mind.

Use it when a save is broken, when you picked the wrong copy above, or when you saved over the wrong slot. It needs an internet connection.

::: tip Good habits
Play on one device at a time, use the same email everywhere, and keep a second slot before a boss.
:::
