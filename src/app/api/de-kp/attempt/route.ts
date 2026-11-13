import { NextRequest, NextResponse } from "next/server";
import { getServiceClient } from "@/lib/supabase";
import { withDbUnavailable } from "@/lib/db-unavailable-route";
import { DE_KP_SOURCES } from "@/lib/de-kp";
import { canAdvance, isStep, stepIndex, sanitizeAnswers, sanitizeMarks, scoreRun, stepHasAnswers, UUID_RE, type ChecklistPoint, type RubricPoint } from "@/lib/de-kp/case-run";
import { guardDeKp, caseAccessError, NO_STORE } from "../guard";
import { attemptIdTaken, readCaseHeads, readCaseKey, readFollowupKeys, readOwnAttempt, type AttemptRow } from "../read";
import { badRequest, notFound, readFailure, readJson } from "../respond";

export const dynamic = "force-dynamic";
export const maxDuration = 30;

function view(row: AttemptRow) {
  return {
    id: row.id, step: row.step, completed_at: row.completed_at,
    scores: { history: row.history_score, differential: row.differential_score, bericht: row.bericht_score, followup: row.followup_score },
    critical_missed: row.critical_missed, answers: row.answers ?? {}, marks: row.marks ?? {},
  };
}

/**
 * POST /api/de-kp/attempt: save or resume the caller's own run (spec 5 and 9).
 * Body { attemptId (uuid), slug, step, answers, marks, source? }. The user id is the
 * session's, never the body's. The attempt id is the primary key: a retry returns the
 * saved row; a different user posting a known id reads as not found. The step only
 * moves forward one step at a time and only with the typed answers of the step being
 * left; a new run starts at "anamnese". At "done" the server computes the four scores
 * itself from the typed text and the self-marks (scores are never taken from the client).
 */
async function handlePOST(req: NextRequest) {
  const gate = await guardDeKp(req, { allowFree: true });
  if ("error" in gate) return gate.error;
  const body = await readJson(req);
  if (!body) return badRequest();
  const { attemptId, slug, step: target } = body;
  if (typeof attemptId !== "string" || !UUID_RE.test(attemptId)) return badRequest("attemptId must be a uuid");
  if (typeof slug !== "string" || !/^[a-z0-9]+(-[a-z0-9]+)*$/.test(slug) || slug.length > 120) return badRequest("slug required");
  if (!isStep(target)) return badRequest("unknown step");
  const source = (DE_KP_SOURCES as readonly string[]).includes(body.source as string) ? (body.source as string) : null;

  const sb = getServiceClient();
  const heads = await readCaseHeads(sb);
  if (!heads.ok) return readFailure(heads, "attempt", "head");
  const head = heads.data.find((c) => c.slug === slug);
  if (!head) return notFound();
  const denied = caseAccessError(gate.paid, head);
  if (denied) return denied;

  const userId = gate.guard.userId;
  const existing = await readOwnAttempt(sb, userId, attemptId, true);
  if (!existing.ok) return readFailure(existing, "attempt", "read");
  if (existing.data && existing.data.case_id !== head.id) return notFound("ATTEMPT_NOT_FOUND");
  if (!existing.data) {
    // Not the caller's run: an id another user holds reads as not found, never as a step error.
    const taken = await attemptIdTaken(sb, attemptId);
    if (!taken.ok) return readFailure(taken, "attempt", "probe");
    if (taken.data) return notFound("ATTEMPT_NOT_FOUND");
  }

  const answers = sanitizeAnswers(body.answers);
  const marks = sanitizeMarks(body.marks);
  const current = existing.data ? (isStep(existing.data.step) ? existing.data.step : "anamnese") : "anamnese";
  if (!existing.data && target !== "anamnese") return NextResponse.json({ error: "A run starts at anamnese", code: "STEP_ORDER" }, { status: 409 });
  // A stale retry (the saved row is already further) returns the saved row unchanged.
  if (existing.data && stepIndex(current) > stepIndex(target)) return NextResponse.json({ attempt: view(existing.data), duplicate: true }, { headers: NO_STORE });
  if (!canAdvance(current, target)) return NextResponse.json({ error: "Steps move forward one at a time", code: "STEP_ORDER" }, { status: 409 });
  if (target !== current && !stepHasAnswers(current, answers)) return badRequest("Answer this step before submitting it");

  const patch: Record<string, unknown> = { step: target, answers, marks, ...(source ? { source } : {}) };
  if (target === "done") {
    const key = await readCaseKey(sb, slug);
    if (!key.ok) return readFailure(key, "attempt", "key");
    if (!key.data) return notFound();
    const fu = await readFollowupKeys(sb, head.id);
    if (!fu.ok) return readFailure(fu, "attempt", "followups");
    const s = scoreRun({
      checklist: (key.data.history_checklist ?? []) as ChecklistPoint[],
      rubric: (key.data.bericht_rubric ?? []) as RubricPoint[],
      differentials: (key.data.differentials ?? { leading: [], others: [] }) as { leading: string[][]; others: string[][] },
      followups: fu.data.map((f) => ({ id: f.id, required: f.required })),
      answers, marks,
    });
    Object.assign(patch, {
      history_score: s.history, differential_score: s.differential, bericht_score: s.bericht, followup_score: s.followup,
      critical_missed: s.criticalMissed, completed_at: existing.data?.completed_at ?? new Date().toISOString(),
    });
  }

  if (!existing.data) {
    const { error } = await sb.from("de_kp_case_attempts").insert({ id: attemptId, user_id: userId, case_id: head.id, ...patch });
    if (error) {
      // A concurrent first post of the same id: re-read and answer from the saved row.
      if ((error as { code?: string }).code === "23505") {
        const again = await readOwnAttempt(sb, userId, attemptId, true);
        if (again.ok && again.data) return NextResponse.json({ attempt: view(again.data), duplicate: true }, { headers: NO_STORE });
        return notFound("ATTEMPT_NOT_FOUND");
      }
      return readFailure({ unavailable: ["42P01", "PGRST205"].includes((error as { code?: string }).code ?? ""), error }, "attempt", "insert");
    }
  } else {
    const { error } = await sb.from("de_kp_case_attempts").update(patch).eq("id", attemptId).eq("user_id", userId);
    if (error) return readFailure({ unavailable: ["42P01", "PGRST205"].includes((error as { code?: string }).code ?? ""), error }, "attempt", "update");
  }

  const saved = await readOwnAttempt(sb, userId, attemptId, true);
  if (!saved.ok) return readFailure(saved, "attempt", "reread");
  if (!saved.data) return notFound("ATTEMPT_NOT_FOUND");
  return NextResponse.json({ attempt: view(saved.data), duplicate: false }, { headers: NO_STORE });
}

export const POST = withDbUnavailable(handlePOST);
