#!/usr/bin/env bash
# rpgmaker-web-toolkit: run without cloning (macOS, Linux). Downloads the toolkit and
# its wrangler once into a cache folder, then runs the CLI from it: the next run starts
# at once (it only asks GitHub which version `main` is on).
#
#   curl -fsSL https://raw.githubusercontent.com/Kokoroou/rpgmaker-web-toolkit/main/run.sh | bash
#
# With arguments (a command and the game):
#   curl -fsSL https://raw.githubusercontent.com/Kokoroou/rpgmaker-web-toolkit/main/run.sh | bash -s -- saves import "$HOME/Games/My Game"
#
# RWK_REF selects a branch or tag (default: main). A tag is cached for good.
# RWK_CACHE moves the cache (default: ~/.cache/rpgmaker-web-toolkit, ~/Library/Caches/... on macOS).
#
# --cleanup (or RWK_CLEANUP=1) deletes the cached toolkit after the run, like a one-off
# run. It is left alone while another run still uses it: that run is not disturbed, and
# the last one to finish with --cleanup removes it. Not passed on to the CLI.

set -euo pipefail

repo='Kokoroou/rpgmaker-web-toolkit'
ref="${RWK_REF:-main}"
# Where the downloads come from (tests point these at local files).
download_base="${RWK_DOWNLOAD_BASE:-https://codeload.github.com/$repo}"
api_base="${RWK_API_BASE:-https://api.github.com/repos/$repo}"
cleanup="${RWK_CLEANUP:-}"
case "$cleanup" in 0 | false | no) cleanup='' ;; esac

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

cache_dir() {
  if [ -n "${RWK_CACHE:-}" ]; then
    printf '%s' "$RWK_CACHE"
  elif [ "$(uname -s)" = Darwin ]; then
    printf '%s' "$HOME/Library/Caches/rpgmaker-web-toolkit"
  else
    printf '%s' "${XDG_CACHE_HOME:-$HOME/.cache}/rpgmaker-web-toolkit"
  fi
}

# --- A lock around the short steps that change the cache (publish, lease, remove, prune).
# A file only one process can create; it holds the owner's pid, so one left by a dead
# process is taken over. Downloads and installs run outside it.
locked=''
lock() {
  local tries=0 owner
  while ! (set -o noclobber; echo "$$" >"$lock_file") 2>/dev/null; do
    owner="$(cat "$lock_file" 2>/dev/null || true)"
    if { [ -n "$owner" ] && ! kill -0 "$owner" 2>/dev/null; } || [ -n "$(find "$lock_file" -mmin +2 2>/dev/null)" ]; then
      rm -f "$lock_file"
      continue
    fi
    tries=$((tries + 1))
    if [ "$tries" -gt 600 ]; then
      red "Another run holds $lock_file. If none is running, delete that file."
      return 1
    fi
    sleep 0.1
  done
  locked=1
}
unlock() {
  if [ -n "$locked" ]; then rm -f "$lock_file"; fi
  locked=''
}

# Each run leaves a file named after its pid in the version's .leases folder while it
# uses it. Removing a version waits for the leases of live processes to end.
live_lease() {
  local file pid
  for file in "$1"/.leases/*; do
    [ -e "$file" ] || continue
    pid="${file##*/}"
    pid="${pid%%.*}"
    if kill -0 "$pid" 2>/dev/null; then return 0; fi
    rm -f "$file" # a run that died without releasing
  done
  return 1
}

hash_file() {
  if command -v sha256sum >/dev/null 2>&1; then sha256sum "$1" | cut -d' ' -f1; else shasum -a 256 "$1" | cut -d' ' -f1; fi
}

# Installs (wrangler) nothing else uses are removed; call with the lock held.
prune_deps() {
  local dir hash tk used
  for dir in "$cache"/deps/*/; do
    [ -d "$dir" ] || continue
    hash="$(basename "$dir")"
    used=''
    for tk in "$cache"/toolkit/*/; do
      if [ -f "$tk/.rwk-deps" ] && [ "$(cat "$tk/.rwk-deps")" = "$hash" ]; then used=1; fi
    done
    if [ -z "$used" ]; then rm -rf "$dir"; fi
  done
}

# Older versions go, the newest few stay (a run on an old version may still be going).
prune_old() {
  local keep=3 n=0 dir
  # shellcheck disable=SC2012,SC2046 # directory names are hashes or tags: no spaces or odd characters
  for dir in $(ls -1dt "$cache"/toolkit/*/ 2>/dev/null); do
    n=$((n + 1))
    [ "$n" -le "$keep" ] && continue
    live_lease "$dir" || rm -rf "$dir"
  done
  # What a run that was killed halfway left behind.
  find "$cache" -maxdepth 1 -name 'tmp-*' -mtime +1 -exec rm -rf {} + 2>/dev/null || true
  prune_deps
}

# The version to run: key (the folder name in toolkit/) and src (what to download).
# A tag never changes; for a branch GitHub tells which commit it is on now, and
# without a network the last one downloaded is used.
resolve_version() {
  local safe sha last
  safe="${ref//[^A-Za-z0-9._-]/_}"
  key=''
  if [[ "$ref" =~ ^v?[0-9]+\.[0-9]+\.[0-9]+([-+.][0-9A-Za-z.-]+)?$ ]]; then
    key="tag-$safe"
    src="$ref"
    return 0
  fi
  src="$ref"
  sha="$(curl -fsSL --max-time 15 -H 'Accept: application/vnd.github.sha' "$api_base/commits/$ref" 2>/dev/null || true)"
  if [[ "$sha" =~ ^[0-9a-f]{40}$ ]]; then
    key="$sha"
    src="$sha"
    printf '%s' "$sha" >"$cache/refs/$safe" 2>/dev/null || true
    return 0
  fi
  last="$(cat "$cache/refs/$safe" 2>/dev/null || true)"
  if [[ "$last" =~ ^[0-9a-f]{40}$ ]] && [ -d "$cache/toolkit/$last" ]; then
    gray "Could not ask GitHub about '$ref': using the copy already downloaded (${last:0:7})."
    key="$last"
    src="$last"
    return 0
  fi
  # No answer and nothing cached: download the branch by name, kept under a name of its own.
  key="$safe-$(date +%s)"
}

version_ready() {
  [ -f "$1/cli/index.js" ] && [ -f "$1/node_modules/wrangler/bin/wrangler.js" ]
}

# Downloads the version into a staging folder in the cache (not yet visible to other runs).
download_toolkit() {
  local stage="$1" dir root=''
  cyan "Downloading rpgmaker-web-toolkit ($ref)..."
  curl -fsSL "$download_base/tar.gz/$src" -o "$stage/toolkit.tar.gz"
  tar -xzf "$stage/toolkit.tar.gz" -C "$stage"
  rm -f "$stage/toolkit.tar.gz"
  for dir in "$stage"/*/; do
    root="${dir%/}"
    break
  done
  [ -f "$root/cli/index.js" ] || { red "Unexpected download: no cli/index.js (is '$ref' a valid branch or tag?)."; return 1; }
  printf '%s' "$root"
}

# wrangler and the other dependencies, installed once per package-lock.json and shared by
# every version of the toolkit that has the same one.
build_deps() {
  local stage="$1" root="$2"
  cyan 'Installing wrangler (kept for the next runs)...'
  mkdir -p "$stage/deps"
  cp "$root/package.json" "$root/package-lock.json" "$stage/deps/"
  npm ci --prefix "$stage/deps" --no-fund --no-audit --loglevel=error </dev/null >&2
  [ -f "$stage/deps/node_modules/wrangler/bin/wrangler.js" ] || { red 'npm ci did not install wrangler.'; return 1; }
  : >"$stage/deps/.ready"
}

# Makes the version ready in the cache and takes a lease on it. -> verdir, lease
acquire() {
  local attempt stage deps_stage root hash
  for attempt in 1 2 3; do
    resolve_version
    verdir="$cache/toolkit/$key"
    stage=''
    hash=''
    root=''
    if ! { lock && version_ready "$verdir"; }; then
      unlock
      if [ -d "$verdir" ]; then # half there (an install that was cut short, or its wrangler pruned)
        lock
        rm -rf "$verdir"
        unlock
      fi
      stage="$(mktemp -d "$cache/tmp-XXXXXXXX")"
      root="$(download_toolkit "$stage")"
      hash="$(hash_file "$root/package-lock.json")"
      deps_stage=''
      if [ ! -f "$cache/deps/$hash/.ready" ]; then
        deps_stage="$stage/deps-stage"
        mkdir -p "$deps_stage"
        build_deps "$deps_stage" "$root"
      fi
      lock
      if [ -n "$deps_stage" ]; then
        if [ ! -f "$cache/deps/$hash/.ready" ]; then
          rm -rf "$cache/deps/$hash"
          mv "$deps_stage/deps" "$cache/deps/$hash"
        fi
      fi
      if ! version_ready "$verdir"; then
        printf '%s' "$hash" >"$root/.rwk-deps"
        ln -s "$cache/deps/$hash/node_modules" "$root/node_modules"
        rm -rf "$verdir"
        mv "$root" "$verdir"
      fi
      rm -rf "$stage"
      stage=''
    fi
    # The lock is held here (taken above, in either branch).
    if version_ready "$verdir"; then
      mkdir -p "$verdir/.leases"
      lease="$verdir/.leases/$$.$RANDOM"
      : >"$lease"
      touch "$verdir"
      prune_old
      unlock
      return 0
    fi
    unlock
  done
  red 'Could not set up the toolkit in the cache.'
  return 1
}

# At exit: the lease goes; with --cleanup the cached version goes too, unless another run is using it.
finish() {
  local status=$?
  set +e
  unlock # a lock still held when something failed
  if [ -n "${lease:-}" ] || [ -n "$cleanup" ]; then
    if lock; then
      [ -n "${lease:-}" ] && rm -f "$lease"
      if [ -n "$cleanup" ] && [ -n "${verdir:-}" ] && [ -d "$verdir" ]; then
        if live_lease "$verdir"; then
          gray 'Another run is using the cached toolkit: it stays until that run ends.'
        else
          gray 'Cleaning up the cached toolkit...'
          rm -rf "$verdir"
          prune_deps
        fi
      fi
      unlock
    fi
  fi
  unlock
  return "$status"
}

main() {
  need_node || return 1
  local tool
  for tool in curl tar; do
    command -v "$tool" >/dev/null 2>&1 || { red "$tool is required."; return 1; }
  done

  local args=() arg
  for arg in "$@"; do
    if [ "$arg" = --cleanup ]; then cleanup=1; else args+=("$arg"); fi
  done

  cache="$(cache_dir)"
  lock_file="$cache/.lock"
  mkdir -p "$cache/toolkit" "$cache/deps" "$cache/refs"
  verdir=''
  lease=''
  trap finish EXIT
  trap 'exit 130' INT TERM

  acquire

  # With `curl | bash`, stdin is the script itself: give the CLI the terminal for its prompts.
  # ([ -r /dev/tty ] is true even without a terminal, so try to open it.)
  if [ ! -t 0 ] && { : </dev/tty; } 2>/dev/null; then
    node "$verdir/cli/index.js" ${args[@]+"${args[@]}"} </dev/tty
  else
    node "$verdir/cli/index.js" ${args[@]+"${args[@]}"}
  fi
}

main "$@"
