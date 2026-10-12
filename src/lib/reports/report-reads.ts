/**
 * Paged report reads (a19 review): PostgREST caps a response at 1000 rows,
 * so a single `.limit(10_000)` silently truncates. Pages by id and fails
 * closed when the read budget runs out, never returning a short count.
 */
import type { SupabaseClient } from "@supabase/supabase-js";
import { assertReadSucceeded } from "@/lib/admin/read-result";

const PAGE = 1000;
const MAX_PAGES = 20;

/** question_id of every report (any status) on the given questions. */
export async function readReportQuestionIds(db: SupabaseClient, questionIds: readonly number[]): Promise<Array<{ question_id: number | null }>> {
  const out: Array<{ question_id: number | null }> = [];
  for (let i = 0; i < questionIds.length; i += 200) {
    const chunk = questionIds.slice(i, i + 200);
    for (let page = 0; ; page++) {
      if (page >= MAX_PAGES) throw new Error("report count exceeded the read budget");
      const res = await db.from("question_suggestions").select("question_id").in("question_id", chunk).order("id", { ascending: true }).range(page * PAGE, page * PAGE + PAGE - 1);
      assertReadSucceeded(res);
      const rows = (res.data ?? []) as Array<{ question_id: number | null }>;
      out.push(...rows);
      if (rows.length < PAGE) break;
    }
  }
  return out;
}

/** Every pending report (id, question_id). */
export async function readPendingReports(db: SupabaseClient): Promise<Array<{ id: number; question_id: number | null }>> {
  const out: Array<{ id: number; question_id: number | null }> = [];
  for (let page = 0; ; page++) {
    if (page >= MAX_PAGES) throw new Error("pending reports exceeded the read budget");
    const res = await db.from("question_suggestions").select("id, question_id").eq("status", "pending").order("id", { ascending: true }).range(page * PAGE, page * PAGE + PAGE - 1);
    assertReadSucceeded(res);
    const rows = (res.data ?? []) as Array<{ id: number; question_id: number | null }>;
    out.push(...rows);
    if (rows.length < PAGE) return out;
  }
}
