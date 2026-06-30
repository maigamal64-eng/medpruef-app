import { NextRequest, NextResponse } from "next/server";
import { getServiceClient } from "@/lib/supabase";
import { requireUser } from "@/lib/auth-guard";

export const dynamic = "force-dynamic";

const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * POST /api/notes/[id]/review — record a spaced-repetition review of a note-card.
 *
 * Body: { confidence: 'again' | 'hard' | 'good' | 'easy' }
 *
 * Same SM-2 variant the question flashcards use (/api/answer): the 4-level
 * confidence maps to a binary correct (good/easy = recalled), and ease/interval
 * advance identically — kept consistent on purpose so note-cards and
 * question-cards schedule the same way. Writes note_review_progress (keyed
 * (user_id, note_id), separate from user_question_progress).
 */

const CONFIDENCES = ["again", "hard", "good", "easy"] as const;
type Confidence = (typeof CONFIDENCES)[number];

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
    const confidence = body?.confidence as Confidence;
    if (!CONFIDENCES.includes(confidence)) {
      return NextResponse.json(
        { error: `confidence must be one of: ${CONFIDENCES.join(", ")}` },
        { status: 400 },
      );
    }
    const isCorrect = confidence === "good" || confidence === "easy";

    const sb = getServiceClient();

    // The note must exist and be reviewable by this user (their own, or an
    // active public note). Progress is per-user regardless.
    const { data: note, error: noteErr } = await sb
      .from("notes")
      .select("id, user_id, visibility, is_active")
      .eq("id", id)
      .maybeSingle();
    if (noteErr) {
      console.error("[notes/[id]/review] note load", noteErr);
      return NextResponse.json({ error: "Failed to load note" }, { status: 500 });
    }
    if (!note) return NextResponse.json({ error: "Not found" }, { status: 404 });
    if (
      note.user_id !== userId &&
      !(note.visibility === "public" && note.is_active === true)
    ) {
      return NextResponse.json({ error: "Not found" }, { status: 404 });
    }

    const { data: existing } = await sb
      .from("note_review_progress")
      .select("ease_factor, interval_days, repetitions")
      .eq("user_id", userId)
      .eq("note_id", id)
      .maybeSingle();

    const nowIso = new Date().toISOString();
    let easeFactor: number;
    let intervalDays: number;
    let repetitions: number;

    if (existing) {
      easeFactor = isCorrect
        ? Math.min(3.0, existing.ease_factor + 0.1)
        : Math.max(1.3, existing.ease_factor - 0.2);
      intervalDays = isCorrect
        ? Math.max(1, Math.round(existing.interval_days * easeFactor))
        : 0;
      repetitions = isCorrect ? (existing.repetitions ?? 0) + 1 : 0;
    } else {
      easeFactor = isCorrect ? 2.6 : 2.3;
      intervalDays = isCorrect ? 1 : 0;
      repetitions = isCorrect ? 1 : 0;
    }

    const nextReview = new Date();
    nextReview.setDate(nextReview.getDate() + intervalDays);

    const { error: upErr } = await sb
      .from("note_review_progress")
      .upsert(
        {
          user_id: userId,
          note_id: id,
          ease_factor: easeFactor,
          interval_days: intervalDays,
          repetitions,
          next_review_at: nextReview.toISOString(),
          last_seen_at: nowIso,
          updated_at: nowIso,
        },
        { onConflict: "user_id,note_id" },
      );
    if (upErr) {
      console.error("[notes/[id]/review] upsert", upErr);
      return NextResponse.json({ error: "Failed to save review" }, { status: 500 });
    }

    return NextResponse.json({
      ok: true,
      interval_days: intervalDays,
      next_review_at: nextReview.toISOString(),
    });
  } catch (err) {
    console.error("[notes/[id]/review]", err);
    return NextResponse.json({ error: "Internal error" }, { status: 500 });
  }
}
