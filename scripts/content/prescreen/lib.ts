/**
 * C1 bank-wide blind-answer and explanation pre-screen (a-content-c1,
 * 2026-10-14). Pure rules: no I/O, no env, no network.
 *
 * Source: reports/ai-credits-2026-10-14/content.json lever C1. The pre-screen
 * only ranks rows for Content Medic reads; it never edits a question, never
 * proposes a replacement key, and its verdicts are never shown to learners.
 * Every change still needs two independent Content Medic reads.
 *
 * Per row, four requests at most, all on the Message Batches API:
 *   p1b  pass 1 blind      (Claude Sonnet 5.5): stem and options only, no key.
 *   p1r  pass 1 review     (Claude Sonnet 5.5): the same row with the stored
 *        key, the stored explanation and the model's own recorded blind pick;
 *        returns structured flags.
 *   p2b / p2r  pass 2 blind second opinion (Claude Opus 5.5) on every pass 1
 *        flag plus a seeded 5 % sample of clean rows. Pass 2 never sees pass 1.
 * Opus refusals are re-queued on Sonnet 5.5 (suffix f) and counted.
 *
 * custom_id = <stage>_<question id>_<row hash 16>: the hash covers stem,
 * choices, answer and explanation, so a changed row is a new item and an
 * unchanged row is never paid for twice.
 */
import { createHash } from "node:crypto";
import type { BatchItem, BatchParams, ResultLine } from "../../ai-batch/runner";

// ─── Models (content.json C1) ───────────────────────────────────────────

export const PASS1_MODEL = "claude-sonnet-5-5";
export const PASS2_MODEL = "claude-opus-5-5";
/** Opus 5.5 refusals (bio classifier) are re-queued here; server-side fallbacks are not available on the Batches API. */
export const REFUSAL_FALLBACK_MODEL = "claude-sonnet-5-5";
export const BANKS = ["kmp_innsbruck", "kenntnispruefung", "pharma"] as const;
export type Bank = (typeof BANKS)[number];

/**
 * Output caps include adaptive thinking. Pass 2 runs Opus 5.5 at effort
 * medium and thinks longer, so it gets more room. An answer cut off at the
 * cap is not usable and is sent again (runner: at most 3 batches per item).
 */
export const MAX_TOKENS = { blind: 3000, review: 4000, blind2: 6000, review2: 8000 } as const;
export const PASS2_SAMPLE_RATE = 0.05;
export const DEFAULT_SEED = "prescreen-2026-10";
export const QUEUE_PKG = "prescreen-2026-10";

// ─── Rows ────────────────────────────────────────────────────────────────

export interface Choice {
  text: string;
  correct: boolean;
  position?: number | null;
  image_url?: string | null;
}

export interface QuestionRow {
  id: number;
  exam_type: string;
  topic: string | null;
  question: string;
  choices: Choice[] | null;
  answer: string | null;
  explanation: string | null;
  tags: string[] | null;
  image_url: string | null;
  image_urls: string[] | null;
  is_active: boolean;
}

export interface Exposure {
  /** Answers in the last 90 days (all learners, counts only). */
  answers_90d: number;
  free_set: boolean;
}

export const LETTERS = ["A", "B", "C", "D", "E", "F", "G", "H"] as const;

/** Options in stored position order (falls back to array order). */
export function orderedChoices(row: QuestionRow): Choice[] {
  const cs = Array.isArray(row.choices) ? row.choices.filter((c) => c && typeof c.text === "string") : [];
  return cs
    .map((c, i) => ({ c, i }))
    .sort((a, b) => (a.c.position ?? a.i) - (b.c.position ?? b.i) || a.i - b.i)
    .map((x) => x.c)
    .slice(0, LETTERS.length);
}

export function isMcq(row: QuestionRow): boolean {
  const cs = orderedChoices(row);
  return cs.length >= 2 && cs.some((c) => c.correct === true);
}

export function keyLetters(row: QuestionRow): string[] {
  return orderedChoices(row)
    .map((c, i) => (c.correct === true ? LETTERS[i] : null))
    .filter((x): x is (typeof LETTERS)[number] => x !== null);
}

export function hasImage(row: QuestionRow): boolean {
  if (row.image_url) return true;
  if (Array.isArray(row.image_urls) && row.image_urls.some((u) => typeof u === "string" && u)) return true;
  return orderedChoices(row).some((c) => !!c.image_url);
}

/** Stable 16-hex hash of everything the pre-screen reads. */
export function rowHash(row: QuestionRow): string {
  const payload = JSON.stringify([row.question ?? "", orderedChoices(row).map((c) => [c.text, c.correct === true]), row.answer ?? "", row.explanation ?? "", hasImage(row)]);
  return createHash("sha256").update(payload, "utf8").digest("hex").slice(0, 16);
}

export type Stage = "p1b" | "p1r" | "p2b" | "p2r" | "p2bf" | "p2rf";

export function customId(stage: Stage, row: Pick<QuestionRow, "id">, hash: string): string {
  return `${stage}_${row.id}_${hash}`;
}

export function parseCustomId(id: string): { stage: Stage; questionId: number; hash: string } | null {
  const m = /^(p1b|p1r|p2b|p2r|p2bf|p2rf)_(\d+)_([0-9a-f]{16})$/.exec(id);
  return m ? { stage: m[1] as Stage, questionId: Number(m[2]), hash: m[3] } : null;
}

// ─── Deterministic checks (no model) ────────────────────────────────────

const IMAGE_REF = /\b(abbildung|bild(?:es)?|foto|ekg|röntgen\w*|ct-?bild|mrt-?bild|sonographie-?bild|dargestellt\w*|zu sehen)\b/iu;
const STATED_COUNT = /\((\d)\s+richtige?\s+antworten?\)|\b(\d)\s+richtige\s+antworten\b/iu;
const COUNT_WORDS: Record<string, number> = { zwei: 2, drei: 3, vier: 4, fünf: 5 };
const STATED_COUNT_WORD = /\b(zwei|drei|vier|fünf)\s+(?:richtige|zutreffende)\b/iu;

export interface DeterministicFlags {
  image_ref_without_image: boolean;
  stated_count_mismatch: boolean;
  explanation_short: boolean;
  open_answer: boolean;
  has_image: boolean;
}

export function deterministicFlags(row: QuestionRow): DeterministicFlags {
  const stem = row.question ?? "";
  const m = STATED_COUNT.exec(stem);
  const w = STATED_COUNT_WORD.exec(stem);
  const stated = m ? Number(m[1] ?? m[2]) : w ? COUNT_WORDS[w[1].toLowerCase()] : null;
  const marked = keyLetters(row).length;
  return {
    image_ref_without_image: IMAGE_REF.test(stem) && !hasImage(row),
    stated_count_mismatch: stated !== null && isMcq(row) && stated !== marked,
    explanation_short: (row.explanation ?? "").trim().length < 80,
    open_answer: !isMcq(row),
    has_image: hasImage(row),
  };
}

// ─── Prompts and schemas ────────────────────────────────────────────────

const COMMON = [
  "You support the content team of an Austrian medical licensing exam preparation platform (Vienna Kenntnisprüfung SIP4a/SIP5a, Innsbruck Stichprobentest, Pharmakologie/Rezeptierkunde).",
  "Questions are in German. Answer from current, mainstream clinical knowledge as taught for Austrian exams (Austrian, European and widely used international guidelines).",
  "This is triage, not verification: you do not change anything. A human medical reviewer reads every row you flag. Be calibrated: say when you are unsure, and never invent sources.",
  "Return only the JSON object the schema asks for.",
].join("\n");

export const BLIND_SYSTEM = [
  COMMON,
  "",
  "Task: answer the question yourself, blind. You are not shown the stored answer key.",
  "- Multiple-choice: return the letter(s) of every option you consider correct in `picks`. Some questions have more than one correct option; the stem may say how many.",
  "- Open question (no options): leave `picks` empty and write your short answer in `free_answer` (at most 3 sentences).",
  "- `confidence` is your probability (0 to 1) that your picks are exactly the correct set.",
  "- If an image is attached in the original but not shown to you, set `answerable_without_image` to false when you cannot answer without it.",
  "- `multiple_correct_likely`: more than one option is defensible as correct.",
  "- `stem_depends_on_option_wording`: the stem cannot be understood without the option texts (for example 'Welche Aussage trifft zu?').",
  "- `note`: one short English sentence on anything that makes the item ambiguous, outdated or broken; empty if nothing.",
].join("\n");

export const REVIEW_SYSTEM = [
  COMMON,
  "",
  "Task: you answered this question blind earlier (your answer is quoted). Now you see the stored answer key and the stored explanation. Check them and return flags:",
  "- `key_disagree`: after seeing the key and explanation you still believe the stored key is wrong or incomplete. `key_disagree_confidence` is your probability (0 to 1) that the stored key is wrong. Changing your mind after reading a convincing explanation is fine: then key_disagree is false.",
  "- `own_answer`: the option letters you now consider correct (empty for open questions).",
  "- `multi_answer`: more than one option is defensible but the key marks fewer, or the stem does not say how many.",
  "- `option_dependent_stem`: the stem only makes sense together with the option texts.",
  "- `explanation_contradicts_key`: the explanation argues for a different answer, describes a different patient or question, or contradicts itself.",
  "- `explanation_thin_or_english`: the explanation is missing, a stub, only restates the answer, or is not in German.",
  "- `outdated_guideline_or_year`: key or explanation relies on a superseded guideline, drug, dose, threshold or classification.",
  "- `image_needed_missing`: the question needs an image that is not present.",
  "- `severity`: none, low, medium or high (high = a learner who trusts this row learns something wrong).",
  "- `reason`: at most two English sentences for the medical reviewer: what looks wrong and why. Empty when severity is none.",
].join("\n");

export const BLIND_SCHEMA: Record<string, unknown> = {
  type: "object",
  additionalProperties: false,
  required: ["picks", "free_answer", "confidence", "answerable_without_image", "multiple_correct_likely", "stem_depends_on_option_wording", "note"],
  properties: {
    picks: { type: "array", items: { type: "string", enum: [...LETTERS] } },
    free_answer: { type: "string" },
    confidence: { type: "number" },
    answerable_without_image: { type: "boolean" },
    multiple_correct_likely: { type: "boolean" },
    stem_depends_on_option_wording: { type: "boolean" },
    note: { type: "string" },
  },
};

export const REVIEW_FLAG_KEYS = [
  "key_disagree",
  "multi_answer",
  "option_dependent_stem",
  "explanation_contradicts_key",
  "explanation_thin_or_english",
  "outdated_guideline_or_year",
  "image_needed_missing",
] as const;
export type ReviewFlagKey = (typeof REVIEW_FLAG_KEYS)[number];

export const REVIEW_SCHEMA: Record<string, unknown> = {
  type: "object",
  additionalProperties: false,
  required: [...REVIEW_FLAG_KEYS, "key_disagree_confidence", "own_answer", "severity", "reason"],
  properties: {
    ...Object.fromEntries(REVIEW_FLAG_KEYS.map((k) => [k, { type: "boolean" }])),
    key_disagree_confidence: { type: "number" },
    own_answer: { type: "array", items: { type: "string", enum: [...LETTERS] } },
    severity: { type: "string", enum: ["none", "low", "medium", "high"] },
    reason: { type: "string" },
  },
};

function questionBlock(row: QuestionRow): string {
  const lines = [`Exam: ${row.exam_type}${row.topic ? ` / ${row.topic}` : ""}`, "", "Question:", (row.question ?? "").trim()];
  if (hasImage(row)) lines.push("", "[An image belongs to this question in the original. It is not shown here.]");
  const cs = orderedChoices(row);
  if (cs.length >= 2) {
    lines.push("", "Options:");
    cs.forEach((c, i) => lines.push(`${LETTERS[i]}) ${c.text.trim()}${c.image_url ? " [option image not shown]" : ""}`));
  } else {
    lines.push("", "(Open question: no options.)");
  }
  return lines.join("\n");
}

export interface BlindAnswer {
  picks: string[];
  free_answer: string;
  confidence: number;
  answerable_without_image: boolean;
  multiple_correct_likely: boolean;
  stem_depends_on_option_wording: boolean;
  note: string;
}

export interface ReviewAnswer {
  key_disagree: boolean;
  key_disagree_confidence: number;
  own_answer: string[];
  multi_answer: boolean;
  option_dependent_stem: boolean;
  explanation_contradicts_key: boolean;
  explanation_thin_or_english: boolean;
  outdated_guideline_or_year: boolean;
  image_needed_missing: boolean;
  severity: "none" | "low" | "medium" | "high";
  reason: string;
}

function userMessage(text: string): BatchParams["messages"] {
  return [{ role: "user", content: text }];
}

export function blindItem(row: QuestionRow, stage: "p1b" | "p2b" | "p2bf", model: string, effort: BatchParams["effort"] = "low"): BatchItem {
  return {
    custom_id: customId(stage, row, rowHash(row)),
    params: {
      model,
      effort,
      max_tokens: stage === "p1b" ? MAX_TOKENS.blind : MAX_TOKENS.blind2,
      system: [{ type: "text", text: BLIND_SYSTEM, cache_control: { type: "ephemeral" } }],
      messages: userMessage(questionBlock(row)),
      output_format: { type: "json_schema", schema: BLIND_SCHEMA },
    },
  };
}

export function reviewItem(row: QuestionRow, blind: BlindAnswer, stage: "p1r" | "p2r" | "p2rf", model: string, effort: BatchParams["effort"] = "low"): BatchItem {
  const cs = orderedChoices(row);
  const key = cs.length >= 2 ? keyLetters(row).join(", ") || "(none marked)" : (row.answer ?? "").trim() || "(empty)";
  const own = cs.length >= 2 ? `${blind.picks.join(", ") || "(none)"} (confidence ${blind.confidence.toFixed(2)})` : `${blind.free_answer || "(none)"} (confidence ${blind.confidence.toFixed(2)})`;
  const text = [
    questionBlock(row),
    "",
    `Your blind answer: ${own}`,
    blind.note ? `Your blind note: ${blind.note}` : "",
    "",
    `Stored answer key: ${key}`,
    cs.length >= 2 && row.answer ? `Stored answer text: ${row.answer.trim()}` : "",
    "",
    "Stored explanation:",
    (row.explanation ?? "").trim() || "(no explanation stored)",
  ]
    .filter((l) => l !== "")
    .join("\n");
  return {
    custom_id: customId(stage, row, rowHash(row)),
    params: {
      model,
      effort,
      max_tokens: stage === "p1r" ? MAX_TOKENS.review : MAX_TOKENS.review2,
      system: [{ type: "text", text: REVIEW_SYSTEM, cache_control: { type: "ephemeral" } }],
      messages: userMessage(text),
      output_format: { type: "json_schema", schema: REVIEW_SCHEMA },
    },
  };
}

// ─── Parsing (strict) ───────────────────────────────────────────────────

function clamp01(x: unknown): number {
  const v = typeof x === "number" && Number.isFinite(x) ? x : NaN;
  if (Number.isNaN(v)) throw new Error("confidence not a number");
  return Math.max(0, Math.min(1, v));
}

function letters(x: unknown, max: number): string[] {
  if (!Array.isArray(x)) throw new Error("letters not an array");
  const out = [...new Set(x.map((v) => String(v).trim().toUpperCase()))].filter((v) => (LETTERS as readonly string[]).includes(v)).sort();
  return out.filter((v) => LETTERS.indexOf(v as (typeof LETTERS)[number]) < max);
}

function bool(x: unknown, k: string): boolean {
  if (typeof x !== "boolean") throw new Error(`${k} not a boolean`);
  return x;
}

function str(x: unknown, k: string, cap: number): string {
  if (typeof x !== "string") throw new Error(`${k} not a string`);
  return x.trim().slice(0, cap);
}

function parseJson(text: string): Record<string, unknown> {
  const t = text.trim().replace(/^```(?:json)?\s*/u, "").replace(/\s*```$/u, "");
  const j = JSON.parse(t) as unknown;
  if (!j || typeof j !== "object" || Array.isArray(j)) throw new Error("not a JSON object");
  return j as Record<string, unknown>;
}

/** Throws on anything that does not match the schema exactly (the caller treats that as a failed item). */
export function parseBlind(text: string, optionCount: number): BlindAnswer {
  const j = parseJson(text);
  return {
    picks: letters(j.picks, optionCount),
    free_answer: str(j.free_answer, "free_answer", 600),
    confidence: clamp01(j.confidence),
    answerable_without_image: bool(j.answerable_without_image, "answerable_without_image"),
    multiple_correct_likely: bool(j.multiple_correct_likely, "multiple_correct_likely"),
    stem_depends_on_option_wording: bool(j.stem_depends_on_option_wording, "stem_depends_on_option_wording"),
    note: str(j.note, "note", 300),
  };
}

export function parseReview(text: string, optionCount: number): ReviewAnswer {
  const j = parseJson(text);
  const severity = j.severity;
  if (severity !== "none" && severity !== "low" && severity !== "medium" && severity !== "high") throw new Error("severity invalid");
  const out = {
    key_disagree_confidence: clamp01(j.key_disagree_confidence),
    own_answer: letters(j.own_answer, optionCount),
    severity,
    reason: str(j.reason, "reason", 500),
  } as ReviewAnswer;
  for (const k of REVIEW_FLAG_KEYS) out[k] = bool(j[k], k);
  return out;
}

// ─── Stage planning ─────────────────────────────────────────────────────

export interface StageResult<T> {
  model: string;
  answer: T;
  custom_id: string;
}

export interface RowState {
  row: QuestionRow;
  hash: string;
  p1b?: StageResult<BlindAnswer>;
  p1r?: StageResult<ReviewAnswer>;
  p2b?: StageResult<BlindAnswer>;
  p2r?: StageResult<ReviewAnswer>;
  /** Stage -> last error (refusal, invalid_json, errored, expired). */
  errors: Partial<Record<Stage, string>>;
  refusals: Partial<Record<Stage, number>>;
  attempts_exhausted: Stage[];
}

/** Latest usable result per custom_id, parsed. Invalid JSON is a failure line. */
export function indexResults(results: readonly ResultLine[]): Map<string, ResultLine> {
  const m = new Map<string, ResultLine>();
  for (const r of results) {
    const prev = m.get(r.custom_id);
    if (!prev || prev.type !== "succeeded" || r.type === "succeeded") m.set(r.custom_id, r);
  }
  return m;
}

/** Build per-row state from collected results (only results whose hash matches the current row count). */
export function buildRowStates(rows: readonly QuestionRow[], results: readonly ResultLine[], maxAttempts = 3): Map<number, RowState> {
  const byId = new Map<string, ResultLine[]>();
  for (const r of results) byId.set(r.custom_id, [...(byId.get(r.custom_id) ?? []), r]);
  const states = new Map<number, RowState>();
  for (const row of rows) {
    const hash = rowHash(row);
    const st: RowState = { row, hash, errors: {}, refusals: {}, attempts_exhausted: [] };
    const n = orderedChoices(row).length;
    const take = (stage: Stage): { line: ResultLine; text: string } | null => {
      const lines = byId.get(customId(stage, row, hash)) ?? [];
      const refusals = lines.filter((l) => l.error === "refusal").length;
      if (refusals) st.refusals[stage] = refusals;
      const ok = [...lines].reverse().find((l) => l.type === "succeeded" && l.text);
      const failedBatches = new Set(lines.filter((l) => l.type !== "succeeded").map((l) => l.batch_id));
      if (!ok) {
        const last = lines[lines.length - 1];
        if (last) st.errors[stage] = last.error ?? last.type;
        if (failedBatches.size >= maxAttempts) st.attempts_exhausted.push(stage);
        return null;
      }
      return { line: ok, text: ok.text as string };
    };
    const blindOf = (stage: "p1b" | "p2b" | "p2bf") => {
      const t = take(stage);
      if (!t) return undefined;
      try {
        return { model: t.line.model ?? "", answer: parseBlind(t.text, n), custom_id: t.line.custom_id };
      } catch {
        st.errors[stage] = "invalid_json";
        return undefined;
      }
    };
    const reviewOf = (stage: "p1r" | "p2r" | "p2rf") => {
      const t = take(stage);
      if (!t) return undefined;
      try {
        return { model: t.line.model ?? "", answer: parseReview(t.text, n), custom_id: t.line.custom_id };
      } catch {
        st.errors[stage] = "invalid_json";
        return undefined;
      }
    };
    st.p1b = blindOf("p1b");
    st.p1r = reviewOf("p1r");
    st.p2b = blindOf("p2b") ?? blindOf("p2bf");
    st.p2r = reviewOf("p2r") ?? reviewOf("p2rf");
    states.set(row.id, st);
  }
  return states;
}

/**
 * Pass 1 strength at or above which a row gets the Opus second opinion.
 * 0.45 keeps the 0.3-weight flags (short or English explanation, option
 * dependent stem) out of pass 2 on their own: content.json budgeted pass 2
 * at about 20 % of rows, and those flags alone do not need a key opinion.
 */
export const PASS2_MIN_STRENGTH = 0.45;

/** Rows whose pass 1 is complete and strong enough for pass 2. */
export function pass1Flagged(st: RowState, minStrength = PASS2_MIN_STRENGTH): boolean {
  if (!st.p1b || !st.p1r) return false;
  return flagNames(st, "p1").length > 0 && passStrength(st, "p1") >= minStrength;
}

/** Seeded, stable 5 % sample of clean rows for pass 2. */
export function inSample(id: number, seed = DEFAULT_SEED, rate = PASS2_SAMPLE_RATE): boolean {
  const h = createHash("sha256").update(`${seed}:${id}`, "utf8").digest();
  return h.readUInt32BE(0) / 0xffffffff < rate;
}

export interface NextItemsOptions {
  /** Rows that may run pass 2 (default: flagged plus the sample). */
  pass2?: "flagged_and_sample" | "all" | "none";
  seed?: string;
  effort1?: BatchParams["effort"];
  effort2?: BatchParams["effort"];
  /** Pass 1 strength that triggers pass 2 (default PASS2_MIN_STRENGTH). */
  pass2MinStrength?: number;
}

/**
 * Items that can be submitted now, given what has been collected. Pure:
 * the runner's blockedIds() skips anything already done or in flight.
 */
export function nextItems(states: Iterable<RowState>, opts: NextItemsOptions = {}): { items: BatchItem[]; byStage: Record<Stage, number> } {
  const items: BatchItem[] = [];
  const byStage = { p1b: 0, p1r: 0, p2b: 0, p2r: 0, p2bf: 0, p2rf: 0 } as Record<Stage, number>;
  const push = (it: BatchItem, s: Stage) => {
    items.push(it);
    byStage[s] += 1;
  };
  const pass2 = opts.pass2 ?? "flagged_and_sample";
  for (const st of states) {
    const { row } = st;
    if (!st.p1b) {
      if (!st.attempts_exhausted.includes("p1b")) push(blindItem(row, "p1b", PASS1_MODEL, opts.effort1 ?? "low"), "p1b");
      continue;
    }
    if (!st.p1r) {
      if (!st.attempts_exhausted.includes("p1r")) push(reviewItem(row, st.p1b.answer, "p1r", PASS1_MODEL, opts.effort1 ?? "low"), "p1r");
      continue;
    }
    if (pass2 === "none") continue;
    const wants = pass2 === "all" || pass1Flagged(st, opts.pass2MinStrength) || inSample(row.id, opts.seed);
    if (!wants) continue;
    if (!st.p2b) {
      // Opus refused (or kept failing): one re-queue on Sonnet 5.5, counted in the cost report.
      const opusDone = st.refusals.p2b || st.attempts_exhausted.includes("p2b");
      if (opusDone) {
        if (!st.attempts_exhausted.includes("p2bf")) push(blindItem(row, "p2bf", REFUSAL_FALLBACK_MODEL, opts.effort2 ?? "medium"), "p2bf");
      } else push(blindItem(row, "p2b", PASS2_MODEL, opts.effort2 ?? "medium"), "p2b");
      continue;
    }
    if (!st.p2r) {
      const opusDone = st.refusals.p2r || st.attempts_exhausted.includes("p2r");
      if (opusDone) {
        if (!st.attempts_exhausted.includes("p2rf")) push(reviewItem(row, st.p2b.answer, "p2rf", REFUSAL_FALLBACK_MODEL, opts.effort2 ?? "medium"), "p2rf");
      } else push(reviewItem(row, st.p2b.answer, "p2r", PASS2_MODEL, opts.effort2 ?? "medium"), "p2r");
    }
  }
  return { items, byStage };
}

/** Share of rows with a complete pass 1 that ran (or are due for) pass 2. */
export function pass2Share(states: Iterable<RowState>, opts: Pick<NextItemsOptions, "seed" | "pass2MinStrength"> = {}): { p1_done: number; pass2_due: number; share: number | null } {
  let done = 0;
  let due = 0;
  for (const st of states) {
    if (!st.p1b || !st.p1r) continue;
    done += 1;
    if ((st.p2b && st.p2r) || pass1Flagged(st, opts.pass2MinStrength) || inSample(st.row.id, opts.seed)) due += 1;
  }
  return { p1_done: done, pass2_due: due, share: done ? due / done : null };
}

// ─── Flags, strength, exposure, rank ────────────────────────────────────

/** Weights per flag (0..1). Documented in the release note; change them only with a calibration run. */
export const FLAG_WEIGHTS = {
  key_disagree_confirmed: 1.0, // blind pick differed from the key AND the review still disagrees
  key_disagree_review_only: 0.7,
  blind_key_mismatch: 0.45, // blind pick differed, review accepted the key
  explanation_contradicts_key: 0.85,
  stated_count_mismatch: 0.8,
  image_ref_without_image: 0.6,
  image_needed_missing: 0.6,
  outdated_guideline_or_year: 0.5,
  multi_answer: 0.5,
  option_dependent_stem: 0.3,
  explanation_thin_or_english: 0.3,
  explanation_short: 0.3,
} as const;
export type FlagName = keyof typeof FLAG_WEIGHTS;

const KEY_FLAGS: readonly FlagName[] = ["key_disagree_confirmed", "key_disagree_review_only", "blind_key_mismatch", "stated_count_mismatch", "multi_answer"];
const EXPLANATION_FLAGS: readonly FlagName[] = ["explanation_contradicts_key", "explanation_thin_or_english", "explanation_short", "outdated_guideline_or_year"];

export function flagFamily(f: FlagName): "key" | "explanation" | "shape" {
  if (KEY_FLAGS.includes(f)) return "key";
  if (EXPLANATION_FLAGS.includes(f)) return "explanation";
  return "shape";
}

function sameSet(a: readonly string[], b: readonly string[]): boolean {
  if (a.length !== b.length) return false;
  const s = new Set(a);
  return b.every((x) => s.has(x));
}

/** Flag names for one pass (model flags plus the deterministic ones, which belong to pass 1). */
export function flagNames(st: RowState, pass: "p1" | "p2"): FlagName[] {
  const blind = pass === "p1" ? st.p1b : st.p2b;
  const review = pass === "p1" ? st.p1r : st.p2r;
  const out = new Set<FlagName>();
  if (pass === "p1") {
    const d = deterministicFlags(st.row);
    if (d.stated_count_mismatch) out.add("stated_count_mismatch");
    if (d.image_ref_without_image) out.add("image_ref_without_image");
    if (d.explanation_short) out.add("explanation_short");
  }
  if (!blind || !review) return [...out];
  const b = blind.answer;
  const r = review.answer;
  const mcq = isMcq(st.row);
  const imageBlind = hasImage(st.row) && !b.answerable_without_image;
  const blindMismatch = mcq && !imageBlind && !sameSet(b.picks, keyLetters(st.row));
  if (r.key_disagree && blindMismatch) out.add("key_disagree_confirmed");
  else if (r.key_disagree) out.add("key_disagree_review_only");
  else if (blindMismatch && b.confidence >= 0.6) out.add("blind_key_mismatch");
  for (const k of ["multi_answer", "option_dependent_stem", "explanation_contradicts_key", "explanation_thin_or_english", "outdated_guideline_or_year", "image_needed_missing"] as const) {
    if (r[k]) out.add(k);
  }
  return [...out];
}

export function passStrength(st: RowState, pass: "p1" | "p2"): number {
  const flags = flagNames(st, pass);
  if (flags.length === 0) return 0;
  const review = pass === "p1" ? st.p1r : st.p2r;
  const blind = pass === "p1" ? st.p1b : st.p2b;
  let best = 0;
  for (const f of flags) {
    let w: number = FLAG_WEIGHTS[f];
    if (f === "key_disagree_confirmed" || f === "key_disagree_review_only") w *= 0.5 + 0.5 * (review?.answer.key_disagree_confidence ?? 0.5);
    if (f === "blind_key_mismatch") w *= 0.5 + 0.5 * (blind?.answer.confidence ?? 0.5);
    best = Math.max(best, w);
  }
  const sev = review?.answer.severity;
  const sevBoost = sev === "high" ? 0.15 : sev === "medium" ? 0.05 : 0;
  return Math.min(1.3, best + 0.05 * (flags.length - 1) + sevBoost);
}

/**
 * Strength in [0, 1.3]: pass 1 strength, adjusted by the blind second
 * opinion when it ran (same flag family confirmed x1.3, clean x0.5,
 * different flags x0.9). A sample row clean in pass 1 but flagged by
 * pass 2 gets 0.8 x the pass 2 strength.
 */
export function strength(st: RowState): { value: number; pass2: "confirmed" | "cleared" | "different" | "not_run" | "pass2_only" } {
  const s1 = passStrength(st, "p1");
  const p2ran = !!(st.p2b && st.p2r);
  if (!p2ran) return { value: s1, pass2: "not_run" };
  const f1 = new Set(flagNames(st, "p1").map(flagFamily));
  const f2 = flagNames(st, "p2");
  if (s1 === 0) return f2.length ? { value: 0.8 * passStrength(st, "p2"), pass2: "pass2_only" } : { value: 0, pass2: "cleared" };
  if (f2.length === 0) return { value: s1 * 0.5, pass2: "cleared" };
  if (f2.some((f) => f1.has(flagFamily(f)))) return { value: Math.min(1.3, s1 * 1.3), pass2: "confirmed" };
  return { value: s1 * 0.9, pass2: "different" };
}

/** STP first (content.json: 7 of 11 payers, b11 defect rate 20.7 %). */
export const BANK_WEIGHT: Record<string, number> = { kmp_innsbruck: 1.5, kenntnispruefung: 1.0, pharma: 1.0 };
export const FREE_SET_WEIGHT = 1.25;

export function exposureWeight(e: Exposure | undefined): number {
  const a = Math.max(0, Math.floor(e?.answers_90d ?? 0));
  return Math.log2(2 + a) * (e?.free_set ? FREE_SET_WEIGHT : 1);
}

export interface Verdict {
  id: number;
  exam_type: string;
  topic: string | null;
  row_hash: string;
  status: "flagged" | "clean" | "incomplete";
  flags_p1: FlagName[];
  flags_p2: FlagName[];
  pass2: ReturnType<typeof strength>["pass2"];
  strength: number;
  answers_90d: number;
  free_set: boolean;
  score: number;
  claimed_by: string[];
  key: string[];
  blind_p1: string[] | null;
  blind_p2: string[] | null;
  models: string[];
  reason: string;
  errors: Partial<Record<Stage, string>>;
  refusals: number;
}

function reasonOf(st: RowState, flags: FlagName[]): string {
  const parts: string[] = [];
  const r = st.p2r?.answer.reason || st.p1r?.answer.reason;
  if (r) parts.push(r);
  const d = deterministicFlags(st.row);
  if (d.stated_count_mismatch) parts.push(`Stem states a number of correct answers that differs from the ${keyLetters(st.row).length} marked.`);
  if (d.image_ref_without_image) parts.push("Stem refers to an image but the row has none.");
  if (!r && flags.includes("explanation_short")) parts.push("Explanation is missing or under 80 characters.");
  if (!r && flags.includes("blind_key_mismatch")) parts.push(`Blind answer ${st.p1b?.answer.picks.join(", ") || "(none)"} differs from the key ${keyLetters(st.row).join(", ")}; the review accepted the key.`);
  return parts.join(" ").slice(0, 900);
}

export function verdictFor(st: RowState, exposure: Exposure | undefined, claims: ReadonlyMap<number, string[]>): Verdict {
  const done = !!(st.p1b && st.p1r);
  const s = strength(st);
  const flags1 = flagNames(st, "p1");
  const flags2 = flagNames(st, "p2");
  const value = done ? s.value : 0;
  const score = value * exposureWeight(exposure) * (BANK_WEIGHT[st.row.exam_type] ?? 1);
  const models = [st.p1b, st.p1r, st.p2b, st.p2r].map((x) => x?.model).filter((m): m is string => !!m);
  return {
    id: st.row.id,
    exam_type: st.row.exam_type,
    topic: st.row.topic,
    row_hash: st.hash,
    status: !done ? "incomplete" : value > 0 ? "flagged" : "clean",
    flags_p1: flags1,
    flags_p2: flags2,
    pass2: s.pass2,
    strength: Math.round(value * 1000) / 1000,
    answers_90d: exposure?.answers_90d ?? 0,
    free_set: !!exposure?.free_set,
    score: Math.round(score * 1000) / 1000,
    claimed_by: claims.get(st.row.id) ?? [],
    key: keyLetters(st.row),
    blind_p1: st.p1b ? st.p1b.answer.picks : null,
    blind_p2: st.p2b ? st.p2b.answer.picks : null,
    models: [...new Set(models)],
    reason: reasonOf(st, [...flags1, ...flags2]),
    errors: st.errors,
    refusals: Object.values(st.refusals).reduce((a, b) => a + (b ?? 0), 0),
  };
}

/** Ranked queue: flagged, unclaimed rows by score (ties: STP, exposure, id). */
export function rankQueue(verdicts: readonly Verdict[], topN: number): Verdict[] {
  const order = (b: string) => (b === "kmp_innsbruck" ? 0 : b === "kenntnispruefung" ? 1 : 2);
  return verdicts
    .filter((v) => v.status === "flagged" && v.claimed_by.length === 0)
    .sort((a, b) => b.score - a.score || order(a.exam_type) - order(b.exam_type) || b.answers_90d - a.answers_90d || a.id - b.id)
    .slice(0, Math.max(0, topN));
}

/** Queue rows in data/KEY-DOUBTS.jsonl shape (pkg prescreen-2026-10), plus rank fields. */
export function keyDoubtLines(queue: readonly Verdict[], ts: string, auditPath: string): string[] {
  return queue.map((v, i) => {
    const rank = i + 1;
    const priority = v.strength >= 0.9 || (rank <= 50 && v.strength >= 0.7) ? "high" : "normal";
    return JSON.stringify({
      ts,
      pkg: QUEUE_PKG,
      id: v.id,
      exam_type: v.exam_type,
      reason: v.reason || `Pre-screen flags: ${[...v.flags_p1, ...v.flags_p2].join(", ")}`,
      priority,
      freeze_flags: [],
      status: "needs-track-a-medic",
      proposed_key: null,
      audit_path: auditPath,
      rank,
      score: v.score,
      strength: v.strength,
      flags: [...new Set([...v.flags_p1, ...v.flags_p2])],
      pass2: v.pass2,
      answers_90d: v.answers_90d,
      free_set: v.free_set,
      row_hash: v.row_hash,
      note: "Model triage only; not a medical verdict. Two independent Content Medic reads decide any change.",
    });
  });
}

// ─── Submission order and scope ─────────────────────────────────────────

export type Scope = "hot" | "cold" | "all";

/** STP first, then KP, then pharma; hottest first within a bank. */
export function orderRows(rows: readonly QuestionRow[], exposure: ReadonlyMap<number, Exposure>): QuestionRow[] {
  const bank = (b: string) => (b === "kmp_innsbruck" ? 0 : b === "kenntnispruefung" ? 1 : 2);
  return [...rows].sort((a, b) => bank(a.exam_type) - bank(b.exam_type) || (exposure.get(b.id)?.answers_90d ?? 0) - (exposure.get(a.id)?.answers_90d ?? 0) || a.id - b.id);
}

export function inScope(row: QuestionRow, e: Exposure | undefined, scope: Scope): boolean {
  const hot = (e?.answers_90d ?? 0) > 0;
  return scope === "all" || (scope === "hot" ? hot : !hot);
}

// ─── Claims (rows other packages own) ───────────────────────────────────

/** Question ids named in a changeset (id = N, q.id = N, id IN (...), id = ANY(ARRAY[...])). */
export function idsFromSql(sql: string): number[] {
  const out = new Set<number>();
  const re = /\b(?:q\.)?id\s*(?:=\s*(\d{4,9})\b|IN\s*\(([\d,\s]+)\)|=\s*ANY\s*\(\s*ARRAY\s*\[([\d,\s]+)\])/giu;
  let m: RegExpExecArray | null;
  while ((m = re.exec(sql))) {
    if (m[1]) out.add(Number(m[1]));
    for (const list of [m[2], m[3]]) if (list) for (const x of list.split(",")) if (/^\s*\d{4,9}\s*$/u.test(x)) out.add(Number(x));
  }
  return [...out].sort((a, b) => a - b);
}

/** Integer values under "id" or "question_id" keys anywhere in a JSON document (4 to 9 digits). */
export function idsFromJson(doc: unknown): number[] {
  const out = new Set<number>();
  const walk = (x: unknown, depth: number) => {
    if (depth > 12 || x === null || typeof x !== "object") return;
    if (Array.isArray(x)) {
      for (const v of x) walk(v, depth + 1);
      return;
    }
    for (const [k, v] of Object.entries(x as Record<string, unknown>)) {
      if ((k === "id" || k === "question_id") && Number.isSafeInteger(v) && (v as number) >= 1000 && (v as number) <= 999_999_999) out.add(v as number);
      else walk(v, depth + 1);
    }
  };
  walk(doc, 0);
  return [...out].sort((a, b) => a - b);
}

/** track-B ROW-CLAIMS.jsonl lines -> id -> packages, for the given package prefixes. */
export function idsFromRowClaims(jsonl: string, pkgPrefixes: readonly string[]): Map<number, string[]> {
  const m = new Map<number, string[]>();
  for (const line of jsonl.split("\n")) {
    if (!line.trim()) continue;
    const j = JSON.parse(line) as { pkg?: unknown; ids?: unknown; status?: unknown };
    const pkg = String(j.pkg ?? "");
    if (!pkgPrefixes.some((p) => pkg.startsWith(p))) continue;
    if (!Array.isArray(j.ids)) continue;
    for (const id of j.ids) if (Number.isSafeInteger(id)) m.set(id as number, [...new Set([...(m.get(id as number) ?? []), pkg])]);
  }
  return m;
}

// ─── Calibration ────────────────────────────────────────────────────────

export interface CalibrationLabel {
  id: number;
  /** Known: the key or stem is doubtful. */
  key_doubt: boolean;
  /** Known: the stored explanation has an actionable defect. */
  explanation_defect: boolean;
  source: string[];
}

/** b11 audit rows -> labels (REJECT = explanation defect; key_doubt as recorded). Self-check labels, not independent reads. */
export function labelsFromB11(audit: ReadonlyArray<Record<string, unknown>>): CalibrationLabel[] {
  return audit
    .filter((r) => Number.isSafeInteger(r.id))
    .map((r) => ({ id: r.id as number, key_doubt: r.key_doubt === true, explanation_defect: r.observed_explanation_defect === true || r.verdict === "REJECT", source: ["b11"] }));
}

/** track-B KEY-DOUBTS.jsonl lines -> key-doubt labels (referrals, not confirmed defects). */
export function labelsFromKeyDoubts(jsonl: string): CalibrationLabel[] {
  const out: CalibrationLabel[] = [];
  for (const line of jsonl.split("\n")) {
    if (!line.trim()) continue;
    const j = JSON.parse(line) as { id?: unknown; pkg?: unknown };
    if (!Number.isSafeInteger(j.id) || String(j.pkg ?? "").startsWith(QUEUE_PKG)) continue;
    out.push({ id: j.id as number, key_doubt: true, explanation_defect: false, source: [`key-doubts:${String(j.pkg ?? "?")}`] });
  }
  return out;
}

/** Approved learner "incorrect answer" reports -> key-doubt labels. */
export function labelsFromLearnerFlags(ids: readonly number[]): CalibrationLabel[] {
  return [...new Set(ids)].filter((id) => Number.isSafeInteger(id)).map((id) => ({ id, key_doubt: true, explanation_defect: false, source: ["learner-flag"] }));
}

export function mergeLabels(...sets: ReadonlyArray<readonly CalibrationLabel[]>): Map<number, CalibrationLabel> {
  const m = new Map<number, CalibrationLabel>();
  for (const set of sets)
    for (const l of set) {
      const prev = m.get(l.id);
      m.set(l.id, prev ? { id: l.id, key_doubt: prev.key_doubt || l.key_doubt, explanation_defect: prev.explanation_defect || l.explanation_defect, source: [...new Set([...prev.source, ...l.source])] } : { ...l });
    }
  return m;
}

/** Deterministic stratified pick: half known positives, half known negatives, STP-weighted. */
export function pickCalibration(labels: ReadonlyMap<number, CalibrationLabel>, rows: ReadonlyMap<number, QuestionRow>, n: number, seed = DEFAULT_SEED): number[] {
  const rank = (id: number) => createHash("sha256").update(`${seed}:cal:${id}`, "utf8").digest("hex");
  const avail = [...labels.values()].filter((l) => rows.get(l.id)?.is_active);
  const pos = avail.filter((l) => l.key_doubt || l.explanation_defect);
  const neg = avail.filter((l) => !l.key_doubt && !l.explanation_defect);
  const sortStp = (xs: CalibrationLabel[]) =>
    xs.sort((a, b) => Number(rows.get(b.id)?.exam_type === "kmp_innsbruck") - Number(rows.get(a.id)?.exam_type === "kmp_innsbruck") || rank(a.id).localeCompare(rank(b.id)));
  const nPos = Math.min(pos.length, Math.ceil(n / 2));
  const nNeg = Math.min(neg.length, n - nPos);
  // Interleave banks a little: take the STP-first order, but by hash within it.
  const picked = [...sortStp(pos).slice(0, nPos), ...sortStp(neg).slice(0, nNeg)];
  const extra = n - picked.length > 0 ? sortStp(pos).slice(nPos, nPos + (n - picked.length)) : [];
  return [...picked, ...extra].map((l) => l.id).sort((a, b) => a - b);
}

export interface Confusion {
  tp: number;
  fp: number;
  fn: number;
  tn: number;
  precision: number | null;
  recall: number | null;
}

function confusion(pairs: Array<[boolean, boolean]>): Confusion {
  let tp = 0,
    fp = 0,
    fn = 0,
    tn = 0;
  for (const [pred, truth] of pairs) {
    if (pred && truth) tp++;
    else if (pred && !truth) fp++;
    else if (!pred && truth) fn++;
    else tn++;
  }
  return { tp, fp, fn, tn, precision: tp + fp ? tp / (tp + fp) : null, recall: tp + fn ? tp / (tp + fn) : null };
}

export interface CalibrationReport {
  rows_scored: number;
  rows_incomplete: number;
  any_flag: Record<"p1" | "p1_plus_p2", Confusion>;
  key_flags: Record<"p1" | "p2", Confusion>;
  explanation_flags: Record<"p1" | "p2", Confusion>;
  by_bank: Record<string, Confusion>;
  caveat: string;
}

export function scoreCalibration(states: ReadonlyMap<number, RowState>, labels: ReadonlyMap<number, CalibrationLabel>, ids: readonly number[]): CalibrationReport {
  const any1: Array<[boolean, boolean]> = [];
  const any12: Array<[boolean, boolean]> = [];
  const key1: Array<[boolean, boolean]> = [];
  const key2: Array<[boolean, boolean]> = [];
  const exp1: Array<[boolean, boolean]> = [];
  const exp2: Array<[boolean, boolean]> = [];
  const bank = new Map<string, Array<[boolean, boolean]>>();
  let incomplete = 0;
  for (const id of ids) {
    const st = states.get(id);
    const l = labels.get(id);
    if (!st || !l || !st.p1b || !st.p1r) {
      incomplete++;
      continue;
    }
    const truth = l.key_doubt || l.explanation_defect;
    const f1 = flagNames(st, "p1");
    const s = strength(st);
    const pred1 = f1.length > 0;
    any1.push([pred1, truth]);
    any12.push([s.value > 0 && s.pass2 !== "cleared", truth]);
    key1.push([f1.some((f) => flagFamily(f) === "key"), l.key_doubt]);
    exp1.push([f1.some((f) => flagFamily(f) === "explanation"), l.explanation_defect]);
    if (st.p2b && st.p2r) {
      const f2 = flagNames(st, "p2");
      key2.push([f2.some((f) => flagFamily(f) === "key"), l.key_doubt]);
      exp2.push([f2.some((f) => flagFamily(f) === "explanation"), l.explanation_defect]);
    }
    const b = st.row.exam_type;
    bank.set(b, [...(bank.get(b) ?? []), [pred1, truth]]);
  }
  return {
    rows_scored: any1.length,
    rows_incomplete: incomplete,
    any_flag: { p1: confusion(any1), p1_plus_p2: confusion(any12) },
    key_flags: { p1: confusion(key1), p2: confusion(key2) },
    explanation_flags: { p1: confusion(exp1), p2: confusion(exp2) },
    by_bank: Object.fromEntries([...bank].map(([k, v]) => [k, confusion(v)])),
    caveat:
      "Labels: b11 audit (Codex self-check reads, not independent clinical reads), track-B KEY-DOUBTS (referrals, not confirmed defects) and approved learner wrong-answer reports. A 'false positive' may be a defect the label missed; precision here is a lower bound on usefulness, not a clinical accuracy.",
  };
}

// ─── Cost report ────────────────────────────────────────────────────────

export interface CostLine {
  stage: Stage;
  items: number;
  succeeded: number;
  failed: number;
  refusals: number;
  micro: number;
  mean_micro: number | null;
}

export function costByStage(results: readonly ResultLine[]): CostLine[] {
  const by = new Map<Stage, CostLine>();
  for (const r of results) {
    const p = parseCustomId(r.custom_id);
    if (!p) continue;
    const c = by.get(p.stage) ?? { stage: p.stage, items: 0, succeeded: 0, failed: 0, refusals: 0, micro: 0, mean_micro: null };
    c.items += 1;
    if (r.type === "succeeded") c.succeeded += 1;
    else c.failed += 1;
    if (r.error === "refusal") c.refusals += 1;
    c.micro += r.cost_micro;
    by.set(p.stage, c);
  }
  for (const c of by.values()) c.mean_micro = c.items ? Math.round(c.micro / c.items) : null;
  return [...by.values()].sort((a, b) => a.stage.localeCompare(b.stage));
}

/**
 * Projection for rows not yet run, from measured means where they exist,
 * else from the content.json planning figures (USD per row at batch price:
 * Sonnet blind 0.003, Sonnet review 0.005, Opus blind 0.006, Opus review 0.010).
 */
export const PLANNING_MICRO: Record<"p1b" | "p1r" | "p2b" | "p2r", number> = { p1b: 3_000, p1r: 5_000, p2b: 6_000, p2r: 10_000 };

export function projectMicro(rowsLeft: number, pass2Share: number, measured: readonly CostLine[]): { micro: number; basis: Record<string, "measured" | "planning"> } {
  const mean = (s: "p1b" | "p1r" | "p2b" | "p2r") => {
    const m = measured.find((c) => c.stage === s && c.items >= 10)?.mean_micro;
    return m ? { v: m, b: "measured" as const } : { v: PLANNING_MICRO[s], b: "planning" as const };
  };
  const a = mean("p1b"),
    b = mean("p1r"),
    c = mean("p2b"),
    d = mean("p2r");
  return {
    micro: Math.round(rowsLeft * (a.v + b.v + pass2Share * (c.v + d.v))),
    basis: { p1b: a.b, p1r: b.b, p2b: c.b, p2r: d.b },
  };
}
