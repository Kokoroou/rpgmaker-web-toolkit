---
description: "Log in to Cloudflare with rwk: several accounts with --account, several logins with profiles, and the login, logout, whoami and profiles commands."
lang: en
---

# Cloudflare logins and accounts

Part of the [commands reference](/reference/commands).

## Login commands

| Command | Does |
|---|---|
| `rwk login` | Logs in to Cloudflare in the browser and chooses the account, in the current [login profile](#several-cloudflare-logins), or the one `--profile <name>` names (made if new). Run it again to log in as another email. Terminal only |
| `rwk logout` | Logs out of the current profile (or `--profile <name>`) and forgets it. Its games stay published |
| `rwk whoami` | The login a command would use: the profile, its email and the accounts it reaches (• the chosen one) |
| `rwk profiles` | Lists the login profiles on this PC and marks the one commands use. `rwk profiles use <name>` switches to another one |

## Several Cloudflare accounts

When the login (or the token) reaches more than one account, the first command that talks to Cloudflare asks which one to use, and later runs take the same one. To work in another account for one run, name it with `--account`, by its ID (in the dashboard's address, `dash.cloudflare.com/<ID>`) or its name:

```sh
rwk list --account "Team account"
rwk deploy ./game --yes --account 0123456789abcdef0123456789abcdef
```

The account is chosen in this order:

1. `--account`: an ID, or a name without regard to case. An account the login does not reach stops the run and lists the ones it does; so does a name two accounts share (give the ID). It is not saved: the next run goes back to the usual choice.
2. `CLOUDFLARE_ACCOUNT_ID`, read only by a run with `--yes` (or without a terminal), like `CLOUDFLARE_API_TOKEN`. An ID it does not reach stops the run too.
3. The account chosen last time on this PC.
4. The only account, when there is one.
5. The question, in a terminal. Without one the run stops with exit code 2: give `--account` or `CLOUDFLARE_ACCOUNT_ID`.

`rwk doctor` shows the account it checks and where that choice came from. It takes `--account` too, and reads `CLOUDFLARE_ACCOUNT_ID` even in a terminal.

An account under another email is not one this login reaches, so `--account` cannot pick it: that takes a second login, below.

## Several Cloudflare logins

Each **login profile** is one Cloudflare login (one email) with the account chosen in it. The first login is the profile `default`; add one for each other email, and every command works in the games of that login's account:

```sh
rwk login --profile work         # opens the browser: log in as the other email, choose its account
rwk list                          # now in the account of "work"
rwk deploy ./game --profile default   # one run with the first login, without switching
rwk profiles use default          # back to the first login for later runs
```

| Command | What it does |
|---|---|
| `rwk login [--profile <name>]` | Logs in to the profile (new, or again, perhaps as another email), chooses its account (`--account` answers that), and makes it the one commands use |
| `rwk profiles` | Lists the profiles: their email and account, • the one commands use |
| `rwk profiles use <name>` | Commands use that profile from now on |
| `rwk whoami [--profile <name>]` | Asks Cloudflare which email and accounts the profile reaches |
| `rwk logout [--profile <name>]` | Logs out (Cloudflare revokes the login) and forgets the profile. Its games stay published; log in again to manage them |

The profile is chosen in this order: `--profile` (for one run, not saved), else the one chosen with `rwk profiles use` or `rwk login`, else `default`. A name never logged in stops the run instead of opening the browser (`rwk login --profile <name>` makes it), so a typo does not start a new login. Names use `a-z`, digits and `-`.

A game lives in the account it was published in: its Worker and its R2 data (settings, saves, large files) stay there. To publish it in another login's account too, deploy it from its folder with that profile, as a first deploy there; `saves export` with one profile and `saves import` with the other carry a player's saves over.

A run with `CLOUDFLARE_API_TOKEN` (CI) uses the token, never a profile: `--profile` is ignored, with a warning.
