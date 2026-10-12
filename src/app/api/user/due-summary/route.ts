// LX-06-R / UX-GLOBAL-34: one server source for "Heute fällig" (Home, /flashcards, Library).
// Pure logic lives in src/lib/master-learning/due-summary.ts (track-B b35); entitlement
// from the a12 matrix. Library notes have no Pro gate, so their due count is returned
// for every signed-in learner.
// PostgREST caps every select at its max-rows ceiling (1000, see migration 20260623120000), so
// both reads are paged with .range() and an ORDER BY, and the question filter is chunked.
import { NextRequest, NextResponse } from "next/server";
import { requireUser } from "@/lib/auth-guard";
import { getServiceClient } from "@/lib/supabase";
import { audienceOf, canUse } from "@/lib/entitlements";
import { EXAM_SOURCE_IDS } from "@/lib/topics";
import { buildDueSummary, type DueRow } from "@/lib/master-learning/due-summary";
import { withDbUnavailable } from "@/lib/db-unavailable-route";

export const dynamic = "force-dynamic";
export const maxDuration = 30;

const LOOKAHEAD_DAYS = 8;
const PAGE = 1000;
const MAX_PAGES = 10;
const ID_CHUNK = 200;

async function notesDueToday(sb: ReturnType<typeof getServiceClient>, userId: string): Promise<number | null> {
  const { count, error } = await sb
    .from("note_review_progress")
    .select("note_id", { count: "exact", head: true })
    .eq("user_id", userId)
    .lte("next_review_at", new Date().toISOString());
  return error ? null : count ?? 0;
}

/** GET /api/user/due-summary: own rows only. Question counts for entitled callers only. */
async function handleGET(req: NextRequest) {
  const guard = await requireUser(req);
  if ("error" in guard) return guard.error;

  const sb = getServiceClient();
  const notesDue = await notesDueToday(sb, guard.userId);
  if (!canUse("spaced_repetition", audienceOf({ signedIn: true, ...guard }))) {
    return NextResponse.json({ entitled: false, notesDue }, { headers: { "Cache-Control": "private, no-store" } });
  }

  // The page's bank wins (it already resolved the active exam); else the account preference.
  const requested = req.nextUrl.searchParams.get("examType");
  const { data: user } = requested && (EXAM_SOURCE_IDS as readonly string[]).includes(requested)
    ? { data: { active_exam: requested } }
    : await sb.from("users").select("active_exam").eq("id", guard.userId).maybeSingle();
  const exam = (user?.active_exam as string | null) ?? "kenntnispruefung";

  const horizon = new Date(Date.now() + LOOKAHEAD_DAYS * 86_400_000).toISOString();
  const progress: { question_id: number; next_review_at: string | null; ease_factor: number | null }[] = [];
  for (let page = 0; page < MAX_PAGES; page++) {
    const { data, error } = await sb
      .from("user_question_progress")
      .select("question_id, next_review_at, ease_factor")
      .eq("user_id", guard.userId)
      .not("next_review_at", "is", null)
      .lte("next_review_at", horizon)
      .order("question_id", { ascending: true })
      .range(page * PAGE, page * PAGE + PAGE - 1);
    if (error) return NextResponse.json({ error: "Failed to load reviews" }, { status: 500 });
    progress.push(...(data ?? []));
    if ((data ?? []).length < PAGE) break;
  }

  const ids = progress.map((r) => r.question_id);
  const active = new Set<number>();
  for (let i = 0; i < ids.length; i += ID_CHUNK) {
    const { data: qs, error } = await sb
      .from("questions")
      .select("id")
      .in("id", ids.slice(i, i + ID_CHUNK))
      .eq("exam_type", exam)
      .eq("is_active", true);
    if (error) return NextResponse.json({ error: "Failed to load questions" }, { status: 500 });
    for (const q of qs ?? []) active.add(q.id as number);
  }

  const rows: DueRow[] = progress
    .filter((r) => active.has(r.question_id))
    .map((r) => ({ questionId: r.question_id, nextReviewAt: r.next_review_at, ease: r.ease_factor }));

  return NextResponse.json({ ...buildDueSummary(rows, { now: new Date(), entitled: true }), notesDue }, {
    headers: { "Cache-Control": "private, no-store" },
  });
}

export const GET = withDbUnavailable(handleGET);
