import { NextRequest, NextResponse } from "next/server";
import { getServiceClient } from "@/lib/supabase";
import { requireUser, isFreeAccess } from "@/lib/auth-guard";
import { stripReservedNoteMetadata } from "@/lib/notes-review";
import { readNoteAllowance, remainingNotes, type NoteAllowance } from "@/lib/notes-cap";
import {
  NOTE_SELECT_COLUMNS,
  NOTE_SOURCE_TYPES,
  isNoteSourceType,
  buildNoteRow,
} from "@/lib/notes";
import { withDbUnavailable } from "@/lib/db-unavailable-route";

export const dynamic = "force-dynamic";
export const maxDuration = 30;

/**
 * /api/notes — the user's personal flash-note library (Phase 1 server rail).
 *
 * POST  → create a note. Enforces the 10-note lifetime free cap server-side.
 * GET   → list the caller's active notes, with filter / sort / full-text search,
 *         plus `cap` ({used, limit, lifetime}) for free callers, null for paid.
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
async function handlePOST(req: NextRequest) {
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

    // ── Free-tier cap (signed §6, pick-ux-stu-51 B): 10 notes in the account's
    // lifetime for free users; deleting never returns a slot. Pro / admin are
    // unlimited. Imports bypass this (see /api/notes/import) but DO count.
    if (isFreeAccess(guard)) {
      let allowance;
      try {
        allowance = await readNoteAllowance(sb, userId);
      } catch (err) {
        console.error("[notes POST] cap count", err);
        return NextResponse.json(
          { error: "Failed to check note allowance" },
          { status: 500 },
        );
      }
      if (remainingNotes(allowance) <= 0) {
        return NextResponse.json(
          {
            error: "Free note limit reached",
            gate: "notes",
            limit: allowance.limit,
            count: allowance.used,
            cap: allowance,
          },
          { status: 402 },
        );
      }
    }

    // Assemble the row through the shared builder so create / import / transform
    // normalize content + derive title + fill search_text identically.
    const row = buildNoteRow(userId, {
      source_type: sourceType,
      source_ref: body?.source_ref,
      rawContent: body?.content,
      title: body?.title,
      tags: body?.tags,
      exam_type: body?.exam_type,
      topic: body?.topic,
      // a15: trust labels (reviewed_*, curated, guide) are never learner input.
      metadata: stripReservedNoteMetadata(body?.metadata),
    });

    const { data, error } = await sb
      .from("notes")
      .insert(row)
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
async function handleGET(req: NextRequest) {
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
    const due = p.get("due") === "true";
    const limit = Math.min(Math.max(Number(p.get("limit")) || 50, 1), 200);
    const offset = Math.max(Number(p.get("offset")) || 0, 0);

    const sb = getServiceClient();
    let query = sb
      .from("notes")
      .select(due ? `${NOTE_SELECT_COLUMNS},note_review_progress!inner(next_review_at)` : NOTE_SELECT_COLUMNS, { count: "exact" })
      .eq("user_id", userId)
      .eq("is_active", true);

    // The learner's persisted schedule is the only due source. The inner
    // join excludes unscheduled notes and the account predicate prevents a
    // public note's other reviewers from affecting this queue.
    if (due) query = query.eq("note_review_progress.user_id", userId)
      .lte("note_review_progress.next_review_at", new Date().toISOString());

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

    // Column sort is stable within the requested account-bound note set.
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

    query = query.order("id", { ascending: true }).range(offset, offset + limit - 1);

    const { data, error, count } = await query;
    if (error) {
      console.error("[notes GET] list", error);
      return NextResponse.json(
        { error: "Failed to load notes" },
        { status: 500 },
      );
    }

    // UX-STU-51: free callers get the allowance for the header meter and the
    // delete decision; paid callers get null (no cap). A failed allowance read
    // never fails the list: the meter is then hidden and delete stays off.
    let cap: NoteAllowance | null = null;
    if (isFreeAccess(guard)) {
      try {
        cap = await readNoteAllowance(sb, userId);
      } catch (err) {
        console.error("[notes GET] allowance", err);
      }
    }

    return NextResponse.json({
      notes: data ?? [],
      count: count ?? 0,
      limit,
      offset,
      sort: VALID_SORTS.has(sort) ? sort : "recent",
      cap,
      cap_unknown: isFreeAccess(guard) && cap === null,
    });
  } catch (err) {
    console.error("[notes GET]", err);
    return NextResponse.json({ error: "Internal error" }, { status: 500 });
  }
}

export const POST = withDbUnavailable(handlePOST);
export const GET = withDbUnavailable(handleGET);
