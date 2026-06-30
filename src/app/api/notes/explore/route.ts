import { NextRequest, NextResponse } from "next/server";
import { getServiceClient } from "@/lib/supabase";
import { requireUser } from "@/lib/auth-guard";
import { isNoteSourceType } from "@/lib/notes";

export const dynamic = "force-dynamic";

const EXPLORE_ENABLED =
  (process.env.NOTES_EXPLORE_ENABLED ?? "false").toLowerCase() === "true";

/**
 * GET /api/notes/explore — browse public ("community") flash-notes.
 *
 * Flag-gated (NOTES_EXPLORE_ENABLED) so it stays empty until the safety stack is
 * reviewed. Returns a PRIVACY-SAFE projection only: NO user_id, NO source_ref,
 * NO metadata — so Explore is anonymous-by-default (the signed #6 authorship
 * call resolved toward anonymous for launch; attribution can be added later).
 *
 * Query: q (full-text), exam_type, topic, tag, limit, offset.
 */
const PUBLIC_COLUMNS = "id, title, content, tags, exam_type, topic, published_at";

export async function GET(req: NextRequest) {
  const guard = await requireUser(req);
  if ("error" in guard) return guard.error;

  if (!EXPLORE_ENABLED) {
    return NextResponse.json({ enabled: false, notes: [], count: 0 });
  }

  try {
    const url = new URL(req.url);
    const p = url.searchParams;
    const q = p.get("q")?.trim() || "";
    const examType = p.get("exam_type");
    const topic = p.get("topic");
    const tag = p.get("tag");
    const sourceType = p.get("source_type");
    const limit = Math.min(Math.max(Number(p.get("limit")) || 40, 1), 100);
    const offset = Math.max(Number(p.get("offset")) || 0, 0);

    const sb = getServiceClient();
    let query = sb
      .from("notes")
      .select(PUBLIC_COLUMNS, { count: "exact" })
      .eq("visibility", "public")
      .eq("is_active", true);

    if (examType) query = query.eq("exam_type", examType);
    if (topic) query = query.eq("topic", topic);
    if (tag) query = query.contains("tags", [tag.toLowerCase()]);
    if (isNoteSourceType(sourceType)) query = query.eq("source_type", sourceType);
    if (q) {
      query = query.textSearch("search_tsv", q, {
        type: "websearch",
        config: "simple",
      });
    }

    query = query
      .order("published_at", { ascending: false })
      .range(offset, offset + limit - 1);

    const { data, error, count } = await query;
    if (error) {
      console.error("[notes/explore]", error);
      return NextResponse.json({ error: "Failed to load Explore" }, { status: 500 });
    }

    return NextResponse.json({
      enabled: true,
      notes: data ?? [],
      count: count ?? 0,
      limit,
      offset,
    });
  } catch (err) {
    console.error("[notes/explore]", err);
    return NextResponse.json({ error: "Internal error" }, { status: 500 });
  }
}
