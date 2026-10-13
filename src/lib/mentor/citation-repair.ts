/**
 * Citation repair (gate9, [name] 13 Oct: precision bar 0 of 90, fund a prompt round).
 *
 * Every live gate round since gate4 produced 0 to 3 answers in which the
 * validator deleted a true sentence because the model wrote a value its block
 * did not cite (a row of another block, an uncited row it had retrieved, or a
 * count of a list). Validation stays as strict as before; instead, when the
 * first complete answer would lose sentences for exactly that reason, the turn
 * asks the model once more with code-owned checker feedback, and delivers the
 * second answer only when the validator keeps it whole (turn.ts). The learner
 * pays for at most one answer; the replaced first answer goes to the house.
 *
 * The feedback quotes only the model's own removed sentences and the ids of
 * facts it already retrieved in this turn. It is never shown to the learner.
 */

import { stripProtocolLines } from "./prompt/protocol";
import { allowedKeysFromText, extractValues, isInternalFactId, sentenceRanges } from "./validator";
import type { MentorFact, ValidatedAnswer } from "./seam";

/** Reasons a repair can fix: a value the cited facts of its block do not state. */
const REPAIRABLE_REASONS: ReadonlySet<string> = new Set(["not_in_cited_facts", "uncited_number"]);
/** Rejections that are never value-citation misses (a background layer with numbers or doses). */
const NOT_REPAIRABLE_VALUES: ReadonlySet<string> = new Set(["background_numbers_or_doses"]);

const MAX_SENTENCES = 4;
const MAX_SENTENCE_CHARS = 300;
const MAX_HINT_IDS = 3;

/**
 * True when the validator would show a partly replaced answer only because values were not
 * in the cited facts of their block: never for a refusal, a study-safety or background
 * rejection, an unknown fact id, or an answer with nothing rejected.
 */
export function isCitationRepairable(v: Pick<ValidatedAnswer, "replaced" | "refused" | "rejected">): boolean {
  return (
    v.replaced === true &&
    !v.refused &&
    Array.isArray(v.rejected) &&
    v.rejected.length > 0 &&
    v.rejected.every((r) => REPAIRABLE_REASONS.has(r.reason) && !NOT_REPAIRABLE_VALUES.has(r.value))
  );
}

/**
 * The model's sentences that hold a rejected value and are missing from the validated answer
 * (protocol lines removed), in answer order. A sentence the validator kept is never quoted, so
 * a supported "2" in another block is not reported as removed (review P3).
 */
export function removedSentences(answer: string, rejected: ReadonlyArray<{ value: string }>, kept: ReadonlyArray<{ text: string }> = []): Array<{ sentence: string; values: string[] }> {
  const text = stripProtocolLines(typeof answer === "string" ? answer : "");
  const shown = kept.map((b) => (typeof b.text === "string" ? b.text.replace(/\s+/g, " ") : "")).join("\n");
  const raws = [...new Set(rejected.map((r) => r.value).filter((x) => typeof x === "string" && x.length > 0))];
  const out: Array<{ sentence: string; values: string[] }> = [];
  for (const [a, e] of sentenceRanges(text)) {
    const sentence = text.slice(a, e).replace(/\s+/g, " ").trim();
    if (!sentence || shown.includes(sentence)) continue;
    const vals = extractValues(sentence).filter((v) => raws.includes(v.raw));
    if (vals.length === 0) continue;
    out.push({ sentence, values: [...new Set(vals.map((v) => v.raw))] });
    if (out.length >= MAX_SENTENCES) break;
  }
  return out;
}

const UNIVERSITY_RE: Record<"wien" | "graz" | "innsbruck", RegExp> = {
  wien: /(?<![\p{L}])(?:Wien|Wiener|Vienna|Vienne|Viyana|Вена|Вене|Відень|Відні)(?![\p{L}])/iu,
  graz: /(?<![\p{L}])(?:Graz|Грац\p{L}*)(?![\p{L}])/iu,
  innsbruck: /(?<![\p{L}])(?:Innsbruck|i-med|Инсбрук\p{L}*|Інсбрук\p{L}*)(?![\p{L}])/iu,
};

/**
 * Ids of retrieved official facts that state every rejected value of the sentence (a hint, never
 * a citation). Never an internal fact (the learner's progress, a question row, a computed status:
 * re-review P2, a progress hint coached the own days left back into a deadline), and never a row
 * of another university than the one(s) the sentence names (re-review P2: a Graz row for a Vienna claim).
 */
function factsStating(sentence: string, rawValues: readonly string[], facts: readonly MentorFact[]): string[] {
  const vals = extractValues(sentence).filter((v) => rawValues.includes(v.raw));
  if (vals.length === 0) return [];
  const named = (Object.keys(UNIVERSITY_RE) as Array<keyof typeof UNIVERSITY_RE>).filter((u) => UNIVERSITY_RE[u].test(sentence));
  const ids: string[] = [];
  for (const f of facts) {
    if (isInternalFactId(f.id)) continue;
    const uni = f.filing_university;
    if (named.length > 0 && uni && uni !== "all" && !named.includes(uni as keyof typeof UNIVERSITY_RE)) continue;
    const keys = allowedKeysFromText(`${f.text_de ?? ""}\n${f.text_en ?? ""}`);
    if (vals.every((v) => v.keys.some((k) => keys.has(k)))) ids.push(f.id);
    if (ids.length >= MAX_HINT_IDS) break;
  }
  return ids;
}

/**
 * The code-owned instruction appended to the last user message for the one repair call.
 * `facts` are the facts this turn retrieved (tool results and the fact sheet ids the
 * answer cited); only their ids are named.
 */
export function citationRepairInstruction(answer: string, v: Pick<ValidatedAnswer, "rejected" | "blocks">, facts: readonly MentorFact[]): string {
  const lines = removedSentences(answer, v.rejected, v.blocks).map(({ sentence, values }) => {
    const quoted = sentence.length > MAX_SENTENCE_CHARS ? `${sentence.slice(0, MAX_SENTENCE_CHARS)}...` : sentence;
    const hint = factsStating(sentence, values, facts);
    return `- "${quoted}" (value: ${values.join(", ")})${hint.length ? `; retrieved facts that contain it: ${hint.join(", ")} (cite one only if it states this exact point)` : "; no retrieved fact contains it"}`;
  });
  return [
    "CHECKER FEEDBACK (from the app's code, not from the learner). Your draft answer was not shown. The checker removed these sentences because a value in them is not stated by a fact cited in the same @@BLOCK:",
    ...(lines.length ? lines : ["- (a value without a cited fact)"]),
    "Write the whole answer again, in the same language and output format, and follow these rules:",
    "1. Every date, month, year, number, percentage, amount and count stands in a block whose facts= lists the fact that states it. If a sentence needs another fact, start a new @@BLOCK that cites that fact. Cite a fact only for what it states.",
    "2. Never count items yourself, neither your own list nor a list in another block: write \"the subscription plans\" or \"the other antidotes\", never \"the two ...\".",
    "3. A sentence that repeats a value from an earlier block cites that fact again in its own block, or leaves the value out.",
    "4. If no fact states a value, leave the value or the sentence out. Do not mention this feedback.",
  ].join("\n");
}
