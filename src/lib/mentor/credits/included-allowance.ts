import { creditsFromMicro } from "../config";
import type { CreditPackageRow, MentorPackageId, MentorUsageResponse } from "../contract";
import type { WalletBalance } from "../seam";

/** Display an actual included lot and catalogue row. A lot expiry alone is never a renewal promise. */
export function includedAllowance(
  balance: WalletBalance,
  catalogue: Map<MentorPackageId, CreditPackageRow>,
  entitlementEnds: string[],
  now: Date,
  /** Amount overrides while MENTOR_INCLUDED_RAISE_ENABLED is on (free-credits.ts). */
  amounts: Partial<Record<string, number>> = {},
): MentorUsageResponse["included_allowance"] {
  const lot = balance.lots.filter(l => l.source === "pro_included" && Date.parse(l.startsAt) <= now.getTime() && Date.parse(l.expiresAt) > now.getTime())
    .sort((a, b) => Date.parse(b.startsAt) - Date.parse(a.startsAt))[0];
  if (!lot) return undefined;
  const row = catalogue.get(lot.packageId);
  if (!row?.active || !row.period_days || row.period_days <= 0) return undefined;
  const sliceEnd = Date.parse(lot.startsAt) + row.period_days * 86_400_000;
  // Only promise the next grant when the existing paid entitlement covers it.
  const continues = entitlementEnds.some(end => Date.parse(end) > sliceEnd);
  return {
    credits: creditsFromMicro(amounts[lot.packageId] ?? row.grant_micro),
    credits_left: creditsFromMicro(Math.min(lot.remainingMicro, Math.max(0, balance.availableMicro))),
    period_days: row.period_days,
    renews_at: continues ? new Date(sliceEnd).toISOString() : null,
  };
}
