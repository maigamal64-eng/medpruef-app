import { NextRequest, NextResponse } from "next/server";
import { getServiceClient } from "@/lib/supabase";
import { requireAdmin } from "@/lib/auth-guard";
import { logAdminAction, resolveActorEmail } from "@/lib/admin/audit";

export const dynamic = "force-dynamic";

// GET — Stats overview OR paginated browse
export async function GET(req: NextRequest) {
  const guard = await requireAdmin(req);
  if ("error" in guard) return guard.error;
  try {
    const db = getServiceClient();
    const url = new URL(req.url);
    const mode = url.searchParams.get("mode"); // "browse" for paginated list

    if (mode === "browse") {
      return handleBrowse(db, url);
    }

    // Default: stats overview
    const [totalRes, mcqRes, explRes, imgRes, activeRes, inactiveRes, topicRes] =
      await Promise.all([
        db.from("questions").select("id", { count: "exact", head: true }),
        db.from("questions").select("id", { count: "exact", head: true }).eq("is_active", true).not("choices", "is", null),
        db.from("questions").select("id", { count: "exact", head: true }).eq("is_active", true).not("explanation", "is", null).neq("explanation", ""),
        db.from("questions").select("id", { count: "exact", head: true }).eq("is_active", true).not("image_url", "is", null),
        db.from("questions").select("id", { count: "exact", head: true }).eq("is_active", true),
        db.from("questions").select("id", { count: "exact", head: true }).eq("is_active", false),
        db.from("questions").select("topic").eq("is_active", true),
      ]);

    const topicCounts: Record<string, number> = {};
    for (const row of topicRes.data || []) {
      const topic = (row.topic as string) || "Unknown";
      topicCounts[topic] = (topicCounts[topic] || 0) + 1;
    }
    const byTopic = Object.entries(topicCounts)
      .map(([topic, count]) => ({ topic, count }))
      .sort((a, b) => b.count - a.count);

    return NextResponse.json({
      totalAll: totalRes.count || 0,
      active: activeRes.count || 0,
      inactive: inactiveRes.count || 0,
      withMCQ: mcqRes.count || 0,
      withExplanations: explRes.count || 0,
      withImages: imgRes.count || 0,
      mcqPct: activeRes.count ? Math.round(((mcqRes.count || 0) / activeRes.count) * 100) : 0,
      explPct: activeRes.count ? Math.round(((explRes.count || 0) / activeRes.count) * 100) : 0,
      imgPct: activeRes.count ? Math.round(((imgRes.count || 0) / activeRes.count) * 100) : 0,
      byTopic,
    });
  } catch (err) {
    console.error("[admin/questions GET]", err);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}

async function handleBrowse(db: ReturnType<typeof getServiceClient>, url: URL) {
  const page = parseInt(url.searchParams.get("page") || "1");
  const limit = Math.min(parseInt(url.searchParams.get("limit") || "25"), 100);
  const topic = url.searchParams.get("topic");
  const search = url.searchParams.get("search");
  const hasExplanation = url.searchParams.get("hasExplanation");
  const isActive = url.searchParams.get("isActive");
  const examType = url.searchParams.get("examType");
  const offset = (page - 1) * limit;

  let query = db
    .from("questions")
    .select("id, topic, question, answer, explanation, choices, image_url, exam_dates, tags, is_active, anki_note_id, exam_type, source_file, created_at", { count: "exact" })
    .order("id", { ascending: false })
    .range(offset, offset + limit - 1);

  if (examType) query = query.eq("exam_type", examType);
  if (topic) query = query.eq("topic", topic);
  if (search) query = query.ilike("question", `%${search}%`);
  if (hasExplanation === "true") query = query.not("explanation", "is", null).neq("explanation", "");
  if (hasExplanation === "false") query = query.or("explanation.is.null,explanation.eq.");
  if (isActive === "true") query = query.eq("is_active", true);
  if (isActive === "false") query = query.eq("is_active", false);

  const { data, count, error } = await query;
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  const questions = (data || []).map((q) => ({
    ...q,
    question_preview: (q.question || "").slice(0, 150) + ((q.question || "").length > 150 ? "..." : ""),
    choices_count: Array.isArray(q.choices) ? q.choices.length : 0,
    has_explanation: !!(q.explanation && q.explanation.length > 0),
    has_image: !!q.image_url,
  }));

  return NextResponse.json({
    questions,
    total: count || 0,
    page,
    limit,
    totalPages: Math.ceil((count || 0) / limit),
  });
}

// PATCH — Edit a question
export async function PATCH(req: NextRequest) {
  const guard = await requireAdmin(req);
  if ("error" in guard) return guard.error;
  try {
    const db = getServiceClient();
    const body = await req.json();
    const { questionId, updates } = body;

    if (!questionId) return NextResponse.json({ error: "questionId required" }, { status: 400 });

    const allowed = ["question", "answer", "explanation", "topic", "tags", "is_active", "difficulty"];
    const safeUpdates: Record<string, unknown> = {};
    for (const key of allowed) {
      if (updates[key] !== undefined) safeUpdates[key] = updates[key];
    }

    if (Object.keys(safeUpdates).length === 0) {
      return NextResponse.json({ error: "No valid fields to update" }, { status: 400 });
    }

    const { error } = await db.from("questions").update(safeUpdates).eq("id", questionId);
    if (error) return NextResponse.json({ error: error.message }, { status: 500 });

    const actorEmail = await resolveActorEmail(guard.userId);
    const isActivityToggle =
      typeof updates.is_active === "boolean" &&
      Object.keys(safeUpdates).length === 1;
    await logAdminAction({
      req,
      actorId: guard.userId,
      actorEmail,
      // question_id is an integer in the DB, so targetId goes to
      // payload.target_ref via the helper's UUID check.
      action: isActivityToggle
        ? updates.is_active
          ? "reactivate_question"
          : "deactivate_question"
        : "edit_question",
      targetType: "question",
      targetId: typeof questionId === "number" ? questionId : String(questionId),
      payload: {
        applied_fields: Object.keys(safeUpdates),
      },
    });

    return NextResponse.json({ ok: true });
  } catch (err) {
    console.error("[admin/questions PATCH]", err);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
