/**
 * What the Germany plan step knows about a learner who already has access (a-dekp-walkfix2-1120).
 * The same reading as the price page (PricingClient: /api/user/subscription, extendsFrom only when the
 * server confirms an extension), so the confirm sheet never promises a later start the checkout would refuse.
 */
import { persistAuthEntry } from "@/lib/auth-entry";

export type PlanSubInfo = { extendable: boolean } | "error" | null;

/** Reads the /api/user/subscription answer the way PricingClient does: only `extension_available === true` extends. */
export function parseSubInfo(d: unknown): PlanSubInfo {
  const data = d as { extension_available?: unknown } | null | undefined;
  return { extendable: data?.extension_available === true };
}

/** The current end date the confirm sheet starts the new period from, or null (no access, no end date, no confirmed extension). */
export function extendsFromFor(isPaid: boolean, tierExpiresAt: string | null | undefined, subInfo: PlanSubInfo): string | null {
  return isPaid && tierExpiresAt && subInfo && subInfo !== "error" && subInfo.extendable ? tierExpiresAt : null;
}

/** The trial's start keeps the learner on the Germany route when Whop sends them back to the payment return page. */
export function trialWorkingChange(working: boolean, casesHref: string, setBusy: (busy: boolean) => void): void {
  if (working) persistAuthEntry({ next: casesHref });
  setBusy(working);
}

/**
 * A learner with access the server will not extend (renewing, unverified, one-time without extension, admin) gets no buy
 * button, like the price page's account note: the checkout would refuse with ALREADY_RENEWING or EXTENSION_UNAVAILABLE.
 * While the subscription read is still loading the button stays, the server decides.
 */
export function monthBlocked(isPaid: boolean, isAdmin: boolean, subInfo: PlanSubInfo): boolean {
  if (!isPaid) return false;
  if (isAdmin) return true;
  return subInfo !== null && (subInfo === "error" || !subInfo.extendable);
}
