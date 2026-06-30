import { NextRequest, NextResponse } from "next/server";
import { getServiceClient } from "@/lib/supabase";
import { requireUser } from "@/lib/auth-guard";

export const dynamic = "force-dynamic";

const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

const REASONS = ["pii", "wrong", "spam", "copyright", "other"] as const;
type Reason = (typeof REASONS)[number];

/**
 * POST /api/notes/[id]/report — report a PUBLIC note for moderation.
 *
 * Body: { reason: 'pii'|'wrong'|'spam'|'copyright'|'other', detail?: string }
 *
 * Writes a note_reports row → the admin takedown queue. Idempotent per
 * (note, reporter) while a report is still open (the partial unique index),
 * so re-reporting the same note is a no-op success.
 */
export async function POST(
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

  try {
    const body = await req.json().catch(() => ({}));
    const reason = body?.reason as Reason;
    if (!REASONS.includes(reason)) {
      return NextResponse.json(
        { error: `reason must be one of: ${REASONS.join(", ")}` },
        { status: 400 },
      );
    }
    const detail =
      typeof body?.detail === "string" ? body.detail.slice(0, 1000) : null;

    const sb = getServiceClient();
    // You can only report a note that is actually public + active.
    const { data: note, error: noteErr } = await sb
      .from("notes")
      .select("id, visibility, is_active")
      .eq("id", id)
      .maybeSingle();
    if (noteErr) {
      console.error("[notes/[id]/report] load", noteErr);
      return NextResponse.json({ error: "Failed to load note" }, { status: 500 });
    }
    if (!note || note.visibility !== "public" || note.is_active !== true) {
      return NextResponse.json({ error: "Not found" }, { status: 404 });
    }

    const { error: insErr } = await sb.from("note_reports").insert({
      note_id: id,
      reporter_user_id: userId,
      reason,
      detail,
      status: "open",
    });
    if (insErr) {
      // Already reported by this user (open) → idempotent success.
      if ((insErr as { code?: string }).code === "23505") {
        return NextResponse.json({ ok: true, already_reported: true });
      }
      console.error("[notes/[id]/report] insert", insErr);
      return NextResponse.json({ error: "Failed to file report" }, { status: 500 });
    }

    return NextResponse.json({ ok: true });
  } catch (err) {
    console.error("[notes/[id]/report]", err);
    return NextResponse.json({ error: "Internal error" }, { status: 500 });
  }
}
