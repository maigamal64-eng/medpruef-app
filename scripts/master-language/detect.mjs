// Pure sentence-language detector for the b37 language gate. No dependencies.
// A "sentence" is a visible text block with 4 or more words. It is classified
// as English or German by stopword hits. Single exam terms, brand names and
// question text are never stopwords, so they cannot trip it.

const EN = new Set(
  "the and your you with for to of is are was be this that these those from our we it in on at by or not can will have has do does if when how what which who why more all any as but about into out up get see use start take make find choose open back next free per".split(" "),
);
const DE = new Set(
  "der die das den dem des und ist sind war nicht sie ihr ihre ihren mit für zu zum zur von vom im in auf bei oder wir ein eine einen einer einem kann wird werden haben hat auch wenn wie was welche wer warum mehr alle als aber über aus nach noch nur wählen starten öffnen weiter zurück dein deine deinen dich dir du uns unser unsere".split(" "),
);
// Words shared by both languages or common loanwords: never counted as evidence.
const NEUTRAL = new Set(["in", "an", "so", "man", "die", "was", "war", "bei", "also", "all", "art", "rat", "hat", "gift", "kind", "rest", "home", "start", "tag", "plan", "test"]);

export function tokenize(s) {
  return s.toLowerCase().match(/[a-zäöüß]+/g) ?? [];
}

export function classify(sentence) {
  const words = tokenize(sentence);
  if (words.length < 4) return { lang: "neutral", en: 0, de: 0, words: words.length };
  let en = 0;
  let de = 0;
  for (const w of words) {
    const e = EN.has(w);
    const d = DE.has(w);
    if (e && d) continue;
    if (NEUTRAL.has(w) && !(e && !d) && !(d && !e)) continue;
    if (e) en++;
    if (d) de++;
  }
  const min = 2;
  if (en >= min && en > de) return { lang: "en", en, de, words: words.length };
  if (de >= min && de > en) return { lang: "de", en, de, words: words.length };
  return { lang: "neutral", en, de, words: words.length };
}

export function splitBlocks(text) {
  return text
    .split(/\n+/)
    .flatMap((l) => l.split(/(?<=[.!?])\s+/))
    .map((s) => s.replace(/\s+/g, " ").trim())
    .filter(Boolean);
}

// Allowlisted phrases are stripped from the sentence before classification, so a
// brand or exam term never hides a real leak that happens to mention it.
function stripAllowed(sentence, allow) {
  let out = sentence;
  for (const a of allow) {
    out = a instanceof RegExp ? out.replace(a, " ") : out.split(new RegExp(String(a).replace(/[.*+?^${}()|[\]\\]/g, "\\$&"), "gi")).join(" ");
  }
  return out;
}

/**
 * lang: UI language code under test. Returns offending sentences.
 * de -> English sentences are offences; en -> German sentences are offences;
 * ru/uk/tr/ar -> both English and German sentences are offences (any Latin
 * fallback leak), the translated overlay must cover them.
 */
export function findLeaks(text, lang, allow = []) {
  const bad = [];
  for (const s of splitBlocks(text)) {
    const c = classify(stripAllowed(s, allow));
    const offending =
      lang === "de" ? c.lang === "en" : lang === "en" ? c.lang === "de" : c.lang === "en" || c.lang === "de";
    if (offending) bad.push({ sentence: s.slice(0, 200), detected: c.lang });
  }
  return bad;
}

export const LANGS = ["de", "en", "ru", "uk", "tr", "ar"];
export const RTL = new Set(["ar"]);
