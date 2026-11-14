---
description: "rwk commands for a published game: upgrade, config, rename, status, logs, open, list, delete and doctor, with what each does and needs."
lang: en
---

# Manage published games

Part of the [commands reference](/reference/commands).

Each command takes a [target](/reference/commands#the-target): a folder, a link or a name.

## upgrade

```powershell
& $rwk upgrade my-game
```

Updates the toolkit of a deployed game without uploading it again; the game files stay as uploaded. From a folder it only reads the site name and the creator's policy. Name several games (`upgrade game1 game2`) or use `--all` for every game of the account (the ones already on this toolkit version are skipped): one login, one question, one summary, and a game that fails does not stop the others. See [Update](/setup/updating#new-toolkit-version-game-folder-gone).

## config

```powershell
& $rwk config "D:\Games\My Game"
```

Changes the game's settings by answering questions (the JSON in Notepad, TextEdit or `$EDITOR` is one menu entry away). `--get <key>` prints one setting; `--set <key>=<value>` (repeatable) changes one without questions, also unattended. Feature settings apply without publishing again. See [Customize](/setup/configuration).

## rename

```powershell
& $rwk rename "D:\Games\My Game" --to new-name
```

Moves the site to a new name (address), keeping the saves. Without `--to` it asks. `--dry-run` checks the name and changes nothing. Target: folder. See [Update](/setup/updating#change-the-site-address).

## status

```powershell
& $rwk status my-game
```

Whether the site is up, whether Access is in front of it, how many emails have saves, and which toolkit version it runs (recorded from this version on). Target: link or name.

## logs

```powershell
& $rwk logs my-game
```

Shows the Worker's requests and errors as they happen, until Ctrl+C (terminal only).

## open and list

`rwk open my-game` opens the site in the browser. `rwk list` lists the games published in this Cloudflare account and takes no target.

## delete

```powershell
& $rwk delete my-game
```

Deletes the site's Worker after you type its name. Saves and large files stay in R2, so the game can be published again.

- `--purge` deletes them too (every player's saves and older saves, the settings, the player list, the large files). This cannot be undone: `saves export` first keeps a player's saves.
- The Access application stays in the dashboard.
- Never runs with `--yes`.

## doctor

```powershell
& $rwk doctor
& $rwk doctor my-game
```

Checks this PC: Node.js version, wrangler, the Cloudflare login, and what the login or `CLOUDFLARE_API_TOKEN` may do (Workers, R2, and Access for a token). It also checks what the account needs before a first deploy: R2 switched on, a workers.dev subdomain, and whether the toolkit's R2 bucket exists yet. Reads only; exits with `1` when something needed is missing. See [Troubleshooting](/setup/troubleshooting).

With a game (its link or site name), it then checks that game, each problem with what to do:

| Check | Fails or warns when |
|---|---|
| Game | No game of this account was deployed under that name (an old name points to the new one) |
| Worker | The site's Worker is gone: deploy again from the game folder, the saves stay in R2 |
| Site | It cannot be reached, is still locked (its access protection was never finished), or answers with an error |
| Access | Access is set up but does not protect the site |
| Toolkit | A warning: the site runs an older or newer toolkit than this CLI (`upgrade` brings it up to date), or none was recorded |

A game that cannot be checked (not logged in, R2 denied) counts as a failure. For a game folder, use [`analyze`](/reference/commands/check).
