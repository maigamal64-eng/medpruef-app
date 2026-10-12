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

/** Abbreviation with dots ("D.S.", "m.f.") or a Latin-script word (umlauts, hyphens). */
const TOKEN_RE = /(?:\p{Script=Latin}{1,3}\.){2,4}|\p{Script=Latin}[\p{Script=Latin}\p{M}-]*/gu;

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
    if (t.length > MAX_TERM_CHARS || out.includes(t)) continue;
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
 * "Megaloblastäre Anämie"). Case-insensitive; returned in the learner's spelling.
 */
export function rowTermsNamed(terms: readonly string[] | undefined, corpus: string): string[] {
  if (!terms || terms.length === 0 || !corpus) return [];
  const out: string[] = [];
  for (const t of terms) {
    const tail = t.includes(".") || t.length < 6 ? "(?!\\p{L})" : "";
    if (new RegExp(`(?<!\\p{L})${escapeRe(t)}${tail}`, "iu").test(corpus)) out.push(t);
    if (out.length >= MAX_TERMS) break;
  }
  return out;
}
