import { NextRequest, NextResponse } from "next/server";
import { getServiceClient } from "@/lib/supabase";
import { analyticsWritesDisabled } from "@/lib/supabase-resilience";
import { dbRecentlyUnavailable } from "@/lib/db-unavailable";
import { afterResponse } from "@/lib/after-response";
import { ARRIVAL_CAMPAIGN_RE } from "@/lib/attribution";
import { callerIp, checkRateLimit, rateKey } from "@/lib/rate-limit";
import { uaClass } from "@/lib/analytics-events";

export const dynamic = "force-dynamic";
export const maxDuration = 30;

/**
 * First-party, cookieless landing-hit counter (2026-07-03).
 *
 * WHY: GA4 + the ad pixels are consent-gated (correctly, ePrivacy), and
 * /api/track requires a logged-in userId, so during the Reddit paid probe
 * we had NO number of our own for "how many ad clicks actually arrived":
 * Reddit reported clicks, GA showed nothing, and the gap was unexplainable.
 *
 * This endpoint stores an anonymous, aggregate-only hit: no cookie, no id,
 * no IP, no raw user-agent. It identifies nobody, it just counts, which is
 * why it may fire pre-consent. Fired by AttributionCapture via
 * navigator.sendBeacon on /landing and any UTM-tagged arrival, deduped per
 * browser-session. Always 204: telemetry must never break the page.
 */

const cap = (v: unknown, n = 160): string | null =>
  typeof v === "string" && v.trim() ? v.trim().slice(0, n) : null;

/**
 * Per-IP ceiling (a20, ADM-18 A: rate-limit the anonymous counters before the
 * Growth page reads them). A real visitor sends one hit per browser session;
 * 20 a minute leaves room for shared NATs. Over the ceiling the hit is
 * dropped silently (still 204). The IP is only an in-memory bucket key, it is
 * never stored.
 */
const LANDING_HIT_LIMIT = { limit: 20, windowMs: 60_000 } as const;

export async function POST(req: NextRequest) {
  // Skip while this instance has just seen the database fail (a-db-timeouts).
  if (analyticsWritesDisabled() || dbRecentlyUnavailable()) {
    return new NextResponse(null, { status: 204 });
  }
  if (!checkRateLimit({ key: rateKey("beacon-landing", callerIp(req)), ...LANDING_HIT_LIMIT }).allowed) {
    return new NextResponse(null, { status: 204 });
  }

  let b: Record<string, unknown>;
  try {
    b = (await req.json()) as Record<string, unknown>;
  } catch {
    return new NextResponse(null, { status: 204 });
  }
  if (!b || typeof b !== "object") return new NextResponse(null, { status: 204 });
  // a-arrival-paths: the organic arrival pair must carry a well-formed path key.
  if (b.utm_source === "arrival" && !(b.utm_medium === "organic" && ARRIVAL_CAMPAIGN_RE.test(String(b.utm_campaign ?? "")))) {
    return new NextResponse(null, { status: 204 });
  }
  const ua = req.headers.get("user-agent") || "";
  // a-lernplan-conversion-1019: automation (headless checks, crawlers, Lighthouse) is not an arrival.
  if (uaClass(ua) === "automation") return new NextResponse(null, { status: 204 });
  // a-db-timeouts: the count is written after the 204, so a slow database
  // never holds the visitor's page. Counting is best-effort.
  await afterResponse("/api/beacon/landing", async () => {
    const { error } = await getServiceClient().from("landing_hits").insert({
      path: cap(b.path, 200) || "/",
      utm_source: cap(b.utm_source),
      utm_medium: cap(b.utm_medium),
      utm_campaign: cap(b.utm_campaign),
      utm_content: cap(b.utm_content),
      has_click_id: b.has_click_id === true,
      ref_host: cap(b.ref_host, 120),
      lang: cap(b.lang, 24),
      device: /Mobi|Android/i.test(ua) ? "mobile" : "desktop",
    });
    if (error) console.warn("[beacon/landing] hit not stored", error.message);
  });
  return new NextResponse(null, { status: 204 });
}
