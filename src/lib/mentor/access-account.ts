/**
 * Server-only: can this account open the mentor right now, judged without a
 * request (the referral reward asks this about the referrer). Same rule as
 * the routes (src/lib/mentor/access.ts), with the account row read here
 * because no requireUser guard exists for a third party.
 */

import type { SupabaseClient } from "@supabase/supabase-js";
import { flag } from "@/lib/admin/flags";
import { isPaidTier } from "@/lib/free-tier";
import { readMentorConfig, type MentorConfig } from "./config";
import { mentorBetaAllowed } from "./beta";
import { mentorAvailabilityGate } from "./availability";
import { holdsLiveMentorLot } from "./access";

export async function mentorOpenForAccount(
  db: SupabaseClient,
  userId: string,
  config: MentorConfig = readMentorConfig(),
  flagFn: (key: string, id: string) => Promise<boolean> = (key, id) => flag(key, id, { throwOnError: true }),
): Promise<boolean> {
  const { data, error } = await db.from("users").select("role, tier, tier_expires_at, is_banned").eq("id", userId).maybeSingle();
  if (error) throw new Error("mentor account read failed");
  const row = data as { role: string | null; tier: string | null; tier_expires_at: string | null; is_banned: boolean | null } | null;
  if (!row || row.is_banned) return false;
  const gate = await mentorAvailabilityGate(config, userId, flagFn, (id) => mentorBetaAllowed(db, id, config.betaUserIds, { throwOnError: true }), {
    paidAccess: async () => row.role === "admin" || isPaidTier(row.tier, row.tier_expires_at),
    holdsLiveLot: (id) => holdsLiveMentorLot(db, id),
  });
  return gate === "available";
}
