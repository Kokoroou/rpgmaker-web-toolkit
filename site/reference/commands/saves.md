---
description: "rwk saves commands: import desktop saves, export, move to another email and delete a player's cloud saves of an RPG Maker web game."
lang: en
---

# Saves commands

Part of the [commands reference](/reference/commands).

Four subcommands work on the cloud saves of a game. Each takes the game as a [target](/reference/commands#the-target).

## saves import

```powershell
& $rwk saves import "D:\Games\My Game"
```

Uploads the game's `save/` folder, overwriting same-name cloud saves. `--dry-run` lists them and uploads nothing. Target: folder. See [Update](/setup/updating#upload-desktop-saves-again).

## saves export

```powershell
& $rwk saves export my-game --email me@example.com
```

Downloads that player's cloud saves into `my-game-saves/` (`--out <folder>` to choose), as `.rmmzsave` / `.rpgsave` files. With `CLOUDFLARE_API_TOKEN`, the token needs the permission *Workers R2 Storage → Read*.

## saves move

```powershell
& $rwk saves move my-game --from old@example.com --to new@example.com
```

Moves one player's cloud saves and older saves to another email, for a player who changed address.

- Same-name saves of the new email are replaced; the old copies are deleted once every new one is written.
- Add the new email to `players` and run `upgrade` so it may sign in.
- With `CLOUDFLARE_API_TOKEN` the token needs *Workers R2 Storage → Edit*.

## saves delete

```powershell
& $rwk saves delete my-game --email old@example.com
```

Deletes one player's cloud saves and older saves after you type the email. This cannot be undone: run `saves export` first to keep a copy. Remove the email from the Access policy too. Never runs with `--yes`.
