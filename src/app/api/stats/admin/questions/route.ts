import { changedQuestionFields } from "@/lib/admin/question-edit";
import { assertReadSucceeded } from "@/lib/admin/read-result";
import { adminErrorResponse } from "@/lib/admin/error-response";
import { NextResponse } from "next/server";
import { getServiceClient } from "@/lib/supabase";
import { adminRouteShell } from "@/lib/admin/shell";
import { logAdminAction } from "@/lib/admin/audit";

export const dynamic = "force-dynamic";

// GET — Stats overview OR paginated browse
export const GET = adminRouteShell(async ({ req }) => {
  try {
    const db = getServiceClient();
    const url = new URL(req.url);
    const examType = url.searchParams.get("examType");
    const mode = url.searchParams.get("mode"); // "browse" for paginated list

    if (mode === "browse") {
      return await handleBrowse(db, url);
    }

    // Default: stats overview
    const [totalRes, mcqRes, explRes, imgRes, activeRes, inactiveRes, topicRes, mcqActiveRes] =
      await Promise.all([
        db.from("questions").select("id", { count: "exact", head: true }),
        db.from("questions").select("id", { count: "exact", head: true }).eq("is_active", true).in("exam_type", ["kenntnispruefung", "kmp_innsbruck"]).not("choices", "is", null),
        db.from("questions").select("id", { count: "exact", head: true }).eq("is_active", true).not("explanation", "is", null).neq("explanation", ""),
        db.from("questions").select("id", { count: "exact", head: true }).eq("is_active", true).not("image_url", "is", null),
        db.from("questions").select("id", { count: "exact", head: true }).eq("is_active", true),
        db.from("questions").select("id", { count: "exact", head: true }).eq("is_active", false),
        db.rpc("get_topic_counts", { p_exam_type: examType }),
        db.from("questions").select("id", { count: "exact", head: true }).eq("is_active", true).in("exam_type", ["kenntnispruefung", "kmp_innsbruck"]),
      ]);

    for (const result of [totalRes, mcqRes, explRes, imgRes, activeRes, inactiveRes, topicRes, mcqActiveRes]) assertReadSucceeded(result);
    const byTopic = ((topicRes.data || []) as { topic: string; count: number | string }[]).map((row) => ({ topic: row.topic, count: Number(row.count) })).sort((a, b) => b.count - a.count);

    return NextResponse.json({
      totalAll: totalRes.count || 0,
      active: activeRes.count || 0,
      inactive: inactiveRes.count || 0,
      withMCQ: mcqRes.count || 0,
      withExplanations: explRes.count || 0,
      withImages: imgRes.count || 0,
      mcqPct: mcqActiveRes.count ? Math.round(((mcqRes.count || 0) / mcqActiveRes.count) * 100) : 0,
      explPct: activeRes.count ? Math.round(((explRes.count || 0) / activeRes.count) * 100) : 0,
      imgPct: activeRes.count ? Math.round(((imgRes.count || 0) / activeRes.count) * 100) : 0,
      byTopic,
    });
  } catch (err) {
    console.error("[admin/questions GET]", err);
    return adminErrorResponse(err, "/api/stats/admin/questions");
  }
}, { route: "/api/stats/admin/questions", rateLimit: { limit: 120, windowMs: 60_000 } });

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

  const questionId = url.searchParams.get("questionId");
  if (questionId && /^\d+$/.test(questionId)) query = query.eq("id", Number(questionId));
  if (examType) query = query.eq("exam_type", examType);
  if (topic) query = query.eq("topic", topic);
  if (search) query = query.ilike("question", `%${search}%`);
  if (hasExplanation === "true") query = query.not("explanation", "is", null).neq("explanation", "");
  if (hasExplanation === "false") query = query.or("explanation.is.null,explanation.eq.");
  if (isActive === "true") query = query.eq("is_active", true);
  if (isActive === "false") query = query.eq("is_active", false);

  const { data, count, error } = await query;
  if (error) return adminErrorResponse(error, "/api/stats/admin/questions");

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
export const PATCH = adminRouteShell(async ({ req, actor }) => {
  try {
    const db = getServiceClient();
    const body = await req.json();
    const { questionId, updates } = body;

    if (!questionId) return NextResponse.json({ error: "questionId required" }, { status: 400 });

    const allowed = ["question", "answer", "explanation", "topic", "tags", "is_active", "difficulty"];
    let safeUpdates: Record<string, unknown> = {};
    for (const key of allowed) {
      if (updates?.[key] !== undefined) safeUpdates[key] = updates[key];
    }

    if (Object.keys(safeUpdates).length === 0) {
      return NextResponse.json({ error: "No valid fields to update" }, { status: 400 });
    }

    const { data: before, error: readError } = await db.from("questions").select("question, answer, explanation, topic, tags, is_active, difficulty").eq("id", questionId).maybeSingle();
    if (readError) return adminErrorResponse(readError, "/api/stats/admin/questions");
    if (!before) return NextResponse.json({ error: "Question not found" }, { status: 404 });
    safeUpdates = changedQuestionFields(before, safeUpdates);
    if (!Object.keys(safeUpdates).length) return NextResponse.json({ ok: true, unchanged: true });
    const { error } = await db.from("questions").update(safeUpdates).eq("id", questionId);
    if (error) return adminErrorResponse(error, "/api/stats/admin/questions");

    const isActivityToggle =
      typeof updates.is_active === "boolean" &&
      Object.keys(safeUpdates).length === 1;
    await logAdminAction({
      req,
      actorId: actor.userId,
      actorEmail: actor.email,
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
        before: Object.fromEntries(Object.keys(safeUpdates).map((key) => [key, (before as Record<string, unknown>)[key]])),
        after: safeUpdates,
      },
    });

    return NextResponse.json({ ok: true });
  } catch (err) {
    console.error("[admin/questions PATCH]", err);
    return adminErrorResponse(err, "/api/stats/admin/questions");
  }
}, { route: "/api/stats/admin/questions#patch", rateLimit: { limit: 60, windowMs: 60_000 } });
