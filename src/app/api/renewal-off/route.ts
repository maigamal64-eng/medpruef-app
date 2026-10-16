import { NextRequest, NextResponse } from "next/server";
import { getServiceClient } from "@/lib/supabase";
import { requireUser } from "@/lib/auth-guard";
import { captureServerError } from "@/lib/sentry-capture";
import { effectiveAccessEnd } from "@/lib/reminders/access-ending";
import { extensionAvailability } from "@/lib/whop-extension";
import { RENEWAL_SIGNAL_EVENT } from "@/lib/whop-signal";
import { decideRenewalOff, renewalOffCardEnabled } from "@/lib/renewal-off";

export const dynamic = "force-dynamic";
export const maxDuration = 30;

const HIDDEN = { eligible: false };
const NO_STORE = { "Cache-Control": "no-store" };

/**
 * GET /api/renewal-off (a-whop-cancel-signal): the Home card for a learner
 * who turned renewal off at Whop while access still runs. Default off
 * (RENEWAL_OFF_CARD_ENABLED, read before the session or any database call).
 * Read only; every doubt hides the card. The body carries the learner's own
 * access end, a whop.com manage link and whether /pricing can sell a plan
 * that starts at that end (extension rule, WHOP_EXTENSIONS_ENABLED).
 */
export async function GET(req: NextRequest) {
  if (!renewalOffCardEnabled()) return NextResponse.json(HIDDEN, { headers: NO_STORE });
  const guard = await requireUser(req);
  if ("error" in guard) return guard.error;
  if (guard.role === "admin") return NextResponse.json(HIDDEN, { headers: NO_STORE });
  try {
    const sb = getServiceClient();
    const { data: pins, error: pinErr } = await sb
      .from("subscriptions")
      .select("whop_membership_id, expires_at")
      .eq("user_id", guard.userId)
      .eq("payment_provider", "whop")
      .eq("status", "active")
      .limit(20);
    if (pinErr) {
      captureServerError(pinErr, { route: "/api/renewal-off", phase: "pins" });
      return NextResponse.json(HIDDEN, { headers: NO_STORE });
    }
    if (!pins || pins.length === 0) return NextResponse.json(HIDDEN, { headers: NO_STORE });
    const { data: rows, error: rowErr } = await sb
      .from("user_events")
      .select("created_at, event_data")
      .eq("user_id", guard.userId)
      .eq("event_type", RENEWAL_SIGNAL_EVENT)
      .order("created_at", { ascending: false })
      .limit(20);
    if (rowErr) {
      captureServerError(rowErr, { route: "/api/renewal-off", phase: "signals" });
      return NextResponse.json(HIDDEN, { headers: NO_STORE });
    }
    const decision = decideRenewalOff(pins, rows ?? []);
    if (!decision.show) return NextResponse.json(HIDDEN, { headers: NO_STORE });

    const { data: owner, error: ownerErr } = await sb
      .from("users").select("role, tier, tier_expires_at").eq("id", guard.userId).maybeSingle();
    if (ownerErr || !owner) return NextResponse.json(HIDDEN, { headers: NO_STORE });
    const end = effectiveAccessEnd(owner as { role: string | null; tier: string | null; tier_expires_at: string | null });
    if (end.kind !== "ends") return NextResponse.json(HIDDEN, { headers: NO_STORE });
    const accessEnd = new Date(end.endMs).toISOString();
    const pricing = (await extensionAvailability(sb, guard.userId, owner.tier_expires_at as string)) === "available";
    return NextResponse.json({ eligible: true, accessEnd, manageUrl: decision.manageUrl, pricing }, { headers: NO_STORE });
  } catch (err) {
    captureServerError(err, { route: "/api/renewal-off", userId: guard.userId });
    return NextResponse.json(HIDDEN, { headers: NO_STORE });
  }
}
