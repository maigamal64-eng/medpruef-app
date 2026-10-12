/**
 * kaf-run: pure helpers for the timed KAF practice mode (a24, SIM-04 / CNT-14,
 * pick-kaf-pool = build). No React, no fetch, no storage I/O.
 *
 * The learner types short answers (sip.kaf: free text, no options, up to three
 * answers, one point only for a fully right answer). In the real exam experts
 * grade by hand; here the learner marks their own answer after submit.
 * suggestMark only says whether the typed text equals a stored wording after
 * normalisation. It is a hint, never the grade.
 */
import { gradeQuestion, normalizeAnswerText } from "@/lib/master-exam";

/** Practice clock: the SIP5a March 2025 KAF format ran 240 minutes. sip.duration is not confirmed. */
export const KAF_DURATION_S = 240 * 60;
export const KAF_COUNTS = [10, 20, 30] as const;
export type KafCount = (typeof KAF_COUNTS)[number];
export const KAF_DEFAULT_COUNT: KafCount = 20;
/** Server limits for the pool route. */
export const KAF_POOL_DEFAULT_LIMIT = 30;
export const KAF_POOL_MAX_LIMIT = 60;
/** History POST keeps at most 300 characters per answer and three answers per item. */
export const KAF_ANSWER_MAX_CHARS = 300;
export const KAF_MAX_REQUIRED = 3;

/** One item as the pool route serves it: never options, never accepted answers. */
export interface KafItem {
  id: number;
  topic: string;
  stem: string;
  image_url: string | null;
  required: number;
}

/** The answer key for one item, fetched only after submit (self-marking phase). */
export interface KafKey {
  accepted: string[][];
  model_answer: string;
  key_points: string[];
}

export type KafSuggestion = "matches" | "compare" | "empty";

/** Count chips offered for a pool: every preset that fits, or the whole pool when it is smaller than ten. */
export function countChoices(poolCount: number): number[] {
  const fit = KAF_COUNTS.filter((n) => n <= poolCount);
  return fit.length > 0 ? [...fit] : poolCount > 0 ? [poolCount] : [];
}

/** Clamp a requested pool size to [1, KAF_POOL_MAX_LIMIT]; anything unreadable is the default. */
export function clampPoolLimit(raw: string | null | undefined): number {
  const n = Number(raw);
  if (raw == null || raw === "" || !Number.isFinite(n)) return KAF_POOL_DEFAULT_LIMIT;
  return Math.min(KAF_POOL_MAX_LIMIT, Math.max(1, Math.floor(n)));
}

/** Fisher-Yates sample of up to n items; `random` is injectable for tests. */
export function sampleItems<T>(items: readonly T[], n: number, random: () => number = Math.random): T[] {
  const copy = [...items];
  for (let i = copy.length - 1; i > 0; i--) {
    const j = Math.floor(random() * (i + 1));
    [copy[i], copy[j]] = [copy[j], copy[i]];
  }
  return copy.slice(0, Math.max(0, Math.min(n, copy.length)));
}

/** A required count is 1..3; anything else is treated as 1. */
export function clampRequired(raw: unknown): number {
  const n = Number(raw);
  return Number.isInteger(n) && n >= 1 && n <= KAF_MAX_REQUIRED ? n : 1;
}

/** Trim, drop empty and cap the typed answers the way the history POST stores them. */
export function cleanTyped(typed: readonly string[] | undefined, required: number): string[] {
  return (typed ?? [])
    .slice(0, clampRequired(required))
    .map((s) => (typeof s === "string" ? s.trim().slice(0, KAF_ANSWER_MAX_CHARS) : ""))
    .filter((s) => normalizeAnswerText(s) !== "");
}

/**
 * Suggest a mark. "matches": every required answer equals a stored wording after
 * normalisation (case, ß, punctuation). "compare": the learner compares with the
 * model answer and decides. "empty": nothing typed, never counts as right.
 */
export function suggestMark(accepted: readonly (readonly string[])[], typed: readonly string[] | undefined, keyPoints: readonly string[] = []): KafSuggestion {
  // a24: a key point alone (e.g. "Kultur" for a three-part answer) never suggests "matches";
  // only full model wordings do. The learner still decides.
  const points = new Set(keyPoints.map(normalizeAnswerText));
  accepted = accepted.map((alts) => alts.filter((a) => !points.has(normalizeAnswerText(a)))).filter((alts) => alts.length > 0);
  const texts = (typed ?? []).filter((t) => typeof t === "string" && normalizeAnswerText(t) !== "");
  if (texts.length === 0) return "empty";
  if (accepted.length === 0) return "compare";
  const grade = gradeQuestion({ id: 0, topic: "", acceptedAnswers: accepted.map((a) => [...a]) }, { texts: [...texts] });
  return grade.correct ? "matches" : "compare";
}

export interface KafCounts {
  total: number;
  answered: number;
  /** Items the learner marked "Richtig" (only answered items count). */
  right: number;
  /** Answered items without a decision yet. */
  undecided: number;
  /** Percent right of total, rounded to a whole number. */
  pct: number;
}

/** Self-marked result counts. An unanswered item is never right. */
export function kafResultCounts(
  items: readonly Pick<KafItem, "id" | "required">[],
  answers: Readonly<Record<string, readonly string[] | undefined>>,
  marks: Readonly<Record<string, boolean | undefined>>,
): KafCounts {
  let answered = 0;
  let right = 0;
  let undecided = 0;
  for (const item of items) {
    const key = String(item.id);
    if (cleanTyped(answers[key] as string[] | undefined, item.required).length === 0) continue;
    answered += 1;
    if (marks[key] === true) right += 1;
    else if (marks[key] === undefined) undecided += 1;
  }
  const total = items.length;
  return { total, answered, right, undecided, pct: total > 0 ? Math.round((right / total) * 100) : 0 };
}

/** History POST body for a self-marked KAF run (config.kind "kaf"). */
export function kafHistoryBody(input: {
  attemptId: string;
  title: string;
  items: readonly Pick<KafItem, "id" | "required">[];
  answers: Readonly<Record<string, readonly string[] | undefined>>;
  marks: Readonly<Record<string, boolean | undefined>>;
  startedAt: number;
  finishedAt: number;
  durationS: number;
  timeExpired: boolean;
}) {
  const answers: Record<string, string[]> = {};
  const selfMarks: Record<string, true> = {};
  for (const item of input.items) {
    const key = String(item.id);
    const typed = cleanTyped(input.answers[key] as string[] | undefined, item.required);
    if (typed.length === 0) continue;
    answers[key] = typed;
    if (input.marks[key] === true) selfMarks[key] = true;
  }
  return {
    exam_type: "kenntnispruefung",
    title: input.title,
    attempt_id: input.attemptId,
    config: { kind: "kaf", presetId: "kaf_timed", durationS: input.durationS, count: input.items.length, timeExpired: input.timeExpired },
    question_ids: input.items.map((i) => i.id),
    answers,
    self_marks: selfMarks,
    duration_ms: Math.max(0, input.finishedAt - input.startedAt),
    started_at: new Date(input.startedAt).toISOString(),
  };
}

// ── Local session (own keys; never the /exam autosave or its pending outbox,
//    which /exam would resume as a multiple-choice run). ──

export type KafPhase = "running" | "marking" | "result";

export interface KafSession {
  v: 1;
  attemptId: string;
  startedAt: number;
  durationS: number;
  finishedAt: number | null;
  timeExpired: boolean;
  phase: KafPhase;
  items: KafItem[];
  /** question id -> typed answers (one per required slot, may contain empty strings while running). */
  answers: Record<string, string[]>;
  /** question id -> the learner's own decision. */
  marks: Record<string, boolean>;
  /** question id -> answer key, present once fetched after submit. */
  keys: Record<string, KafKey> | null;
  currentIdx: number;
  savedAt: number;
}

export function kafSessionKey(userId: string): string | null {
  const id = userId.trim();
  return id ? `medpruef_kaf_session:v1:${encodeURIComponent(id)}` : null;
}

export function kafPendingKey(userId: string): string | null {
  const id = userId.trim();
  return id ? `medpruef_kaf_pending:v1:${encodeURIComponent(id)}` : null;
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

function isItem(v: unknown): v is KafItem {
  if (!v || typeof v !== "object") return false;
  const o = v as Record<string, unknown>;
  return Number.isInteger(o.id) && (o.id as number) > 0 && typeof o.stem === "string" && typeof o.topic === "string"
    && (o.image_url === null || typeof o.image_url === "string") && clampRequired(o.required) === o.required;
}

/** Parse a stored session; anything incompatible is discarded (null). */
export function parseKafSession(raw: string | null): KafSession | null {
  if (!raw) return null;
  try {
    const s = JSON.parse(raw) as KafSession;
    if (!s || s.v !== 1 || typeof s.attemptId !== "string" || !UUID.test(s.attemptId)) return null;
    if (typeof s.startedAt !== "number" || !Number.isFinite(s.startedAt)) return null;
    if (typeof s.durationS !== "number" || s.durationS <= 0 || s.durationS > 8 * 3600) return null;
    if (!Array.isArray(s.items) || s.items.length === 0 || !s.items.every(isItem)) return null;
    if (!["running", "marking", "result"].includes(s.phase)) return null;
    if (!s.answers || typeof s.answers !== "object" || Array.isArray(s.answers)) return null;
    return {
      ...s,
      marks: s.marks && typeof s.marks === "object" && !Array.isArray(s.marks) ? s.marks : {},
      keys: s.keys && typeof s.keys === "object" && !Array.isArray(s.keys) ? s.keys : null,
      finishedAt: typeof s.finishedAt === "number" ? s.finishedAt : null,
      timeExpired: s.timeExpired === true,
      currentIdx: Math.min(Math.max(0, Number(s.currentIdx) || 0), s.items.length - 1),
    };
  } catch {
    return null;
  }
}

/** Parse the answer-key map the answers route returns; unknown ids and bad shapes are dropped. */
export function parseKafKeys(raw: unknown, ids: readonly number[]): Record<string, KafKey> {
  const out: Record<string, KafKey> = {};
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return out;
  const wanted = new Set(ids.map(String));
  for (const [k, v] of Object.entries(raw as Record<string, unknown>)) {
    if (!wanted.has(k) || !v || typeof v !== "object") continue;
    const o = v as Record<string, unknown>;
    const accepted = Array.isArray(o.accepted)
      ? o.accepted.filter(Array.isArray).map((alts) => (alts as unknown[]).filter((s): s is string => typeof s === "string" && s.trim() !== ""))
          .filter((alts) => alts.length > 0)
      : [];
    if (accepted.length === 0 || typeof o.model_answer !== "string") continue;
    const keyPoints = Array.isArray(o.key_points) ? o.key_points.filter((s): s is string => typeof s === "string" && s.trim() !== "") : [];
    out[k] = { accepted, model_answer: o.model_answer, key_points: keyPoints };
  }
  return out;
}

/** HH:MM:SS for the running clock. */
export function formatClock(seconds: number): string {
  const s = Math.max(0, Math.floor(seconds));
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  return `${String(h).padStart(2, "0")}:${String(m).padStart(2, "0")}:${String(s % 60).padStart(2, "0")}`;
}
