import { NextRequest, NextResponse } from "next/server";
import { getServiceClient } from "@/lib/supabase";
import { requireUser } from "@/lib/auth-guard";

export const dynamic = "force-dynamic";

/**
 * GET /api/user/topic-strength?examType=<kenntnispruefung|kmp_innsbruck|pharma>
 *
 * Returns the authenticated user's per-topic accuracy rows from
 * `user_topic_strength` — the server-side source of truth that replaces
 * the legacy localStorage `medpruef_quiz_results` store.
 *
 * Response shape:
 *   {
 *     strengths: [
 *       {
 *         examType: string,
 *         topic: string,
 *         answered: number,
 *         correct: number,
 *         accuracy: number,   // 0..100, rounded
 *         lastAnsweredAt: string   // ISO
 *       },
 *       ...
 *     ]
 *   }
 *
 * Sorted by `lastAnsweredAt` desc so the client can lazily show the
 * most recently touched topics first.
 *
 * Why this exists (backlog #13, 2026-04-21):
 *   Previously `src/lib/weakness.ts` read and wrote per-topic accuracy
 *   to localStorage. Users on multiple devices (web + mobile PWA) saw
 *   different "weak topics" and different Study Plans. This endpoint
 *   moves the source of truth to Supabase so every device sees the
 *   same weakness signal.
 *
 * Auth: `requireUser` — userId comes from the session header, never
 * from the query string. The request does NOT expose any way to read
 * another user's rows.
 */
export async function GET(req: NextRequest) {
  const guard = await requireUser(req);
  if ("error" in guard) return guard.error;
  const userId = guard.userId;

  try {
    const sp = req.nextUrl.searchParams;
    const examType = sp.get("examType");

    const sb = getServiceClient();

    let q = sb
      .from("user_topic_strength")
      .select("exam_type, topic, answered, correct, last_answered_at")
      .eq("user_id", userId)
      .order("last_answered_at", { ascending: false })
      .limit(500);

    if (examType) {
      q = q.eq("exam_type", examType);
    }

    const { data, error } = await q;
    if (error) {
      console.error("[topic-strength GET]", error);
      return NextResponse.json(
        { error: "Failed to load topic strengths" },
        { status: 500 }
      );
    }

    const strengths = (data || []).map(row => {
      const answered = Number(row.answered) || 0;
      const correct = Number(row.correct) || 0;
      return {
        examType: row.exam_type as string,
        topic: row.topic as string,
        answered,
        correct,
        accuracy: answered > 0 ? Math.round((correct / answered) * 100) : 0,
        lastAnsweredAt: row.last_answered_at as string,
      };
    });

    return NextResponse.json({ strengths });
  } catch (err) {
    console.error("[topic-strength GET]", err);
    return NextResponse.json({ error: "Internal error" }, { status: 500 });
  }
}
