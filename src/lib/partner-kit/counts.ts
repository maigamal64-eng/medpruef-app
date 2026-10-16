/**
 * Monday scoreboard read per partner code (a-partner-kit). Pure fold: the
 * script (scripts/partner-kit/counts.ts) reads the rows. Same payer rule as
 * the code front door's code-counts (X7): a paid subscriptions row created at
 * or after the redemption. Internal and counts-only (no id leaves the script);
 * the organiser's own read applies the small-cell rule instead.
 */
export interface PartnerLearnerRow {
  user_id: string;
  redeemed_at: string;
  /** True when the learner's saved exam date or chosen sitting names an official sitting (journey resolveNamedSitting). */
  named_sitting: boolean;
}

export interface PartnerCountRow {
  code: string;
  redemptions: number;
  named_sittings: number;
  checkout_opens: number;
  payers: number;
}

/** checkoutAt / paidAt: per learner, the instants (ms) of a checkout_session_created event / a paid subscriptions row. */
export function foldPartnerCounts(code: string, learners: PartnerLearnerRow[], checkoutAt: Map<string, number[]>, paidAt: Map<string, number[]>): PartnerCountRow {
  const seen = new Set<string>();
  let named = 0;
  let opens = 0;
  let payers = 0;
  for (const l of learners) {
    if (!l.user_id || seen.has(l.user_id)) continue;
    seen.add(l.user_id);
    const from = Date.parse(l.redeemed_at);
    if (l.named_sitting) named += 1;
    if (!Number.isFinite(from)) continue;
    if ((checkoutAt.get(l.user_id) ?? []).some((t) => t >= from)) opens += 1;
    if ((paidAt.get(l.user_id) ?? []).some((t) => t >= from)) payers += 1;
  }
  return { code: code.toLowerCase(), redemptions: seen.size, named_sittings: named, checkout_opens: opens, payers };
}
