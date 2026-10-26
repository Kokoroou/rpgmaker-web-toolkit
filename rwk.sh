#!/usr/bin/env bash
# rpgmaker-web-toolkit launcher (macOS, Linux).
#   ./rwk.sh deploy "$HOME/Games/My Game"
set -euo pipefail

# Follow symlinks (a ~/bin/rwk link) back to the clone.
source="${BASH_SOURCE[0]}"
while [ -L "$source" ]; do
  dir="$(cd -P "$(dirname "$source")" && pwd)"
  source="$(readlink "$source")"
  case "$source" in /*) ;; *) source="$dir/$source" ;; esac
done
RWK_HOME="$(cd -P "$(dirname "$source")" && pwd)"

if ! command -v node >/dev/null 2>&1; then
  echo '[rwk] Node.js not found. Install the LTS release from https://nodejs.org (macOS: brew install node) and run again.' >&2
  exit 1
fi
if [ "$(node -p 'process.versions.node.split(".")[0]')" -lt 22 ]; then
  echo "[rwk] Node.js 22 or newer is required (found $(node --version))." >&2
  exit 1
fi

# Also after an update that added a dependency.
if [ ! -f "$RWK_HOME/node_modules/wrangler/bin/wrangler.js" ] || [ ! -f "$RWK_HOME/node_modules/lz-string/package.json" ]; then
  echo '[rwk] Installing dependencies...' >&2
  (cd "$RWK_HOME" && npm ci --no-fund --no-audit) || { echo '[rwk] npm ci failed.' >&2; exit 1; }
fi

exec node "$RWK_HOME/cli/index.js" "$@"
