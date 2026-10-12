import { NextRequest, NextResponse } from "next/server";
import { getServiceClient } from "@/lib/supabase";
import { requireUser } from "@/lib/auth-guard";

export const dynamic = "force-dynamic";
export const maxDuration = 30;
const headers = { "Cache-Control": "private, no-store", Vary: "x-session-token" };

export async function POST(req: NextRequest) {
  const guard = await requireUser(req, { allowCached: false });
  if ("error" in guard) {
    for (const [key, value] of Object.entries(headers)) guard.error.headers.set(key, value);
    return guard.error;
  }
  let body: unknown;
  try { body = await req.json(); } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400, headers });
  }
  const { questionId, rating } = (body && typeof body === "object" ? body : {}) as Record<string, unknown>;
  if (typeof questionId !== "number" || !Number.isSafeInteger(questionId) || questionId <= 0 || questionId > 2147483647 || (rating !== 1 && rating !== -1)) {
    return NextResponse.json({ error: "questionId and rating (1 or -1) required" }, { status: 400, headers });
  }
  try {
    const db = getServiceClient();
    const { data, error } = await db.rpc("rate_explanation_once", {
      p_user_id: guard.userId, p_question_id: questionId, p_rating: rating,
    });
    if (!error) return NextResponse.json({ success: true, one_vote: true, rating, ...data }, { headers });
    if (error.code === "P0002") return NextResponse.json({ error: "Question not found" }, { status: 404, headers });
    // During rollout only: PostgreSQL relation/function absence and the
    // equivalent PostgREST schema-cache codes. Other errors fail closed.
    if (!["42P01", "42883", "PGRST202", "PGRST205"].includes(error.code)) {
      return NextResponse.json({ error: "Rating temporarily unavailable" }, { status: 503, headers });
    }
    const { data: question, error: lookupError } = await db.from("questions").select("id")
      .eq("id", questionId).eq("is_active", true).maybeSingle();
    if (lookupError) return NextResponse.json({ error: "Rating temporarily unavailable" }, { status: 503, headers });
    if (!question) return NextResponse.json({ error: "Question not found" }, { status: 404, headers });
    // Prefer the existing atomic increment RPC during rollout.
    const legacy = await db.rpc("increment_explanation_rating", { q_id: questionId, rating_val: rating });
    if (legacy.error) {
      if (!["42883", "PGRST202"].includes(legacy.error.code)) {
        return NextResponse.json({ error: "Rating temporarily unavailable" }, { status: 503, headers });
      }
      // The live baseline lacks the increment RPC too. Preserve the legacy
      // aggregate path with compare-and-swap rather than losing concurrent votes.
      for (let attempt = 0; attempt < 5; attempt++) {
        const current = await db.from("questions")
          .select("explanation_rating_sum, explanation_rating_count")
          .eq("id", questionId).eq("is_active", true).maybeSingle();
        if (current.error) break;
        if (!current.data) return NextResponse.json({ error: "Question not found" }, { status: 404, headers });
        const sum = current.data.explanation_rating_sum as number | null;
        const count = current.data.explanation_rating_count as number | null;
        let update = db.from("questions").update({
          explanation_rating_sum: (sum ?? 0) + rating,
          explanation_rating_count: (count ?? 0) + 1,
        }).eq("id", questionId).eq("is_active", true);
        update = sum === null ? update.is("explanation_rating_sum", null) : update.eq("explanation_rating_sum", sum);
        update = count === null ? update.is("explanation_rating_count", null) : update.eq("explanation_rating_count", count);
        const written = await update.select("id").maybeSingle();
        if (written.error) break;
        if (written.data) return NextResponse.json({ success: true, one_vote: false, rating }, { headers });
      }
      return NextResponse.json({ error: "Rating temporarily unavailable" }, { status: 503, headers });
    }
    return NextResponse.json({ success: true, one_vote: false, rating }, { headers });
  } catch {
    return NextResponse.json({ error: "Rating temporarily unavailable" }, { status: 503, headers });
  }
}

// Supplies durable own-vote state for the frozen UI's later integration.
export async function GET(req: NextRequest) {
  const guard = await requireUser(req, { allowCached: false });
  if ("error" in guard) {
    for (const [key, value] of Object.entries(headers)) guard.error.headers.set(key, value);
    return guard.error;
  }
  const questionId = Number(req.nextUrl.searchParams.get("questionId"));
  if (!Number.isSafeInteger(questionId) || questionId <= 0 || questionId > 2147483647) {
    return NextResponse.json({ error: "Invalid questionId" }, { status: 400, headers });
  }
  try {
    const { data, error } = await getServiceClient().from("explanation_ratings").select("rating")
      .eq("user_id", guard.userId).eq("question_id", questionId).maybeSingle();
    if (error && ["42P01", "PGRST205"].includes(error.code)) {
      return NextResponse.json({ rating: null, one_vote: false }, { headers });
    }
    if (error) return NextResponse.json({ error: "Rating temporarily unavailable" }, { status: 503, headers });
    return NextResponse.json({ rating: data?.rating ?? null, one_vote: true }, { headers });
  } catch {
    return NextResponse.json({ error: "Rating temporarily unavailable" }, { status: 503, headers });
  }
}
