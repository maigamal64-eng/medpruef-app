import { CHECKOUT_SETTLE_MS } from './checkout-pending';

/** The /pricing second-checkout guard window (pendingCheckout default). */
export const PENDING_GUARD_MS = 30 * 60_000;

export type ReturnOutcome = 'pending' | 'granted' | 'unmatched' | 'failed' | 'no_payment';
export interface VerifyAnswer { granted?: boolean; reason?: string; settled?: boolean | null }

/**
 * Verify answers that mean "the provider shows no membership for this buyer".
 * payment_not_found is NOT one: Whop already shows a valid membership, so the
 * charge may still be settling (review P1, a second charge risk); it stays pending.
 */
const NO_PAYMENT_REASONS = new Set(['membership_not_found']);
const FAILED_REASONS = new Set(['provider_unavailable', 'db_error', 'error']);

/**
 * Issue 7 (user activity 2026-10-12): /checkout/success read a "no payment"
 * answer as pending, so a buyer who never paid saw "Zahlung wird geprüft"
 * and "Ihr Pro-Zugang erscheint hier automatisch". A no-payment answer is
 * its own outcome; a provider or database failure stays "failed" and never
 * claims that no payment exists.
 */
export function verifyOutcome(responseOk: boolean, data: VerifyAnswer): ReturnOutcome {
  if (!responseOk) return 'failed';
  if (data.granted === true) return 'granted';
  if (data.reason === 'payment_unmatched') return 'unmatched';
  if (data.reason && NO_PAYMENT_REASONS.has(data.reason)) return 'no_payment';
  if (data.reason && FAILED_REASONS.has(data.reason)) return 'failed';
  return 'pending';
}

/**
 * Is the no-payment answer final? The checkout verify route says so
 * (settled: the guard-release row exists). Without a server answer (null:
 * no redirect row; undefined: trial verify, which records no release row)
 * the page waits a window from the first no-payment answer it saw: the
 * settle window for a purchase, the full guard window for the trial, so
 * "try again" never meets the /pricing refusal.
 */
export function noPaymentSettledOnPage(settled: boolean | null | undefined, firstNoPaymentAt: number | null, now = Date.now(), windowMs = CHECKOUT_SETTLE_MS): boolean {
  if (settled === true) return true;
  if (settled === false) return false;
  return firstNoPaymentAt !== null && now - firstNoPaymentAt >= windowMs;
}
