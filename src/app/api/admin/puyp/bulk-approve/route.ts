import { NextResponse } from "next/server";
import { getServiceClient } from "@/lib/supabase";
import { adminRouteShell } from "@/lib/admin/shell";
import { logAdminAction } from "@/lib/admin/audit";
import { suggestNextExpiresAt, type PuypExamType } from "@/lib/exam-dates";
import { approvePuypAttempt, sendPuypDecisionEmail } from "@/lib/admin/puyp-decision";

export const dynamic = "force-dynamic";

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * POST /api/admin/puyp/bulk-approve
 * Body: { attempt_ids: string[] }  (max 20)
 *
 * Approves up to 20 PUYP submissions in one call. Each attempt goes through
 * the same guarded database function as a single approval (ADM-19): never
 * shortens access, keeps permanent Pro, checks owner/status/cap and audits in
 * the same step. An aggregate audit row captures the bulk intent.
 */
export const POST = adminRouteShell(
  async ({ req, actor }) => {
    let body: { attempt_ids?: unknown };
    try {
      body = await req.json();
    } catch {
      return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
    }
    const ids = Array.isArray(body.attempt_ids)
      ? [...new Set(body.attempt_ids.filter((s): s is string => typeof s === "string" && UUID_RE.test(s)))]
      : [];
    if (ids.length === 0) {
      return NextResponse.json({ error: "attempt_ids required" }, { status: 400 });
    }
    if (ids.length > 20) {
      return NextResponse.json({ error: "Bulk approval capped at 20 attempts per call" }, { status: 400 });
    }

    const sb = getServiceClient();
    const results: Array<{ attempt_id: string; ok: boolean; error?: string; new_expires_at?: string; learner_notified?: boolean }> = [];

    for (const attemptId of ids) {
      const { data: attempt, error: fetchErr } = await sb
        .from("exam_attempts")
        .select("id, exam_type")
        .eq("id", attemptId)
        .maybeSingle();
      if (fetchErr || !attempt) {
        results.push({ attempt_id: attemptId, ok: false, error: fetchErr ? "lookup_failed" : "not_found" });
        continue;
      }
      const result = await approvePuypAttempt(sb, {
        actorId: actor.userId,
        attemptId,
        requestedExpiresAt: suggestNextExpiresAt(attempt.exam_type as PuypExamType),
        via: "bulk",
      });
      if (!result.ok) {
        results.push({ attempt_id: attemptId, ok: false, error: result.status === 500 ? "approval_failed" : result.error });
        // Without the database function nothing can be approved; stop early.
        if (result.status === 503) break;
        continue;
      }
      const email = await sendPuypDecisionEmail(sb, result.userId, attemptId, "approved", { newExpiresAtIso: result.newExpiresAt });
      results.push({ attempt_id: attemptId, ok: true, new_expires_at: result.newExpiresAt, learner_notified: email.sent });
    }

    await logAdminAction({
      req,
      actorId: actor.userId,
      actorEmail: actor.email,
      action: "bulk_approve_puyp",
      payload: {
        requested: ids.length,
        approved: results.filter((r) => r.ok).length,
        failed: results.filter((r) => !r.ok).length,
      },
    });

    return NextResponse.json({ results });
  },
  {
    route: "/api/admin/puyp/bulk-approve",
    rateLimit: { limit: 6, windowMs: 60_000 },
  }
);
