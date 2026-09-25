const AMBIGUOUS_BILLING_TIER_KEYS = new Set([
  "first_month_19",
  "first_3mo_27",
]);

/**
 * Return subscription labels that do not imply billing cadence when a
 * legacy tier key is shared by one-time and recurring provider plans.
 */
export function getSubscriptionDisplayNames(
  tierKey: string,
  humanName: string,
  humanNameDe: string,
): { humanName: string; humanNameDe: string } {
  if (AMBIGUOUS_BILLING_TIER_KEYS.has(tierKey)) {
    return {
      humanName: "MedPrüf Pro access",
      humanNameDe: "MedPrüf Pro-Zugang",
    };
  }

  return { humanName, humanNameDe };
}
