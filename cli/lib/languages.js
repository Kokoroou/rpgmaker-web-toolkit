// Translations of the game's data. A translator ships a copy of data/ in
// data-<code>/ (data-vi, data-en, data_zh-tw…); the toolkit publishes them all
// and RWK_Language serves the one the player picks, file by file: a file the
// translation lacks comes from data/.
//
//   languages  false (off) | true (default) | { default, original, lock }
//     default   the code shown until the player chooses ("" or the original's code: the game as it is)
//     original  the code of data/'s own language (ja…), only to name it in the menu
//     lock      players cannot change the language

// data-vi, data_en, data-zh-tw: a two-letter language code, then optional region / script parts.
const LANGUAGE_DIR = /^data[-_]([a-z]{2}(?:[-_][a-z0-9]{2,8})*)$/i;
const CODE = /^[a-z]{2}(?:-[a-z0-9]{2,8})*$/;

// "data_zh_TW" -> "zh-tw"; null when the folder is not a translation.
export function languageCode(dirName) {
  const m = LANGUAGE_DIR.exec(dirName);
  return m ? m[1].toLowerCase().replace(/_/g, "-") : null;
}

// The translations among the web build's files (collectFiles()), after the
// config's include / exclude.
// -> [{ code, dir, files: ["Map001.json"…], missing: number }] sorted by code;
// missing counts data/'s files this translation lacks.
export function detectLanguages(files) {
  const original = new Set();
  const byDir = new Map();
  for (const { rel } of files) {
    const m = /^([^/]+)\/([^/]+\.json)$/i.exec(rel);
    if (!m) continue;
    if (m[1] === "data") original.add(m[2]);
    else if (languageCode(m[1])) {
      if (!byDir.has(m[1])) byDir.set(m[1], []);
      byDir.get(m[1]).push(m[2]);
    }
  }
  const found = new Map(); // code -> entry: data-vi and data_vi count once
  for (const [dir, names] of [...byDir].sort(([a], [b]) => (a < b ? -1 : 1))) {
    const code = languageCode(dir);
    if (found.has(code)) continue;
    const have = new Set(names);
    found.set(code, { code, dir, files: names.sort(), missing: [...original].filter((name) => !have.has(name)).length });
  }
  return [...found.values()].sort((a, b) => (a.code < b.code ? -1 : 1));
}

const isObject = (v) => !!v && typeof v === "object" && !Array.isArray(v);
const normalizeCode = (v) => (typeof v === "string" ? v.trim().toLowerCase().replace(/_/g, "-") : "");

// -> problems with the "languages" key and the folders found, worded for the deploy log
export function checkLanguagesConfig(value, languages) {
  const problems = [];
  const codes = languages.map((l) => l.code);
  if (value === undefined || value === true || value === false) return problems;
  if (!isObject(value)) return [`"languages" must be true, false or an object like { "default": "vi" }; using the defaults.`];
  const known = ["default", "original", "lock"];
  const unknown = Object.keys(value).filter((key) => !known.includes(key));
  if (unknown.length) problems.push(`"languages": unknown key(s) ${unknown.join(", ")}; ignored. Known: ${known.join(", ")}.`);
  const def = normalizeCode(value.default);
  if (value.default !== undefined && def && def !== normalizeCode(value.original) && !codes.includes(def)) {
    problems.push(
      `"languages.default" is "${value.default}" but there is no data-${def} folder${codes.length ? ` (found: ${codes.join(", ")})` : ""}; players start with the original.`
    );
  }
  if (value.original !== undefined && !CODE.test(normalizeCode(value.original))) {
    problems.push(`"languages.original" must be a language code like "ja"; ignored.`);
  }
  return problems;
}

// RWK_Core's `languages`: false | {
//   default: the code players start with ("" = data/)
//   original: the code naming data/ ("" when not given)
//   lock: players keep `default`
//   choices: { <code>: { dir: "data-vi", files: ["Map001.json"…] } }
// }
// No translation (or "languages": false) -> false.
export function languagesRuntime(value, files) {
  if (value === false) return false;
  const found = detectLanguages(files);
  if (!found.length) return false;
  const v = isObject(value) ? value : {};
  const original = CODE.test(normalizeCode(v.original)) ? normalizeCode(v.original) : "";
  const choices = Object.fromEntries(found.map((l) => [l.code, { dir: l.dir, files: l.files }]));
  const wanted = normalizeCode(v.default);
  const start = wanted && wanted !== original && Object.hasOwn(choices, wanted) ? wanted : "";
  return { default: start, original, lock: v.lock === true, choices };
}
