// Live translation of the game's text through Workers AI (RWK_Translate).
//
//   POST /api/translate   { from: "ja" | "auto", to: "en", texts: [string] }
//                         -> { texts: [string | null], limited: bool }
//
// null: that text could not be translated now (the player sees the original).
// Each translated text is kept in R2, shared by every game and device of the
// account, so a line is only paid for once:
//
//   rwk/translate/<model>/<from>-<to>/<sha-256 of the text>.txt
//
// The free plan gives 10,000 Neurons a day to the whole account. Characters
// sent to the model are counted per UTC day (cli/limits.json: translate.dailyChars),
// across every game that shares the bucket; past the cap new lines stay
// untranslated until the next day, lines already in R2 still come back.
//
//   rwk/translate/usage/<YYYY-MM-DD>.json   { chars }
//
// RWK_TRANSLATE, written by the CLI: '{"model":"…","dailyChars":100000,"on":true}'
// (on: everyone's setting at deploy). Absent: the deploy had no AI binding.

import { json } from "./saves.js";

const MAX_TEXTS = 50;
const MAX_CHARS = 1000; // per text
const CONCURRENCY = 4;
const LANG_RE = /^[a-z]{2,3}(-[A-Za-z]{2,4})?$/;

// -> { model, dailyChars, on } | null
export function translateSettings(env) {
  if (!env.RWK_TRANSLATE) return null;
  try {
    const v = JSON.parse(env.RWK_TRANSLATE);
    if (!v || typeof v.model !== "string") return null;
    return { model: v.model, dailyChars: Number(v.dailyChars) || 0, on: v.on === true };
  } catch {
    return null;
  }
}

// The player's own setting, else everyone's from R2, else the deploy's.
export function translateAllowed(settings, user = {}) {
  const own = user.settings ? user.settings.translate : undefined;
  const set = own !== undefined ? own : user.shared ? user.shared.translate : undefined;
  return set !== undefined ? !!set : settings.on;
}

// A guess from the script, for games whose language the deployer did not give.
export function detectLanguage(text) {
  if (/[぀-ヿ]/.test(text)) return "ja";
  if (/[가-힯]/.test(text)) return "ko";
  if (/[一-鿿]/.test(text)) return "zh";
  if (/[Ѐ-ӿ]/.test(text)) return "ru";
  if (/[฀-๿]/.test(text)) return "th";
  if (/[؀-ۿ]/.test(text)) return "ar";
  return "en";
}

async function sha256(text) {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(text));
  return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, "0")).join("");
}

const modelDir = (model) => model.replace(/^@cf\//, "").replace(/[^A-Za-z0-9.-]+/g, "_");
const today = () => new Date().toISOString().slice(0, 10);
const usageKey = (day) => `rwk/translate/usage/${day}.json`;

async function readUsage(bucket, day) {
  try {
    const obj = await bucket.get(usageKey(day));
    if (!obj) return 0;
    return Number(JSON.parse(new TextDecoder().decode(await obj.arrayBuffer())).chars) || 0;
  } catch {
    return 0;
  }
}

export async function handleTranslate(request, env, user) {
  if (request.method !== "POST") return json({ error: "Method not allowed" }, 405);
  const settings = translateSettings(env);
  if (!settings || !env.AI || !env.BUCKET) return json({ error: "Translation is not set up for this game" }, 501);
  if (!translateAllowed(settings, user)) return json({ error: "Translation is turned off for this game" }, 403);

  let body;
  try {
    body = await request.json();
  } catch {
    return json({ error: "Invalid JSON" }, 400);
  }
  const { from = "auto", to, texts } = body || {};
  if (!LANG_RE.test(String(to)) || (from !== "auto" && !LANG_RE.test(String(from)))) return json({ error: "Invalid language" }, 400);
  if (!Array.isArray(texts) || !texts.length || texts.length > MAX_TEXTS) return json({ error: `Send 1 to ${MAX_TEXTS} texts` }, 400);
  if (texts.some((t) => typeof t !== "string" || t.length > MAX_CHARS)) return json({ error: `Each text must be a string of at most ${MAX_CHARS} characters` }, 400);

  const out = new Array(texts.length).fill(null);
  const misses = [];
  await Promise.all(
    texts.map(async (text, i) => {
      const source = from === "auto" ? detectLanguage(text) : from;
      if (!text.trim() || source === to.split("-")[0]) return void (out[i] = text);
      const key = `rwk/translate/${modelDir(settings.model)}/${source}-${to}/${await sha256(text)}.txt`;
      const hit = await env.BUCKET.get(key).catch(() => null);
      if (hit) out[i] = new TextDecoder().decode(await hit.arrayBuffer());
      else misses.push({ i, text, source, key });
    })
  );

  misses.sort((a, b) => a.i - b.i); // in the order sent, for the daily cap
  let limited = false;
  if (misses.length) {
    const day = today();
    let used = await readUsage(env.BUCKET, day);
    const todo = [];
    for (const miss of misses) {
      if (used + miss.text.length > settings.dailyChars) {
        limited = true;
        continue;
      }
      used += miss.text.length;
      todo.push(miss);
    }
    if (todo.length) {
      // Counted before the calls: a failed call still may have used Neurons.
      await env.BUCKET.put(usageKey(day), JSON.stringify({ chars: used }), { httpMetadata: { contentType: "application/json" } }).catch((err) => console.error("[rwk] translate usage", err));
      let next = 0;
      const worker = async () => {
        while (next < todo.length) {
          const miss = todo[next++];
          try {
            const res = await env.AI.run(settings.model, { text: miss.text, source_lang: miss.source, target_lang: to });
            const translated = res && typeof res.translated_text === "string" ? res.translated_text.trim() : "";
            if (!translated) continue;
            out[miss.i] = translated;
            await env.BUCKET.put(miss.key, translated, { httpMetadata: { contentType: "text/plain; charset=utf-8" } });
          } catch (err) {
            // Out of Neurons, a model error, R2 down: the original stays.
            console.error("[rwk] translate", err && err.message);
          }
        }
      };
      await Promise.all(Array.from({ length: Math.min(CONCURRENCY, todo.length) }, worker));
    }
  }
  return json({ texts: out, limited });
}
