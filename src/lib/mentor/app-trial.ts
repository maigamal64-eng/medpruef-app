/**
 * The MedPrüf trial asked about with a card (G1 fix, 16 Oct; gate ap2-trial-nocard-de).
 *
 * "Brauche ich für den Test eine Karte?" is about the MedPrüf trial, but "Test" is also
 * the learner's word for the Stichprobentest: under pricing v2 with the reverse trial the
 * model read it as the exam and refused (no_verified_source, exam=stichprobentest) in both
 * live runs, although app.billing.trial sits on the fact sheet. The question is recognised
 * here in code; the turn context then names the trial fact, and a no_verified_source
 * refusal of such a question in German or English is answered with that fact's own text
 * (billing-copy.ts, the single owner, which already follows PRICING_V2 and the reverse
 * trial: 3 days without a card when on, the card trial when off).
 */

import { examKeysNamedIn, foldText } from "./facts-loader";
import type { MentorLang } from "./contract";
import type { MentorFact, ValidatedAnswer } from "./seam";

export const APP_TRIAL_FACT_ID = "app.billing.trial";

/** Words for the MedPrüf trial in any language (folded: ä -> ae, lowercase). */
const TRIAL_RE =
  /(?<![\p{L}\p{N}])(?:testphase|testzugang|testwoche|testzeit|testversion|probephase|probezeit|probezugang|probewoche|pro-test|trial|trials|essai|deneme(?!\s+s[ıi]nav)|пробн\p{L}*)(?![\p{L}\p{N}])/u;

/**
 * German only: the bare "Test" (and "Probe"), which the learner also uses for the Stichprobentest.
 * It counts for the trial only together with a payment card and with no exam named in the
 * conversation; in other languages "test" stays the exam (review P1).
 */
const GERMAN_TEST_RE = /(?<![\p{L}\p{N}])(?:test|tests|probe)(?![\p{L}\p{N}])/u;

/** Words for a payment card or payment details. */
const CARD_RE =
  /(?<![\p{L}\p{N}-])(?:karte|kreditkarte|bankkarte|bankomatkarte|debitkarte|zahlungskarte|zahlungsmittel|zahlungsdaten|card|cards|creditcard|carte|kart|karti|kartı|карт\p{L}*)(?![\p{L}\p{N}])|credit\s+card|debit\s+card|payment\s+(?:details|method)|kredi\s+kart/u;

/**
 * An identity card, exam fee or paying for something: an exam-day or fee question, never the
 * trial (review P1: "Do I need my ID card for the test?", "Brauche ich zum Test meine e-card?",
 * "Kann ich die Gebühr für den Test mit Kreditkarte zahlen?").
 */
const NOT_TRIAL_RE =
  /e-?card|\bid\b|identity|ausweis|lichtbild|reisepass|\bpass\b|passport|student|gebuehr|\bfees?\b|\b(?:be)?zahl(?:en|e|t)\b|\bpay\b|\bpaid\b|kimlik|identit|удостовер|паспорт|посвідч|оплат|uecret|ucret|frais/u;

/**
 * True when the learner's message asks about the trial together with a card or payment details,
 * names no exam, and is not about an ID card or a fee. `priorLearnerTexts` are the learner's
 * earlier messages in this conversation: if one names an exam, a German "Test" means that exam
 * (review P2), so only an explicit trial word still counts.
 */
export function isAppTrialQuestion(message: unknown, lang: MentorLang = "de", priorLearnerTexts: readonly string[] = []): boolean {
  if (typeof message !== "string") return false;
  const text = message.slice(0, 1500);
  if (examKeysNamedIn(text).size > 0) return false;
  const folded = foldText(text);
  if (!CARD_RE.test(folded) || NOT_TRIAL_RE.test(folded)) return false;
  if (TRIAL_RE.test(folded)) return true;
  const examEarlier = priorLearnerTexts.some((t) => typeof t === "string" && examKeysNamedIn(t.slice(0, 1500)).size > 0);
  return lang === "de" && !examEarlier && GERMAN_TEST_RE.test(folded);
}

/**
 * A no_verified_source refusal of a recognised trial question becomes the trial fact's own
 * text in German or English, cited. Every other answer and every other language is returned
 * unchanged (billing facts exist in de and en only). The answer is code-owned, so it counts
 * as replaced: never charged (MUX-38 B), like the other code-owned answers.
 */
export function answerAppTrialRefusal(v: ValidatedAnswer, lang: MentorLang, trialFact: MentorFact | null | undefined): ValidatedAnswer {
  if (v.refused !== "no_verified_source") return v;
  if (lang !== "de" && lang !== "en") return v;
  if (!trialFact || trialFact.id !== APP_TRIAL_FACT_ID) return v;
  const text = { de: trialFact.text_de, en: trialFact.text_en }[lang];
  if (typeof text !== "string" || !text.trim()) return v;
  return {
    blocks: [{ text, fact_ids: [trialFact.id] }],
    citations: [{ fact_id: trialFact.id, source_label: trialFact.source_label, source_url: trialFact.source_url, read_on: trialFact.read_on, review_every_days: trialFact.review_every_days }],
    replaced: true,
    rejected: v.rejected,
  };
}

/** Turn-context line for a recognised trial question (no learner text). */
export const APP_TRIAL_HINT =
  "This question is about the MedPrüf trial and whether a card is needed, not about an exam: answer it from app.billing.trial (on the fact sheet) and cite it. Its length, card terms and who can start it (for example a linked Telegram account) are exactly what that fact states; when the fact names a condition for starting the trial, state that condition too.";

/**
 * a-mentor-flip-facts-fix (live gate 17 Oct, ap2-trial-after-de/en): an answer that cites the
 * trial fact but leaves out who can start the trial. When app.billing.trial names a linked
 * Telegram account and no block of the answer mentions Telegram, the fact's own sentence that
 * names it (Lektor-approved billing-copy text) is added as a block. `trialFact` is passed only
 * when the model's answer cited it. German and English only (the fact's languages); refusals
 * and replaced answers are unchanged.
 * Adding a sentence of a cited fact is not a replacement: the charge decision is unchanged.
 */
export function addTrialCondition(v: ValidatedAnswer, lang: MentorLang, trialFact: MentorFact | null | undefined): ValidatedAnswer {
  // Review P2: a replaced answer (the not-confirmed fallback or a partly removed answer) stays as the
  // validator left it; a fact sentence beside the fallback line would contradict it and turn a notice
  // into an answer.
  if (v.refused || v.replaced || (lang !== "de" && lang !== "en")) return v;
  if (!trialFact || trialFact.id !== APP_TRIAL_FACT_ID) return v;
  if (v.blocks.some((b) => typeof b.text === "string" && /telegram/i.test(b.text))) return v;
  const text = { de: trialFact.text_de, en: trialFact.text_en }[lang];
  if (typeof text !== "string") return v;
  const sentence = text.split(/(?<=[.!?])\s+/u).find((s) => /telegram/i.test(s))?.trim();
  if (!sentence) return v;
  // Internal app ids are never shown as block sources (validator shownIds), so none is set here.
  return { ...v, blocks: [...v.blocks, { text: sentence, fact_ids: [] }] };
}
