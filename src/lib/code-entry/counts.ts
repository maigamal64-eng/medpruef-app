/**
 * Per-code scoreboard of the code front door (a-code-front-door). Pure: the
 * script (scripts/growth/code-counts.ts) reads the rows, this folds them.
 *
 *   entered   anonymous funnel rows `code_entered_pre_signup` per code (no
 *             automation traffic)
 *   signups   `user_registered` rows whose first touch is the typed code
 *             (attribution utm_source = code, utm_campaign = the code)
 *   redeemed  distinct learners with a `code_redeemed` row, split by the kind
 *             the server decided (campaign, referral, seat)
 *   payers    of those redeemers, learners with a paid subscriptions row
 *             created after the redemption
 * Feeds the Monday scoreboard reads X1, X2, X7 and X9 per code.
 */
export interface EnteredRow { code: string; automation?: boolean }
export interface SignupRow { code: string }
export interface RedeemRow { code: string; kind: string; user_id: string; at: string }

export interface CodeCount {
  code: string;
  entered: number;
  signups: number;
  redeemed: number;
  by_kind: Record<string, number>;
  payers: number;
}

export function foldCodeCounts(entered: EnteredRow[], signups: SignupRow[], redeemed: RedeemRow[], paidAt: Map<string, number[]>): CodeCount[] {
  const by = new Map<string, CodeCount>();
  const row = (code: string): CodeCount => {
    const k = code.toLowerCase();
    let r = by.get(k);
    if (!r) { r = { code: k, entered: 0, signups: 0, redeemed: 0, by_kind: {}, payers: 0 }; by.set(k, r); }
    return r;
  };
  for (const e of entered) if (e.code && !e.automation) row(e.code).entered += 1;
  for (const s of signups) if (s.code) row(s.code).signups += 1;
  const seen = new Set<string>();
  for (const r of redeemed) {
    if (!r.code || !r.user_id) continue;
    const key = `${r.code.toLowerCase()}|${r.user_id}`;
    if (seen.has(key)) continue;
    seen.add(key);
    const c = row(r.code);
    c.redeemed += 1;
    c.by_kind[r.kind] = (c.by_kind[r.kind] ?? 0) + 1;
    const t = Date.parse(r.at);
    if (Number.isFinite(t) && (paidAt.get(r.user_id) ?? []).some((p) => p >= t)) c.payers += 1;
  }
  return [...by.values()].sort((a, b) => b.entered + b.redeemed - (a.entered + a.redeemed) || a.code.localeCompare(b.code));
}
