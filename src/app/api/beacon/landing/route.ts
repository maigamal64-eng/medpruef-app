import { NextRequest, NextResponse } from "next/server";
import { getServiceClient } from "@/lib/supabase";
import { analyticsWritesDisabled } from "@/lib/supabase-resilience";

export const dynamic = "force-dynamic";

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

export async function POST(req: NextRequest) {
  if (analyticsWritesDisabled()) {
    return new NextResponse(null, { status: 204 });
  }

  try {
    const b = (await req.json()) as Record<string, unknown>;
    const ua = req.headers.get("user-agent") || "";
    const db = getServiceClient();
    await db.from("landing_hits").insert({
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
  } catch {
    /* counting is best-effort, never surface an error */
  }
  return new NextResponse(null, { status: 204 });
}
