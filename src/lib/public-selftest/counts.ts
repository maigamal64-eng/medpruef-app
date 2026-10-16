/**
 * a-public-selftest: pure fold for the Monday scoreboard (scripts/selftest/counts.ts).
 * Counts only: no ids, no scores, no dates leave this function.
 */
export interface FunnelRow { event: string; metadata: Record<string, unknown> | null }
export interface SavedRow { user_id: string; at: string; sitting: string }
export interface CheckoutRow { user_id: string; at: string }

export const CHECKOUT_WINDOW_DAYS = 14;

export interface SelftestCounts {
  arrivals: number;
  starts: { total: number; by_exam: Record<string, number>; by_source: Record<string, number> };
  finishes: { total: number; by_bucket: Record<string, number> };
  register_clicks: { total: number; named: number; open: number };
  signups: { registration_success_selftest: number; first_touch_selbsttest: number };
  saved: { accounts: number; named_sitting: number; open: number };
  checkout_opens_14d: { accounts: number };
}

const bump = (o: Record<string, number>, k: unknown) => { const key = typeof k === "string" && k ? k : "unknown"; o[key] = (o[key] ?? 0) + 1; };

export function foldSelftestCounts(input: {
  arrivals: number;
  funnel: readonly FunnelRow[];
  firstTouchSignups: number;
  saved: readonly SavedRow[];
  checkouts: readonly CheckoutRow[];
}): SelftestCounts {
  const out: SelftestCounts = {
    arrivals: input.arrivals,
    starts: { total: 0, by_exam: {}, by_source: {} },
    finishes: { total: 0, by_bucket: {} },
    register_clicks: { total: 0, named: 0, open: 0 },
    signups: { registration_success_selftest: 0, first_touch_selbsttest: input.firstTouchSignups },
    saved: { accounts: 0, named_sitting: 0, open: 0 },
    checkout_opens_14d: { accounts: 0 },
  };
  for (const r of input.funnel) {
    const m = r.metadata ?? {};
    if (m.ua_class === "automation") continue;
    if (r.event === "selftest_start") { out.starts.total++; bump(out.starts.by_exam, m.exam); bump(out.starts.by_source, m.source); }
    else if (r.event === "selftest_finish") { out.finishes.total++; bump(out.finishes.by_bucket, m.bucket); }
    else if (r.event === "selftest_register_click") { out.register_clicks.total++; if (m.sitting === "named") out.register_clicks.named++; else out.register_clicks.open++; }
    else if (r.event === "registration_success" && m.intent === "selftest") out.signups.registration_success_selftest++;
  }
  // One saved row per account (the route refuses a second); keep the first if the data says otherwise.
  const firstSaved = new Map<string, SavedRow>();
  for (const s of input.saved) { const prev = firstSaved.get(s.user_id); if (!prev || s.at < prev.at) firstSaved.set(s.user_id, s); }
  out.saved.accounts = firstSaved.size;
  for (const s of firstSaved.values()) { if (s.sitting === "named") out.saved.named_sitting++; else out.saved.open++; }
  const windowMs = CHECKOUT_WINDOW_DAYS * 86_400_000;
  const opened = new Set<string>();
  for (const c of input.checkouts) {
    const s = firstSaved.get(c.user_id);
    if (!s) continue;
    const dt = Date.parse(c.at) - Date.parse(s.at);
    if (Number.isFinite(dt) && dt >= 0 && dt <= windowMs) opened.add(c.user_id);
  }
  out.checkout_opens_14d.accounts = opened.size;
  return out;
}
