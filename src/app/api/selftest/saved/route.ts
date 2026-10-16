import { NextRequest, NextResponse } from "next/server";
import { getServiceClient } from "@/lib/supabase";
import { requireUser } from "@/lib/auth-guard";
import { checkRateLimit, rateKey } from "@/lib/rate-limit";
import { withDbUnavailable } from "@/lib/db-unavailable-route";
import { publicSelftestEnabled } from "@/lib/public-selftest/flag";
import { SELFTEST_SAVED_EVENT, SELFTEST_SIZE, asSelftestBank } from "@/lib/public-selftest";

export const dynamic = "force-dynamic";
export const maxDuration = 30;

/**
 * POST /api/selftest/saved (a-public-selftest): one signed user_events row
 * `selftest_saved {exam, sitting: named|open, count}` after the carry ran, so
 * the Monday count can join self-check signups to their named sitting and to
 * checkout opens. Counts only: no score, no answers, no date. At most one row
 * per account (a repeat answers duplicate). 404 while the self-check is off.
 */
async function handlePOST(req: NextRequest) {
  if (!publicSelftestEnabled()) return NextResponse.json({ error: "Not found" }, { status: 404 });
  const guard = await requireUser(req);
  if ("error" in guard) return guard.error;
  if (!checkRateLimit({ key: rateKey("selftest-saved", guard.userId), limit: 5, windowMs: 10 * 60_000 }).allowed) {
    return NextResponse.json({ error: "Too many requests" }, { status: 429, headers: { "Retry-After": "600" } });
  }
  let body: Record<string, unknown>;
  try { body = (await req.json()) as Record<string, unknown>; } catch { return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 }); }
  const exam = asSelftestBank(body.exam);
  const sitting = body.sitting === "named" || body.sitting === "open" ? body.sitting : null;
  const count = typeof body.count === "number" && Number.isInteger(body.count) && body.count >= 0 && body.count <= SELFTEST_SIZE ? body.count : null;
  if (!exam || !sitting || count === null) return NextResponse.json({ error: "exam, sitting (named|open) and count required" }, { status: 400 });

  const sb = getServiceClient();
  const prior = await sb.from("user_events").select("id").eq("user_id", guard.userId).eq("event_type", SELFTEST_SAVED_EVENT).limit(1).maybeSingle();
  if (prior.error) throw prior.error;
  if (prior.data) return NextResponse.json({ ok: true, duplicate: true });
  const { error } = await sb.from("user_events").insert({ user_id: guard.userId, event_type: SELFTEST_SAVED_EVENT, event_data: { exam, sitting, count } });
  if (error) throw error;
  return NextResponse.json({ ok: true });
}

export const POST = withDbUnavailable(handlePOST);
