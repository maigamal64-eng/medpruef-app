import { NextRequest, NextResponse } from "next/server";
import { getServiceClient } from "@/lib/supabase";
import { requireUser } from "@/lib/auth-guard";
import {
  isNoteSourceType,
  isNoteKind,
  noteKindFromMetadata,
  type PublicNoteProjection,
} from "@/lib/notes";

export const dynamic = "force-dynamic";

const EXPLORE_ENABLED =
  (process.env.NOTES_EXPLORE_ENABLED ?? "false").toLowerCase() === "true";

/**
 * GET /api/notes/explore — browse PUBLIC flash-notes (the Library "Explore" tab).
 *
 * Flag-gated (NOTES_EXPLORE_ENABLED). Returns a PRIVACY-SAFE projection: NO
 * user_id, NO source_ref, NO raw metadata. It DOES derive + expose the
 * `curated` / `guide` / `kind` / `source_type` signals the card needs so
 * curated MedPrüf-Team content is labeled "MedPrüf Team" (verified), never
 * "unverified" — the EXP-1 root cause was that this projection carried no
 * curated signal at all.
 *
 * Query:
 *   q          full-text (search_tsv, websearch/simple)
 *   exam_type  kenntnispruefung | kmp_innsbruck | pharma
 *   topic      exact topic match
 *   tag        contains this tag (lowercased)
 *   source_type  bookmark | user_note | ai_explanation | manual (the note origin axis)
 *   kind       guide | card | community (the curated/community presentation axis)
 *   sort       recent (default) | title
 *   limit / offset  pagination (limit 1..100)
 */
const PUBLIC_COLUMNS =
  "id, title, content, tags, exam_type, topic, source_type, published_at, metadata";

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
    const kind = p.get("kind");
    const sort = p.get("sort") || "recent";
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

    // Presentation-kind facet (metadata-driven). Null-safe for "community":
    // a genuine user note has no curated flag, so metadata->>'curated' is NULL
    // or 'false' — plain neq('true') would DROP the NULL rows, so use the
    // is-null OR neq form.
    if (isNoteKind(kind)) {
      if (kind === "guide") {
        query = query.eq("metadata->>guide", "true");
      } else if (kind === "card") {
        query = query
          .eq("metadata->>curated", "true")
          .or("metadata->>guide.is.null,metadata->>guide.neq.true");
      } else {
        // community
        query = query.or(
          "metadata->>curated.is.null,metadata->>curated.neq.true",
        );
      }
    }

    if (q) {
      query = query.textSearch("search_tsv", q, {
        type: "websearch",
        config: "simple",
      });
    }

    // Sort. published_at (recency) is the default; title is a stable A→Z browse.
    // Popularity is intentionally NOT offered — there is no backing signal.
    if (sort === "title") {
      query = query.order("title", { ascending: true });
    } else {
      query = query.order("published_at", { ascending: false });
    }
    query = query.range(offset, offset + limit - 1);

    const { data, error, count } = await query;
    if (error) {
      console.error("[notes/explore]", error);
      return NextResponse.json(
        { error: "Failed to load Explore" },
        { status: 500 },
      );
    }

    const notes: PublicNoteProjection[] = (data ?? []).map((n) => {
      const meta = n.metadata as Record<string, unknown> | null;
      const { curated, guide, kind: k } = noteKindFromMetadata(meta);
      return {
        id: n.id as string,
        title: n.title as string,
        content: n.content as PublicNoteProjection["content"],
        tags: (n.tags as string[]) ?? [],
        exam_type: (n.exam_type as string | null) ?? null,
        topic: (n.topic as string | null) ?? null,
        source_type: (n.source_type as PublicNoteProjection["source_type"]) ?? null,
        published_at: (n.published_at as string | null) ?? null,
        curated,
        guide,
        kind: k,
      };
    });

    return NextResponse.json({
      enabled: true,
      notes,
      count: count ?? 0,
      limit,
      offset,
    });
  } catch (err) {
    console.error("[notes/explore]", err);
    return NextResponse.json({ error: "Internal error" }, { status: 500 });
  }
}
