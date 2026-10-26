// Per-OS behaviour: where the toolkit keeps its state, which program opens a
// URL, and which editor edits the config. Pure functions (platform and
// environment passed in) so every OS is tested from any OS.

import os from "node:os";
import path from "node:path";

// A path typed or dropped into the terminal: surrounding quotes go; on macOS and
// Linux a dropped path arrives with backslash-escaped spaces and "~" is the home folder.
export function cleanPathInput(text, { platform = process.platform, home = os.homedir() } = {}) {
  let out = text.trim().replace(/^["']|["']$/g, "");
  if (platform === "win32") return out;
  out = out.replace(/\\(.)/g, "$1");
  if (out === "~" || out.startsWith("~/")) out = path.posix.join(home, out.slice(1));
  return out;
}

// Windows: %APPDATA%. macOS: ~/Library/Application Support. Linux: $XDG_CONFIG_HOME or ~/.config.
export function stateDir({ platform = process.platform, env = process.env, home } = {}) {
  const name = "rpgmaker-web-toolkit";
  if (platform === "win32") return path.win32.join(env.APPDATA || home, name);
  if (platform === "darwin") return path.posix.join(home, "Library", "Application Support", name);
  return path.posix.join(env.XDG_CONFIG_HOME || path.posix.join(home, ".config"), name);
}

// -> { cmd, args } that opens a URL in the default browser.
export function openUrlCommand(url, platform = process.platform) {
  if (platform === "win32") return { cmd: "explorer.exe", args: [url] };
  if (platform === "darwin") return { cmd: "open", args: [url] };
  return { cmd: "xdg-open", args: [url] };
}

// -> { cmd, args, label } for an editor that blocks until the file is closed.
// $VISUAL / $EDITOR may hold arguments ("code --wait").
export function editorCommand(file, { platform = process.platform, env = process.env } = {}) {
  const custom = (env.VISUAL || env.EDITOR || "").trim();
  if (custom) {
    const [cmd, ...args] = custom.split(/\s+/);
    return { cmd, args: [...args, file], label: cmd };
  }
  if (platform === "win32") return { cmd: "notepad.exe", args: [file], label: "Notepad" };
  if (platform === "darwin") return { cmd: "open", args: ["-W", "-t", file], label: "TextEdit" };
  return { cmd: "nano", args: [file], label: "nano" };
}
