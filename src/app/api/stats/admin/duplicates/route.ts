import { NextResponse } from "next/server";
import { getServiceClient } from "@/lib/supabase";

export const dynamic = "force-dynamic";

export async function GET() {
  try {
    const db = getServiceClient();

    // Find duplicate questions by comparing normalized question text
    // Uses SQL to find questions with identical text (trimmed, lowercased)
    const { data, error } = await db.rpc("find_duplicate_questions").select("*");

    // If RPC doesn't exist, fall back to a manual approach
    if (error) {
      // Fetch all active questions and detect duplicates client-side
      const { data: questions, error: qError } = await db
        .from("questions")
        .select("id, question, topic, exam_dates, is_active, anki_note_id")
        .eq("is_active", true)
        .order("id", { ascending: true });

      if (qError) {
        return NextResponse.json({ error: "Failed to fetch questions" }, { status: 500 });
      }

      // Group by normalized question text (first 200 chars, trimmed, lowercased)
      const groups: Record<string, typeof questions> = {};
      for (const q of questions || []) {
        const key = (q.question || "").trim().toLowerCase().slice(0, 200);
        if (key.length < 20) continue; // Skip very short questions
        if (!groups[key]) groups[key] = [];
        groups[key].push(q);
      }

      // Filter to groups with 2+ questions (duplicates)
      const duplicateGroups = Object.entries(groups)
        .filter(([, qs]) => qs.length >= 2)
        .map(([text, qs]) => ({
          text: text.slice(0, 100) + (text.length > 100 ? "..." : ""),
          count: qs.length,
          questions: qs.map((q) => ({
            id: q.id,
            topic: q.topic,
            exam_dates: q.exam_dates,
            anki_note_id: q.anki_note_id,
          })),
        }))
        .sort((a, b) => b.count - a.count);

      return NextResponse.json({
        totalGroups: duplicateGroups.length,
        totalExtraCopies: duplicateGroups.reduce((sum, g) => sum + g.count - 1, 0),
        groups: duplicateGroups.slice(0, 50), // Top 50 groups
      });
    }

    return NextResponse.json(data);
  } catch (err) {
    console.error("[/api/stats/admin/duplicates]", err);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
