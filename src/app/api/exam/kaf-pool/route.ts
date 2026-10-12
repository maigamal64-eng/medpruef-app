import { NextRequest, NextResponse } from "next/server";
import * as Sentry from "@sentry/nextjs";
import { getServiceClient } from "@/lib/supabase";
import { clampPoolLimit, clampRequired, sampleItems, type KafItem } from "@/lib/kaf-run";
import { guardKaf, readKafPool, unavailableResponse } from "./pool-read";
import { withDbUnavailable } from "@/lib/db-unavailable-route";

export const dynamic = "force-dynamic";
export const maxDuration = 30;

/**
 * GET /api/exam/kaf-pool: items for the timed KAF practice mode (a24, SIM-04 /
 * CNT-14, pick-kaf-pool = build). Signed-in Pro only, dark unless
 * KAF_TIMED_ENABLED === "true" (404 KAF_DISABLED). Only rows that passed two
 * Medic reads (public.kaf_items) are served.
 *
 *   ?countOnly=1   { count }
 *   ?limit=N       { items: [{ id, topic, stem, image_url, required }] }, a random
 *                  sample of up to N (default 30, max 60). Never options, never
 *                  accepted answers: those come from /answers after submit.
 *
 * 503 KAF_POOL_UNAVAILABLE while the 20261223090000 changeset is not applied.
 */
async function handleGET(req: NextRequest) {
  const gate = await guardKaf(req);
  if ("error" in gate) return gate.error;

  const url = new URL(req.url);
  const read = await readKafPool(getServiceClient());
  if (!read.ok) {
    if (read.unavailable) return unavailableResponse();
    Sentry.captureException(read.error, { tags: { route: "exam/kaf-pool", step: "read" } });
    return NextResponse.json({ error: "Lookup failed" }, { status: 500 });
  }

  if (url.searchParams.get("countOnly") === "1") {
    return NextResponse.json({ count: read.items.length }, { headers: { "Cache-Control": "no-store" } });
  }

  const sample = sampleItems(read.items, clampPoolLimit(url.searchParams.get("limit")));
  const items: KafItem[] = sample.map((row) => {
    const q = read.questions.get(row.question_id)!;
    return { id: row.question_id, topic: q.topic ?? "", stem: q.question ?? "", image_url: q.image_url ?? null, required: clampRequired(row.required) };
  });
  return NextResponse.json({ items }, { headers: { "Cache-Control": "no-store" } });
}

export const GET = withDbUnavailable(handleGET);
