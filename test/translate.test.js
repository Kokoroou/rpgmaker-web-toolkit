// Live translation: the Worker's endpoint (worker/translate.js) with a fake
// Workers AI binding, the CLI's settings and Worker bindings, and the
// runtime plugin (RWK_Translate) in a VM with the engine globals it touches.

import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import vm from "node:vm";
import { createWorker } from "../worker/index.js";
import { detectLanguage, translateAllowed, translateSettings } from "../worker/translate.js";
import { settingsKey } from "../worker/settings.js";
import { workerVars, writeWorkerProject } from "../cli/lib/cloudflare.js";
import { keepAssetsPatch } from "../cli/lib/workers-api.js";
import { DEFAULT_TRANSLATE, loadLimits, parseLimits } from "../cli/lib/limits.js";
import { parsePolicy } from "../cli/lib/policy.js";
import { RUNTIME_PLUGINS, TRANSLATE_TARGETS, keysNeedingDeploy, liveSettingsOf, runtimeConfigOf, runtimeSources, translateConfig, translateWanted, translateWorker } from "../cli/lib/stage.js";
import { makeEnv } from "./helpers.js";

const BASE = "https://game.example.workers.dev";
const ROOT = path.join(import.meta.dirname, "..");
const SETTINGS = { model: "@cf/meta/m2m100-1.2b", dailyChars: 100, on: true };

function fakeAI(fn = ({ text, target_lang }) => ({ translated_text: `[${target_lang}] ${text}` })) {
  const calls = [];
  return {
    calls,
    async run(model, input) {
      calls.push({ model, ...input });
      return fn(input);
    },
  };
}

function setup(overrides = {}) {
  const AI = fakeAI(overrides.ai);
  const env = makeEnv({ RWK_TRANSLATE: JSON.stringify(SETTINGS), AI, ...overrides.env });
  const worker = createWorker();
  const post = async (body, method = "POST") => {
    const res = await worker.fetch(new Request(BASE + "/api/translate", { method, body: method === "POST" ? JSON.stringify(body) : undefined }), env);
    return { status: res.status, body: await res.json() };
  };
  return { env, AI, post };
}

test("translate api: translates, keeps each line in R2 and answers again from there", async () => {
  const { env, AI, post } = setup();
  const res = await post({ from: "ja", to: "en", texts: ["こんにちは", "  ", "またね"] });
  assert.equal(res.status, 200);
  assert.deepEqual(res.body, { texts: ["[en] こんにちは", "  ", "[en] またね"], limited: false });
  assert.deepEqual(AI.calls.map((c) => [c.model, c.source_lang, c.target_lang]), [
    ["@cf/meta/m2m100-1.2b", "ja", "en"],
    ["@cf/meta/m2m100-1.2b", "ja", "en"],
  ]);
  const keys = [...env.BUCKET.objects.keys()];
  assert.equal(keys.filter((k) => /^rwk\/translate\/meta_m2m100-1\.2b\/ja-en\/[0-9a-f]{64}\.txt$/.test(k)).length, 2);
  assert.ok(keys.includes(`rwk/translate/usage/${new Date().toISOString().slice(0, 10)}.json`));

  const again = await post({ from: "ja", to: "en", texts: ["またね"] });
  assert.deepEqual(again.body.texts, ["[en] またね"]);
  assert.equal(AI.calls.length, 2, "from R2, no second call");
});

test("translate api: guesses the language, and leaves text already in the target", async () => {
  const { AI, post } = setup();
  const res = await post({ to: "en", texts: ["안녕", "Hello there", "你好"] });
  assert.deepEqual(res.body.texts, ["[en] 안녕", "Hello there", "[en] 你好"]);
  assert.deepEqual(AI.calls.map((c) => c.source_lang), ["ko", "zh"]);
  assert.equal(detectLanguage("ありがとう"), "ja");
  assert.equal(detectLanguage("Привет"), "ru");
  assert.equal(detectLanguage("สวัสดี"), "th");
  assert.equal(detectLanguage("مرحبا"), "ar");
});

test("translate api: the daily cap leaves new lines untranslated, cached ones still come", async () => {
  const { env, AI, post } = setup();
  await post({ from: "ja", to: "en", texts: ["あ".repeat(60)] });
  const res = await post({ from: "ja", to: "en", texts: ["あ".repeat(60), "い".repeat(50), "う".repeat(30)] });
  assert.deepEqual(res.body.texts, ["[en] " + "あ".repeat(60), null, "[en] " + "う".repeat(30)]);
  assert.equal(res.body.limited, true);
  assert.equal(AI.calls.length, 2);
  const day = new Date().toISOString().slice(0, 10);
  const usage = JSON.parse(new TextDecoder().decode(await (await env.BUCKET.get(`rwk/translate/usage/${day}.json`)).arrayBuffer()));
  assert.deepEqual(usage, { chars: 90 });
});

test("translate api: a model error or an empty answer gives null and is not kept", async () => {
  let fail = true;
  const { env, post } = setup({
    ai: ({ text }) => {
      if (text === "empty") return { translated_text: "  " };
      if (fail) throw new Error("out of neurons");
      return { translated_text: "ok" };
    },
  });
  const res = await post({ from: "fr", to: "en", texts: ["bonjour", "empty"] });
  assert.deepEqual(res.body.texts, [null, null]);
  assert.equal([...env.BUCKET.objects.keys()].filter((k) => k.endsWith(".txt")).length, 0);
  fail = false;
  assert.deepEqual((await post({ from: "fr", to: "en", texts: ["bonjour"] })).body.texts, ["ok"]);
});

test("translate api: refuses what it cannot or may not do", async () => {
  const { post } = setup();
  assert.equal((await post(null, "GET")).status, 405);
  assert.equal((await post({ to: "english!", texts: ["a"] })).status, 400);
  assert.equal((await post({ from: "x y", to: "en", texts: ["a"] })).status, 400);
  assert.equal((await post({ to: "en", texts: [] })).status, 400);
  assert.equal((await post({ to: "en", texts: new Array(51).fill("a") })).status, 400);
  assert.equal((await post({ to: "en", texts: ["a".repeat(1001)] })).status, 400);
  assert.equal((await post({ to: "en", texts: [3] })).status, 400);

  const worker = createWorker();
  const bad = await worker.fetch(new Request(BASE + "/api/translate", { method: "POST", body: "{" }), makeEnv({ RWK_TRANSLATE: JSON.stringify(SETTINGS), AI: fakeAI() }));
  assert.equal(bad.status, 400);

  const noAi = await worker.fetch(new Request(BASE + "/api/translate", { method: "POST", body: "{}" }), makeEnv({ RWK_TRANSLATE: JSON.stringify(SETTINGS) }));
  assert.equal(noAi.status, 501, "deployed without the Workers AI binding");
  const noVar = await worker.fetch(new Request(BASE + "/api/translate", { method: "POST", body: "{}" }), makeEnv({ AI: fakeAI() }));
  assert.equal(noVar.status, 501);
});

test("translate api: follows the deployer's live settings and each player's own", async () => {
  const { env, post } = setup({ env: { RWK_TRANSLATE: JSON.stringify({ ...SETTINGS, on: false }) } });
  assert.equal((await post({ to: "en", texts: ["こんにちは"] })).status, 403, "off at deploy, on for one player only");
  // A settings file from `rwk config` (worker/settings.js) wins over the deploy.
  const live = setup();
  await live.env.BUCKET.put(settingsKey(live.env.GAME_ID), JSON.stringify({ config: { translate: false }, players: {} }));
  assert.equal((await live.post({ to: "en", texts: ["こんにちは"] })).status, 403);

  assert.equal(translateAllowed({ on: false }, { settings: { translate: { to: ["en"] } } }), true, "the player's own setting first");
  assert.equal(translateAllowed({ on: true }, { settings: { translate: false }, shared: { translate: {} } }), false);
  assert.equal(translateAllowed({ on: false }, { shared: { translate: { to: ["en"] } } }), true);
  assert.equal(translateAllowed({ on: true }, {}), true);
  assert.equal(translateSettings({ RWK_TRANSLATE: "{" }), null);
  assert.equal(translateSettings({ RWK_TRANSLATE: '{"dailyChars":3}' }), null);
});

test("translate config: off unless asked, targets, source and font", () => {
  assert.equal(translateConfig(undefined), false);
  assert.equal(translateConfig(false), false);
  assert.deepEqual(translateConfig(true), { to: TRANSLATE_TARGETS, default: "en", from: "auto", font: "auto" });
  assert.deepEqual(translateConfig({ to: ["VI", "en", "vi", "not a code"], default: "en", from: "ja", font: "game" }), { to: ["vi", "en"], default: "en", from: "ja", font: "game" });
  assert.deepEqual(translateConfig({ to: ["vi"], default: "fr" }, { original: "ja" }), { to: ["vi"], default: "vi", from: "ja", font: "auto" });
  assert.equal(runtimeConfigOf("MZ", { slug: "g" }).translate, false);
  assert.equal(runtimeConfigOf("MZ", { slug: "g", translate: { to: ["vi"] } }).translate.default, "vi");
  assert.ok(RUNTIME_PLUGINS.includes("RWK_Translate"));
  assert.ok(runtimeSources().RWK_Translate.includes("/api/translate"));

  const policy = parsePolicy({ hosting: "shared", features: { translate: false } });
  assert.equal(liveSettingsOf("MZ", { slug: "g", translate: true }, policy).config.translate, false, "the creator's policy wins");
});

test("translate: the Worker gets Workers AI only when someone may translate", async () => {
  const limits = await loadLimits({ url: "off" });
  assert.deepEqual(limits.translate, { model: "@cf/meta/m2m100-1.2b", dailyChars: 100000 });
  assert.equal(translateWanted({}), false);
  assert.equal(translateWanted({ players: { "a@b.c": { translate: true } } }), true);
  assert.equal(translateWorker({ translate: true }, null, limits).on, true);
  assert.deepEqual(translateWorker({ players: { "a@b.c": { translate: true } } }, null, limits), { ...limits.translate, on: false });
  assert.equal(translateWorker({}, null, limits), null);
  assert.equal(translateWorker({ translate: true }, parsePolicy({ hosting: "shared", features: { translate: false } }), limits), null);

  assert.equal(workerVars({ gameId: "g", auth: {} }).RWK_TRANSLATE, undefined);
  assert.equal(workerVars({ gameId: "g", auth: {}, translate: { model: "m", dailyChars: 1, on: true } }).RWK_TRANSLATE, '{"model":"m","dailyChars":1,"on":true}');

  const buildDir = fs.mkdtempSync(path.join(os.tmpdir(), "rwk-tr-"));
  const translate = { ...limits.translate, on: true };
  const common = { buildDir, slug: "g", overflowRels: [], auth: { mode: "none" }, locked: false, toolkitRoot: ROOT };
  let cfg = JSON.parse(fs.readFileSync(writeWorkerProject({ ...common, bucket: "b", translate }), "utf8"));
  assert.deepEqual(cfg.ai, { binding: "AI" });
  assert.ok(JSON.parse(cfg.vars.RWK_TRANSLATE).dailyChars > 0);
  cfg = JSON.parse(fs.readFileSync(writeWorkerProject({ ...common, bucket: "b" }), "utf8"));
  assert.equal(cfg.ai, undefined);
  cfg = JSON.parse(fs.readFileSync(writeWorkerProject({ ...common, bucket: null, translate }), "utf8"));
  assert.equal(cfg.ai, undefined, "translations live in R2");
  fs.rmSync(buildDir, { recursive: true, force: true });

  const toolkit = { names: RUNTIME_PLUGINS, plugins: {}, config: {}, keepOff: false };
  const patch = keepAssetsPatch({ slug: "g", bucket: "b", overflowRels: [], auth: { mode: "none" }, toolkitRoot: ROOT, toolkit, translate });
  assert.ok(patch.bindings.some((b) => b.type === "ai" && b.name === "AI"));
  assert.ok(!keepAssetsPatch({ slug: "g", bucket: "b", overflowRels: [], auth: { mode: "none" }, toolkitRoot: ROOT, toolkit }).bindings.some((b) => b.type === "ai"));
});

test("translate: limits file, and the deploy that turning it on needs", () => {
  const base = { updated: "2026-10-29", assets: { maxFiles: 20000, maxFileBytes: 26214400 } };
  assert.deepEqual(parseLimits(base).translate, DEFAULT_TRANSLATE, "a copy from before the key");
  assert.deepEqual(parseLimits({ ...base, translate: { model: "@cf/meta/other-1b", dailyChars: 5 } }).translate, { model: "@cf/meta/other-1b", dailyChars: 5 });
  assert.deepEqual(parseLimits({ ...base, translate: { model: "gpt", dailyChars: 5 } }).translate, DEFAULT_TRANSLATE);
  assert.deepEqual(parseLimits({ ...base, translate: { model: "@cf/a/b", dailyChars: -1 } }).translate, DEFAULT_TRANSLATE);
  const bundled = JSON.parse(fs.readFileSync(path.join(ROOT, "cli", "limits.json"), "utf8"));
  assert.deepEqual(parseLimits(bundled).translate, { model: bundled.translate.model, dailyChars: bundled.translate.dailyChars });

  assert.deepEqual(keysNeedingDeploy({ slug: "g" }, { slug: "g", translate: true }), ["translate"]);
  assert.deepEqual(keysNeedingDeploy({ slug: "g", translate: true }, { slug: "g", translate: { to: ["vi"] } }), []);
  assert.deepEqual(keysNeedingDeploy({ slug: "g", translate: true }, { slug: "g", translate: false }), []);
});

//---------------------------------------------------------------------------
// The runtime plugin
//---------------------------------------------------------------------------

const source = fs.readFileSync(path.join(ROOT, "runtime", "RWK_Translate.js"), "utf8");

function load({ translate = { to: ["en", "vi"], default: "en", from: "ja", font: "auto" }, stored = {}, engine = "MZ", answer } = {}) {
  const added = [];
  const toasts = [];
  const store = new Map(Object.entries(stored));
  const requests = [];
  answer = answer || ((body) => ({ texts: body.texts.map((t) => `<${body.to}:${t}>`) }));
  const fetch = async (url, init) => {
    const body = JSON.parse(init.body);
    requests.push({ url, ...body });
    const out = answer(body);
    if (out instanceof Error) throw out;
    if (typeof out === "number") return { ok: false, status: out, json: async () => ({}) };
    return { ok: true, status: 200, json: async () => out };
  };
  class Bitmap {
    constructor(width) {
      this.width = width;
    }
    measureTextWidth(s) {
      return s.length * 10;
    }
  }
  class Window_Base {
    standardFontFace() {
      return "GameFont";
    }
  }
  class Window_Message extends Window_Base {
    constructor() {
      super();
      this.contents = new Bitmap(400);
      this.started = 0;
      this.inputs = 0;
    }
    canStart() {
      return message.hasText() && !message.scrollMode();
    }
    startInput() {
      this.inputs++;
      return message.isChoice();
    }
  }
  class Game_System {}
  if (engine === "MZ") Game_System.prototype.mainFontFace = () => "rmmz-mainfont";
  const message = {
    _texts: [],
    _choices: [],
    _speakerName: "",
    _faceName: "",
    hasText() {
      return this._texts.length > 0;
    },
    isChoice() {
      return this._choices.length > 0;
    },
    scrollMode: () => false,
    faceName() {
      return this._faceName;
    },
    speakerName() {
      return this._speakerName;
    },
  };
  class Scene_Boot {
    start() {}
  }
  const window = {
    RWK: {
      config: { gameId: "g", translate },
      deviceId: "dev",
      storage: { get: (k) => (store.has(k) ? store.get(k) : null), set: (k, v) => store.set(k, v) },
      tools: { add: (t) => added.push(t) },
      icons: { languages: "<svg/>" },
      toast: (m) => toasts.push(m),
      choose: async () => null,
    },
  };
  const context = { window, console, fetch, setTimeout, Date, Intl, Window_Base, Window_Message, Game_System, Scene_Boot, $gameMessage: message, ImageManager: { iconWidth: 32, faceWidth: 144 } };
  vm.runInNewContext(source, context);
  return { RWK: window.RWK, window, context, message, added, toasts, store, requests, Window_Message, Game_System, Scene_Boot };
}

const tick = (ms = 30) => new Promise((r) => setTimeout(r, ms));

test("translate plugin: not loaded when the config turns it off", () => {
  const { RWK, added } = load({ translate: false });
  assert.equal(RWK.translate, undefined);
  assert.equal(added.length, 0);
});

test("translate plugin: control codes stay, the words between them go", () => {
  const { RWK } = load();
  const parts = RWK.translate.split("\\C[2]ハロルド\\C[0]：\n\\N[1]、元気？ \\I[64]");
  assert.deepEqual(
    JSON.parse(JSON.stringify(parts.map((p) => (p.code ? p.text : `«${p.core}»`)))),
    ["\\C[2]", "«ハロルド»", "\\C[0]", "«：»", "\\N[1]", "«、元気？»", "\\I[64]"]
  );
  assert.equal(RWK.translate.split("今日は\nいい天気")[0].text, "今日はいい天気", "no space between CJK lines");
  assert.equal(RWK.translate.split("Good\nmorning")[0].text, "Good morning");
  assert.equal(RWK.translate.rebuild("\\C[2]Hi\\C[0]"), "\\C[2]Hi\\C[0]", "nothing translated yet: the original");
});

test("translate plugin: a message waits for its translation, then shows it wrapped", async () => {
  const { message, Window_Message, store, requests } = load({ stored: { "rwk.translate.g": true } });
  message._texts = ["\\C[2]ハロルド\\C[0]：", "こんにちは、世界！"];
  message._choices = ["はい", "いいえ"];
  message._speakerName = "ハロルド";
  const win = new Window_Message();
  assert.equal(win.canStart(), false, "held back while the request runs");
  await tick();
  assert.equal(requests.length, 1, "one request for the message, its choices and the speaker");
  assert.equal(requests[0].from, "ja");
  assert.equal(requests[0].to, "en");
  // The two lines are one sentence: sent together, without a space between CJK characters.
  assert.deepEqual(requests[0].texts.sort(), ["ハロルド", "：こんにちは、世界！", "はい", "いいえ"].sort());
  assert.equal(win.canStart(), true);
  assert.equal(message._choices.join("|"), "<en:はい>|<en:いいえ>");
  assert.equal(message._speakerName, "<en:ハロルド>");
  const shown = message._texts.join("\n");
  assert.ok(shown.startsWith("\\C[2]<en:ハロルド>\\C[0]"), shown);
  assert.ok(message._texts.every((line) => line.replace(/\\C\[\d\]/g, "").length * 10 <= 400), "fits the window");
  assert.equal(win.canStart(), true, "the same message is not asked for twice");
  assert.equal(requests.length, 1);
  assert.equal(store.get("rwk.translate.g"), true);

  // A message whose lines are all known starts at once.
  message._texts = ["はい"];
  message._choices = [];
  message._speakerName = "";
  assert.equal(win.canStart(), true);
  assert.equal(message._texts.join("\n"), "<en:はい>");
});

test("translate plugin: the original shows when the Worker fails or is too slow", async () => {
  const fail = load({ stored: { "rwk.translate.g": true }, answer: () => new Error("offline") });
  fail.message._texts = ["こんにちは", "世界"];
  const win = new fail.Window_Message();
  assert.equal(win.canStart(), false);
  await tick();
  assert.equal(win.canStart(), true);
  assert.deepEqual(fail.message._texts, ["こんにちは", "世界"], "lines as the game broke them");

  const slow = load({ stored: { "rwk.translate.g": true }, answer: () => new Promise(() => {}) });
  slow.message._texts = ["こんにちは"];
  const w2 = new slow.Window_Message();
  assert.equal(w2.canStart(), false);
  // The plugin reads this Date (the VM's context shares it).
  const realNow = Date.now;
  try {
    Date.now = () => realNow() + 5000;
    assert.equal(w2.canStart(), true, "after the wait, the original");
  } finally {
    Date.now = realNow;
  }
  assert.deepEqual(slow.message._texts, ["こんにちは"]);

  const off = load({ stored: { "rwk.translate.g": true }, answer: () => 501 });
  off.message._texts = ["こんにちは"];
  const w3 = new off.Window_Message();
  w3.canStart();
  await tick();
  assert.equal(w3.canStart(), true);
  assert.deepEqual(off.toasts, ["Translation is not available for this game"]);
  off.message._texts = ["別の行"];
  assert.equal(w3.canStart(), true, "no more requests once the Worker said no");

  const limited = load({ stored: { "rwk.translate.g": true }, answer: (b) => ({ texts: b.texts.map(() => null), limited: true }) });
  limited.message._texts = ["こんにちは"];
  const w4 = new limited.Window_Message();
  w4.canStart();
  await tick();
  w4.canStart();
  assert.match(limited.toasts[0], /limit/);
});

test("translate plugin: choices on their own wait in startInput", async () => {
  const { message, Window_Message } = load({ stored: { "rwk.translate.g": true } });
  message._choices = ["はい"];
  const win = new Window_Message();
  assert.equal(win.startInput(), true);
  assert.equal(win.inputs, 0, "not started yet");
  await tick();
  win.startInput();
  assert.equal(win.inputs, 1);
  assert.deepEqual(message._choices, ["<en:はい>"]);
});

test("translate plugin: off by default, and nothing is asked for", () => {
  const { message, Window_Message, requests, added } = load();
  message._texts = ["こんにちは"];
  assert.equal(new Window_Message().canStart(), true);
  assert.equal(requests.length, 0);
  assert.deepEqual(added.map((t) => t.type || "row"), ["switch", "row"]);
  assert.equal(added[0].checked(), false);
  assert.equal(added[0].summary(), "");
  assert.match(added[1].label(), /English/);
});

test("translate plugin: names and descriptions, put back when turned off", async () => {
  const t = load({ stored: { "rwk.translate.g": true } });
  t.window.$dataItems = [null, { name: "ポーション", description: "HPを回復\n\\C[2]小\\C[0]" }];
  t.window.$dataSkills = [null, { name: "", description: "" }];
  new t.Scene_Boot().start();
  await tick();
  assert.equal(t.window.$dataItems[1].name, "<en:ポーション>");
  assert.equal(t.window.$dataItems[1].description, "<en:HPを回復>\n\\C[2]<en:小>\\C[0]");
  t.added[0].onSelect(); // off
  assert.equal(t.window.$dataItems[1].name, "ポーション");
  assert.equal(t.store.get("rwk.translate.g"), false);
  t.added[0].onSelect(); // on again
  await tick();
  assert.equal(t.window.$dataItems[1].name, "<en:ポーション>");
});

test("translate plugin: a font with every Vietnamese mark, unless the deployer keeps the game's", async () => {
  const mz = load({ stored: { "rwk.translate.g": true, "rwk.translateTo.g": "vi" } });
  assert.match(new mz.Game_System().mainFontFace(), /Noto Sans/);
  const mzEn = load({ stored: { "rwk.translate.g": true } });
  assert.equal(new mzEn.Game_System().mainFontFace(), "rmmz-mainfont");
  const mv = load({ engine: "MV", stored: { "rwk.translate.g": true, "rwk.translateTo.g": "vi" } });
  assert.match(new mv.Window_Message().standardFontFace(), /Noto Sans/);
  const kept = load({ engine: "MV", translate: { to: ["vi"], default: "vi", from: "ja", font: "game" }, stored: { "rwk.translate.g": true } });
  assert.equal(new kept.Window_Message().standardFontFace(), "GameFont");
  assert.equal(kept.added.length, 1, "one language: no picker");
  const own = load({ translate: { to: ["ja", "en"], default: "ja", from: "ja", font: "auto" } });
  assert.equal(own.RWK.translate.target(), "en", "never into the game's own language");
  assert.equal(own.added.length, 1);
});

test("translate plugin: picking another language", async () => {
  const t = load({ stored: { "rwk.translate.g": true } });
  t.RWK.choose = async (title, text, options) => {
    assert.deepEqual(options.map((o) => o.value), ["en", "vi", null]);
    return "vi";
  };
  t.window.$dataItems = [null, { name: "ポーション", description: "" }];
  await t.added[1].onSelect();
  assert.equal(t.RWK.translate.target(), "vi");
  assert.equal(t.store.get("rwk.translateTo.g"), "vi");
  await tick();
  assert.equal(t.window.$dataItems[1].name, "<vi:ポーション>");
  assert.equal(t.requests.at(-1).to, "vi");
});
