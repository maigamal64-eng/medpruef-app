/**
 * Pure helpers for POST /api/history/exams (a24). Server-only by usage, no
 * imports from the database client so they stay unit-testable.
 */

/** Hard cap for any stored duration: eight hours. */
export const MAX_EXAM_DURATION_MS = 8 * 3600_000;
/** Legacy runs without a stored clock used the four-hour practice timer. */
export const LEGACY_DURATION_S = 4 * 3600;
/** Grace for a submit that lands just after the deadline. */
const DEADLINE_GRACE_MS = 60_000;

export interface SanitizedConfig {
  kind: "mcq" | "kaf";
  part: string | null;
  presetId: string | null;
  passRuleId: string | null;
  ruleStatus: string | null;
  subjects: string[];
  owed: string[];
  count: number | null;
  durationS: number | null;
  untimed: boolean;
  timeExpired: boolean;
  flagged_ids: number[];
}

const SHORT = /^[a-z0-9_-]{1,40}$/i;

function shortString(v: unknown): string | null {
  return typeof v === "string" && SHORT.test(v) ? v : null;
}

function stringList(v: unknown, max: number): string[] {
  if (!Array.isArray(v)) return [];
  return v.filter((s): s is string => typeof s === "string" && s.trim().length > 0).map((s) => s.trim().slice(0, 80)).slice(0, max);
}

function intList(v: unknown, max: number): number[] {
  if (!Array.isArray(v)) return [];
  return [...new Set(v.map(Number).filter((n) => Number.isInteger(n) && n > 0 && n <= 10_000_000))].slice(0, max);
}

/** Whitelist the client config: only known keys with bounded values are stored. */
export function sanitizeExamConfig(raw: unknown, questionIds: readonly number[]): SanitizedConfig {
  const c = raw && typeof raw === "object" && !Array.isArray(raw) ? (raw as Record<string, unknown>) : {};
  const ids = new Set(questionIds);
  const durationS = typeof c.durationS === "number" && Number.isFinite(c.durationS)
    ? Math.min(Math.max(0, Math.round(c.durationS)), MAX_EXAM_DURATION_MS / 1000)
    : null;
  return {
    kind: c.kind === "kaf" ? "kaf" : "mcq",
    part: shortString(c.part),
    presetId: shortString(c.presetId),
    passRuleId: shortString(c.passRuleId),
    ruleStatus: shortString(c.ruleStatus),
    subjects: stringList(c.subjects, 20),
    owed: stringList(c.owed, 20),
    count: typeof c.count === "number" && Number.isInteger(c.count) && c.count >= 0 ? Math.min(c.count, 400) : null,
    durationS,
    untimed: c.untimed === true,
    timeExpired: c.timeExpired === true,
    flagged_ids: intList(c.flagged_ids, 400).filter((id) => ids.has(id)),
  };
}

/**
 * Clamp the reported working time to the run's own clock (UX-EXM-17: a run
 * keeps the duration it started with). Untimed custom runs keep the hard cap.
 */
export function clampDurationMs(raw: unknown, config: Pick<SanitizedConfig, "durationS" | "untimed">): number | null {
  if (typeof raw !== "number" || !Number.isFinite(raw)) return null;
  const clock = config.untimed ? MAX_EXAM_DURATION_MS : Math.min(MAX_EXAM_DURATION_MS, (config.durationS || LEGACY_DURATION_S) * 1000 + DEADLINE_GRACE_MS);
  return Math.min(Math.max(0, Math.round(raw)), clock);
}

/** KAF answers: up to three typed answers per item, each at most 300 characters. */
export function parseKafAnswers(raw: unknown, questionIds: readonly number[]): Record<string, string[]> {
  const ids = new Set(questionIds);
  const out: Record<string, string[]> = {};
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return out;
  for (const [k, v] of Object.entries(raw as Record<string, unknown>)) {
    const qid = Number(k);
    if (!ids.has(qid) || !Array.isArray(v)) continue;
    const texts = v.map((x) => (typeof x === "string" ? x.trim().slice(0, 300) : "")).filter(Boolean).slice(0, 3);
    if (texts.length > 0) out[String(qid)] = texts;
  }
  return out;
}

/** Self marks count only for answered items (an empty answer is never right). */
export function parseSelfMarks(raw: unknown, answers: Record<string, string[]>): Record<string, boolean> {
  const out: Record<string, boolean> = {};
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return out;
  for (const [k, v] of Object.entries(raw as Record<string, unknown>)) {
    if (v === true && answers[k]?.length) out[k] = true;
  }
  return out;
}

/** Accepted answers stored per KAF item: one list of alternatives per required answer. */
export function parseAccepted(raw: unknown): string[][] {
  if (!Array.isArray(raw)) return [];
  return raw
    .filter((alts): alts is unknown[] => Array.isArray(alts))
    .map((alts) => alts.filter((s): s is string => typeof s === "string" && s.trim().length > 0).map((s) => s.trim()))
    .filter((alts) => alts.length > 0);
}
