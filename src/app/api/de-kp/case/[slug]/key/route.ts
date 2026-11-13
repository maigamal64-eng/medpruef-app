import { NextRequest, NextResponse } from "next/server";
import { getServiceClient } from "@/lib/supabase";
import { withDbUnavailable } from "@/lib/db-unavailable-route";
import { keyPartsReleased, isStep, UUID_RE } from "@/lib/de-kp/case-run";
import { guardDeKp, caseAccessError, NO_STORE } from "../../../guard";
import { readCaseKey, readCaseHeads, readFollowupKeys, readOwnAttempt } from "../../../read";
import { badRequest, notFound, notSubmitted, readFailure, readJson } from "../../../respond";

export const dynamic = "force-dynamic";
export const maxDuration = 30;

/**
 * POST /api/de-kp/case/[slug]/key, body { attemptId }: the answer key, released
 * part by part and only after the learner submitted the matching step, judged by
 * the step stored on the caller's OWN attempt (never by anything the client says
 * here). Nothing submitted yet: 409 NOT_SUBMITTED. Another user's attempt id or
 * one of another case reads as not found.
 */
async function handlePOST(req: NextRequest, ctx: { params: Promise<{ slug: string }> }) {
  const gate = await guardDeKp(req, { allowFree: true });
  if ("error" in gate) return gate.error;
  const { slug } = await ctx.params;
  const body = await readJson(req);
  if (!body || typeof body.attemptId !== "string" || !UUID_RE.test(body.attemptId)) return badRequest("attemptId required");
  if (!/^[a-z0-9]+(-[a-z0-9]+)*$/.test(slug) || slug.length > 120) return notFound();

  const sb = getServiceClient();
  const heads = await readCaseHeads(sb);
  if (!heads.ok) return readFailure(heads, "key", "head");
  const head = heads.data.find((c) => c.slug === slug);
  if (!head) return notFound();
  const denied = caseAccessError(gate.paid, head);
  if (denied) return denied;

  const attempt = await readOwnAttempt(sb, gate.guard.userId, body.attemptId);
  if (!attempt.ok) return readFailure(attempt, "key", "attempt");
  if (!attempt.data || attempt.data.case_id !== head.id || !isStep(attempt.data.step)) return notFound("ATTEMPT_NOT_FOUND");
  const parts = keyPartsReleased(attempt.data.step);
  if (parts.length === 0) return notSubmitted();

  const key = await readCaseKey(sb, slug);
  if (!key.ok) return readFailure(key, "key", "read");
  if (!key.data) return notFound();
  const k = key.data;
  const out: Record<string, unknown> = { released: parts };
  if (parts.includes("history")) out.history_checklist = k.history_checklist;
  if (parts.includes("differentials")) out.differentials = k.differentials;
  if (parts.includes("bericht")) {
    out.bericht_rubric = k.bericht_rubric;
    out.model_bericht_de = k.model_bericht_de;
  }
  if (parts.includes("oral")) {
    const fu = await readFollowupKeys(sb, head.id);
    if (!fu.ok) return readFailure(fu, "key", "followups");
    out.followups = fu.data;
    out.sources = k.sources;
  }
  return NextResponse.json(out, { headers: NO_STORE });
}

export const POST = withDbUnavailable(handlePOST);
