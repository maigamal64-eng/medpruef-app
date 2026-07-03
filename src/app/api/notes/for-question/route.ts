import { NextRequest, NextResponse } from "next/server";
import { getServiceClient } from "@/lib/supabase";
import { requireUser } from "@/lib/auth-guard";

export const dynamic = "force-dynamic";

const EXPLORE_ENABLED =
  (process.env.NOTES_EXPLORE_ENABLED ?? "false").toLowerCase() === "true";

/**
 * GET /api/notes/for-question?question_id=N — public (community + curated)
 * flash-notes linked to one question via source_ref.question_id (2026-07-03).
 *
 * Powers the "Notizen zu dieser Frage" section on the quiz page. Same flag +
 * privacy posture as /api/notes/explore: gated by NOTES_EXPLORE_ENABLED and
 * returns the anonymous projection only (no user_id, no metadata beyond the
 * curated marker). Backed by the notes_qref_idx partial index.
 */
const PUBLIC_COLUMNS = "id, title, content, tags, exam_type, topic, published_at, metadata";

export async function GET(req: NextRequest) {
  const guard = await requireUser(req);
  if ("error" in guard) return guard.error;

  if (!EXPLORE_ENABLED) {
    return NextResponse.json({ enabled: false, notes: [] });
  }

  const qid = Number(req.nextUrl.searchParams.get("question_id"));
  if (!Number.isInteger(qid) || qid <= 0) {
    return NextResponse.json({ error: "Invalid question_id" }, { status: 400 });
  }

  try {
    const sb = getServiceClient();
    const { data, error } = await sb
      .from("notes")
      .select(PUBLIC_COLUMNS)
      .eq("visibility", "public")
      .eq("is_active", true)
      .eq("source_ref->>question_id", String(qid))
      .order("published_at", { ascending: false })
      .limit(5);
    if (error) {
      console.error("[notes/for-question]", error);
      return NextResponse.json({ error: "Failed to load notes" }, { status: 500 });
    }
    return NextResponse.json({
      enabled: true,
      notes: (data ?? []).map((n) => ({
        id: n.id,
        title: n.title,
        content: n.content,
        tags: n.tags,
        curated: Boolean((n.metadata as Record<string, unknown> | null)?.curated),
      })),
    });
  } catch {
    return NextResponse.json({ error: "Failed to load notes" }, { status: 500 });
  }
}
