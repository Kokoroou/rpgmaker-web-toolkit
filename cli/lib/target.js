// What a command works on. One argument names it, in any of three ways:
//   folder  the game folder on this PC            ~/Games/My Game
//   link    the deployed game's link              https://my-game.alice.workers.dev
//   name    the site name (the link's first part) my-game
// A command lists the kinds it accepts; the same argument works for all.

import fs from "node:fs";
import { siteNameFromLink, validateSlug } from "./game.js";
import { cleanPathInput } from "./platform.js";
import { UsageError } from "./ui.js";

const isDirectory = (p) => {
  try {
    return fs.statSync(p).isDirectory();
  } catch {
    return false;
  }
};

// A name that is also a folder in the current directory is the folder: give the link to mean the site.
export function classifyTarget(input, { isDir = isDirectory } = {}) {
  const value = cleanPathInput(String(input ?? ""));
  if (/^https?:\/\//i.test(value) || /\.workers\.dev(\/|$)/i.test(value)) return { kind: "link", value };
  if (isDir(value)) return { kind: "folder", value };
  if (/[\\/]|^[a-z]:|^[~.]/i.test(value)) return { kind: "folder", value };
  return { kind: validateSlug(value) ? "folder" : "name", value };
}

// The site name a link or a name stands for.
export const siteNameOf = (target) => (target.kind === "link" ? siteNameFromLink(target.value) : target.value);

const KIND_WORDS = { folder: "a game folder", link: "a game link", name: "a site name" };

// The target when its kind is one the command accepts, else a UsageError that says what to pass instead.
export function expectTarget(input, kinds, usage) {
  const target = classifyTarget(input);
  if (kinds.includes(target.kind)) return target;
  const wanted = kinds.map((k) => KIND_WORDS[k]).join(" or ");
  throw new UsageError(`"${target.value}" is ${KIND_WORDS[target.kind]}, but this command needs ${wanted}.`, { hint: `Usage: ${usage}` });
}
