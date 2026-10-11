import { MENTOR_DB_FLAG_KEY, type MentorConfig } from "./config";

export interface MentorAvailabilityResponse {
  available: boolean;
  can_buy: boolean;
}
export type AvailabilityGate = "available" | "disabled" | "not_eligible" | "unresolved";
/** Flag/allowlist only. No wallet, grants, catalogue, ledger or spend query. */
export async function mentorAvailabilityGate(config: Pick<MentorConfig, "aiFeaturesEnabled" | "enabled" | "betaUserIds">, userId: string, flag: (key: string, id: string) => Promise<boolean>, betaAllowed?: (userId: string) => Promise<boolean>): Promise<AvailabilityGate> {
  if (!config.aiFeaturesEnabled || !config.enabled) return "disabled";
  try {
    if (!await flag(MENTOR_DB_FLAG_KEY, userId)) return "disabled";
    const allowed = betaAllowed ? await betaAllowed(userId) : config.betaUserIds.length === 0 || config.betaUserIds.includes(userId.toLowerCase());
    return allowed ? "available" : "not_eligible";
  }
  catch { return "unresolved"; }
}
