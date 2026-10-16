/**
 * Deadlines for Whop API calls (a-whop-webhook-ack, review G3/G14).
 * Dependency-free so any Whop caller can import it.
 *
 * WHOP_FETCH_TIMEOUT_MS bounds every Whop read or write made while a webhook
 * delivery or a learner request waits: Whop counts a delivery slower than
 * 5 s as failed, so one call must end well inside that.
 * WHOP_CHECKOUT_CREATE_TIMEOUT_MS bounds the checkout-configuration POST,
 * a learner click rather than a webhook, where session creation can be
 * slower than a read.
 */
export const WHOP_FETCH_TIMEOUT_MS = 4000;
export const WHOP_CHECKOUT_CREATE_TIMEOUT_MS = 8000;
