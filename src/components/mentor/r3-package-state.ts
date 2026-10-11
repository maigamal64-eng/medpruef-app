import type { MentorPackageOffer } from "@/lib/mentor/contract";

export const CHECKOUT_RECOVERY_MS = 15_000;

/** Compare actual offered package rows; no price or grant is copied into UI code. */
export function perCreditSaving(basis: MentorPackageOffer | undefined, plus: MentorPackageOffer | undefined): number | null {
  if (!basis || !plus || basis.kind !== "subscription" || plus.kind !== "subscription") return null;
  if (![basis.credits, plus.credits, basis.price_eur_cents, plus.price_eur_cents].every(n => Number.isFinite(n) && n > 0)) return null;
  const baseline = basis.price_eur_cents / basis.credits;
  const saving = (1 - (plus.price_eur_cents / plus.credits) / baseline) * 100;
  const rounded = Math.round(saving);
  return rounded > 0 ? rounded : null;
}

/** Clear an in-flight checkout when the browser restores the page from bfcache. */
export function subscribeCheckoutRestore(target: Pick<Window, "addEventListener" | "removeEventListener">, reset: () => void): () => void {
  const restore = (event: Event) => { if ((event as PageTransitionEvent).persisted) reset(); };
  target.addEventListener("pageshow", restore);
  return () => target.removeEventListener("pageshow", restore);
}
