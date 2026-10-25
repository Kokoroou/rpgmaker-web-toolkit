# On-screen buttons

What players see is on [Touch controls](/play/controls). This page is the `controls` part of the game's [settings](/setup/configuration):

```json
"controls": {
  "enabled": true,
  "showOn": "touch",
  "gamepad": true,
  "dpad": true,
  "opacity": 0.35,
  "scale": 1,
  "extras": ["fullscreen", "editLayout"],
  "buttons": [
    { "key": "t", "label": "T", "hint": "Quest journal" },
    { "key": "r", "label": "Inspect", "pin": true },
    { "label": "Popup", "keys": [{ "key": "f", "label": "F" }, "e", "q"] }
  ]
}
```

| Key | Values | Default |
|---|---|---|
| `enabled` | The whole on-screen gamepad | first-deploy answer |
| `showOn` | `touch` (touch screens), `always`, `never` | `touch` |
| `gamepad` | A / B / X / Y and L / R (`ok`, `cancel`, `shift`, `menu`, `pageup` / `pagedown`) | `true` |
| `dpad` | The D-pad | `true` |
| `opacity` | 0 to 1 | `0.35` |
| `scale` | Button size multiplier | `1` |
| `extras` | `fullscreen` (a toolbar button on touch screens, ⚙ → Full screen otherwise) and `editLayout` (⚙ → Edit button layout) | both |

## Extra keys (`buttons`)

The first deploy finds the keys the game's plugins read and asks for a label for each.

<div class="shots">

![Plain buttons go in the ⌨ Game keys panel, with their hint](/img/game-keys.png){.shot .portrait}

![Pinned buttons and groups stay on screen: Inspect and Popup ▾](/img/controls-landscape.png){.shot .landscape}

</div>

| Field | Meaning |
|---|---|
| `key` | An RPG Maker key name (`ok`, `escape`…), a name a plugin registers (`r`, `t`…), or a keyCode |
| `label` | Text on the button |
| `hint` | What it does, shown in the ⌨ panel. Filled from the plugin's description |
| `pin` | `true`: on screen as a keycap instead of in the ⌨ panel |
| `keys` | Makes a **group** (▾) that opens a row of sub-buttons: key names or `{ "key", "label" }` |

With `"gamepad": false`, every button stays on screen. Buttons for keys the gamepad already presses are hidden. When an update adds keys, the deploy offers buttons for them.

Players can still move and hide buttons; that stays in their browser and does not change these settings.
