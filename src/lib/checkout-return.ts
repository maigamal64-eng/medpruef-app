import { CHECKOUT_SETTLE_MS } from './checkout-pending';

export type ReturnOutcome = 'pending' | 'granted' | 'unmatched' | 'failed' | 'no_payment';
export interface VerifyAnswer { granted?: boolean; reason?: string; settled?: boolean }

/** Verify answers that mean "the provider shows no payment (or trial) for this buyer". */
const NO_PAYMENT_REASONS = new Set(['membership_not_found', 'payment_not_found']);
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
 * (settled, same moment it releases the second-checkout guard). Without
 * that field (trial verify) the page waits the same settle window from the
 * first no-payment answer it saw.
 */
export function noPaymentSettledOnPage(settled: boolean | undefined, firstNoPaymentAt: number | null, now = Date.now()): boolean {
  if (settled === true) return true;
  if (settled === false) return false;
  return firstNoPaymentAt !== null && now - firstNoPaymentAt >= CHECKOUT_SETTLE_MS;
}
