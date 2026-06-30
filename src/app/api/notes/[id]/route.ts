import { NextRequest, NextResponse } from "next/server";
import { getServiceClient } from "@/lib/supabase";
import { requireUser } from "@/lib/auth-guard";
import {
  NOTE_SELECT_COLUMNS,
  normalizeContent,
  buildSearchText,
  deriveTitle,
} from "@/lib/notes";

export const dynamic = "force-dynamic";

const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * /api/notes/[id] — single-note read / update / delete (Phase 1).
 *
 * GET    → owner OR an active public note (read-only). 404 otherwise.
 * PATCH  → owner-only. Edits title/content/tags/exam_type/topic. Does NOT flip
 *          visibility — publishing waits for the Phase 6 safety stack (signed
 *          §9 #5: no note goes public until PII/moderation is live).
 * DELETE → owner-only. Hard delete; the FK CASCADE removes note_links rows and
 *          note_review_progress rows for this note.
 */

type Ctx = { params: Promise<{ id: string }> };

// ── GET: owner or active public ──────────────────────────────────────────────
export async function GET(req: NextRequest, ctx: Ctx) {
  const guard = await requireUser(req);
  if ("error" in guard) return guard.error;
  const userId = guard.userId;

  const { id } = await ctx.params;
  if (!UUID_RE.test(id)) {
    return NextResponse.json({ error: "Invalid note id" }, { status: 400 });
  }

  try {
    const sb = getServiceClient();
    const { data, error } = await sb
      .from("notes")
      .select(NOTE_SELECT_COLUMNS)
      .eq("id", id)
      .maybeSingle();

    if (error) {
      console.error("[notes/[id] GET]", error);
      return NextResponse.json({ error: "Failed to load note" }, { status: 500 });
    }
    if (!data) return NextResponse.json({ error: "Not found" }, { status: 404 });

    const isOwner = data.user_id === userId;
    const isPublic = data.visibility === "public" && data.is_active === true;
    if (!isOwner && !isPublic) {
      // Don't leak existence of someone else's private note.
      return NextResponse.json({ error: "Not found" }, { status: 404 });
    }

    return NextResponse.json({ note: data, is_owner: isOwner });
  } catch (err) {
    console.error("[notes/[id] GET]", err);
    return NextResponse.json({ error: "Internal error" }, { status: 500 });
  }
}

// ── PATCH: owner-only edit ───────────────────────────────────────────────────
export async function PATCH(req: NextRequest, ctx: Ctx) {
  const guard = await requireUser(req);
  if ("error" in guard) return guard.error;
  const userId = guard.userId;

  const { id } = await ctx.params;
  if (!UUID_RE.test(id)) {
    return NextResponse.json({ error: "Invalid note id" }, { status: 400 });
  }

  try {
    const body = await req.json().catch(() => ({}));
    const sb = getServiceClient();

    // Ownership check (also gets us the current content to merge against).
    const { data: existing, error: loadErr } = await sb
      .from("notes")
      .select("id, user_id, content")
      .eq("id", id)
      .maybeSingle();
    if (loadErr) {
      console.error("[notes/[id] PATCH] load", loadErr);
      return NextResponse.json({ error: "Failed to load note" }, { status: 500 });
    }
    if (!existing) return NextResponse.json({ error: "Not found" }, { status: 404 });
    if (existing.user_id !== userId) {
      return NextResponse.json({ error: "Not found" }, { status: 404 });
    }

    const update: Record<string, unknown> = { updated_at: new Date().toISOString() };

    // Content edit (full replace of the structured body). When content OR tags
    // OR title change, re-normalize and rebuild the denormalized columns.
    const contentChanged =
      body?.content !== undefined ||
      body?.tags !== undefined ||
      body?.title !== undefined;
    if (contentChanged) {
      const base =
        body?.content && typeof body.content === "object"
          ? body.content
          : (existing.content ?? {});
      const merged = {
        ...(typeof base === "object" ? base : {}),
        ...(body?.title !== undefined ? { title: body.title } : {}),
        ...(body?.tags !== undefined ? { tags: body.tags } : {}),
      };
      const content = normalizeContent(merged);
      content.title = deriveTitle(content);
      update.content = content;
      update.title = content.title;
      update.tags = content.tags;
      update.search_text = buildSearchText(content);
    }

    if (typeof body?.exam_type === "string") {
      update.exam_type = body.exam_type.slice(0, 80);
    } else if (body?.exam_type === null) {
      update.exam_type = null;
    }
    if (typeof body?.topic === "string") {
      update.topic = body.topic.slice(0, 120);
    } else if (body?.topic === null) {
      update.topic = null;
    }

    const { data, error } = await sb
      .from("notes")
      .update(update)
      .eq("id", id)
      .eq("user_id", userId)
      .select(NOTE_SELECT_COLUMNS)
      .single();

    if (error) {
      console.error("[notes/[id] PATCH] update", error);
      return NextResponse.json({ error: "Failed to update note" }, { status: 500 });
    }

    return NextResponse.json({ note: data });
  } catch (err) {
    console.error("[notes/[id] PATCH]", err);
    return NextResponse.json({ error: "Internal error" }, { status: 500 });
  }
}

// ── DELETE: owner-only hard delete ───────────────────────────────────────────
export async function DELETE(req: NextRequest, ctx: Ctx) {
  const guard = await requireUser(req);
  if ("error" in guard) return guard.error;
  const userId = guard.userId;

  const { id } = await ctx.params;
  if (!UUID_RE.test(id)) {
    return NextResponse.json({ error: "Invalid note id" }, { status: 400 });
  }

  try {
    const sb = getServiceClient();
    // Scope the delete to the owner so a non-owner can never delete; CASCADE
    // cleans note_links + note_review_progress.
    const { data, error } = await sb
      .from("notes")
      .delete()
      .eq("id", id)
      .eq("user_id", userId)
      .select("id")
      .maybeSingle();

    if (error) {
      console.error("[notes/[id] DELETE]", error);
      return NextResponse.json({ error: "Failed to delete note" }, { status: 500 });
    }
    if (!data) return NextResponse.json({ error: "Not found" }, { status: 404 });

    return NextResponse.json({ ok: true, id: data.id });
  } catch (err) {
    console.error("[notes/[id] DELETE]", err);
    return NextResponse.json({ error: "Internal error" }, { status: 500 });
  }
}
