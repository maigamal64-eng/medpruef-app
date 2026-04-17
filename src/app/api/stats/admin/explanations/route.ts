import { NextRequest, NextResponse } from "next/server";
import { getServiceClient } from "@/lib/supabase";
import { requireAdmin } from "@/lib/auth-guard";

export const dynamic = "force-dynamic";

/**
 * GET /api/stats/admin/explanations
 *
 * Returns the worst-rated AI explanations so [name] can review and
 * regenerate or delete them. Source: questions.explanation_rating_sum /
 * explanation_rating_count which are incremented by /api/explanation-rating.
 *
 * Filters: only active questions with at least minRatings total ratings.
 * Sort: most-negative score first (rating_sum ASC).
 *
 * Query params:
 *   limit (max 100, default 20)
 *   minRatings (default 3)
 */
export async function GET(req: NextRequest) {
  const guard = await requireAdmin(req);
  if ("error" in guard) return guard.error;

  const url = new URL(req.url);
  const limit = Math.min(
    Math.max(1, parseInt(url.searchParams.get("limit") || "20", 10) || 20),
    100,
  );
  const minRatings = Math.max(
    1,
    parseInt(url.searchParams.get("minRatings") || "3", 10) || 3,
  );

  const db = getServiceClient();
  const { data, error } = await db
    .from("questions")
    .select(
      "id, topic, exam_type, ai_explanation, ai_explanation_generated_at, explanation_rating_sum, explanation_rating_count"
    )
    .eq("is_active", true)
    .gte("explanation_rating_count", minRatings)
    .order("explanation_rating_sum", { ascending: true })
    .order("explanation_rating_count", { ascending: false })
    .limit(limit);

  if (error) {
    console.error("[admin/explanations]", error);
    return NextResponse.json(
      { error: "Failed to load explanations" },
      { status: 500 },
    );
  }

  const rows = (data || []).map((q) => ({
    question_id: q.id as number,
    topic: (q.topic as string) || "",
    exam_type: (q.exam_type as string) || "",
    ai_explanation_snippet: ((q.ai_explanation as string) || "").slice(0, 300),
    rating_sum: (q.explanation_rating_sum as number) || 0,
    rating_count: (q.explanation_rating_count as number) || 0,
    score:
      q.explanation_rating_count && (q.explanation_rating_count as number) > 0
        ? Math.round(
            ((q.explanation_rating_sum as number) /
              (q.explanation_rating_count as number)) *
              100,
          ) / 100
        : 0,
    generated_at: q.ai_explanation_generated_at as string | null,
  }));

  return NextResponse.json({ explanations: rows });
}
