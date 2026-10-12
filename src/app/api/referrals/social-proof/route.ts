import { NextRequest, NextResponse } from "next/server";
import { getServiceClient } from "@/lib/supabase";
import {
  callerIdentity,
  checkRateLimit,
  rateKey,
  rateLimitHeaders,
} from "@/lib/rate-limit";
import { captureServerError } from "@/lib/sentry-capture";

export const dynamic = "force-dynamic";
export const maxDuration = 30;

/**
 * GET /api/referrals/social-proof
 *
 * Public, read-only counts of qualified referrals across the last 7 / 30
 * / all-time windows. Feeds the "N Empfehlungen diese Woche" row on
 * /referrals so returning users see the program gaining traction (and
 * so the first few referrers feel visible — honesty compounds).
 *
 * No auth — the numbers themselves are safe to show to anyone. We DO
 * rate-limit by caller identity (user id if present, else forwarded IP)
 * at 60/min per the sprint prompt — cheap DDOS protection and enough
 * headroom that a legit user landing on /referrals won't be throttled.
 *
 * "Qualified" = status in ('qualified','rewarded'). Pending rows
 * aren't counted because they haven't yet paid (noise). Capped rows
 * (hold_reason='annual_cap', reward_credit_cents=0) DO count — they
 * represent real referee subscriptions that happen to hit the €600
 * ceiling.
 *
 * Added 2026-04-24 (rescue-sprint §4.5).
 */
export async function GET(req: NextRequest) {
  // Rate-limit: 60 requests/min per caller. Not the 5/10min we use on
  // checkout — social-proof is read-only, non-mutating, and a page can
  // legitimately refresh it several times in quick succession.
  const ident = callerIdentity(req);
  const gate = checkRateLimit({
    key: rateKey("referrals/social-proof", ident),
    limit: 60,
    windowMs: 60_000,
  });
  if (!gate.allowed) {
    return NextResponse.json(
      { error: "Too many requests", retryAfterSec: gate.retryAfterSec },
      { status: 429, headers: rateLimitHeaders(gate, { limit: 60 }) }
    );
  }

  try {
    const sb = getServiceClient();

    const now = new Date();
    const sevenDaysAgo = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000);
    const thirtyDaysAgo = new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000);

    // Three count-only queries. Each uses the server-side count head
    // pattern so no rows cross the wire. qualified_at is the right
    // anchor because that's the moment the referee actually paid.
    const [sevenRes, thirtyRes, allRes] = await Promise.all([
      sb
        .from("referrals")
        .select("id", { head: true, count: "exact" })
        .in("status", ["qualified", "rewarded"])
        .gte("qualified_at", sevenDaysAgo.toISOString()),
      sb
        .from("referrals")
        .select("id", { head: true, count: "exact" })
        .in("status", ["qualified", "rewarded"])
        .gte("qualified_at", thirtyDaysAgo.toISOString()),
      sb
        .from("referrals")
        .select("id", { head: true, count: "exact" })
        .in("status", ["qualified", "rewarded"]),
    ]);

    if (sevenRes.error || thirtyRes.error || allRes.error) {
      captureServerError(
        sevenRes.error || thirtyRes.error || allRes.error,
        { route: "/api/referrals/social-proof" }
      );
      return NextResponse.json(
        { error: "Count lookup failed" },
        { status: 500, headers: rateLimitHeaders(gate, { limit: 60 }) }
      );
    }

    return NextResponse.json(
      {
        qualifiedLast7d: sevenRes.count ?? 0,
        qualifiedLast30d: thirtyRes.count ?? 0,
        qualifiedAllTime: allRes.count ?? 0,
      },
      { headers: rateLimitHeaders(gate, { limit: 60 }) }
    );
  } catch (err) {
    captureServerError(err, { route: "/api/referrals/social-proof" });
    return NextResponse.json(
      { error: "Internal error" },
      { status: 500, headers: rateLimitHeaders(gate, { limit: 60 }) }
    );
  }
}
