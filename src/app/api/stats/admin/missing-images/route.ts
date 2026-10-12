import { NextResponse } from "next/server";
import { getServiceClient } from "@/lib/supabase";
import { adminRouteShell } from "@/lib/admin/shell";

export const dynamic = "force-dynamic";

/**
 * Admin triage endpoint for questions that reference images
 * ("Sehen Sie sich das folgende EKG an...", "Auf dem Bild zeigt sich...",
 * "dieses Röntgenbild...") but have no image_url / image_urls populated.
 *
 * Questions are detected by a twice-daily content audit and tagged with
 * 'missing_image' in `questions.tags`. This route returns the current
 * tagged set grouped by exam_type + topic so [name] can decide for each
 * one: (a) source the missing image manually, (b) rewrite the stem to
 * be self-contained, or (c) deactivate.
 *
 * Optional query params:
 *   - exam_type: filter by kenntnispruefung | kmp_innsbruck | pharma
 *   - topic: filter by topic
 */
export const GET = adminRouteShell(async ({ req }) => {

  try {
    const db = getServiceClient();
    const url = new URL(req.url);
    const examType = url.searchParams.get("exam_type");
    const topic = url.searchParams.get("topic");

    let query = db
      .from("questions")
      .select("id, exam_type, topic, question, tags, is_active, source_file, image_url, image_urls")
      .contains("tags", ["missing_image"])
      .eq("is_active", true)
      .order("exam_type", { ascending: true })
      .order("topic", { ascending: true })
      .order("id", { ascending: true });

    if (examType) query = query.eq("exam_type", examType);
    if (topic) query = query.eq("topic", topic);

    const { data: questions, error } = await query;

    if (error) {
      console.error("[/api/stats/admin/missing-images] query error:", error);
      return NextResponse.json(
        { error: "Failed to fetch missing-image questions" },
        { status: 500 },
      );
    }

    const rows = questions || [];

    // Per-exam-type counts (unfiltered by query params — always the full picture)
    const { data: allTagged, error: countError } = await db
      .from("questions")
      .select("exam_type")
      .contains("tags", ["missing_image"])
      .eq("is_active", true);

    const byExamType: Record<string, number> = {};
    if (!countError && allTagged) {
      for (const r of allTagged) {
        const et = (r.exam_type as string) || "unknown";
        byExamType[et] = (byExamType[et] || 0) + 1;
      }
    }

    // Per-topic counts within the (possibly-filtered) result set
    const byTopic: Record<string, number> = {};
    for (const r of rows) {
      const t = r.topic || "unknown";
      byTopic[t] = (byTopic[t] || 0) + 1;
    }

    return NextResponse.json({
      total: rows.length,
      totalAllExamTypes: allTagged?.length ?? rows.length,
      byExamType,
      byTopic,
      questions: rows.map((r) => ({
        id: r.id,
        exam_type: r.exam_type,
        topic: r.topic,
        question: r.question,
        tags: r.tags,
        source_file: r.source_file,
        // a15 (UX-ADM-26): whether an image is attached despite the tag.
        has_image: !!r.image_url || (Array.isArray(r.image_urls) && r.image_urls.length > 0),
      })),
    });
  } catch (err) {
    console.error("[/api/stats/admin/missing-images]", err);
    return NextResponse.json(
      { error: "Internal server error" },
      { status: 500 },
    );
  }
}, { route: "/api/stats/admin/missing-images", rateLimit: { limit: 120, windowMs: 60_000 } });
