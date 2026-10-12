/**
 * German terms the learner named in an explain request ("... keep the German
 * term and gloss it. Phytomenadion"). get_question hands back only the ones its
 * own row contains, in the learner's spelling, so the model can start the answer
 * with "<term> (<gloss>)" (eval 12 Oct: the first mention sat inside an option's
 * brackets, was inflected, or was never glossed).
 *
 * Learner text never reaches the system prompt: a term leaves this module only
 * when the question row (tool data) contains it, and only in a bounded charset.
 */

const MAX_CANDIDATES = 200;
const MAX_TERMS = 3;
const MAX_TERM_CHARS = 40;

/**
 * Abbreviation with dots ("D.S.", "m.f.", or a capitalised single one such as
 * "Rp."; "mg." ending a sentence is not one) or a Latin-script word (umlauts,
 * hyphens), with a letter-code suffix kept ("Vitamin K", "Vitamin B12").
 */
const TOKEN_RE = /(?:\p{Script=Latin}{1,3}\.){2,4}(?!\p{L})|\p{Lu}\p{Script=Latin}{0,2}\.(?!\p{L})|\p{Script=Latin}[\p{Script=Latin}\p{M}-]*(?: \p{Lu}\d{0,2}(?![\p{L}\p{N}]))?/gu;

/**
 * Request words of en/fr/tr that are spelled like German row words (review P2:
 * "this patient" matched "Patient"). They are never treated as named terms.
 */
const REQUEST_WORDS = new Set(["patient", "patients", "patiente", "normal", "normale", "option", "options", "answer", "question", "questions", "explain", "explanation", "hint", "solution", "term", "terme", "german", "deutsch", "almanca"]);

function escapeRe(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/** Latin-script words and dotted abbreviations of the message, in order, bounded. */
export function learnerNamedTerms(message: unknown): string[] {
  if (typeof message !== "string") return [];
  const out: string[] = [];
  for (const m of message.slice(0, 2000).matchAll(TOKEN_RE)) {
    const t = m[0].replace(/-+$/, "");
    // Every candidate is kept until the row check: the term is often the last word.
    if (t.length > MAX_TERM_CHARS || out.includes(t) || REQUEST_WORDS.has(t.toLowerCase())) continue;
    const abbreviation = t.includes(".");
    // Short or lowercase-ascii words are mostly the request language ("Keep the term"),
    // not exam terms: a lowercase word needs a German letter or six characters.
    if (!abbreviation && (t.length < 4 || (!/^\p{Lu}/u.test(t) && t.length < 6 && !/[äöüß]/iu.test(t)))) continue;
    out.push(t);
    if (out.length >= MAX_CANDIDATES) break;
  }
  return out;
}

/**
 * The named terms the question row contains: as a whole word, or as the start of
 * a longer word for terms of six or more characters ("megaloblastär" in
 * "Megaloblastäre Anämie"). Case-insensitive except for a lowercase plain-ASCII
 * word; at most three, the last named first; returned in the learner's spelling.
 */
export function rowTermsNamed(terms: readonly string[] | undefined, corpus: string): string[] {
  if (!terms || terms.length === 0 || !corpus) return [];
  const out: string[] = [];
  // From the end of the message: the named term is usually its last word (review P2).
  for (const t of [...terms].reverse()) {
    const tail = t.includes(".") || t.length < 6 || /\d$|\s\p{Lu}$/u.test(t) ? "(?![\\p{L}\\p{N}])" : "";
    // A lowercase plain-ASCII word must match case-sensitively: German nouns are
    // capitalised, so an en/fr request word ("normal") does not hit "Normalwert".
    const flags = /^\p{Ll}[a-z-]*$/u.test(t) ? "u" : "iu";
    if (new RegExp(`(?<![\\p{L}\\p{N}])${escapeRe(t)}${tail}`, flags).test(corpus)) out.unshift(t);
    if (out.length >= MAX_TERMS) break;
  }
  return out;
}

/**
 * Words that only appear when the model writes about the gloss instruction
 * itself, never in an explanation (gate round 3, r3-explain-gloss-10-tr:
 * "Heparin (гепарин) yerine Türkçe gloss: Heparin (heparin)? Hayır, ...:
 * Heparin (fraksiyone olmayan antikoagülan)").
 */
const GLOSS_META_RE = /(?<![\p{L}_])(?:gloss(?:_first|es)?|opening_template)(?![\p{L}_])/iu;

/** A bracket gloss in the answer language's script only (Cyrillic for ru/uk, never Cyrillic or Arabic otherwise). */
function glossFitsLang(inner: string, lang: string): boolean {
  if (!inner.trim() || /[؀-ۿ]/u.test(inner)) return false;
  return lang === "ru" || lang === "uk" ? /[Ѐ-ӿ]/u.test(inner) : !/[Ѐ-ӿ]/u.test(inner);
}

/**
 * Removes answer lines in which the model talks about the gloss rules instead
 * of explaining. In the first such line, the last "<named term> (<gloss>)" in
 * the answer language is kept (it is the model's own final choice), so the
 * opening still starts with the glossed term; every other meta line is
 * dropped. Protocol lines are kept. Deletion only: no new text is written.
 */
export function repairGlossMeta(raw: string, terms: readonly string[], lang: string): string {
  if (typeof raw !== "string" || !GLOSS_META_RE.test(raw)) return raw;
  let salvaged = false;
  const out: string[] = [];
  for (const line of raw.split("\n")) {
    if (/^\s*@@/.test(line) || !GLOSS_META_RE.test(line)) {
      out.push(line);
      continue;
    }
    if (!salvaged) {
      salvaged = true;
      let keep: string | null = null;
      for (const t of terms) {
        for (const m of line.matchAll(new RegExp(`(?<![\\p{L}\\p{N}])${escapeRe(t)}\\s*\\(([^()\\n]*)\\)`, "giu"))) {
          if (glossFitsLang(m[1], lang) && (keep === null || line.lastIndexOf(m[0]) >= line.lastIndexOf(keep))) keep = m[0];
        }
      }
      if (keep) out.push(keep);
    }
  }
  return out.join("\n");
}

/** gloss_first terms of the get_question results of this turn (tool data only). */
export function glossTermsFromTools(results: ReadonlyArray<{ name: string; result: { content: string; isError?: boolean } }>): string[] {
  const out: string[] = [];
  for (const r of results) {
    if (r.name !== "get_question" || r.result.isError) continue;
    try {
      const terms = (JSON.parse(r.result.content) as { gloss_first?: unknown }).gloss_first;
      if (Array.isArray(terms)) for (const t of terms) if (typeof t === "string" && t && !out.includes(t)) out.push(t);
    } catch {
      /* malformed result adds nothing */
    }
  }
  return out;
}
