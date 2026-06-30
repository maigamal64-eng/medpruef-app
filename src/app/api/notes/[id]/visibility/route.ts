import { NextRequest, NextResponse } from "next/server";
import { getServiceClient } from "@/lib/supabase";
import { requireUser } from "@/lib/auth-guard";
import { NOTE_SELECT_COLUMNS, buildSearchText, normalizeContent } from "@/lib/notes";
import { scanNoteForPublic } from "@/lib/notes-safety";

export const dynamic = "force-dynamic";

const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

// The whole public/Explore surface stays OFF until the safety stack is reviewed
// (signed §9 #5: NO note goes public until the stack is live). Default OFF.
const EXPLORE_ENABLED =
  (process.env.NOTES_EXPLORE_ENABLED ?? "false").toLowerCase() === "true";

// Author self-unpublish grace. After this, public is user-irreversible (only an
// admin takedown or a report can remove it) — the signed "soften irreversible".
const UNPUBLISH_GRACE_MS = 24 * 60 * 60 * 1000;

/**
 * PATCH /api/notes/[id]/visibility — publish a note to Explore, or unpublish it.
 *
 * Body: { visibility: 'public' | 'private', confirm?: boolean }
 *
 * publish → gated on EXPLORE_ENABLED + a pre-publish PII/quality scan. Empty/junk
 *           is hard-blocked (422); soft PII flags return needsConfirm (409) until
 *           the author re-sends confirm:true.
 * private → author self-unpublish, allowed only within 24h of publishing.
 */
export async function PATCH(
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
    const visibility = body?.visibility;
    if (visibility !== "public" && visibility !== "private") {
      return NextResponse.json(
        { error: "visibility must be 'public' or 'private'" },
        { status: 400 },
      );
    }

    const sb = getServiceClient();
    const { data: note, error: loadErr } = await sb
      .from("notes")
      .select("id, user_id, content, visibility, published_at, is_active")
      .eq("id", id)
      .maybeSingle();
    if (loadErr) {
      console.error("[notes/[id]/visibility] load", loadErr);
      return NextResponse.json({ error: "Failed to load note" }, { status: 500 });
    }
    if (!note || note.user_id !== userId) {
      return NextResponse.json({ error: "Not found" }, { status: 404 });
    }

    const nowIso = new Date().toISOString();

    // ── Publish ──────────────────────────────────────────────────────────────
    if (visibility === "public") {
      if (!EXPLORE_ENABLED) {
        return NextResponse.json(
          {
            error: "Sharing notes publicly isn't available yet.",
            code: "EXPLORE_DISABLED",
          },
          { status: 503 },
        );
      }
      if (note.visibility === "public" && note.is_active) {
        return NextResponse.json({ ok: true, already_public: true });
      }

      const text = buildSearchText(normalizeContent(note.content));
      const scan = await scanNoteForPublic(text);
      if (!scan.qualityOk) {
        return NextResponse.json(
          {
            error: "This note can't be published.",
            code: "QUALITY_BLOCK",
            flags: scan.flags,
          },
          { status: 422 },
        );
      }
      if (scan.flags.length > 0 && body?.confirm !== true) {
        return NextResponse.json(
          {
            error: "Please review what will be shared publicly.",
            code: "NEEDS_CONFIRM",
            needs_confirm: true,
            flags: scan.flags,
          },
          { status: 409 },
        );
      }

      const { data, error } = await sb
        .from("notes")
        .update({
          visibility: "public",
          is_active: true,
          published_at: note.published_at ?? nowIso,
          updated_at: nowIso,
        })
        .eq("id", id)
        .eq("user_id", userId)
        .select(NOTE_SELECT_COLUMNS)
        .single();
      if (error) {
        console.error("[notes/[id]/visibility] publish", error);
        return NextResponse.json({ error: "Failed to publish" }, { status: 500 });
      }
      return NextResponse.json({ ok: true, note: data });
    }

    // ── Unpublish (author, within grace) ─────────────────────────────────────
    if (note.visibility !== "public") {
      return NextResponse.json({ ok: true, already_private: true });
    }
    const publishedMs = note.published_at
      ? new Date(note.published_at as string).getTime()
      : 0;
    if (
      !Number.isFinite(publishedMs) ||
      Date.now() - publishedMs > UNPUBLISH_GRACE_MS
    ) {
      return NextResponse.json(
        {
          error:
            "Public notes can only be made private within 24 hours of publishing. Report it for removal if needed.",
          code: "GRACE_EXPIRED",
        },
        { status: 403 },
      );
    }

    const { data, error } = await sb
      .from("notes")
      .update({ visibility: "private", updated_at: nowIso })
      .eq("id", id)
      .eq("user_id", userId)
      .select(NOTE_SELECT_COLUMNS)
      .single();
    if (error) {
      console.error("[notes/[id]/visibility] unpublish", error);
      return NextResponse.json({ error: "Failed to unpublish" }, { status: 500 });
    }
    return NextResponse.json({ ok: true, note: data });
  } catch (err) {
    console.error("[notes/[id]/visibility]", err);
    return NextResponse.json({ error: "Internal error" }, { status: 500 });
  }
}
