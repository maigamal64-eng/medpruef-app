import { NextResponse } from "next/server";
import { getServiceClient } from "@/lib/supabase";
import { adminRouteShell } from "@/lib/admin/shell";
import { canAccessAdminPermission, loadAdminPermissionSnapshot } from "@/lib/admin/permissions";
import { adminErrorResponse } from "@/lib/admin/error-response";

export const dynamic = "force-dynamic";
export const maxDuration = 30;

const MISSING = ["42P01", "PGRST205", "PGRST200"];

/**
 * GET /api/stats/admin/explanations/downvoted (a15, TR-13)
 *
 * Questions whose explanation has 2 or more down-votes in the one-vote
 * ledger (explanation_downvoted_questions view, b18). Learner identities are
 * never read; only per-question counts. Before the ledger migration is
 * applied the route answers measured:false instead of an empty success.
 * The coverage metric (rated items / items answered in the month) is
 * deferred per pick-rating-denominator (release: later).
 */
export const GET = adminRouteShell(async ({ actor }) => {
  if (!canAccessAdminPermission(await loadAdminPermissionSnapshot(actor.userId), "content.read")) {
    return NextResponse.json({ error: "Your admin role cannot read content." }, { status: 403 });
  }
  const db = getServiceClient();
  const { data, error } = await db
    .from("explanation_downvoted_questions")
    .select("question_id, down_votes, votes, rating_sum")
    .order("down_votes", { ascending: false })
    .limit(100);
  if (error && MISSING.includes(String(error.code))) {
    return NextResponse.json({ measured: false, items: [] });
  }
  if (error) return adminErrorResponse(error, "/api/stats/admin/explanations/downvoted");
  const rows = (data ?? []) as Array<{ question_id: number; down_votes: number; votes: number; rating_sum: number }>;
  const ids = rows.map((r) => r.question_id);
  const questions = ids.length
    ? await db.from("questions").select("id, topic, exam_type, question, is_active").in("id", ids)
    : { data: [], error: null };
  if (questions.error) return adminErrorResponse(questions.error, "/api/stats/admin/explanations/downvoted");
  const byId = new Map(((questions.data ?? []) as Array<{ id: number; topic: string | null; exam_type: string | null; question: string | null; is_active: boolean | null }>).map((q) => [q.id, q]));
  return NextResponse.json({
    measured: true,
    items: rows.map((r) => {
      const q = byId.get(r.question_id);
      return {
        question_id: r.question_id,
        down_votes: Number(r.down_votes),
        votes: Number(r.votes),
        rating_sum: Number(r.rating_sum),
        topic: q?.topic ?? null,
        exam_type: q?.exam_type ?? null,
        is_active: q?.is_active ?? null,
        question: (q?.question ?? "").slice(0, 160),
      };
    }),
  });
}, { route: "/api/stats/admin/explanations/downvoted" });
