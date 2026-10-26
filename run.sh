#!/usr/bin/env bash
# rpgmaker-web-toolkit: run without cloning (macOS, Linux). Downloads the toolkit
# into a temp folder, installs wrangler, runs the CLI, then deletes the temp folder.
#
#   curl -fsSL https://raw.githubusercontent.com/Kokoroou/rpgmaker-web-toolkit/main/run.sh | bash
#
# With arguments (a command and the game):
#   curl -fsSL https://raw.githubusercontent.com/Kokoroou/rpgmaker-web-toolkit/main/run.sh | bash -s -- saves import "$HOME/Games/My Game"
#
# RWK_REF selects a branch or tag (default: main).

set -euo pipefail

repo='Kokoroou/rpgmaker-web-toolkit'
ref="${RWK_REF:-main}"

red() { printf '\033[31m%s\033[0m\n' "$*" >&2; }
# Status lines go to stderr, so `--json` leaves only the CLI's result on stdout.
cyan() { printf '\033[36m%s\033[0m\n' "$*" >&2; }
gray() { printf '\033[90m%s\033[0m\n' "$*" >&2; }

need_node() {
  if ! command -v node >/dev/null 2>&1; then
    red 'Node.js 22 or newer is required. Install the LTS release from https://nodejs.org (macOS: brew install node), then run again.'
    return 1
  fi
  local major
  major="$(node -p 'process.versions.node.split(".")[0]')"
  if [ "$major" -lt 22 ]; then
    red "Node.js 22 or newer is required (found $(node --version)). Install the LTS release from https://nodejs.org, then run again."
    return 1
  fi
}

main() {
  need_node || return 1
  local tool
  for tool in curl tar; do
    command -v "$tool" >/dev/null 2>&1 || { red "$tool is required."; return 1; }
  done

  work="$(mktemp -d "${TMPDIR:-/tmp}/rwk-XXXXXXXX")"
  trap 'gray "Cleaning up the temp folder..."; rm -rf "$work"' EXIT
  trap 'exit 130' INT TERM

  cyan "Downloading rpgmaker-web-toolkit ($ref)..."
  curl -fsSL "https://codeload.github.com/$repo/tar.gz/$ref" -o "$work/toolkit.tar.gz"
  tar -xzf "$work/toolkit.tar.gz" -C "$work"
  local root='' dir
  for dir in "$work"/*/; do
    root="${dir%/}"
    break
  done
  [ -f "$root/cli/index.js" ] || { red "Unexpected download: no cli/index.js (is '$ref' a valid branch or tag?)."; return 1; }

  cyan 'Installing wrangler (faster next time thanks to the npm cache)...'
  npm ci --prefix "$root" --no-fund --no-audit --loglevel=error </dev/null >&2

  # With `curl | bash`, stdin is the script itself: give the CLI the terminal for its prompts.
  # ([ -r /dev/tty ] is true even without a terminal, so try to open it.)
  if [ ! -t 0 ] && { : </dev/tty; } 2>/dev/null; then
    node "$root/cli/index.js" "$@" </dev/tty
  else
    node "$root/cli/index.js" "$@"
  fi
}

main "$@"
