# On-screen buttons

The first deploy asks whether to add an on-screen gamepad. Everything about it lives under `controls` in the game's settings ([how to edit them](/setup/configuration#edit-the-settings)).

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

Players can also move and hide buttons themselves in the game; see [Touch controls](/play/controls#move-or-hide-buttons). Their changes stay in their browser and do not change these settings.

## The gamepad

The layout follows emulator apps such as JoiPlay: a D-pad bottom-left, A / B / X / Y bottom-right, L / R above them. The buttons press the same keys RPG Maker maps a real controller to:

| Button | Key | Does |
|---|---|---|
| A | `ok` | Confirm, talk, interact |
| B | `cancel` | Back / close |
| X | `shift` | Dash (hold) |
| Y | `menu` | Open the game's menu |
| L / R | `pageup` / `pagedown` | Previous / next page (switch actor in menus) |

| Key | Values | Default |
|---|---|---|
| `enabled` | `true` / `false`: the whole on-screen gamepad | answer to the first-deploy question |
| `showOn` | `touch` (touch screens only), `always`, `never` | `touch` |
| `gamepad` | A / B / X / Y and L / R | `true` |
| `dpad` | The D-pad (slide your thumb to change direction) | `true` |
| `opacity` | 0 to 1 | `0.35` |
| `scale` | Multiplies the button size | `1` |
| `extras` | Toolbar extras: `fullscreen` (⛶) and `editLayout` (✥ Edit button layout in ⚙). Remove one to hide it | both |

## Extra keys

Many games use plugins that read keys a phone has no way to press: a quest log on `T`, a map on `M`… The toolkit finds these keys in the game's plugins at the first deploy and asks for a label for each. They are listed in `buttons`:

| Field | Meaning |
|---|---|
| `key` | The key: an RPG Maker key name (`ok`, `escape`, `pageup`…), a name a plugin registers (`r`, `t`…), or a numeric keyCode |
| `label` | Text on the button |
| `hint` | What the key does, shown under the button. Filled in from the description of the plugin that reads the key |
| `pin` | `true` keeps the button on screen as a keycap. Otherwise it lives in the ⌨ **Game keys** panel |
| `keys` | Makes a **group**: a button that opens a row of sub-buttons. Each entry is a key name or `{ "key", "label" }` |

Where buttons show:

- By default, extra keys are in the ⌨ **Game keys** panel of the toolbar, so they don't crowd the screen.
- Pinned buttons and groups stay on screen: above L / R in portrait, down the right edge in landscape. When `gamepad` is `false`, every button is shown this way.
- Buttons for keys the gamepad already presses (`ok`, `escape`, `pageup`…) are hidden while `gamepad` is on.

When a game update adds new keys, the deploy offers to add buttons for them; see [Update the game](/setup/updating#install-a-patch-or-a-translation).
