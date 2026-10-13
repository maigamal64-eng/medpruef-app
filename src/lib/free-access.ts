/**
 * Server-side free-quota enforcement for EVERY route that serves question
 * content (2026-10-02 paywall hardening, [name]'s explicit ask).
 *
 * The free allowance (SoT §2 "Free tier"): 150 questions per exam type,
 * drawn from the deterministic free slice (`getFreeSliceIds`), counted
 * durably from answer_history. `/api/questions` already enforced it; these
 * side doors did not and served question content for ANY id:
 *   - GET  /api/ai-chat        (cached AI explanation, open even to anon)
 *   - GET/POST /api/translate  (translated stem / explanation)
 *   - POST /api/history/exams  (returned the correct option texts)
 *   - POST /api/notes/transform (note built from the full question)
 *   - POST /api/answer          (a blind answer on an unseen slice id made
 *                                it "answered" and therefore readable)
 *
 * The rule a free (or lapsed / expired / declined-trial) user gets is the
 * free-set access rule in src/lib/free-set.ts (a-free-set, 2026-10-12):
 * readable = the 150-question free set of the exam type, plus a question of
 * the old free slice only if the user has already answered it; once the learner has
 * answered 150 distinct free questions (old or new set) in that exam type,
 * only answered free questions stay readable. Guests (no user id) get the
 * new set only. Unknown or inactive ids are always denied.
 */
import type { SupabaseClient } from "@supabase/supabase-js";
import { DbUnavailableError, isDbUnavailable } from "@/lib/db-unavailable";
import { captureServerError } from "@/lib/sentry-capture";
import { FREE_TIER_QUESTIONS_PER_EXAM, loadFreeAccess } from "@/lib/free-tier";
import { freeUniverseIds } from "@/lib/free-set";

export interface FreeAccessResult {
  /** Requested ids the caller may read. */
  allowed: Set<number>;
  /** Requested ids that are outside the free allowance. */
  denied: number[];
  /** Exam types in which the caller is at/over the cap. */
  cappedExams: string[];
}

/**
 * Filter `questionIds` down to what a FREE caller may read. Callers must only
 * invoke this for non-paid access (paid/admin bypass happens upstream).
 * Fails CLOSED: unknown/inactive ids are denied.
 *
 * An unavailable database (timeout, network, 57014) THROWS a
 * DbUnavailableError instead (a-db-relief-1, skeptic HIGH): a denial during
 * a brownout turned a free learner's answer into a 402, which the quiz and
 * the device outbox treat as final (the answer was dropped and the paywall
 * opened). Callers map it to 503 + Retry-After (`dbUnavailableResponse`).
 * Any other failed read throws a plain Error (callers answer 500): a denial
 * is returned only after reads that succeeded and prove it (a-fo-01).
 */
export async function filterFreeAccessibleQuestions(
  sb: SupabaseClient,
  userId: string | null,
  questionIds: number[]
): Promise<FreeAccessResult> {
  const ids = Array.from(new Set(questionIds.filter((n) => Number.isInteger(n) && n > 0)));
  const allowed = new Set<number>();
  const cappedExams: string[] = [];
  if (ids.length === 0) return { allowed, denied: [], cappedExams };

  const { data, error } = await sb
    .from("questions")
    .select("id, exam_type")
    .in("id", ids)
    .eq("is_active", true);
  if (error) throw readFailure(error, "questions");

  const byExam = new Map<string, number[]>();
  for (const row of (data ?? []) as Array<{ id: number; exam_type: string | null }>) {
    const exam = row.exam_type ?? "";
    if (!exam) continue;
    const list = byExam.get(exam) ?? [];
    list.push(row.id);
    byExam.set(exam, list);
  }

  for (const [exam, examIds] of byExam) {
    // Nothing requested inside the free universe: no history read needed.
    const universe = new Set(freeUniverseIds(exam));
    if (!examIds.some((id) => universe.has(id))) continue;
    let access: Awaited<ReturnType<typeof loadFreeAccess>>;
    try {
      // strict: a failed history read throws instead of reading as "nothing
      // answered", which would deny an answered legacy question.
      access = await loadFreeAccess(sb, userId, exam, { strict: true });
    } catch (err) {
      throw readFailure(err, "answer_history");
    }
    if (access.capped) cappedExams.push(exam);
    const readable = new Set(access.readable);
    examIds.filter((id) => readable.has(id)).forEach((id) => allowed.add(id));
  }

  return { allowed, denied: ids.filter((id) => !allowed.has(id)), cappedExams };
}

/** Unavailable database: DbUnavailableError (503). Anything else: a plain Error (500), never a denial. */
function readFailure(err: unknown, read: string): Error {
  if (isDbUnavailable(err)) return asDbUnavailable(err);
  if (err instanceof Error) return err;
  return new Error(`Free access ${read} read failed`, { cause: err });
}

/** A thrown DbUnavailableError for any unavailable-database shape (PostgREST error objects included). */
export function asDbUnavailable(err: unknown): DbUnavailableError {
  if (err instanceof DbUnavailableError) return err;
  const reason = (err as { reason?: unknown } | null)?.reason === "network" ? "network" : "timeout";
  const message = (err as { message?: unknown } | null)?.message;
  return new DbUnavailableError(reason, typeof message === "string" ? message : "Database unavailable", { cause: err });
}

/** Convenience: may a FREE caller read this single question? (Throws DbUnavailableError, see above.) */
export async function canFreeUserReadQuestion(
  sb: SupabaseClient,
  userId: string | null,
  questionId: number
): Promise<boolean> {
  const r = await filterFreeAccessibleQuestions(sb, userId, [questionId]);
  return r.allowed.has(questionId);
}

// ── Paywall server event (UX-GLOBAL-32) ─────────────────────────────
// One `paywall_hit` user_event {gate, exam, surface, trigger} per (user,
// gate, exam) per hour per server instance, written here because page_view
// strips the query. The admin Overview tile and the daily digest read this
// name. Best-effort, never throws.
const CAP_HIT_THROTTLE_MS = 60 * 60 * 1000;
const capHitSeen = new Map<string, number>();

export async function logFreeCapHit(
  sb: SupabaseClient,
  args: {
    userId: string | null;
    gate: string;
    route: string;
    examType?: string | null;
    seen?: number | null;
    questionId?: number | null;
    /** Learner surface that triggered the request (quiz, flashcards, exam...). */
    surface?: string | null;
    /** What tripped the gate: quota, practice_mode, feature. */
    trigger?: string | null;
  }
): Promise<void> {
  if (!args.userId) return;
  const key = `${args.userId}|${args.gate}|${args.examType ?? ""}`;
  const now = Date.now();
  const last = capHitSeen.get(key);
  if (last && now - last < CAP_HIT_THROTTLE_MS) return;
  capHitSeen.set(key, now);
  if (capHitSeen.size > 5000) capHitSeen.clear();
  // a-db-timeouts: PostgREST reports a failed insert in `error`, it does not
  // throw, so the old try/catch dropped failures silently and the throttle
  // then suppressed the event for an hour. Read the error and release the
  // throttle so the next wall hit writes the event.
  const release = () => {
    if (capHitSeen.get(key) === now) {
      if (last === undefined) capHitSeen.delete(key);
      else capHitSeen.set(key, last);
    }
  };
  try {
    const { error } = await sb.from("user_events").insert({
      user_id: args.userId,
      event_type: "paywall_hit",
      event_data: {
        gate: args.gate,
        exam: args.examType ?? null,
        surface: args.surface ?? args.route.replace(/^\/api\//, ""),
        trigger: args.trigger ?? (args.gate === "qbank_limit" ? "quota" : "feature"),
        route: args.route,
        exam_type: args.examType ?? null,
        seen: args.seen ?? null,
        limit: FREE_TIER_QUESTIONS_PER_EXAM,
        question_id: args.questionId ?? null,
      },
    });
    if (error) {
      release();
      console.error("[free-access] paywall_hit not stored", { code: error.code, message: error.message, gate: args.gate, route: args.route });
      if (!isDbUnavailable(error)) captureServerError(error, { route: args.route, phase: "paywall_hit-insert", gate: args.gate });
    }
  } catch (err) {
    release();
    console.error("[free-access] cap-hit log failed", err);
  }
}

/** Test hook: reset the per-instance throttle. */
export function __resetCapHitThrottle(): void {
  capHitSeen.clear();
}
