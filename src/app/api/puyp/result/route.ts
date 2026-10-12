import { checkRateLimit } from "@/lib/rate-limit";
import { NextRequest, NextResponse } from "next/server";
import { requireUser } from "@/lib/auth-guard";
import { getServiceClient } from "@/lib/supabase";
import { captureServerError } from "@/lib/sentry-capture";
import { computeQbankCompletion, type PuypExamType } from "@/lib/puyp";
import { validActionKey } from "@/lib/puyp-idempotency";

/** user_events type for a fail recorded without proof (a24, pick-ux-exm-46 A). */
const PUYP_FAIL_EVENT = "puyp_result_recorded";

export const dynamic = "force-dynamic";
export const maxDuration = 30;

/**
 * POST /api/puyp/result
 *
 * Records a user-reported result of the real exam.
 *
 * FAIL without proof (a24, pick-ux-exm-46 A): every learner can record that
 * they did not pass. Such a fail claims nothing, so it is NOT an
 * exam_attempts row (the admin PUYP queue, inbox count and action alert all
 * read exam_attempts result='fail'). It is one user_events row
 * (event_type 'puyp_result_recorded', outcome 'fail', with_proof false), keyed
 * by the client action UUID so a retry returns the first record. Outcomes are
 * internal calibration only and are never shown as a pass rate. Learners who
 * claim the guarantee upload proof through /api/puyp/submit instead.
 *   Body: { result: 'fail', idempotency_key: uuid,
 *           exam_type?: ..., attempt_date?: 'YYYY-MM-DD' }
 *   No unique index backs the key, so two truly simultaneous first requests
 *   can write two telemetry rows; no money or access depends on them.
 *
 * PASS: records a user-reported PASS on their real exam. No admin
 * verification needed — there's no incentive to lie about passing
 * (no extension granted), so we trust the self-report. An admin can
 * always retroactively flip the row if something looks fishy.
 *
 * Why a pass row matters:
 *   1. The referral-qualification branch (see /api/referrals/*)
 *      reads `exam_attempts` to decide when a referrer's €75 payout
 *      becomes claimable for a premium tier referee — the 30-day
 *      hold starts at the referee's original subscription_started_at,
 *      not the exam-date (spec lock #3 April 23 2026 amendment).
 *   2. The dashboard uses it to stop prompting the user with the
 *      "How did your exam go?" card.
 *   3. Admin metrics: pass-rate per cohort is the headline KPI.
 *
 * Body:
 *   { result: 'pass',
 *     exam_type?: 'kenntnispruefung' | 'kmp_innsbruck' | 'pharma',
 *     attempt_date?: 'YYYY-MM-DD' }
 *
 * exam_type + attempt_date are optional and default to
 * `users.active_exam` + `users.exam_date` respectively. If neither
 * is available we 400 — the client shouldn't be calling this before
 * the user's exam date.
 */
export async function POST(req: NextRequest) {
  const guard = await requireUser(req);
  if ("error" in guard) return guard.error;
  const { userId } = guard;

  try {
    const body = await req.json().catch(() => ({}));
    const result = String(body?.result || "").toLowerCase();

    if (result !== "pass" && result !== "fail") {
      return NextResponse.json(
        { error: "result must be 'pass' or 'fail'. A guarantee claim with proof goes through /api/puyp/submit." },
        { status: 400 }
      );
    }
    if (result === "fail" && !validActionKey(body?.idempotency_key)) {
      return NextResponse.json({ error: "Valid idempotency_key required" }, { status: 400 });
    }

    const sb = getServiceClient();

    // Pull the user's defaults for exam_type + attempt_date.
    const { data: user, error: uErr } = await sb
      .from("users")
      .select("active_exam, exam_date")
      .eq("id", userId)
      .maybeSingle();

    if (uErr || !user) {
      return NextResponse.json(
        { error: "User lookup failed" },
        { status: 500 }
      );
    }

    const examType =
      (typeof body?.exam_type === "string"
        ? (body.exam_type as string).toLowerCase()
        : (user.active_exam as string | null)) || null;

    if (
      !examType ||
      !["kenntnispruefung", "kmp_innsbruck", "pharma"].includes(examType)
    ) {
      return NextResponse.json(
        { error: "Unknown exam_type. Set your active exam in settings first." },
        { status: 400 }
      );
    }

    const attemptDate =
      typeof body?.attempt_date === "string" &&
      /^\d{4}-\d{2}-\d{2}$/.test(body.attempt_date)
        ? body.attempt_date
        : (user.exam_date as string | null);

    if (!attemptDate) {
      return NextResponse.json(
        { error: "attempt_date required. Set your exam date in settings or pass attempt_date in the body." },
        { status: 400 }
      );
    }

    if (result === "fail") {
      // Each record reads the bank completion and writes a row: bound it per learner.
      const gate = checkRateLimit({ key: `puyp-fail:${userId}`, limit: 5, windowMs: 60 * 60_000 });
      if (!gate.allowed) {
        return NextResponse.json({ error: "Too many requests", retryAfter: gate.retryAfterSec }, { status: 429, headers: { "Retry-After": String(gate.retryAfterSec) } });
      }
      return recordFailWithoutProof(sb, userId, examType as PuypExamType, attemptDate, body.idempotency_key as string);
    }

    // Natural pass key: one self-reported pass per account and exam bank.
    const readPrior = () => sb.from("exam_attempts").select("id").eq("user_id", userId).eq("exam_type", examType).eq("result", "pass").order("created_at", { ascending: false }).limit(1).maybeSingle();
    const prior = await readPrior();
    if (prior.error) return NextResponse.json({ error: "Could not confirm prior result" }, { status: 500 });
    if (prior.data) return NextResponse.json({ ok: true, attempt_id: prior.data.id, result: "pass", duplicate: true });

    // Capture the current subscription id (if any active) so the
    // admin can trace which sub the attempt corresponds to. Not
    // fatal if the user is on the free tier — the column is nullable.
    const { data: activeSub } = await sb
      .from("subscriptions")
      .select("id")
      .eq("user_id", userId)
      .eq("status", "active")
      .order("created_at", { ascending: false })
      .limit(1)
      .maybeSingle();

    // Snapshot the completion % — useful for cohort-analysis queries
    // even on pass rows.
    const completion = await computeQbankCompletion(
      userId,
      examType as PuypExamType
    );

    const nowIso = new Date().toISOString();

    const { data: inserted, error: insertErr } = await sb
      .from("exam_attempts")
      .insert({
        user_id: userId,
        subscription_id: activeSub?.id ?? null,
        exam_type: examType,
        attempt_date: attemptDate,
        result: "pass",
        verified_at: nowIso, // self-verified
        verified_by: userId, // self
        qbank_completion_pct: completion.pct,
      })
      .select("id")
      .single();

    if (insertErr?.code === "23505") {
      const existing = await readPrior();
      if (!existing.error && existing.data) return NextResponse.json({ ok: true, attempt_id: existing.data.id, result: "pass", duplicate: true });
    }
    if (insertErr || !inserted) {
      captureServerError(insertErr, {
        route: "/api/puyp/result",
        userId,
        step: "insert",
      });
      return NextResponse.json(
        { error: "Failed to record result" },
        { status: 500 }
      );
    }

    // Telemetry.
    await sb.from("user_events").insert({
      user_id: userId,
      event_type: "puyp_result_pass",
      event_data: {
        exam_type: examType,
        attempt_date: attemptDate,
        qbank_completion_pct: completion.pct,
        attempt_id: inserted.id,
      },
    });

    return NextResponse.json({
      ok: true,
      attempt_id: inserted.id,
      result: "pass",
    });
  } catch (err) {
    captureServerError(err, { route: "/api/puyp/result", userId });
    return NextResponse.json(
      { error: "Internal error" },
      { status: 500 }
    );
  }
}

type ServiceClient = ReturnType<typeof getServiceClient>;

async function recordFailWithoutProof(
  sb: ServiceClient,
  userId: string,
  examType: PuypExamType,
  attemptDate: string,
  actionKey: string
): Promise<NextResponse> {
  const readPrior = () =>
    sb
      .from("user_events")
      .select("id")
      .eq("user_id", userId)
      .eq("event_type", PUYP_FAIL_EVENT)
      .eq("event_data->>idempotency_key", actionKey)
      .limit(1)
      .maybeSingle();
  const prior = await readPrior();
  if (prior.error) return NextResponse.json({ error: "Could not confirm prior result" }, { status: 500 });
  if (prior.data) return NextResponse.json({ ok: true, result: "fail", with_proof: false, duplicate: true });

  const completion = await computeQbankCompletion(userId, examType);
  const { error } = await sb.from("user_events").insert({
    user_id: userId,
    event_type: PUYP_FAIL_EVENT,
    event_data: {
      outcome: "fail",
      with_proof: false,
      exam_type: examType,
      attempt_date: attemptDate,
      idempotency_key: actionKey,
      qbank_completion_pct: completion.pct,
    },
  });
  if (error) {
    captureServerError(error, { route: "/api/puyp/result", userId, step: "fail_insert" });
    return NextResponse.json({ error: "Failed to record result" }, { status: 500 });
  }
  return NextResponse.json({ ok: true, result: "fail", with_proof: false });
}
