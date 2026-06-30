import { NextRequest, NextResponse } from "next/server";
import { getServiceClient } from "@/lib/supabase";
import { requireUser, isFreeAccess } from "@/lib/auth-guard";
import {
  FREE_NOTE_LIMIT,
  NOTE_SELECT_COLUMNS,
  NOTE_SOURCE_TYPES,
  isNoteSourceType,
  normalizeContent,
  normalizeTags,
  buildSearchText,
  deriveTitle,
  type NoteSourceType,
} from "@/lib/notes";

export const dynamic = "force-dynamic";

/**
 * /api/notes — the user's personal flash-note library (Phase 1 server rail).
 *
 * POST  → create a note. Enforces the 10-note free cap server-side.
 * GET   → list the caller's active notes, with filter / sort / full-text search.
 *
 * Auth: requireUser (signed session token). Every row is scoped to the caller;
 * the tables are RLS deny-all and reached only via the service-role client.
 */

const VALID_SORTS = new Set([
  "recent",
  "updated",
  "exam",
  "topic",
  "source",
]);

// ── POST: create ─────────────────────────────────────────────────────────────
export async function POST(req: NextRequest) {
  const guard = await requireUser(req);
  if ("error" in guard) return guard.error;
  const userId = guard.userId;

  try {
    const body = await req.json().catch(() => ({}));

    const sourceType = body?.source_type;
    if (!isNoteSourceType(sourceType)) {
      return NextResponse.json(
        {
          error: `Invalid source_type. Must be one of: ${NOTE_SOURCE_TYPES.join(", ")}`,
        },
        { status: 400 },
      );
    }

    const sb = getServiceClient();

    // ── Free-tier cap (signed §6): 10 non-renewable notes for free users.
    // Pro / admin are unlimited. Imports bypass this (see /api/notes/import)
    // but DO count toward it here.
    if (isFreeAccess(guard)) {
      const { count, error: countErr } = await sb
        .from("notes")
        .select("id", { count: "exact", head: true })
        .eq("user_id", userId)
        .eq("is_active", true);
      if (countErr) {
        console.error("[notes POST] cap count", countErr);
        return NextResponse.json(
          { error: "Failed to check note allowance" },
          { status: 500 },
        );
      }
      if ((count ?? 0) >= FREE_NOTE_LIMIT) {
        return NextResponse.json(
          {
            error: "Free note limit reached",
            gate: "notes",
            limit: FREE_NOTE_LIMIT,
            count: count ?? 0,
          },
          { status: 402 },
        );
      }
    }

    // Merge any top-level body.tags into the content tags, then normalize once
    // so the stored content + denormalized columns are always consistent.
    const mergedRawContent = {
      ...(body?.content && typeof body.content === "object" ? body.content : {}),
      tags: [
        ...(Array.isArray(body?.content?.tags) ? body.content.tags : []),
        ...(Array.isArray(body?.tags) ? body.tags : []),
      ],
      title:
        typeof body?.title === "string"
          ? body.title
          : (body?.content?.title ?? ""),
    };
    const content = normalizeContent(mergedRawContent);
    const title = deriveTitle(content);
    content.title = title;
    const tags = content.tags;
    const searchText = buildSearchText(content);

    const sourceRef =
      body?.source_ref && typeof body.source_ref === "object"
        ? body.source_ref
        : null;
    const metadata =
      body?.metadata && typeof body.metadata === "object" ? body.metadata : {};
    const examType =
      typeof body?.exam_type === "string" ? body.exam_type.slice(0, 80) : null;
    const topic =
      typeof body?.topic === "string" ? body.topic.slice(0, 120) : null;

    const { data, error } = await sb
      .from("notes")
      .insert({
        user_id: userId,
        source_type: sourceType as NoteSourceType,
        source_ref: sourceRef,
        title,
        content,
        tags,
        exam_type: examType,
        topic,
        metadata,
        search_text: searchText,
      })
      .select(NOTE_SELECT_COLUMNS)
      .single();

    if (error) {
      console.error("[notes POST] insert", error);
      return NextResponse.json(
        { error: "Failed to create note" },
        { status: 500 },
      );
    }

    return NextResponse.json({ note: data }, { status: 201 });
  } catch (err) {
    console.error("[notes POST]", err);
    return NextResponse.json({ error: "Internal error" }, { status: 500 });
  }
}

// ── GET: list ────────────────────────────────────────────────────────────────
export async function GET(req: NextRequest) {
  const guard = await requireUser(req);
  if ("error" in guard) return guard.error;
  const userId = guard.userId;

  try {
    const url = new URL(req.url);
    const p = url.searchParams;

    const q = p.get("q")?.trim() || "";
    const sourceType = p.get("source_type");
    const examType = p.get("exam_type");
    const topic = p.get("topic");
    const tag = p.get("tag");
    const sort = p.get("sort") || "recent";
    const limit = Math.min(Math.max(Number(p.get("limit")) || 50, 1), 200);
    const offset = Math.max(Number(p.get("offset")) || 0, 0);

    const sb = getServiceClient();
    let query = sb
      .from("notes")
      .select(NOTE_SELECT_COLUMNS, { count: "exact" })
      .eq("user_id", userId)
      .eq("is_active", true);

    if (isNoteSourceType(sourceType)) query = query.eq("source_type", sourceType);
    if (examType) query = query.eq("exam_type", examType);
    if (topic) query = query.eq("topic", topic);
    if (tag) query = query.contains("tags", [tag.toLowerCase()]);
    if (q) {
      // Full-text over the generated tsvector (config 'simple' — mixed DE/EN/AR).
      query = query.textSearch("search_tsv", q, {
        type: "websearch",
        config: "simple",
      });
    }

    // Phase 1 supports column sorts only; "due" sort (needs the review-progress
    // join) lands with the Library review UI in Phase 4.
    switch (sort) {
      case "updated":
        query = query.order("updated_at", { ascending: false });
        break;
      case "exam":
        query = query.order("exam_type", { ascending: true, nullsFirst: false });
        break;
      case "topic":
        query = query.order("topic", { ascending: true, nullsFirst: false });
        break;
      case "source":
        query = query.order("source_type", { ascending: true });
        break;
      case "recent":
      default:
        query = query.order("created_at", { ascending: false });
        break;
    }

    query = query.range(offset, offset + limit - 1);

    const { data, error, count } = await query;
    if (error) {
      console.error("[notes GET] list", error);
      return NextResponse.json(
        { error: "Failed to load notes" },
        { status: 500 },
      );
    }

    return NextResponse.json({
      notes: data ?? [],
      count: count ?? 0,
      limit,
      offset,
      sort: VALID_SORTS.has(sort) ? sort : "recent",
    });
  } catch (err) {
    console.error("[notes GET]", err);
    return NextResponse.json({ error: "Internal error" }, { status: 500 });
  }
}
