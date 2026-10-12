// Server loader for the "Heute fällig" rows (LX-06-R). One owner for the
// due-summary route and the study nudge (a30), so the mail states the same N
// as Home. PostgREST caps every select at 1000 rows, so the progress read is
// paged with an ORDER BY and the question filter is chunked.
import type { getServiceClient } from "@/lib/supabase";
import type { DueRow } from "./due-summary";

type Db = ReturnType<typeof getServiceClient>;
const LOOKAHEAD_DAYS = 8;
const PAGE = 1000;
const MAX_PAGES = 10;
const ID_CHUNK = 200;

export class DueRowsReadError extends Error {
  constructor(readonly stage: "reviews" | "questions") {
    super(stage === "reviews" ? "Failed to load reviews" : "Failed to load questions");
  }
}

/** Own scheduled rows within the look-ahead, limited to active questions of one bank. */
export async function loadDueRows(sb: Db, userId: string, exam: string, now: Date = new Date()): Promise<DueRow[]> {
  const horizon = new Date(now.getTime() + LOOKAHEAD_DAYS * 86_400_000).toISOString();
  const progress: { question_id: number; next_review_at: string | null; ease_factor: number | null }[] = [];
  for (let page = 0; page < MAX_PAGES; page++) {
    const { data, error } = await sb
      .from("user_question_progress")
      .select("question_id, next_review_at, ease_factor")
      .eq("user_id", userId)
      .not("next_review_at", "is", null)
      .lte("next_review_at", horizon)
      .order("question_id", { ascending: true })
      .range(page * PAGE, page * PAGE + PAGE - 1);
    if (error) throw new DueRowsReadError("reviews");
    progress.push(...(data ?? []));
    if ((data ?? []).length < PAGE) break;
  }

  const ids = progress.map((r) => r.question_id);
  const active = new Set<number>();
  for (let i = 0; i < ids.length; i += ID_CHUNK) {
    const { data: qs, error } = await sb
      .from("questions")
      .select("id")
      .in("id", ids.slice(i, i + ID_CHUNK))
      .eq("exam_type", exam)
      .eq("is_active", true);
    if (error) throw new DueRowsReadError("questions");
    for (const q of qs ?? []) active.add(q.id as number);
  }

  return progress
    .filter((r) => active.has(r.question_id))
    .map((r) => ({ questionId: r.question_id, nextReviewAt: r.next_review_at, ease: r.ease_factor }));
}
