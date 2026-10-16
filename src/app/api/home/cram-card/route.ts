import { NextResponse, type NextRequest } from "next/server";
import { isPaidAccess, requireUser } from "@/lib/auth-guard";
import { getServiceClient } from "@/lib/supabase";
import { withDbUnavailable } from "@/lib/db-unavailable-route";
import { homeCramCardEnabled } from "@/lib/home-cram-card/flag";
import { pickCramCreditsLot } from "@/lib/home-cram-card/rules";
import { FREE_CREDIT_MICRO_PER_CREDIT, readFreeCreditConfig } from "@/lib/mentor/credits/free-credits";
import { mentorLearnerRouteOpenFor } from "@/lib/mentor/route-gate";
import { getGmAvailability } from "@/lib/gm-practice/availability";

export const dynamic = "force-dynamic";
export const maxDuration = 30;

/** Lot sources the free-credit hooks write (welcome, code, experience reward) plus admin gifts (win-back, rewards). */
const FREE_CARD_SOURCES = ["welcome_taste", "campaign_code", "experience_reward", "admin_gift"] as const;

/**
 * GET /api/home/cram-card?need=credits|gm (a-cram-card): the two server reads
 * the Home cram card cannot make itself. {enabled:false} without a session or
 * database read while HOME_CRAM_CARD_ENABLED is off.
 *  - need=credits (SIP card): the caller's own live free-credit lot that ends
 *    soonest, {credits left, expires_at}, only while a free-credit hook is on
 *    and the mentor is open to the account; else null.
 *  - need=gm (Rez/GM card): whether Gerichtsmedizin practice is available.
 * Own data only. A failed read answers null / false, never an error the card shows.
 */
export const GET = withDbUnavailable(async (req: NextRequest) => {
  const headers = { "cache-control": "no-store" };
  if (!homeCramCardEnabled()) return NextResponse.json({ enabled: false }, { headers });
  const guard = await requireUser(req);
  if ("error" in guard) return guard.error;
  const need = new URL(req.url).searchParams.get("need");

  if (need === "gm") {
    const { available } = await getGmAvailability(getServiceClient);
    return NextResponse.json({ enabled: true, gm: available }, { headers });
  }
  if (need !== "credits") return NextResponse.json({ enabled: true }, { headers });

  const fc = readFreeCreditConfig();
  const hooksOn = fc.welcomeEnabled || fc.campaignEnabled || fc.experienceEnabled || fc.winbackEnabled || fc.rewardLotsEnabled;
  if (!hooksOn) return NextResponse.json({ enabled: true, credits: null }, { headers });
  const paid = isPaidAccess(guard);
  if (!(await mentorLearnerRouteOpenFor({ userId: guard.userId, paidAccess: paid }))) {
    return NextResponse.json({ enabled: true, credits: null }, { headers });
  }
  const now = new Date();
  const { data, error } = await getServiceClient().from("ai_credit_lot")
    .select("source, source_id, granted_micro, spent_micro, clawed_back_micro, expires_at")
    .eq("user_id", guard.userId).in("source", [...FREE_CARD_SOURCES])
    .eq("status", "live").gt("expires_at", now.toISOString())
    .order("expires_at", { ascending: true }).limit(20);
  if (error) return NextResponse.json({ enabled: true, credits: null }, { headers });
  // admin_gift also holds comped-subscription included lots (key <sub>:<slice>); only the reward and win-back lots (key reward:...) are free-credit lots.
  const rows = ((data ?? []) as Array<Parameters<typeof pickCramCreditsLot>[0][number] & { source: string; source_id: string | null }>)
    .filter((r) => r.source !== "admin_gift" || (r.source_id ?? "").startsWith("reward:"));
  const credits = pickCramCreditsLot(rows, FREE_CREDIT_MICRO_PER_CREDIT, now);
  return NextResponse.json({ enabled: true, credits }, { headers });
});
