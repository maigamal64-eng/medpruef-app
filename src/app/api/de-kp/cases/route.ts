import { NextRequest, NextResponse } from "next/server";
import { getServiceClient } from "@/lib/supabase";
import { withDbUnavailable } from "@/lib/db-unavailable-route";
import { guardDeKp, NO_STORE } from "../guard";
import { readCaseHeads, readOwnAttempts } from "../read";
import { readFailure } from "../respond";

export const dynamic = "force-dynamic";
export const maxDuration = 30;

/**
 * GET /api/de-kp/cases: the active KP-DE cases (slug, titles, subject, free flag,
 * locked) and the caller's own recent runs (step and scores, never typed text).
 * Signed in, dark unless DE_KP_ENABLED. Never a vignette, key or count of
 * Austrian questions.
 */
async function handleGET(req: NextRequest) {
  const gate = await guardDeKp(req, { allowFree: true });
  if ("error" in gate) return gate.error;

  const sb = getServiceClient();
  const heads = await readCaseHeads(sb);
  if (!heads.ok) return readFailure(heads, "cases", "heads");
  const runs = await readOwnAttempts(sb, gate.guard.userId);
  if (!runs.ok) return readFailure(runs, "cases", "attempts");

  const slugById = new Map(heads.data.map((c) => [c.id, c.slug]));
  return NextResponse.json(
    {
      cases: heads.data.map((c) => ({ slug: c.slug, title_de: c.title_de, title_en: c.title_en, subject: c.subject, is_free: c.is_free === true, locked: !gate.paid && c.is_free !== true })),
      attempts: runs.data.filter((r) => slugById.has(r.case_id)).map((r) => ({
        id: r.id, slug: slugById.get(r.case_id)!, step: r.step, started_at: r.started_at ?? null, completed_at: r.completed_at,
        scores: { history: r.history_score, differential: r.differential_score, bericht: r.bericht_score, followup: r.followup_score }, critical_missed: r.critical_missed,
      })),
    },
    { headers: NO_STORE },
  );
}

export const GET = withDbUnavailable(handleGET);
