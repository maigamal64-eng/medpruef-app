import { NextRequest, NextResponse } from "next/server";
import { getServiceClient } from "@/lib/supabase";
import { requireUser, isFreeAccess } from "@/lib/auth-guard";
import {
  DEFAULT_EXAM_SOURCE,
  EXAM_SOURCE_IDS,
} from "@/lib/topics";
import { loadFreeAccess } from "@/lib/free-tier";
import { logFreeCapHit } from "@/lib/free-access";

export const dynamic = "force-dynamic";

/**
 * GET /api/offline/questions
 *
 * Returns a batch of active questions for offline use. The client
 * (src/app/settings/page.tsx) calls this when the user taps
 * "Herunterladen", then persists the batch into IndexedDB via
 * src/lib/offlineDb.ts.
 *
 * Query params:
 *   examType — 'kenntnispruefung' | 'kmp_innsbruck' | 'pharma' (default: kenntnispruefung)
 *   count    — integer 1..500 (default: 100, capped at 500)
 *   topic    — optional, narrow to one specialty
 *
 * Auth: requireUser — this is a user-specific download action (counts
 * against the session, not anonymous). Guests can't use offline mode
 * because their answers can't be synced back to a real user row.
 *
 * Cache-Control: private, no-store — the response is bound to the
 * caller's session. Middle-boxes must not cache.
 */
export async function GET(req: NextRequest) {
  const guard = await requireUser(req);
  if ("error" in guard) return guard.error;

  const sp = req.nextUrl.searchParams;

  // ── examType validation ──
  const rawExam = sp.get("examType") || DEFAULT_EXAM_SOURCE;
  const examType =
    rawExam === "SIP" ? "kenntnispruefung" : rawExam;
  if (!(EXAM_SOURCE_IDS as readonly string[]).includes(examType)) {
    return NextResponse.json(
      { error: "Invalid examType" },
      { status: 400 },
    );
  }

  // ── count validation (1..500) ──
  const rawCount = parseInt(sp.get("count") || "100", 10);
  if (!Number.isFinite(rawCount) || rawCount < 1) {
    return NextResponse.json(
      { error: "count must be a positive integer" },
      { status: 400 },
    );
  }
  const count = Math.min(500, Math.max(1, Math.round(rawCount)));

  const topic = sp.get("topic");

  // ── build the query ──
  const sb = getServiceClient();
  let query = sb
    .from("questions")
    .select(
      "id, topic, question, answer, explanation, ai_explanation, exam_type, choices, image_url, image_urls, exam_dates, tags",
    )
    .eq("is_active", true)
    .eq("exam_type", examType)
    // Prefer MCQ rows for offline — open-answer fallbacks are less
    // useful without the server's grading round-trip anyway.
    .not("choices", "is", null);

  if (topic) {
    query = query.eq("topic", topic);
  }

  // ── Free-tier gate (2026-06-20, free set a-free-set 2026-10-12) ──
  // A free user's offline batch is bounded to what they may read: the free
  // set plus already-answered questions of the old slice, and once capped
  // only answered free questions (rule in src/lib/free-set.ts). The offline
  // path can never be looser than the live questions route.
  if (isFreeAccess(guard)) {
    const access = await loadFreeAccess(sb, guard.userId, examType);
    if (access.capped) {
      await logFreeCapHit(sb, {
        userId: guard.userId,
        gate: "qbank_limit",
        route: "/api/offline/questions",
        examType,
        seen: access.counted,
      });
    }
    if (access.readable.length === 0) {
      return NextResponse.json(
        { questions: [] },
        { headers: { "Cache-Control": "private, no-store, max-age=0" } },
      );
    }
    query = query.in("id", access.readable);
  }

  const { data, error } = await query.limit(count);

  if (error) {
    console.error("[offline/questions]", error);
    return NextResponse.json({ error: "Query failed" }, { status: 500 });
  }

  const cachedAt = new Date().toISOString();
  const questions = (data ?? []).map((row) => ({
    id: row.id as number,
    topic: (row.topic as string) ?? "",
    question: (row.question as string) ?? "",
    answer: (row.answer as string) ?? "",
    explanation: (row.explanation as string | null) ?? null,
    ai_explanation: (row.ai_explanation as string | null) ?? null,
    exam_type: (row.exam_type as string) ?? examType,
    choices: row.choices ?? null,
    image_url: (row.image_url as string | null) ?? null,
    image_urls: (row.image_urls as string[] | null) ?? null,
    exam_dates: (row.exam_dates as string[] | null) ?? [],
    tags: (row.tags as string[] | null) ?? [],
    cached_at: cachedAt,
  }));

  return NextResponse.json(
    { questions },
    {
      headers: {
        "Cache-Control": "private, no-store, max-age=0",
      },
    },
  );
}
