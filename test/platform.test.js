// Windows / macOS / Linux differences in cli/. Pure inputs, so every OS is
// checked from whichever OS runs the tests.

import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { test } from "node:test";
import { analyzeGame, collectFiles, resolveCI } from "../cli/lib/game.js";
import { cleanPathInput, editorCommand, openUrlCommand, stateDir } from "../cli/lib/platform.js";
import { generatedFiles } from "../cli/lib/stage.js";

const tmp = () => fs.mkdtempSync(path.join(os.tmpdir(), "rwk-plat-"));

test("platform: state folder, browser and editor per OS", () => {
  const winHome = "C:\\Users\\ann";
  assert.equal(stateDir({ platform: "win32", env: { APPDATA: `${winHome}\\AppData\\Roaming` }, home: winHome }), `${winHome}\\AppData\\Roaming\\rpgmaker-web-toolkit`);
  assert.equal(stateDir({ platform: "darwin", env: {}, home: "/Users/ann" }), "/Users/ann/Library/Application Support/rpgmaker-web-toolkit");
  assert.equal(stateDir({ platform: "linux", env: {}, home: "/home/ann" }), "/home/ann/.config/rpgmaker-web-toolkit");
  assert.equal(stateDir({ platform: "linux", env: { XDG_CONFIG_HOME: "/x/cfg" }, home: "/home/ann" }), "/x/cfg/rpgmaker-web-toolkit");

  assert.deepEqual(openUrlCommand("https://a.b", "win32"), { cmd: "explorer.exe", args: ["https://a.b"] });
  assert.deepEqual(openUrlCommand("https://a.b", "darwin"), { cmd: "open", args: ["https://a.b"] });
  assert.deepEqual(openUrlCommand("https://a.b", "linux"), { cmd: "xdg-open", args: ["https://a.b"] });

  assert.equal(editorCommand("f.json", { platform: "win32", env: {} }).cmd, "notepad.exe");
  assert.deepEqual(editorCommand("f.json", { platform: "darwin", env: {} }).args, ["-W", "-t", "f.json"]);
  assert.equal(editorCommand("f.json", { platform: "linux", env: {} }).cmd, "nano");
  assert.deepEqual(editorCommand("f.json", { platform: "linux", env: { VISUAL: "code --wait", EDITOR: "vi" } }), { cmd: "code", args: ["--wait", "f.json"], label: "code" });
  assert.equal(editorCommand("f.json", { platform: "win32", env: { EDITOR: "vi" } }).cmd, "vi");
});

test("platform: dropped folder paths", () => {
  const posix = { platform: "linux", home: "/home/ann" };
  assert.equal(cleanPathInput("'/games/My Game'", posix), "/games/My Game");
  assert.equal(cleanPathInput("/games/My\\ Game ", posix), "/games/My Game");
  assert.equal(cleanPathInput("~/Games/x", posix), "/home/ann/Games/x");
  assert.equal(cleanPathInput('"D:\\Games\\My Game"', { platform: "win32" }), "D:\\Games\\My Game");
  assert.equal(cleanPathInput("D:\\Games\\a b", { platform: "win32" }), "D:\\Games\\a b");
});

test("analyze: a game made on Windows with mixed-case names works on case-sensitive disks", () => {
  const dir = tmp();
  const put = (rel, content = "x") => {
    const abs = path.join(dir, ...rel.split("/"));
    fs.mkdirSync(path.dirname(abs), { recursive: true });
    fs.writeFileSync(abs, content);
  };
  put("Index.html", "<html><head></head></html>");
  put("JS/rmmz_core.js");
  put("JS/plugins.js", "var $plugins = [];");
  put("Data/System.json", JSON.stringify({ gameTitle: "Mixed" }));
  put("Img/pictures/a.png");
  put("Save/file1.rmmzsave");

  const game = analyzeGame(dir);
  assert.equal(game.engine, "MZ");
  assert.equal(game.title, "Mixed");
  assert.deepEqual(game.unknownDirs, []);
  assert.equal(game.saveDir, path.join(dir, "Save"));

  // Published under the lowercase names the engine asks for.
  const files = collectFiles(game);
  assert.deepEqual(files.map((f) => f.rel).sort(), ["data/System.json", "img/pictures/a.png", "index.html", "js/plugins.js", "js/rmmz_core.js"]);

  // The generated files read the real names.
  const out = generatedFiles(game, { slug: "g", sync: {} }, files);
  assert.ok(out.get("index.html").includes('href="rwk.webmanifest" crossorigin="use-credentials"'));
  assert.ok(out.has("js/plugins.js"));
  assert.equal(resolveCI(dir, "js", "PLUGINS.JS"), path.join(dir, "JS", "plugins.js"));
  assert.equal(resolveCI(dir, "nope", "x"), path.join(dir, "nope", "x"));
});
