//=============================================================================
// RWK_Translate.js - rpgmaker-web-toolkit
// Required Notice: Copyright 2026 Trương Tuấn Anh (https://github.com/Kokoroou)
// License: PolyForm Noncommercial 1.0.0 with the Game Creators permission,
// https://github.com/Kokoroou/rpgmaker-web-toolkit/blob/main/LICENSE
// Live machine translation, for games in a language the player does not read:
// messages, choices, the speaker's name and the names and descriptions of
// items, weapons, armors and skills go through the Worker (/api/translate,
// Workers AI), which keeps every translated line in R2 for the next player.
// Control codes (\C[2], \N[1], \I[5]…) stay as they are, outside what is sent.
// Off until the player turns it on; the original shows whenever a line is not
// ready in time, the daily limit is reached or the device is offline.
//=============================================================================
/*:
 * @target MZ MV
 * @plugindesc [rpgmaker-web-toolkit] Live machine translation of messages and names. Requires RWK_Core.
 * @author rpgmaker-web-toolkit
 */

(() => {
  "use strict";

  const RWK = window.RWK;
  if (!RWK || !RWK.config.translate) return;

  // The deployer's choice (cli/lib/stage.js: translateConfig).
  const cfg = RWK.config.translate;
  const FROM = cfg.from || "auto";
  // Never into the game's own language.
  const listed = (Array.isArray(cfg.to) ? cfg.to : []).filter((code) => code !== FROM);
  const TARGETS = listed.length ? listed : ["en"];
  const ON_KEY = "rwk.translate." + RWK.config.gameId;
  const TO_KEY = "rwk.translateTo." + RWK.config.gameId;
  // How long a message waits for its translation before the original shows.
  const WAIT_MS = 2000;
  const BATCH = 50; // texts per request (worker/translate.js: MAX_TEXTS)
  const MAX_CHARS = 1000;

  let on = RWK.storage.get(ON_KEY) === true;
  const storedTo = RWK.storage.get(TO_KEY);
  let to = TARGETS.includes(storedTo) ? storedTo : TARGETS.includes(cfg.default) ? cfg.default : TARGETS[0];
  let unavailable = false; // the Worker said no (not set up, turned off): until the next launch
  let limitedNoted = false;
  const active = () => on && !unavailable && to !== FROM;

  //---------------------------------------------------------------------------
  // Text: control codes stay, the words between them are translated.
  //---------------------------------------------------------------------------

  // Raw text, before convertEscapeCharacters: \\ \$ \. \| \^ \! \> \< \{ \}
  // and \Name / \Name[…] / \Name<…> (plugins add their own codes in that shape).
  const CODE = /\\(?:[$.|^!><{}\\]|[A-Za-z]+(?:\[[^\]\n]*\]|<[^>\n]*>)?)/g;
  const CJK = /[　-ヿ㐀-鿿豈-﫿＀-￯]/;
  const HAS_WORDS = /[A-Za-zÀ-ɏͰ-῿぀-ヿ㐀-鿿가-힯豈-﫿]/;

  // -> [{ code: true, text } | { code: false, text, lead, core, trail }]; a
  // line break inside a run joins the lines (no space between CJK characters).
  function split(text) {
    const out = [];
    let at = 0;
    const words = (run) => {
      if (!run) return;
      const joined = run.replace(/\n/g, (m, i) => (CJK.test(run[i - 1] || "") && CJK.test(run[i + 1] || "") ? "" : " "));
      const m = /^(\s*)([\s\S]*?)(\s*)$/.exec(joined);
      out.push({ code: false, text: joined, lead: m[1], core: m[2], trail: m[3] });
    };
    String(text).replace(CODE, (code, i) => {
      words(text.slice(at, i));
      out.push({ code: true, text: code });
      at = i + code.length;
      return code;
    });
    words(text.slice(at));
    return out;
  }

  const wants = (part) => !part.code && HAS_WORDS.test(part.core) && part.core.length <= MAX_CHARS;

  // Every run of words to send for these texts.
  const runsOf = (texts) => texts.flatMap((t) => split(t).filter(wants).map((p) => p.core));

  // text with its runs replaced by what came back (the original where nothing did).
  function rebuild(text, lang = to) {
    return split(text)
      .map((p) => {
        if (!wants(p)) return p.text;
        const done = cache.get(lang + "\n" + p.core);
        return p.lead + (typeof done === "string" ? done : p.core) + p.trail;
      })
      .join("");
  }

  //---------------------------------------------------------------------------
  // Requests: texts asked for within one frame go in one request.
  //---------------------------------------------------------------------------

  const cache = new Map(); // `${lang}\n${text}` -> translation | null (failed this time)
  const waiting = new Map(); // same key -> Promise
  let queue = [];
  let timer = null;

  function request(texts, lang = to) {
    const promises = [];
    for (const text of new Set(texts)) {
      const key = lang + "\n" + text;
      if (cache.has(key)) continue;
      if (!waiting.has(key)) {
        waiting.set(
          key,
          new Promise((resolve) => queue.push({ text, lang, key, resolve }))
        );
      }
      promises.push(waiting.get(key));
    }
    if (queue.length && !timer) timer = setTimeout(flush, 16);
    return Promise.all(promises);
  }

  function flush() {
    timer = null;
    const items = queue;
    queue = [];
    const byLang = new Map();
    for (const item of items) {
      if (!byLang.has(item.lang)) byLang.set(item.lang, []);
      byLang.get(item.lang).push(item);
    }
    for (const [lang, list] of byLang) {
      for (let i = 0; i < list.length; i += BATCH) send(lang, list.slice(i, i + BATCH));
    }
  }

  async function send(lang, items) {
    let texts = null;
    try {
      const res = await fetch("/api/translate", {
        method: "POST",
        headers: { "content-type": "application/json", "x-rwk-device": RWK.deviceId },
        body: JSON.stringify({ from: FROM, to: lang, texts: items.map((i) => i.text) }),
        credentials: "same-origin",
        cache: "no-store",
        redirect: "manual",
      });
      if (res.status === 403 || res.status === 501) {
        unavailable = true;
        RWK.toast("Translation is not available for this game", "warn", 3000);
      } else if (res.ok) {
        const data = await res.json();
        texts = Array.isArray(data.texts) ? data.texts : null;
        if (data.limited && !limitedNoted) {
          limitedNoted = true;
          RWK.toast("Today's translation limit is reached: new lines stay in the original", "warn", 4000);
        }
      }
    } catch (e) {
      // Offline or timed out: the originals.
    }
    items.forEach((item, i) => {
      const value = texts && typeof texts[i] === "string" ? texts[i] : null;
      // A failure is not kept, so the line is asked for again next time.
      if (value !== null) cache.set(item.key, value);
      waiting.delete(item.key);
      item.resolve(value);
    });
  }

  //---------------------------------------------------------------------------
  // Wrapping: a translation is rarely as long as the original, so the lines
  // are broken again to the window's width (a long one goes on the next page).
  //---------------------------------------------------------------------------

  const NO_SPACES = /^(zh|ja|th)/;

  function wrap(win, text) {
    const width = messageWidth(win);
    if (!width || !win.contents || typeof win.contents.measureTextWidth !== "function") return text.split("\n");
    const measure = (s) => win.contents.measureTextWidth(s);
    const iconWidth = (typeof ImageManager !== "undefined" && ImageManager.iconWidth) || Window_Base._iconWidth || 32;
    const lines = [];
    let line = "";
    let used = 0;
    for (const p of split(text)) {
      if (p.code) {
        line += p.text;
        if (/^\\I\[/i.test(p.text)) used += iconWidth + 4;
        continue;
      }
      const pieces = NO_SPACES.test(to) ? Array.from(p.text) : p.text.split(/(?<= )/);
      for (const piece of pieces) {
        const w = measure(piece);
        if (used + w > width && line.trim()) {
          lines.push(line.replace(/\s+$/, ""));
          line = piece.replace(/^\s+/, "");
          used = measure(line);
        } else {
          line += piece;
          used += w;
        }
      }
    }
    if (line.trim() || !lines.length) lines.push(line.replace(/\s+$/, ""));
    return lines;
  }

  function messageWidth(win) {
    const contents = win.contents;
    if (!contents || !contents.width) return 0;
    const face = $gameMessage.faceName() ? ((typeof ImageManager !== "undefined" && ImageManager.faceWidth) || Window_Base._faceWidth || 144) + 24 : 0;
    return (contents.width - face) * 0.97;
  }

  //---------------------------------------------------------------------------
  // Messages and choices (Game_Message / Window_Message, same names in MZ and MV).
  // canStart holds the message back until its translation is in, or WAIT_MS.
  //---------------------------------------------------------------------------

  let job = null; // { texts: the message's own array, done, until }

  function messageParts() {
    const speaker = typeof $gameMessage.speakerName === "function" ? $gameMessage.speakerName() : "";
    return { text: $gameMessage._texts.join("\n"), choices: $gameMessage._choices || [], speaker: speaker || "" };
  }

  const changed = (run) => {
    const done = cache.get(to + "\n" + run);
    return typeof done === "string" && done !== run;
  };

  function apply(win) {
    const { text, choices, speaker } = messageParts();
    // Nothing came back: the lines stay as the game broke them.
    if (runsOf([text]).some(changed)) $gameMessage._texts = wrap(win, rebuild(text));
    if (choices.length) $gameMessage._choices = choices.map((c) => rebuild(c));
    if (speaker && "_speakerName" in $gameMessage) $gameMessage._speakerName = rebuild(speaker);
    job.texts = $gameMessage._texts;
    job.done = true;
  }

  // -> true once the current message may show
  function ready(win) {
    if (!active() || !Array.isArray($gameMessage._texts)) return true;
    if (job && job.texts === $gameMessage._texts) {
      if (job.done) return true;
      if (job.arrived || Date.now() >= job.until) {
        apply(win);
        return true;
      }
      return false;
    }
    const { text, choices, speaker } = messageParts();
    const runs = runsOf([text, speaker, ...choices]);
    job = { texts: $gameMessage._texts, done: false, arrived: false, until: Date.now() + WAIT_MS };
    if (!runs.length || runs.every((r) => cache.has(to + "\n" + r))) {
      apply(win);
      return true;
    }
    const mine = job;
    request(runs).then(() => (mine.arrived = true));
    return false;
  }

  const _canStart = Window_Message.prototype.canStart;
  Window_Message.prototype.canStart = function () {
    return _canStart.apply(this, arguments) && ready(this);
  };

  // Choices with no message before them start here, not through canStart.
  const _startInput = Window_Message.prototype.startInput;
  Window_Message.prototype.startInput = function () {
    if ($gameMessage.isChoice() && !$gameMessage.hasText() && !ready(this)) return true; // asked again next frame
    return _startInput.apply(this, arguments);
  };

  //---------------------------------------------------------------------------
  // The database: names and descriptions, translated once per launch and
  // put back when the player turns translation off or picks another language.
  //---------------------------------------------------------------------------

  const originals = new Map(); // object -> { name, description }
  const FIELDS = ["name", "description"];
  let dbRound = 0;

  function databaseObjects() {
    const lists = [window.$dataItems, window.$dataWeapons, window.$dataArmors, window.$dataSkills];
    return lists.flatMap((list) => (Array.isArray(list) ? list.filter((o) => o && typeof o.name === "string") : []));
  }

  function restoreDatabase() {
    for (const [obj, fields] of originals) Object.assign(obj, fields);
  }

  async function translateDatabase() {
    const round = ++dbRound;
    restoreDatabase();
    if (!active()) return;
    const objects = databaseObjects();
    for (const obj of objects) if (!originals.has(obj)) originals.set(obj, { name: obj.name, description: obj.description || "" });
    // Line by line: a description fills the help window's two lines as the game wrote them.
    const texts = objects.flatMap((obj) => FIELDS.flatMap((f) => originals.get(obj)[f].split("\n")));
    const lang = to;
    await request(runsOf(texts), lang);
    if (round !== dbRound || !active()) return; // turned off, or another language since
    for (const obj of objects) {
      const orig = originals.get(obj);
      obj.name = rebuild(orig.name, lang);
      if (orig.description) obj.description = orig.description.split("\n").map((line) => rebuild(line, lang)).join("\n");
    }
  }

  const _start = Scene_Boot.prototype.start;
  Scene_Boot.prototype.start = function () {
    _start.apply(this, arguments);
    if (active()) translateDatabase();
  };

  //---------------------------------------------------------------------------
  // Font: many game fonts lack the Vietnamese marks (ơ, ư, ề…), and a mark
  // drawn from another font looks broken. Every common system font has them.
  //---------------------------------------------------------------------------

  const FULL_FONTS = '"Noto Sans", "Segoe UI", Roboto, "Helvetica Neue", Arial, sans-serif';
  const needsFont = () => active() && cfg.font !== "game" && /^vi/.test(to);
  if (typeof Game_System !== "undefined" && Game_System.prototype.mainFontFace) {
    const _mainFontFace = Game_System.prototype.mainFontFace; // MZ
    Game_System.prototype.mainFontFace = function () {
      return needsFont() ? FULL_FONTS : _mainFontFace.apply(this, arguments);
    };
  } else if (Window_Base.prototype.standardFontFace) {
    const _standardFontFace = Window_Base.prototype.standardFontFace; // MV
    Window_Base.prototype.standardFontFace = function () {
      return needsFont() ? FULL_FONTS : _standardFontFace.apply(this, arguments);
    };
  }

  //---------------------------------------------------------------------------
  // ⚙ → Display: the switch, and the language when there is a choice.
  //---------------------------------------------------------------------------

  function nameOf(code) {
    try {
      const name = new Intl.DisplayNames([code], { type: "language" }).of(code);
      if (name && name.toLowerCase() !== code.toLowerCase()) return name.charAt(0).toLocaleUpperCase(code) + name.slice(1);
    } catch (e) {
      // No Intl.DisplayNames, or a code it does not know.
    }
    return code.toUpperCase();
  }

  function setOn(value) {
    on = value;
    unavailable = false;
    RWK.storage.set(ON_KEY, on);
    if (window.$dataItems) translateDatabase();
    RWK.toast(on ? `Translation into ${nameOf(to)}: on` : "Translation: off", "info", 1500);
  }

  async function pickLanguage() {
    const options = TARGETS.map((code) => ({ label: nameOf(code), value: code, primary: code === to }));
    options.push({ label: "Cancel", value: null });
    const code = await RWK.choose("Translate into", "Machine translation: names and messages may read oddly.", options);
    if (code === null || code === to) return;
    to = code;
    RWK.storage.set(TO_KEY, code);
    if (window.$dataItems) translateDatabase();
  }

  RWK.tools.add({
    icon: RWK.icons.languages,
    group: "display",
    label: "Translate the game",
    type: "switch",
    checked: () => on,
    summary: () => (on ? `Translated into ${nameOf(to)}` : ""),
    detail: () => (on ? `Into ${nameOf(to)}, by machine; the original shows until a line is ready` : "Machine translation of messages and names"),
    keepOpen: true,
    onSelect: () => setOn(!on),
  });
  if (TARGETS.length > 1) {
    RWK.tools.add({
      icon: RWK.icons.languages,
      group: "display",
      label: () => `Translate into: ${nameOf(to)}`,
      detail: "Tap to pick another language",
      onSelect: pickLanguage,
    });
  }

  // For tests and other plugins.
  RWK.translate = { split, rebuild, wrap, isOn: () => on, target: () => to };
})();
