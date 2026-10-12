import { NextRequest, NextResponse } from "next/server";
import { getServiceClient } from "@/lib/supabase";
import { requireUser, isPaidAccess } from "@/lib/auth-guard";
import { NOTE_SELECT_COLUMNS, buildNoteRow } from "@/lib/notes";
import { withDbUnavailable } from "@/lib/db-unavailable-route";

export const dynamic = "force-dynamic";
export const maxDuration = 30;

const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * POST /api/notes/[id]/clone — "save to my library": copy a PUBLIC note into the
 * caller's own notes (Notes feature P6-ii / Explore).
 *
 * Pro-gated (signed §4: "save to my library… Pro-gated"). The copy is a fresh
 * private note owned by the caller, source_type='manual', with
 * metadata.cloned_from = the source id (provenance, not the original author's
 * identity — Explore is anonymous). It does NOT copy the source's source_ref
 * (which would leak the original question/author).
 */
async function handlePOST(
  req: NextRequest,
  ctx: { params: Promise<{ id: string }> },
) {
  const guard = await requireUser(req);
  if ("error" in guard) return guard.error;
  const userId = guard.userId;

  const { id } = await ctx.params;
  if (!UUID_RE.test(id)) {
    return NextResponse.json({ error: "Invalid note id" }, { status: 400 });
  }

  // Pro-gated.
  if (!isPaidAccess(guard)) {
    return NextResponse.json(
      { error: "Saving community notes is a Pro feature.", gate: "notes" },
      { status: 402 },
    );
  }

  try {
    const sb = getServiceClient();
    const { data: src, error: srcErr } = await sb
      .from("notes")
      .select("id, content, tags, exam_type, topic, visibility, is_active")
      .eq("id", id)
      .maybeSingle();
    if (srcErr) {
      console.error("[notes/[id]/clone] load", srcErr);
      return NextResponse.json({ error: "Failed to load note" }, { status: 500 });
    }
    if (!src || src.visibility !== "public" || src.is_active !== true) {
      return NextResponse.json({ error: "Not found" }, { status: 404 });
    }

    const row = buildNoteRow(userId, {
      source_type: "manual",
      rawContent: src.content,
      exam_type: src.exam_type,
      topic: src.topic,
      metadata: { created_from: "explore_clone", cloned_from: id },
    });

    const { data, error } = await sb
      .from("notes")
      .insert(row)
      .select(NOTE_SELECT_COLUMNS)
      .single();
    if (error) {
      console.error("[notes/[id]/clone] insert", error);
      return NextResponse.json({ error: "Failed to save note" }, { status: 500 });
    }

    return NextResponse.json({ ok: true, note: data }, { status: 201 });
  } catch (err) {
    console.error("[notes/[id]/clone]", err);
    return NextResponse.json({ error: "Internal error" }, { status: 500 });
  }
}

export const POST = withDbUnavailable(handlePOST);
