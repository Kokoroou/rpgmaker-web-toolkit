// Translations in data-<code>/: finding them (CLI), the config the web build
// gets, and RWK_Language picking one in the browser (run in a VM).

import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import vm from "node:vm";
import { checkLanguagesConfig, detectLanguages, languageCode, languagesRuntime } from "../cli/lib/languages.js";
import { generatedFiles, runtimeConfigOf, serviceWorkerSource } from "../cli/lib/stage.js";
import { mergeConfig } from "../worker/toolkit.js";
import { warnLanguages } from "../cli/lib/build-checks.js";
import { warnings } from "../cli/lib/ui.js";

const f = (rel) => ({ rel, size: 1, mtimeMs: 1 });
const FILES = [
  "data/System.json",
  "data/Map001.json",
  "data/Map002.json",
  "data-vi/System.json",
  "data-vi/Map001.json",
  "data_zh-TW/System.json",
  "data-backup/System.json",
  "data-vi/notes.txt",
  "img/data-en/a.png",
].map(f);

test("language folders: data-vi, data_zh-TW, but not data-backup", () => {
  assert.equal(languageCode("data-vi"), "vi");
  assert.equal(languageCode("data_zh-TW"), "zh-tw");
  assert.equal(languageCode("data_zh_TW"), "zh-tw");
  for (const no of ["data", "data-backup", "data-old", "data-", "datavi", "data-v", "img-vi"]) assert.equal(languageCode(no), null, no);

  assert.deepEqual(detectLanguages(FILES), [
    { code: "vi", dir: "data-vi", files: ["Map001.json", "System.json"], missing: 1 },
    { code: "zh-tw", dir: "data_zh-TW", files: ["System.json"], missing: 2 },
  ]);
  assert.deepEqual(detectLanguages([f("data/a.json")]), []);
  const twice = detectLanguages([f("data/a.json"), f("data-vi/a.json"), f("data_vi/a.json")]);
  assert.deepEqual(twice.map((l) => l.dir), ["data-vi"], "one entry per code");
});

test("the runtime config: default, original, lock, and off", () => {
  const files = FILES;
  const base = languagesRuntime(undefined, files);
  assert.deepEqual(base, {
    default: "",
    original: "",
    lock: false,
    choices: {
      vi: { dir: "data-vi", files: ["Map001.json", "System.json"] },
      "zh-tw": { dir: "data_zh-TW", files: ["System.json"] },
    },
  });
  assert.deepEqual(languagesRuntime(true, files), base);
  assert.equal(languagesRuntime(false, files), false);
  assert.equal(languagesRuntime(undefined, [f("data/a.json")]), false, "nothing to pick");

  const set = languagesRuntime({ default: "VI", original: "ja", lock: true }, files);
  assert.equal(set.default, "vi");
  assert.equal(set.original, "ja");
  assert.equal(set.lock, true);
  assert.equal(languagesRuntime({ default: "fr" }, files).default, "", "no data-fr: the original");
  assert.equal(languagesRuntime({ default: "ja", original: "ja" }, files).default, "", "the original's own code");
  assert.equal(languagesRuntime({ original: "japanese" }, files).original, "", "not a code");
});

test("language settings: problems worded for the deploy log", () => {
  const found = detectLanguages(FILES);
  for (const fine of [undefined, true, false, {}, { default: "vi" }, { default: "ja", original: "ja" }, { lock: true }]) {
    assert.deepEqual(checkLanguagesConfig(fine, found), [], JSON.stringify(fine));
  }
  assert.match(checkLanguagesConfig("vi", found)[0], /must be true, false or an object/);
  assert.match(checkLanguagesConfig({ default: "fr" }, found)[0], /no data-fr folder \(found: vi, zh-tw\)/);
  assert.match(checkLanguagesConfig({ default: "fr" }, [])[0], /no data-fr folder;/);
  assert.match(checkLanguagesConfig({ original: "japanese" }, found)[0], /"languages.original" must be a language code/);
  assert.match(checkLanguagesConfig({ lang: "vi" }, found)[0], /unknown key\(s\) lang/);

  const before = warnings.length;
  const summary = warnLanguages(FILES, { default: "fr" });
  assert.deepEqual(summary, [
    { code: "vi", dir: "data-vi", files: 2, missing: 1 },
    { code: "zh-tw", dir: "data_zh-TW", files: 1, missing: 2 },
  ]);
  assert.equal(warnings.length - before, 1);
});

function game() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "rwk-lang-"));
  fs.mkdirSync(path.join(root, "js"));
  fs.writeFileSync(path.join(root, "js", "plugins.js"), "var $plugins = [];\n");
  fs.writeFileSync(path.join(root, "index.html"), "<html><head></head><body></body></html>");
  return { root, engine: "MZ", title: "G" };
}

const coreConfig = (out) => {
  const js = out.get("js/plugins.js");
  return JSON.parse(JSON.parse(/\$plugins\.push\((\{"name":"RWK_Core".*\})\);/.exec(js)[1]).parameters.config);
};

test("web build: RWK_Language is loaded after RWK_Core and gets the translations", () => {
  const withLang = generatedFiles(game(), { slug: "g", sync: {} }, FILES);
  assert.ok(withLang.has("js/plugins/RWK_Language.js"));
  const js = withLang.get("js/plugins.js");
  assert.ok(js.indexOf('"RWK_Core"') < js.indexOf('"RWK_Language"') && js.indexOf('"RWK_Language"') < js.indexOf('"RWK_SaveSync"'));
  assert.deepEqual(Object.keys(coreConfig(withLang).languages.choices), ["vi", "zh-tw"]);

  assert.equal(coreConfig(generatedFiles(game(), { slug: "g", sync: {} }, [f("data/a.json")])).languages, undefined);
  assert.equal(coreConfig(generatedFiles(game(), { slug: "g", sync: {}, languages: false }, FILES)).languages, undefined);
  assert.equal(runtimeConfigOf("MZ", { slug: "g", sync: {} }).languages, undefined, "taken from the game's files, or from the deployed build");
});

test("upgrade keeps the deployed build's translations", () => {
  const deployed = { languages: { default: "", original: "", lock: false, choices: { vi: { dir: "data-vi", files: ["a.json"] } } } };
  const next = runtimeConfigOf("MZ", { slug: "g", sync: {} });
  assert.deepEqual(mergeConfig(next, deployed, false).languages, deployed.languages);
  assert.equal(mergeConfig(next, {}, false).languages, undefined);
  const own = { ...next, languages: { choices: {} } };
  assert.deepEqual(mergeConfig(own, deployed, false).languages, { choices: {} }, "a build with the game's files wins");
});

test("the Service Worker keeps the translations, so offline play has them", () => {
  const sw = serviceWorkerSource([f("data/System.json"), f("data-vi/System.json"), f("data_zh-TW/System.json"), f("elsewhere/x.json")]);
  assert.match(sw, /"data-vi\/System\.json"/);
  assert.match(sw, /"data_zh-TW\/System\.json"/);
  assert.doesNotMatch(sw, /elsewhere/);
});

//---------------------------------------------------------------------------
// RWK_Language in the browser
//---------------------------------------------------------------------------

const CHOICES = {
  vi: { dir: "data-vi", files: ["System.json", "Map001.json"] },
  vn: { dir: "data-vn", files: ["System.json"] },
};

function load(languages, { stored = {}, choice } = {}) {
  const tools = [];
  const opened = [];
  class XHR {
    open(method, url) {
      opened.push(url);
    }
  }
  const store = { ...stored };
  const context = {
    XMLHttpRequest: XHR,
    document: { documentElement: {} },
    location: { reloaded: 0, reload() { this.reloaded++; } },
    Intl,
    window: null,
  };
  context.window = {
    RWK: {
      config: { gameId: "g", languages },
      storage: { get: (key, fallback = null) => (key in store ? store[key] : fallback), set: (key, value) => (store[key] = value) },
      tools: { add: (t) => tools.push(t) },
      choose: async (title, message, options) => {
        context.asked = options.map((o) => o.label);
        return choice === undefined ? null : choice;
      },
      icons: { languages: "<svg/>" },
    },
  };
  vm.runInNewContext(fs.readFileSync(new URL("../runtime/RWK_Language.js", import.meta.url), "utf8"), context);
  const xhr = new context.XMLHttpRequest();
  const get = (url) => {
    xhr.open("GET", url);
    return opened.at(-1);
  };
  return { tools, get, store, context, opened };
}

const lang = (extra = {}) => ({ default: "", original: "", lock: false, choices: CHOICES, ...extra });

test("language: the original data/ until a translation is picked", () => {
  const game = load(lang());
  assert.equal(game.get("data/System.json"), "data/System.json");
  assert.equal(game.tools.length, 1);
  assert.equal(game.tools[0].group, "display");
  assert.equal(game.tools[0].label(), "Language: Original");
  assert.equal(load(lang({ original: "ja" })).tools[0].label(), "Language: 日本語 (original)");
  assert.equal(load(false).tools.length, 0);
  assert.equal(load(undefined).tools.length, 0);
});

test("language: a picked translation serves its own files and falls back to data/", () => {
  const game = load(lang(), { stored: { "rwk.language.g": "vi" } });
  assert.equal(game.get("data/System.json"), "data-vi/System.json");
  assert.equal(game.get("./data/Map001.json"), "./data-vi/Map001.json");
  assert.equal(game.get("data/System.json?v=2"), "data-vi/System.json?v=2");
  assert.equal(game.get("data/Map002.json"), "data/Map002.json", "not translated: the original");
  assert.equal(game.get("data/sub/System.json"), "data/sub/System.json");
  assert.equal(game.get("img/pictures/System.json"), "img/pictures/System.json");
  assert.equal(game.get("data-vi/System.json"), "data-vi/System.json");
  assert.equal(game.context.document.documentElement.lang, "vi");
  assert.equal(game.tools[0].label(), "Language: Tiếng Việt");
});

test("language: the creator's default, a remembered pick, and the lock", () => {
  assert.equal(load(lang({ default: "vi" })).get("data/System.json"), "data-vi/System.json");
  assert.equal(load(lang({ default: "vi" }), { stored: { "rwk.language.g": "" } }).get("data/System.json"), "data/System.json", "the player chose the original");
  assert.equal(load(lang({ default: "vi" }), { stored: { "rwk.language.g": "xx" } }).get("data/System.json"), "data-vi/System.json", "a code the build lacks");
  assert.equal(load(lang({ default: "vi" }), { stored: { "rwk.language.g": 5 } }).get("data/System.json"), "data-vi/System.json");

  const locked = load(lang({ default: "vi", lock: true }), { stored: { "rwk.language.g": "" } });
  assert.equal(locked.get("data/System.json"), "data-vi/System.json");
  assert.equal(locked.tools.length, 0, "no picker");
});

test("language: Vietnamese folders named vn are still called Tiếng Việt", () => {
  assert.equal(load(lang(), { stored: { "rwk.language.g": "vn" } }).tools[0].label(), "Language: Tiếng Việt");
});

test("language: picking one remembers it and restarts the game", async () => {
  const game = load(lang(), { choice: "vi" });
  await game.tools[0].onSelect();
  assert.deepEqual([...game.context.asked], ["Original", "Tiếng Việt", "Tiếng Việt", "Cancel"], "vi and vn are two folders");
  assert.equal(game.store["rwk.language.g"], "vi");
  assert.equal(game.context.location.reloaded, 1);

  const same = load(lang({ default: "vi" }), { choice: "vi" });
  await same.tools[0].onSelect();
  assert.equal(same.context.location.reloaded, 0, "no change, no restart");
  const cancelled = load(lang());
  await cancelled.tools[0].onSelect();
  assert.equal(cancelled.context.location.reloaded, 0);
  assert.deepEqual(cancelled.store, {});

  const original = load(lang({ default: "vi" }), { choice: "" });
  await original.tools[0].onSelect();
  assert.equal(original.store["rwk.language.g"], "");
  assert.equal(original.context.location.reloaded, 1);
});
