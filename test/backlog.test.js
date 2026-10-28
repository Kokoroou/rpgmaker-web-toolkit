// RWK_Backlog.js runs in the browser; load it in a VM with the few engine
// globals it touches to test the log itself (no DOM needed before the panel opens).

import assert from "node:assert/strict";
import fs from "node:fs";
import test from "node:test";
import vm from "node:vm";

const source = fs.readFileSync(new URL("../runtime/RWK_Backlog.js", import.meta.url), "utf8");

function load(backlog = { max: 100 }) {
  const added = [];
  class Window_Message {
    startMessage() {
      this.started = (this.started || 0) + 1;
    }
    // Like the engine: "\C[2]" in the data is a backslash + code.
    convertEscapeCharacters(text) {
      return String(text).replace(/\\/g, "\x1b");
    }
  }
  const messages = { speaker: "", text: "" };
  const calls = [];
  const window = {
    RWK: { config: { backlog }, tools: { add: (t) => added.push(t), isOpen: () => false }, icons: { list: "<svg/>" } },
    addEventListener() {},
  };
  const context = {
    window,
    console,
    Window_Message,
    $gameMessage: { speakerName: () => messages.speaker, allText: () => messages.text },
    DataManager: {
      setupNewGame: () => calls.push("new"),
      extractSaveContents: () => calls.push("load"),
    },
    Input: { keyMapper: {} },
    SceneManager: {},
  };
  vm.runInNewContext(source, context);
  const say = (text, speaker = "") => {
    messages.speaker = speaker;
    messages.text = text;
    const win = new Window_Message();
    win.startMessage();
    return win;
  };
  return { RWK: window.RWK, say, added, calls, context };
}

test("backlog: not loaded when the config turns it off", () => {
  const { RWK, added } = load(false);
  assert.equal(RWK.backlog, undefined);
  assert.equal(added.length, 0);
});

test("backlog: records speaker and text, control codes removed", () => {
  const { RWK, say } = load();
  const win = say("\\C[2]Hello\\C[0], \\I[12]world\\!\n\\.Second \\{line\\}", "\\C[3]Eve");
  assert.equal(win.started, 1, "the original startMessage still runs");
  assert.deepEqual(JSON.parse(JSON.stringify(RWK.backlog.entries())), [{ speaker: "Eve", text: "Hello, world\nSecond line" }]);
});

test("backlog: empty messages are ignored", () => {
  const { RWK, say } = load();
  say("\\C[1]\\!  ");
  say("");
  assert.equal(RWK.backlog.entries().length, 0);
});

test("backlog: keeps only the last max messages", () => {
  const { RWK, say } = load({ max: 10 });
  for (let i = 1; i <= 25; i++) say("line " + i);
  const texts = RWK.backlog.entries().map((e) => e.text);
  assert.equal(texts.length, 10);
  assert.equal(texts[0], "line 16");
  assert.equal(texts[9], "line 25");
});

test("backlog: a new game or a loaded save starts over", () => {
  const { RWK, say, context, calls } = load();
  say("one");
  context.DataManager.setupNewGame();
  assert.equal(RWK.backlog.entries().length, 0);
  say("two");
  context.DataManager.extractSaveContents({});
  assert.equal(RWK.backlog.entries().length, 0);
  assert.deepEqual(calls, ["new", "load"], "the engine functions still run");
});

test("backlog: adds one entry to the menu", () => {
  const { added } = load();
  assert.equal(added.length, 1);
  assert.equal(added[0].label, "Messages log");
  assert.equal(added[0].group, "messages");
});
