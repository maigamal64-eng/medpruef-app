import { NextRequest, NextResponse } from "next/server";
import * as Sentry from "@sentry/nextjs";
import { getServiceClient } from "@/lib/supabase";
import { parseAccepted } from "@/lib/exam-history-server";
import { KAF_POOL_MAX_LIMIT, type KafKey } from "@/lib/kaf-run";
import { guardKaf, readKafPool, unavailableResponse } from "../pool-read";
import { withDbUnavailable } from "@/lib/db-unavailable-route";

export const dynamic = "force-dynamic";
export const maxDuration = 30;

/**
 * POST /api/exam/kaf-pool/answers { ids: number[] } (max 60): the accepted
 * wording, model answer and key points for the self-marking phase of a KAF
 * practice run (a24). The runner calls it only after the learner submits.
 * Pro only, dark unless KAF_TIMED_ENABLED. Ids outside the reviewed pool are
 * left out of the response.
 */
async function handlePOST(req: NextRequest) {
  const gate = await guardKaf(req);
  if ("error" in gate) return gate.error;

  let body: { ids?: unknown };
  try {
    body = (await req.json()) as { ids?: unknown };
  } catch {
    return NextResponse.json({ error: "Bad body" }, { status: 400 });
  }
  if (!Array.isArray(body.ids) || body.ids.length === 0 || body.ids.length > KAF_POOL_MAX_LIMIT) {
    return NextResponse.json({ error: "ids must be 1 to 60 question ids" }, { status: 400 });
  }
  const ids = [...new Set(body.ids.map(Number))];
  if (!ids.every((n) => Number.isInteger(n) && n > 0 && n <= 10_000_000)) {
    return NextResponse.json({ error: "Invalid ids" }, { status: 400 });
  }

  const read = await readKafPool(getServiceClient(), { ids, withKey: true });
  if (!read.ok) {
    if (read.unavailable) return unavailableResponse();
    Sentry.captureException(read.error, { tags: { route: "exam/kaf-pool/answers", step: "read" } });
    return NextResponse.json({ error: "Lookup failed" }, { status: 500 });
  }

  const out: Record<string, KafKey> = {};
  for (const row of read.items) {
    const accepted = parseAccepted(row.accepted);
    if (accepted.length === 0) continue;
    const keyPoints = Array.isArray(row.key_points)
      ? row.key_points.filter((s): s is string => typeof s === "string" && s.trim() !== "").map((s) => s.trim())
      : [];
    out[String(row.question_id)] = { accepted, model_answer: String(row.model_answer ?? "").trim(), key_points: keyPoints };
  }
  return NextResponse.json(out, { headers: { "Cache-Control": "no-store" } });
}

export const POST = withDbUnavailable(handlePOST);
