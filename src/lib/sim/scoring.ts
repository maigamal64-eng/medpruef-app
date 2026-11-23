/**
 * Scoring (PLAN.md 3: "Self-mark is final; AI marks are suggestions with quotes").
 *
 * - An AI verdict (S5) is a suggestion per item with a quote from the learner's own text.
 * - `checkVerdict` applies the quote rule: a "covered" or "partly" verdict whose quote is
 *   not in the learner's text becomes "unklar"; a critical item never keeps "covered"
 *   (or "partly") without a passing quote, it becomes "missing".
 * - Only the learner's self-mark scores. An item with no self-mark counts as missing,
 *   so "unklar" counts as not covered until the learner ticks it.
 * - A critical item is missed unless its final self-mark is "covered" and its slot has text.
 * - A free-text part with nothing or one word scores 0.
 * - An item whose slot has no text cannot be marked "covered" or "partly" (the reducer
 *   refuses it, `markProblem`), so the learner's mark and the score always agree.
 * - In a short_answers part each typed line is one answer: the items that share a slot
 *   (KP: the other differentials) earn together at most as much credit as the slot has
 *   typed lines (v1 case-run.ts differentialScore).
 */
import { isFreeTextKind, isScored, type PartConfig, type PartKind } from "./parts";
import type { SimItem } from "./case";

export const AI_STATUSES = ["covered", "partly", "missing", "unklar"] as const;
export type AiStatus = (typeof AI_STATUSES)[number];

export const SELF_MARKS = ["covered", "partly", "missing"] as const;
export type SelfMark = (typeof SELF_MARKS)[number];

/** Credit of a "partly" self-mark. "covered" is 1, "missing" 0. */
export const PARTLY_CREDIT = 0.5;
/** A quote shorter than this (after normalising) never passes. */
export const MIN_QUOTE_CHARS = 3;
/** A quote for a critical (safety) item must be at least this long and have at least this many words (PLAN.md 2.2, 2.10). */
export const MIN_CRITICAL_QUOTE_CHARS = 12;
export const MIN_CRITICAL_QUOTE_WORDS = 2;

/** The shape the AI grader (S5) returns per item. Stored on the session with model and prompt version so a regrade is traceable. */
export interface ItemVerdict {
  itemId: string;
  status: AiStatus;
  /** Verbatim from the learner's text; null for "missing" and "unklar". */
  quote: string | null;
  model: string;
  promptVersion: string;
}

/** Whitespace collapsed, Unicode NFC, lower case: the form quotes and learner text are compared in. */
export function normaliseForQuote(text: string): string {
  return text.normalize("NFC").replace(/\s+/g, " ").trim().toLowerCase();
}

/** True when the quote is in the learner's text and long enough; a critical item needs a longer quote (two words, 12 characters). */
export function quotePasses(quote: string | null, learnerText: string, critical = false): boolean {
  if (quote === null) return false;
  const q = normaliseForQuote(quote);
  if (q.length < (critical ? MIN_CRITICAL_QUOTE_CHARS : MIN_QUOTE_CHARS)) return false;
  if (critical && wordCount(q) < MIN_CRITICAL_QUOTE_WORDS) return false;
  return normaliseForQuote(learnerText).includes(q);
}

/** Apply the quote and critical rules to one verdict, judged on the text of the item's slot. */
export function checkVerdict(v: ItemVerdict, item: Pick<SimItem, "critical">, slotText: string): ItemVerdict {
  if (v.status === "missing" || v.status === "unklar") return { ...v, quote: null };
  if (quotePasses(v.quote, slotText, item.critical)) return v;
  return { ...v, status: item.critical ? "missing" : "unklar", quote: null };
}

/** The self-mark a suggestion proposes; the learner confirms or changes it. "unklar" proposes "missing". */
export function proposedSelfMark(status: AiStatus): SelfMark {
  return status === "covered" ? "covered" : status === "partly" ? "partly" : "missing";
}

export function wordCount(text: string): number {
  return text.match(/[\p{L}\p{N}]+/gu)?.length ?? 0;
}

/** True when a free-text answer is long enough to send to the grader (more than one word). S5 skips the model call otherwise. */
export function worthGrading(text: string): boolean {
  return wordCount(text) >= 2;
}

/** Typed lines with at least one word (one short answer per line). */
export function typedLineCount(text: string): number {
  return text.split("\n").filter((l) => wordCount(l) > 0).length;
}

function credit(mark: SelfMark | null): number {
  return mark === "covered" ? 1 : mark === "partly" ? PARTLY_CREDIT : 0;
}

export interface ItemResult {
  itemId: string;
  weight: number;
  critical: boolean;
  /** The learner's mark; null when never marked (counts as missing). */
  final: SelfMark | null;
  /** The AI suggestion after the quote rule; null when none was made. */
  suggestion: AiStatus | null;
  /** 0, PARTLY_CREDIT or 1; 0 whenever the item's slot is empty. */
  credit: number;
  criticalMissed: boolean;
  /** The learner's final mark differs from what the suggestion proposed. */
  overridden: boolean;
}

export interface PartResult {
  partId: string;
  kind: PartKind;
  /** 0..1 */
  score: number;
  /** Nothing or one word in a free-text part, or no text at all: the part scores 0. */
  empty: boolean;
  items: ItemResult[];
  criticalMissed: string[];
}

/** What scoring needs of an item (the label is display only). */
export type ScoredItem = Pick<SimItem, "id" | "slot" | "critical" | "weight">;

export interface PartScoreInput {
  part: PartConfig;
  items: readonly ScoredItem[];
  answers: Readonly<Record<string, string>>;
  selfMarks: Readonly<Record<string, SelfMark>>;
  verdicts: Readonly<Record<string, ItemVerdict>>;
}

function partText(answers: Readonly<Record<string, string>>): string {
  return Object.values(answers).join(" ");
}

export function isPartEmpty(kind: PartKind, answers: Readonly<Record<string, string>>): boolean {
  const words = wordCount(partText(answers));
  return isFreeTextKind(kind) ? words < 2 : words === 0;
}

/** True when the item's slot has text the item can be judged on (and the part is not empty). */
export function itemHasText(kind: PartKind, answers: Readonly<Record<string, string>>, slot: string): boolean {
  return !isPartEmpty(kind, answers) && wordCount(answers[slot] ?? "") > 0;
}

/** Credit the items sharing a slot may earn together; Infinity unless the part is short_answers (one answer per typed line). */
export function slotCreditBudget(kind: PartKind, answers: Readonly<Record<string, string>>, slot: string): number {
  return kind === "short_answers" ? typedLineCount(answers[slot] ?? "") : Number.POSITIVE_INFINITY;
}

export type MarkProblem = "slot_empty" | "slot_full";

/**
 * Whether the learner may give `mark` to `itemId` (null = fine). "missing" and clearing are always fine;
 * "covered" or "partly" needs text in the item's slot and, in short answers, a typed line not already credited.
 */
export function markProblem(
  kind: PartKind,
  items: readonly ScoredItem[],
  answers: Readonly<Record<string, string>>,
  selfMarks: Readonly<Record<string, SelfMark>>,
  itemId: string,
  mark: SelfMark | null,
): MarkProblem | null {
  if (mark === null || mark === "missing") return null;
  const it = items.find((x) => x.id === itemId);
  if (!it) return null;
  if (!itemHasText(kind, answers, it.slot)) return "slot_empty";
  const used = items.filter((x) => x.id !== itemId && x.slot === it.slot).reduce((sum, x) => sum + credit(selfMarks[x.id] ?? null), 0);
  return used + credit(mark) > slotCreditBudget(kind, answers, it.slot) ? "slot_full" : null;
}

export function scorePart(i: PartScoreInput): PartResult {
  const empty = isPartEmpty(i.part.kind, i.answers);
  let total = 0;
  let got = 0;
  const items: ItemResult[] = [];
  const criticalMissed: string[] = [];
  const budget = new Map<string, number>();
  for (const it of i.items) {
    const slotHasText = !empty && wordCount(i.answers[it.slot] ?? "") > 0;
    const final = i.selfMarks[it.id] ?? null;
    const v = i.verdicts[it.id];
    const suggestion = v ? checkVerdict(v, it, i.answers[it.slot] ?? "").status : null;
    // Defensive cap: the reducer never lets a shared slot earn more than its typed lines.
    const left = budget.get(it.slot) ?? slotCreditBudget(i.part.kind, i.answers, it.slot);
    const c = slotHasText ? Math.min(credit(final), left) : 0;
    budget.set(it.slot, left - c);
    const missed = it.critical && !(slotHasText && final === "covered");
    total += it.weight;
    got += it.weight * c;
    if (missed) criticalMissed.push(it.id);
    items.push({
      itemId: it.id,
      weight: it.weight,
      critical: it.critical,
      final,
      suggestion,
      credit: c,
      criticalMissed: missed,
      overridden: suggestion !== null && final !== null && proposedSelfMark(suggestion) !== final,
    });
  }
  return { partId: i.part.id, kind: i.part.kind, score: total > 0 ? got / total : 0, empty, items, criticalMissed };
}

/** Weighted total over the scored parts that ran (0..1). Parts with marking "none" never count. */
export function totalScore(parts: readonly { part: PartConfig; result: PartResult }[]): number {
  let w = 0;
  let s = 0;
  for (const { part, result } of parts) {
    if (!isScored(part)) continue;
    w += part.totalWeight;
    s += part.totalWeight * result.score;
  }
  return w > 0 ? s / w : 0;
}
