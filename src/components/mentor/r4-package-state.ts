import type { MentorPackageOffer, MentorUsageResponse } from "@/lib/mentor/contract";
import { packagePurchaseState } from "./view-model";
/** Lowest immediate EUR payment among packages this learner can actually buy. */
export function cheapestWay(usage: MentorUsageResponse | undefined, offers: MentorPackageOffer[]) {
  if (!usage?.can_buy || usage.state === "resting") return undefined;
  return offers.filter(o => Number.isFinite(o.price_eur_cents) && o.price_eur_cents > 0 && !packagePurchaseState(usage, o.package_id).disabled)
    .sort((a, b) => a.price_eur_cents - b.price_eur_cents)[0];
}
