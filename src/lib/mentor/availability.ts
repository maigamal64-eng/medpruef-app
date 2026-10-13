import { MENTOR_DB_FLAG_KEY, type MentorConfig } from "./config";
import { envAllowlisted } from "./beta";
import { decideMentorAdmission, type MentorAdmissionVia, type MentorScopeReads } from "./access";

export interface MentorAvailabilityResponse {
  available: boolean;
  can_buy: boolean;
}
export type AvailabilityGate = "available" | "disabled" | "not_eligible" | "unresolved";
export type AvailabilityConfig = Pick<MentorConfig, "aiFeaturesEnabled" | "enabled" | "betaUserIds"> & Partial<Pick<MentorConfig, "accessScope" | "packagesEnabled">>;

/**
 * Masters, DB flag, then the shared admission rule (src/lib/mentor/access.ts).
 * No wallet, grants, catalogue, ledger or spend query; the scope may read one
 * lot row when MENTOR_ACCESS_SCOPE widens access.
 */
export async function mentorAvailabilityAdmission(config: AvailabilityConfig, userId: string, flag: (key: string, id: string) => Promise<boolean>, betaAllowed?: (userId: string) => Promise<boolean>, reads?: MentorScopeReads): Promise<{ gate: AvailabilityGate; via: MentorAdmissionVia | null }> {
  if (!config.aiFeaturesEnabled || !config.enabled) return { gate: "disabled", via: null };
  try {
    if (!await flag(MENTOR_DB_FLAG_KEY, userId)) return { gate: "disabled", via: null };
    const via = await decideMentorAdmission({
      scope: config.accessScope ?? "beta",
      packagesEnabled: config.packagesEnabled === true,
      userId,
      allowlisted: async (id) => betaAllowed ? betaAllowed(id) : envAllowlisted(config.betaUserIds, id),
      reads,
    });
    return via ? { gate: "available", via } : { gate: "not_eligible", via: null };
  }
  catch { return { gate: "unresolved", via: null }; }
}

/** Flag/admission only (see mentorAvailabilityAdmission). */
export async function mentorAvailabilityGate(config: AvailabilityConfig, userId: string, flag: (key: string, id: string) => Promise<boolean>, betaAllowed?: (userId: string) => Promise<boolean>, reads?: MentorScopeReads): Promise<AvailabilityGate> {
  return (await mentorAvailabilityAdmission(config, userId, flag, betaAllowed, reads)).gate;
}
