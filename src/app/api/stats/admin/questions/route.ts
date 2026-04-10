import { NextResponse } from "next/server";
import { getServiceClient } from "@/lib/supabase";

export async function GET() {
  try {
    const db = getServiceClient();

    const [totalRes, mcqRes, explRes, imgRes, topicRes, dupRes] =
      await Promise.all([
        // Total active questions
        db
          .from("questions")
          .select("id", { count: "exact", head: true })
          .eq("is_active", true),

        // With MCQ choices (choices is not null)
        db
          .from("questions")
          .select("id", { count: "exact", head: true })
          .eq("is_active", true)
          .not("choices", "is", null),

        // With explanations (not null and not empty)
        db
          .from("questions")
          .select("id", { count: "exact", head: true })
          .eq("is_active", true)
          .not("explanation", "is", null)
          .neq("explanation", ""),

        // With images
        db
          .from("questions")
          .select("id", { count: "exact", head: true })
          .eq("is_active", true)
          .not("image_url", "is", null),

        // Topic breakdown — fetch topic column for active questions
        db
          .from("questions")
          .select("topic")
          .eq("is_active", true),

        // Duplicates — fetch question text to find exact duplicates
        db
          .from("questions")
          .select("question")
          .eq("is_active", true),
      ]);

    // Compute topic breakdown
    const topicCounts: Record<string, number> = {};
    for (const row of topicRes.data || []) {
      const topic = (row.topic as string) || "Unknown";
      topicCounts[topic] = (topicCounts[topic] || 0) + 1;
    }
    const byTopic = Object.entries(topicCounts)
      .map(([topic, count]) => ({ topic, count }))
      .sort((a, b) => b.count - a.count);

    // Compute duplicate count
    const questionTexts: Record<string, number> = {};
    for (const row of dupRes.data || []) {
      const q = (row.question as string) || "";
      const normalized = q.trim().toLowerCase();
      if (normalized.length > 10) {
        questionTexts[normalized] = (questionTexts[normalized] || 0) + 1;
      }
    }
    const duplicateCount = Object.values(questionTexts).filter(
      (c) => c > 1
    ).length;

    return NextResponse.json({
      total: totalRes.count || 0,
      withMCQ: mcqRes.count || 0,
      withExplanations: explRes.count || 0,
      withImages: imgRes.count || 0,
      byTopic,
      duplicateCount,
    });
  } catch (err) {
    console.error("[/api/stats/admin/questions]", err);
    return NextResponse.json(
      { error: "Internal server error" },
      { status: 500 }
    );
  }
}
