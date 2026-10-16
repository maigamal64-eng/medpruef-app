/**
 * Seed seats (a-seed-seats, CEO decision seed-seats of 15 Oct 2026; growth
 * plan section 10, hypothesis X9). A seat code is a campaign code of kind
 * "seat": it gives a new learner 30 days of Pro plus the code's AI Mentor
 * credits, at most 20 seats per venue code. Pure (no I/O), server and client
 * safe.
 *
 * Who may take a seat (enforced in mentor_redeem_seat_code, 20270105090000):
 *   - account created at most 14 days ago, not banned, not an admin;
 *   - never paid (no paid subscriptions row, no granted payment, no paid
 *     grant receipt) and no running access except the 3-day reverse trial,
 *     so a seat never replaces or stacks on a paid or comped period;
 *   - a verified identity (confirmed email or Telegram); one seat per person
 *     (seatIdentityKey in ./server.ts):
 *     the normalised address key and the Telegram id are unique across seats
 *     and outlive a deleted account;
 *   - one code per account (shared with the credit codes).
 *
 * Seat holders are never payers: the seed_seat row has provider "seat" and
 * amount 0, so every paying count leaves it out; the admin lists them beside
 * the paying count (money-rules classifyPayers.seatHolders).
 *
 * SEED_SEATS_ENABLED (server env, default OFF; only the literal "true") turns
 * seat codes on. It also needs the Mentor reachable for a Pro account (the
 * credits are the other half of the seat): AI_FEATURES_ENABLED and
 * MENTOR_ENABLED "true" and MENTOR_ACCESS_SCOPE "paid" or "signed_in".
 * Until then a seat code reads as not active everywhere.
 */
type Env = Record<string, string | undefined>;

export const SEED_SEATS_ENV = "SEED_SEATS_ENABLED";
/** Pro days per seat (the table allows 1..30; the app always writes 30). */
export const SEAT_PRO_DAYS = 30;
/** Seats per venue code (the table CHECK and the redeem function hold the same bound). */
export const SEAT_VENUE_CAP = 20;
/** Account age limit for a seat ("account under 14 days old"). */
export const SEAT_MAX_ACCOUNT_AGE_DAYS = 14;

export const SEAT_TIER = "seed_seat";
export const SEAT_PROVIDER = "seat";

export function seedSeatsFlag(env: Env = process.env): boolean {
  return (env[SEED_SEATS_ENV] ?? "").trim() === "true";
}

/** The seat's credits must be spendable: the Mentor open to a Pro account. */
export function seatMentorReachable(env: Env = process.env): boolean {
  const scope = (env.MENTOR_ACCESS_SCOPE ?? "").trim();
  return env.AI_FEATURES_ENABLED === "true" && env.MENTOR_ENABLED === "true" && (scope === "paid" || scope === "signed_in");
}

/** Seat codes are redeemable only while both hold. */
export function seedSeatsReady(env: Env = process.env): boolean {
  return seedSeatsFlag(env) && seatMentorReachable(env);
}

/** Is this subscriptions row a seed seat? */
export function isSeatRow(s: { tier?: string | null; payment_provider?: string | null } | null | undefined): boolean {
  return !!s && (s.tier === SEAT_TIER || s.payment_provider === SEAT_PROVIDER);
}
