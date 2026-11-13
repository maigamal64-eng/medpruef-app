import { NextRequest, NextResponse } from "next/server";
import { getServiceClient } from "@/lib/supabase";
import { withDbUnavailable } from "@/lib/db-unavailable-route";
import { stepIndex, matchDomains, revealAnswers, UUID_RE, type ChecklistPoint } from "@/lib/de-kp/case-run";
import { guardDeKp, caseAccessError, NO_STORE } from "../../../guard";
import { readCaseHeads, readCaseKey, readFollowupStems, readOwnAttempt } from "../../../read";
import { badRequest, notFound, notSubmitted, readFailure, readJson } from "../../../respond";

export const dynamic = "force-dynamic";
export const maxDuration = 30;

/**
 * POST /api/de-kp/case/[slug]/reveal, body { stage, ... } (spec 4.2):
 *   stage "anamnese" { lines }      the simulated patient's answers for the domains the
 *                                   learner's lines name (matched on the server)
 *   stage "findings" { attemptId }  findings, once Anamnese is submitted
 *   stage "oral"     { attemptId }  the follow-up STEMS, once the Bericht is submitted
 * Never a rubric, model report, accepted wording or follow-up key.
 */
async function handlePOST(req: NextRequest, ctx: { params: Promise<{ slug: string }> }) {
  const gate = await guardDeKp(req, { allowFree: true });
  if ("error" in gate) return gate.error;
  const { slug } = await ctx.params;
  const body = await readJson(req);
  if (!body) return badRequest();
  if (!/^[a-z0-9]+(-[a-z0-9]+)*$/.test(slug) || slug.length > 120) return notFound();

  const sb = getServiceClient();
  const heads = await readCaseHeads(sb);
  if (!heads.ok) return readFailure(heads, "reveal", "head");
  const head = heads.data.find((c) => c.slug === slug);
  if (!head) return notFound();
  const denied = caseAccessError(gate.paid, head);
  if (denied) return denied;

  const stage = body.stage;
  if (stage === "anamnese") {
    if (!Array.isArray(body.lines) || body.lines.length > 60) return badRequest("lines must be an array");
    const key = await readCaseKey(sb, slug);
    if (!key.ok) return readFailure(key, "reveal", "key");
    if (!key.data) return notFound();
    const checklist = (key.data.history_checklist ?? []) as ChecklistPoint[];
    const matched = matchDomains(body.lines.filter((l): l is string => typeof l === "string"));
    const answers = revealAnswers(checklist, (key.data.patient_answers_de ?? {}) as Record<string, string>, matched);
    return NextResponse.json(
      { domains: [...matched], revealed: Object.entries(answers).map(([id, answer]) => ({ id, domain: checklist.find((p) => p.id === id)?.domain ?? null, answer })) },
      { headers: NO_STORE },
    );
  }

  if (stage !== "findings" && stage !== "oral") return badRequest("unknown stage");
  if (typeof body.attemptId !== "string" || !UUID_RE.test(body.attemptId)) return badRequest("attemptId required");
  const attempt = await readOwnAttempt(sb, gate.guard.userId, body.attemptId);
  if (!attempt.ok) return readFailure(attempt, "reveal", "attempt");
  if (!attempt.data || attempt.data.case_id !== head.id) return notFound("ATTEMPT_NOT_FOUND");
  const step = attempt.data.step as Parameters<typeof stepIndex>[0];

  if (stage === "findings") {
    if (stepIndex(step) < stepIndex("differentials")) return notSubmitted();
    const key = await readCaseKey(sb, slug);
    if (!key.ok) return readFailure(key, "reveal", "key");
    if (!key.data) return notFound();
    return NextResponse.json({ findings: key.data.findings ?? [] }, { headers: NO_STORE });
  }
  if (stepIndex(step) < stepIndex("oral")) return notSubmitted();
  const stems = await readFollowupStems(sb, head.id);
  if (!stems.ok) return readFailure(stems, "reveal", "followups");
  return NextResponse.json({ followups: stems.data }, { headers: NO_STORE });
}

export const POST = withDbUnavailable(handlePOST);
