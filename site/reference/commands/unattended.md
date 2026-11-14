---
description: "Run rwk without questions for CI: --yes, --json, exit code 2, the Cloudflare API token permissions, and deploys started at the same time."
lang: en
---

# Run without questions (CI)

Part of the [commands reference](/reference/commands).

`--yes` runs a command with no one at the keyboard, for a game repository that redeploys itself. It is also on whenever stdin is not a terminal, as in GitHub Actions or GitLab CI.

```sh
./rwk.sh deploy ~/Games/"My Game" --yes
```

- Each question takes its default answer, and the log shows it with `(non-interactive)`.
- A question with no safe answer stops the run with **exit code 2** and says what to do instead: a missing game folder, a first [access protection](/setup/access) the API cannot set up (no Zero Trust team yet, or a token without the Access permissions), `config` without `--get` / `--set` (it asks questions). The site name of a first deploy is the folder's by default; `--name` gives it, and `rename` takes its new name from `--to`. Do the first deploy in a terminal; later updates can run unattended.
- Two questions answer **no** when nobody is there: deleting the old Worker after a `rename` (asked again at the next run) and uploading the `save/` folder during a deploy (`saves import --yes` uploads it).
- [Exit codes](/reference/commands#exit-codes) tell a script what happened.
- `--json` does the same and prints the [result](/setup/ci#the-result) (link, build report, warnings) as one JSON object on stdout. In GitHub Actions, every run also writes the step outputs and summary. Ready-made setups: [Publish from CI](/setup/ci).

Log in with an API token instead of the browser login: set `CLOUDFLARE_API_TOKEN`, plus `CLOUDFLARE_ACCOUNT_ID` (or [`--account`](/reference/commands/accounts#several-cloudflare-accounts)) when the token reaches several accounts. Only a run with `--yes` (or without a terminal) reads them, so a token set for another tool never replaces the toolkit's own login. Create the token in the dashboard (My Profile → API Tokens → Create Custom Token) with these permissions, for the one account:

| Permission | Why |
|---|---|
| Account → Account Settings → Read | Find the account |
| Account → Workers Scripts → Edit | Deploy the Worker and its files |
| Account → Workers R2 Storage → Edit | The game's settings, saves and large files in R2 |
| Account → Access: Apps and Policies → Edit | Protect the site with [Cloudflare Access](/setup/access) on its first deploy |
| Account → Access: Organizations, Identity Providers, and Groups → Read | Find the Zero Trust team's login domain |
| User → User Details → Read (optional) | The email suggested for `saves import`; without it, `saves import --yes` stops at that question, and the first Access policy has no email to allow unless `players` lists some |

Keep the token in the CI's secrets: the toolkit never prints it.

From a clone, `.\rwk.cmd` (Windows) or `./rwk.sh` (macOS, Linux) takes the same commands. See [CONTRIBUTING.md](https://github.com/Kokoroou/rpgmaker-web-toolkit/blob/main/CONTRIBUTING.md).

## Deploys at the same time

Deploys started in different shells (or terminals, or CI jobs) at once are safe:

- They share the cached toolkit, and each run registers while it works (see below), so a run that finishes with `--cleanup` never removes what another run is using.
- Each has a build folder of its own, so one run finishing never removes another's files.
- The list of games in R2 (`rwk/games.json`) is written under a lock on this PC, on its latest copy, so no game loses another's entry. Two first deploys that picked the same site name: the second stops before it deploys and asks for another name (`--name`). (Deploys from two different PCs are not covered by the lock.)
