import type { Metadata } from "next";
import { headers } from "next/headers";
import { callerIp, checkRateLimit, rateKey } from "@/lib/rate-limit";
import { getServiceClient } from "@/lib/supabase";
import { guidanceLang } from "@/lib/guidance/facts";
import { readFreeCreditConfig } from "@/lib/mentor/credits/free-credits";
import { readLiveCampaign } from "@/lib/mentor/credits/campaign";
import { SEAT_MAX_ACCOUNT_AGE_DAYS, seedSeatsReady } from "@/lib/seed-seats";
import { readCodeKind, readLiveSeat } from "@/lib/seed-seats/server";
import { partnerAccountMaxAgeDays } from "@/lib/partner-kit";
import GratisClient from "./GratisClient";

export const dynamic = "force-dynamic";

// Campaign links are shared in groups and with partners; they are never indexed.
export const metadata: Metadata = {
  title: "MedPrüf: Credits für den KI-Mentor",
  robots: { index: false, follow: false },
};

/**
 * /gratis/<code> (a-free-credit-hooks): what a campaign code gives, then
 * register or sign in, then the code is redeemed by an explicit POST.
 * Only a live code is described. Unknown, paused, ended or not-started codes,
 * and every code while MENTOR_CAMPAIGN_CODES_ENABLED is off, show the same
 * neutral page, so the page never confirms that a code exists.
 * a-seed-seats: while seat codes are on (seedSeatsReady), a live seat code
 * describes the 30-day Pro seat instead; a seat code is never described as a
 * credits code (with seats off it reads as not active).
 */
export default async function GratisPage({ params, searchParams }: { params: Promise<{ code: string }>; searchParams: Promise<{ lang?: string | string[] }> }) {
  const [{ code }, sp] = await Promise.all([params, searchParams]);
  const fc = readFreeCreditConfig();
  const seats = seedSeatsReady();
  // Guessing codes through the page: 30 reads a minute per address, then the neutral page without a read.
  const gate = fc.campaignEnabled || seats ? checkRateLimit({ key: rateKey("gratis-page", callerIp({ headers: await headers() })), limit: 30, windowMs: 60_000 }) : null;
  const now = new Date();
  const sb = gate?.allowed ? getServiceClient() : null;
  // Next already decodes the segment; a malformed one is just not a code (normalizeCampaignCode refuses it).
  const seat = seats && sb ? await readLiveSeat(sb, code, now) : null;
  let live = !seat && fc.campaignEnabled && sb ? await readLiveCampaign(sb, code, now) : null;
  // A seat code is never offered as a credits code (its credits come only with the seat).
  if (live && sb && (await readCodeKind(sb, live.code).catch(() => "seat")) === "seat") live = null;
  return (
    <GratisClient
      campaign={live ? { code: live.code, credits: live.credits, expiryDays: live.expiry_days } : null}
      seat={seat}
      maxAgeDays={partnerAccountMaxAgeDays(code, seat ? SEAT_MAX_ACCOUNT_AGE_DAYS : fc.campaignAccountMaxAgeDays)}
      lang={guidanceLang(sp.lang)}
    />
  );
}
