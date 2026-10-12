// LX-06-R / UX-GLOBAL-34: one server source for "Heute fällig" (Home, /flashcards, Library).
// Pure logic lives in src/lib/master-learning/due-summary.ts (track-B b35); entitlement
// from the a12 matrix. Library notes have no Pro gate, so their due count is returned
// for every signed-in learner.
// The paged row read lives in src/lib/master-learning/due-rows-server.ts (shared with the study nudge).
import { NextRequest, NextResponse } from "next/server";
import { requireUser } from "@/lib/auth-guard";
import { getServiceClient } from "@/lib/supabase";
import { audienceOf, canUse } from "@/lib/entitlements";
import { EXAM_SOURCE_IDS } from "@/lib/topics";
import { buildDueSummary, type DueRow } from "@/lib/master-learning/due-summary";
import { withDbUnavailable } from "@/lib/db-unavailable-route";
import { DueRowsReadError, loadDueRows } from "@/lib/master-learning/due-rows-server";

export const dynamic = "force-dynamic";
export const maxDuration = 30;

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

  let rows: DueRow[];
  try {
    rows = await loadDueRows(sb, guard.userId, exam);
  } catch (err) {
    if (err instanceof DueRowsReadError) return NextResponse.json({ error: err.message }, { status: 500 });
    throw err;
  }

  return NextResponse.json({ ...buildDueSummary(rows, { now: new Date(), entitled: true }), notesDue }, {
    headers: { "Cache-Control": "private, no-store" },
  });
}

export const GET = withDbUnavailable(handleGET);
