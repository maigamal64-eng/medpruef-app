/**
 * Mentor credits: who may see and buy packages. Mirrors the runtime gate in
 * config.ts (AI_FEATURES_ENABLED && MENTOR_ENABLED && DB flag "mentor" &&
 * beta allowlist) and adds MENTOR_PACKAGES_ENABLED. Every flag defaults OFF.
 * The checkout verify route is NOT gated: a buyer returning from Whop must
 * get their credits even if a flag was switched off mid-checkout.
 */

import { flag } from "@/lib/admin/flags";
import { MENTOR_DB_FLAG_KEY, type MentorConfig } from "../config";

export type FlagFn = (key: string, userId?: string) => Promise<boolean>;

export async function canBuyMentorPackages(
  userId: string,
  config: Pick<MentorConfig, "aiFeaturesEnabled" | "enabled" | "packagesEnabled" | "betaUserIds">,
  flagFn: FlagFn = flag,
): Promise<boolean> {
  if (!config.aiFeaturesEnabled || !config.enabled || !config.packagesEnabled) return false;
  if (config.betaUserIds.length > 0 && !config.betaUserIds.includes(userId.toLowerCase())) return false;
  try {
    return await flagFn(MENTOR_DB_FLAG_KEY, userId);
  } catch {
    return false;
  }
}
