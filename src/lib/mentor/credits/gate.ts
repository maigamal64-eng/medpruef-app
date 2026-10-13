/**
 * Mentor credits: who may see and buy packages. Mirrors the runtime gate in
 * config.ts (AI_FEATURES_ENABLED && MENTOR_ENABLED && DB flag "mentor" &&
 * admission: allowlist or MENTOR_ACCESS_SCOPE, src/lib/mentor/access.ts) and
 * adds MENTOR_PACKAGES_ENABLED. Every account the scope admits can buy. Every flag defaults OFF.
 * The checkout verify route is NOT gated: a buyer returning from Whop must
 * get their credits even if a flag was switched off mid-checkout.
 */

import { flag } from "@/lib/admin/flags";
import { type MentorConfig } from "../config";

import { getServiceClient } from "@/lib/supabase";
import { mentorBetaAllowed } from "../beta";
import { mentorAvailabilityGate } from "../availability";
import type { MentorScopeReads } from "../access";

export type FlagFn = (key: string, userId?: string) => Promise<boolean>;

export async function canBuyMentorPackages(
  userId: string,
  config: Pick<MentorConfig, "aiFeaturesEnabled" | "enabled" | "packagesEnabled" | "betaUserIds"> & Partial<Pick<MentorConfig, "accessScope">>,
  flagFn: FlagFn = (key, id) => flag(key, id, { fresh: true }),
  betaAllowed: (userId: string) => Promise<boolean> = id => mentorBetaAllowed(getServiceClient(), id, config.betaUserIds),
  reads?: MentorScopeReads,
): Promise<boolean> {
  if (!config.packagesEnabled) return false;
  return (await mentorAvailabilityGate(config, userId, (key, id) => flagFn(key, id), betaAllowed, reads)) === "available";
}
