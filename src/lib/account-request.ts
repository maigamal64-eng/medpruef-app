/** One synchronous latch covers mouse, keyboard and same-tick duplicate actions. */
export function createActionGate(cooldownMs = 0, now: () => number = Date.now) {
  let busy = false;
  let nextAt = -Infinity;
  return {
    enter() { if (busy || now() < nextAt) return false; busy = true; nextAt = now() + cooldownMs; return true; },
    leave() { busy = false; },
    available() { return !busy && now() >= nextAt; },
  };
}
export const PAYMENT_CHECK_CEILING_MS = 15 * 60_000;
export const PAYMENT_CHECK_COOLDOWN_MS = 10_000;
export function confirmedUnmatchedPayment(data: { reason?: string; payment_ref?: string | null }) {
  // A ledger-truncated unmatched response without a reference proves no payment.
  return data.reason === 'payment_unmatched' && Boolean(data.payment_ref);
}
export function safeCheckoutReference(params: URLSearchParams): string | null {
  return [...params.values()].find(value => /^ch_[A-Za-z0-9_-]{1,150}$/.test(value)) ?? null;
}
