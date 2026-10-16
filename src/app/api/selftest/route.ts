import { NextRequest, NextResponse } from "next/server";
import { getServiceClient } from "@/lib/supabase";
import { callerIp, checkRateLimit, rateKey } from "@/lib/rate-limit";
import { withDbUnavailable } from "@/lib/db-unavailable-route";
import { isDbUnavailable } from "@/lib/db-unavailable";
import { publicSelftestEnabled } from "@/lib/public-selftest/flag";
import { asSelftestBank } from "@/lib/public-selftest";
import { SelftestUnavailableError, loadSelftest } from "@/lib/public-selftest/server";

export const dynamic = "force-dynamic";
export const maxDuration = 30;

/**
 * GET /api/selftest?bank=kmp_innsbruck|kenntnispruefung (a-public-selftest).
 *
 * No account. Serves the fixed allowlist of one bank (free-set rows with two
 * agreeing Medic reads and unchanged served text), never an id from the
 * request, so it opens no question beyond what a guest can already read in
 * the free sample. 404 while PUBLIC_SELFTEST_ENABLED is off. Per-IP limit:
 * a run needs one call; 20 in 10 minutes covers reloads and shared networks.
 * Correct flags travel with the options like /api/questions ([name]'s lock of
 * 2026-04-16); the score stays in the browser until the visitor saves it.
 */
const SELFTEST_LIMIT = { limit: 20, windowMs: 10 * 60_000 } as const;
const NO_STORE = { "Cache-Control": "no-store" } as const;

async function handleGET(req: NextRequest) {
  if (!publicSelftestEnabled()) return NextResponse.json({ error: "Not found" }, { status: 404, headers: NO_STORE });
  const bank = asSelftestBank(req.nextUrl.searchParams.get("bank"));
  if (!bank) return NextResponse.json({ error: "bank must be kmp_innsbruck or kenntnispruefung" }, { status: 400, headers: NO_STORE });
  const gate = checkRateLimit({ key: rateKey("selftest", callerIp(req)), ...SELFTEST_LIMIT });
  if (!gate.allowed) {
    return NextResponse.json({ error: "Too many requests", code: "RATE_LIMITED", retryAfter: gate.retryAfterSec }, {
      status: 429, headers: { ...NO_STORE, "Retry-After": String(Math.max(1, gate.retryAfterSec)) },
    });
  }
  try {
    const payload = await loadSelftest(getServiceClient(), bank);
    return NextResponse.json(payload, { headers: NO_STORE });
  } catch (err) {
    if (isDbUnavailable(err)) throw err;
    if (err instanceof SelftestUnavailableError) {
      console.warn("[selftest] unavailable", { bank, reason: err.reason, kept: err.kept });
    } else {
      console.error("[selftest] read failed", { bank, message: err instanceof Error ? err.message : String(err) });
    }
    return NextResponse.json({ error: "Self-check unavailable", code: "SELFTEST_UNAVAILABLE" }, { status: 503, headers: { ...NO_STORE, "Retry-After": "60" } });
  }
}

export const GET = withDbUnavailable(handleGET);
