---
description: "Where the rwk one-liner keeps its cached toolkit and wrangler, how --cleanup works, and the RWK_* environment variables."
lang: en
---

# Cache and cleanup

Part of the [commands reference](/reference/commands).

## Where it is kept

The one-liner keeps what it downloads, so the next run starts at once instead of downloading the toolkit and installing wrangler again:

| | Where (`RWK_CACHE` moves it) |
|---|---|
| Windows | `%LOCALAPPDATA%\rpgmaker-web-toolkit\cache` |
| macOS | `~/Library/Caches/rpgmaker-web-toolkit` |
| Linux | `$XDG_CACHE_HOME/rpgmaker-web-toolkit`, else `~/.cache/rpgmaker-web-toolkit` |

## What stays and what goes

- A **release tag** (`RWK_REF=v1.0.0`) is cached for good. For `main` (or another branch) the run asks GitHub which commit it is on, downloads only when that changed, and without a network uses the last copy it has.
- wrangler is installed once per `package-lock.json` and shared by every cached version, so a new toolkit version usually downloads a few MB, not wrangler again.
- The newest three versions are kept; older ones and unused wrangler installs are removed by the next run.
- **`--cleanup`** (or `RWK_CLEANUP=1`) deletes the cached toolkit when the run ends, as every run used to. It never pulls the toolkit from a run that is still using it: each run registers while it works, and `--cleanup` removes the toolkit only when no other run does, so deploys started together are safe. If another run is still going, it says so and the last run to finish with `--cleanup` removes it. The login, `settings.json` and the game folder are never touched.

```sh
curl -fsSL https://raw.githubusercontent.com/Kokoroou/rpgmaker-web-toolkit/main/run.sh | bash -s -- deploy ./game --cleanup
```

```powershell
& $rwk deploy "D:\Games\My Game" --cleanup
```

Without `--cleanup`, what a run only needs while it works (the build folder, downloads in progress) is still deleted at its end, and the cached toolkit stays for the next run. A clone (`rwk.cmd`, `rwk.sh`) has no cache to clean: `--cleanup` does nothing there.

## Environment variables

| Environment variable | Effect |
|---|---|
| `$env:RWK_REF = "v1.0.0"` (`export RWK_REF=v1.0.0`) | Runs that tag or branch instead of `main` |
| `$env:RWK_CACHE = "D:\rwk-cache"` (`export RWK_CACHE=~/rwk-cache`) | Keeps the [cached toolkit](#where-it-is-kept) there |
| `$env:RWK_CLEANUP = "1"` (`export RWK_CLEANUP=1`) | Same as `--cleanup` on every run |
| `$env:RWK_DEBUG = "1"` (`export RWK_DEBUG=1`) | Prints full error details (same as `--verbose`) |
| `$env:RWK_ASCII = "1"` (`export RWK_ASCII=1`) | ASCII symbols instead of ✓ ▶ → |
| `$env:RWK_LIMITS_URL = "off"` (`export RWK_LIMITS_URL=off`) | Uses only the [free plan limits](/reference/limits#when-cloudflare-changes-them) shipped with the toolkit (or another URL to read them from) |
