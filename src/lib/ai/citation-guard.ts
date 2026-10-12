/**
 * Citation guard for the legacy AI explanation chat (TR-30).
 *
 * The chat has no source corpus behind it: its only inputs are the question,
 * its choices, the keyed answer and the stored explanation. Any guideline
 * edition, paper, URL or "Quelle:" line in a reply is therefore invented. The
 * prompt forbids them; this guard enforces it in code, before the reply is
 * cached or shown. Removed sentences are replaced by one "not sure" note.
 */

export type GuardLang = "de" | "en";

export interface CitationGuardResult {
  text: string;
  removed: number;
}

/** Shown once under a reply whose citation was removed. Formal register (pick-copy-register B). */
export const NOT_SURE_NOTE: Record<GuardLang, string> = {
  de: "Hinweis: Eine Quellenangabe ließ sich nicht prüfen und wurde entfernt. Bei diesem Detail bin ich nicht sicher, bitte prüfen Sie es in Ihrem Lehrbuch.",
  en: "Note: a source reference could not be verified and was removed. I am not sure about this detail, please check it in your textbook.",
};

// Named bodies and references. Generic words (Empfehlung, Statement) are left out:
// "Die Empfehlung lautet 2000 IE" is a dose, not a citation.
const BODIES =
  "Leitlinien?|Guidelines?|Positionspapier|S[123]k?(?:-Leitlinie)?|AWMF|ESC|ERC|AHA|ACC|ESH|ÖDG|OEDG|DGIM|DEGAM|DGK|NICE|WHO|ADA|GOLD|GINA|KDIGO|EASL|ESMO|ESPEN|ACR|EULAR|ACOG|RKI|STIKO|AGES|Impfplan|Herold|Amboss|AMBOSS|UpToDate|Harrison";

// A four-digit number followed by a unit is a dose or volume, never an edition year.
const YEAR = "\\b(?:19[5-9]\\d|20[0-3]\\d)\\b(?!\\s*(?:mg|g|kg|ml|l|IE|IU|E|U|kcal|µg|mcg|mmol|mol|h|min|Std|%|Tage?|days?|Einheiten|units?)\\b|\\s*\\/)";

// Every repetition below is bounded so the guard stays linear on hostile model output.
const PATTERNS: RegExp[] = [
  /https?:\/\/|\bwww\.[a-z0-9-]+\./iu,
  /\bdoi\s*[:.]?\s*10\.\d|\bPMID\b|\bPubMed\b/iu,
  /\bet al\.?(?=\s|,|\)|$)/iu,
  new RegExp(`(?:^|[^\\p{L}])(?:${BODIES})(?=[^\\p{L}]|$)[^.\\n]{0,60}?${YEAR}`, "u"),
  new RegExp(`${YEAR}[^.\\n]{0,20}?(?:${BODIES})(?=[^\\p{L}]|$)`, "u"),
  /\((?:[A-ZÄÖÜ][\p{Ll}.&-]{0,30}\s+){0,3}[A-ZÄÖÜ][\p{Ll}.&-]{0,30},?\s*(?:19|20)\d{2}\)/u,
];

/** A whole line that only introduces sources ("**Quellen:**", "Sources:"). */
const SOURCE_HEADING = /^\s*(?:[-*]\s*)?(?:\*\*|__)?\s*(?:Quellen?|Sources?|Literatur|Literature|References?|Referenzen)\s*(?:\*\*|__)?\s*:/iu;

export function isCitation(sentence: string): boolean {
  return PATTERNS.some((p) => p.test(sentence));
}

// Never end a sentence after a common abbreviation ("max. 4000 mg", "z.B. Dr. Meier").
const ABBREVIATION = /(?:^|[\s(])(?:max|min|mind|ca|z\.\s?B|Dr|Prof|Pat|bzw|ggf|vgl|u\.\s?a|d\.\s?h|evtl|inkl|Std|etc|Abb|Nr|i\.\s?v|p\.\s?o|s\.\s?c|i\.\s?m|e\.\s?g|i\.\s?e|approx|vs|St)\.$/u;

function splitSentences(line: string): string[] {
  const parts = line.split(/(?<=[.!?])\s+(?=[\p{Lu}*(„"])/u);
  const out: string[] = [];
  for (const p of parts) {
    if (out.length > 0 && ABBREVIATION.test(out[out.length - 1])) out[out.length - 1] += ` ${p}`;
    else out.push(p);
  }
  return out;
}

/** A line left with nothing readable (a bullet marker, bold markers, punctuation). */
function isHollow(line: string): boolean {
  return line.replace(/[\s*_\-•>#:.,;()[\]]+/gu, "").length === 0;
}

export function guardCitations(text: string, lang: GuardLang): CitationGuardResult {
  let removed = 0;
  const out: string[] = [];
  let skippingSourceList = false;
  for (const line of text.split("\n")) {
    if (SOURCE_HEADING.test(line)) {
      removed++;
      // A heading with nothing after the colon introduces a list: drop its bullets too.
      skippingSourceList = isHollow(line.replace(SOURCE_HEADING, ""));
      continue;
    }
    if (skippingSourceList) {
      if (/^\s*(?:[-*•]|\d+[.)])\s+/u.test(line)) { removed++; continue; }
      if (line.trim() === "") continue;
      skippingSourceList = false;
    }
    // A table row is kept or dropped whole, so its cells never misalign.
    if (/^\s*\|/u.test(line)) {
      if (isCitation(line)) { removed++; continue; }
      out.push(line);
      continue;
    }
    const prefix = /^\s*(?:[-*•]\s+|\d+[.)]\s+)?/u.exec(line)?.[0] ?? "";
    const body = line.slice(prefix.length);
    const kept = splitSentences(body).filter((s) => {
      if (isCitation(s)) { removed++; return false; }
      return true;
    });
    const next = prefix + kept.join(" ");
    if (kept.length === 0 || (isHollow(next) && !isHollow(line))) continue;
    out.push(next);
  }
  if (removed === 0) return { text, removed };
  const body = out.join("\n").replace(/\n{3,}/g, "\n\n").trim();
  return { text: `${body}\n\n_${NOT_SURE_NOTE[lang]}_`, removed };
}
