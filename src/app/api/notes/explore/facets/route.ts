import { NextRequest, NextResponse } from "next/server";
import { getServiceClient } from "@/lib/supabase";
import { requireUser } from "@/lib/auth-guard";
import { noteKindFromMetadata, type NoteKind } from "@/lib/notes";
import { withDbUnavailable } from "@/lib/db-unavailable-route";

export const dynamic = "force-dynamic";
export const maxDuration = 30;

const EXPLORE_ENABLED =
  (process.env.NOTES_EXPLORE_ENABLED ?? "false").toLowerCase() === "true";

/**
 * GET /api/notes/explore/facets — the distinct filter values present in Explore,
 * so the browse UI populates its exam / topic / tag / kind filters from real
 * data (not a hardcoded guess that could offer empty filters).
 *
 * Returns { exam_types:[{value,count}], topics:[…], tags:[{tag,count}] (top N),
 *           kinds:[{kind,count}], total }. Flag-gated like /api/notes/explore.
 *
 * Reads only the light columns (exam_type, topic, tags, metadata) over all
 * public+active notes and aggregates in memory. At ~761 rows this is cheap and
 * avoids per-facet round trips; if the public set grows large this can move to
 * a materialized/RPC aggregate.
 */
const TOP_TAGS = 40;

async function handleGET(req: NextRequest) {
  const guard = await requireUser(req);
  if ("error" in guard) return guard.error;

  if (!EXPLORE_ENABLED) {
    return NextResponse.json({
      enabled: false,
      exam_types: [],
      topics: [],
      tags: [],
      kinds: [],
      total: 0,
    });
  }

  try {
    const sb = getServiceClient();
    const { data, error } = await sb
      .from("notes")
      .select("exam_type, topic, tags, metadata")
      .eq("visibility", "public")
      .eq("is_active", true)
      .limit(5000);

    if (error) {
      console.error("[notes/explore/facets]", error);
      return NextResponse.json(
        { error: "Failed to load facets" },
        { status: 500 },
      );
    }

    const examTypes = new Map<string, number>();
    const topics = new Map<string, number>();
    const tags = new Map<string, number>();
    const kinds = new Map<NoteKind, number>();

    for (const row of data ?? []) {
      const et = row.exam_type as string | null;
      if (et) examTypes.set(et, (examTypes.get(et) ?? 0) + 1);
      const tp = row.topic as string | null;
      if (tp) topics.set(tp, (topics.get(tp) ?? 0) + 1);
      const rowTags = (row.tags as string[]) ?? [];
      for (const tg of rowTags) {
        if (!tg) continue;
        tags.set(tg, (tags.get(tg) ?? 0) + 1);
      }
      const { kind } = noteKindFromMetadata(
        row.metadata as Record<string, unknown> | null,
      );
      kinds.set(kind, (kinds.get(kind) ?? 0) + 1);
    }

    const sortedCount = <K,>(m: Map<K, number>) =>
      [...m.entries()].sort((a, b) => b[1] - a[1]);

    return NextResponse.json({
      enabled: true,
      total: (data ?? []).length,
      exam_types: sortedCount(examTypes).map(([value, count]) => ({
        value,
        count,
      })),
      topics: sortedCount(topics).map(([value, count]) => ({ value, count })),
      tags: sortedCount(tags)
        // Drop the ubiquitous "kuratiert"/"guide" system tags from the picker —
        // they are not useful filters (present on ~all curated rows).
        .filter(([tag]) => tag !== "kuratiert" && tag !== "guide")
        .slice(0, TOP_TAGS)
        .map(([tag, count]) => ({ tag, count })),
      kinds: sortedCount(kinds).map(([kind, count]) => ({ kind, count })),
    });
  } catch (err) {
    console.error("[notes/explore/facets]", err);
    return NextResponse.json({ error: "Internal error" }, { status: 500 });
  }
}

export const GET = withDbUnavailable(handleGET);
