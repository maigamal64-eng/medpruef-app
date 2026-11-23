/**
 * Open-answer self-grade (a-open-answer-fix-1123, behind
 * OPEN_ANSWER_SELF_GRADE_ENABLED). A question without choices has no key to
 * grade against, so after "Antwort anzeigen" the learner says whether they knew
 * it. The tap is recorded through /api/answer like any quiz answer: isCorrect
 * from the tap, userAnswer "self:known" or "self:unknown". A reveal with no
 * tap is never sent (27 Sep decision). Pure apart from the injected deps.
 */
import { t, type Lang } from "@/lib/i18n";

export const SELF_GRADE_KNOWN = "self:known";
export const SELF_GRADE_UNKNOWN = "self:unknown";

export function selfGradeAnswer(known: boolean): string {
  return known ? SELF_GRADE_KNOWN : SELF_GRADE_UNKNOWN;
}

/** Readable text for a stored self-grade (history), null for any other answer. */
export function selfGradeLabel(userAnswer: string | null | undefined, lang: Lang): string | null {
  if (userAnswer === SELF_GRADE_KNOWN) return t("a_open_self_hist_known", lang);
  if (userAnswer === SELF_GRADE_UNKNOWN) return t("a_open_self_hist_unknown", lang);
  return null;
}

export interface SelfGradeArgs {
  userId: string | null | undefined;
  requestId: string;
  questionId: number;
  known: boolean;
  timeSpentMs: number;
  /** Fingerprint of the key as delivered; an open-answer question has no options. */
  keyFingerprint: string;
}

export interface SelfGradeDeps {
  online: boolean;
  post: (body: Record<string, unknown>) => Promise<{ status: number; ok: boolean; json: () => Promise<unknown> }>;
  queue: (row: { id: string; userId: string; questionId: number; userAnswer: string; isCorrect: boolean; timeSpentMs: number; keyFingerprint: string }) => Promise<unknown>;
  isRetryable: (status: number | null) => boolean;
}

export type SelfGradeOutcome =
  | { state: "saved"; xp: number; gamification: Record<string, unknown> | null; review: { intervalDays?: number } | null }
  | { state: "queued"; serverQueued: boolean }
  | { state: "paywall"; limit?: number }
  | { state: "refused" }
  | { state: "failed" };

/** The exact /api/answer body of a normal answer, with the self-grade answer text. */
export function selfGradeBody(a: SelfGradeArgs): Record<string, unknown> {
  return {
    userId: a.userId,
    requestId: a.requestId,
    questionId: a.questionId,
    isCorrect: a.known,
    userAnswer: selfGradeAnswer(a.known),
    timeSpentMs: a.timeSpentMs,
    keyFingerprint: a.keyFingerprint,
  };
}

export async function submitSelfGrade(a: SelfGradeArgs, deps: SelfGradeDeps): Promise<SelfGradeOutcome> {
  const row = a.userId
    ? { id: a.requestId, userId: a.userId, questionId: a.questionId, userAnswer: selfGradeAnswer(a.known), isCorrect: a.known, timeSpentMs: a.timeSpentMs, keyFingerprint: a.keyFingerprint }
    : null;
  const queue = async (serverQueued: boolean): Promise<SelfGradeOutcome> => {
    if (!row) return { state: "failed" };
    try { await deps.queue(row); return { state: "queued", serverQueued }; } catch { return { state: "failed" }; }
  };
  if (!deps.online) return queue(false);
  let res: Awaited<ReturnType<SelfGradeDeps["post"]>>;
  try {
    res = await deps.post(selfGradeBody(a));
  } catch {
    return deps.isRetryable(null) ? queue(true) : { state: "failed" };
  }
  if (res.status === 402) {
    const rejection = (await res.json().catch(() => ({}))) as { limit?: unknown };
    return { state: "paywall", limit: typeof rejection?.limit === "number" ? rejection.limit : undefined };
  }
  if (res.status === 404 || res.status === 409) return { state: "refused" };
  if (res.status === 401 || res.status >= 500) return queue(res.status >= 500);
  if (!res.ok) return { state: "failed" };
  const data = (await res.json().catch(() => null)) as { saved?: boolean; xp?: number; gamification?: Record<string, unknown> | null; review?: { intervalDays?: number } | null } | null;
  if (data?.saved !== true) return { state: "failed" };
  return { state: "saved", xp: typeof data.xp === "number" ? data.xp : 0, gamification: data.gamification ?? null, review: data.review ?? null };
}
