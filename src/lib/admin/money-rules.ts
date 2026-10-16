/**
 * money-rules: the ONE definition of money in and paying for every admin
 * surface (ADM-01 option A, approved 2026-10-11 as pick-admin-01).
 *
 *   Money in   = paid payments by payment date, gross, minus refunds on the
 *                day the refund happened (cash basis), Vienna calendar days.
 *   Paying     = distinct real learners (staff and test accounts excluded)
 *                with an active, unexpired subscription on a real payment
 *                rail AND at least one positive payment. Trial rows with no
 *                positive charge are reported apart as "in trial".
 *
 * Pure and dependency-free so the overview route, the payments route, the
 * roster route, growth/control-plane metrics and the unit tests all share
 * the exact same arithmetic. Server modules load the rows; this file only
 * classifies them. Never sums two currencies together.
 *
 * Gross vs net (OW-31): Whop delivers `amount_after_fees` first, so one
 * payment can be logged as 1900 (the charge) and 1772 (Whop net). Gross is
 * the highest amount seen for a payment id, net is the lowest positive
 * amount below it. When only one amount was ever delivered, net is unknown,
 * never assumed equal to gross.
 */

export const VIENNA_TZ = "Europe/Vienna";
const DAY_MS = 86_400_000;

// ── Staff and test accounts ─────────────────────────────────────────────
// One predicate, mirrored by the a14 SQL changeset (ops_growth_summary).
// Telegram-only accounts carry no email and cannot be classified here.
const INTERNAL_DOMAINS = ["@medpruf.com", "@medpruef.com"];
const TEST_WORD = /(^|[^a-z])(test|testing|fixture|e2e|dummy|fake|qa|demo|playwright|smoke)([^a-z]|$)/;

export interface AccountLike {
  email?: string | null;
  role?: string | null;
  tier?: string | null;
}

export function isStaffOrTestAccount(u: AccountLike | null | undefined): boolean {
  if (!u) return false;
  if (u.role === "admin" || u.tier === "admin") return true;
  const e = (u.email ?? "").trim().toLowerCase();
  if (!e) return false;
  if (INTERNAL_DOMAINS.some((d) => e.endsWith(d))) return true;
  if (e.endsWith(".invalid") || e.endsWith(".test") || /@example\./.test(e)) return true;
  return TEST_WORD.test(e);
}

export const STAFF_TEST_BASIS =
  "Staff and test accounts are excluded: admin role or tier, @medpruf.com / @medpruef.com, reserved test domains (.invalid, example.*, .test) and test words in the email. Telegram-only accounts have no email and stay counted.";

// ── Vienna calendar ─────────────────────────────────────────────────────
const dayFmt = new Intl.DateTimeFormat("en-CA", {
  timeZone: VIENNA_TZ,
  year: "numeric",
  month: "2-digit",
  day: "2-digit",
});

/** YYYY-MM-DD of the instant in Vienna. */
export function viennaDay(at: Date | string | number): string {
  return dayFmt.format(new Date(at));
}

/** YYYY-MM of the instant in Vienna. */
export function viennaMonth(at: Date | string | number): string {
  return viennaDay(at).slice(0, 7);
}

/** The last `n` Vienna days ending today, oldest first. */
export function lastViennaDays(now: Date, n: number): string[] {
  const out: string[] = [];
  const seen = new Set<string>();
  // Step back in 12h increments so DST shifts never skip or repeat a day.
  for (let t = now.getTime(); out.length < n; t -= DAY_MS / 2) {
    const d = viennaDay(t);
    if (!seen.has(d)) {
      seen.add(d);
      out.unshift(d);
    }
  }
  return out;
}

/** The last `n` Vienna months ending this month, oldest first. */
export function lastViennaMonths(now: Date, n: number): string[] {
  const [y, m] = viennaMonth(now).split("-").map(Number);
  const out: string[] = [];
  for (let i = n - 1; i >= 0; i--) {
    const idx = y * 12 + (m - 1) - i;
    out.push(`${Math.floor(idx / 12)}-${String((idx % 12) + 1).padStart(2, "0")}`);
  }
  return out;
}

// ── Ledger ──────────────────────────────────────────────────────────────

/** A payment_events row as the server loads it (subset of columns). */
export interface LedgerEventRow {
  id?: number;
  event: string;
  provider: string | null;
  user_id: string | null;
  tier: string | null;
  plan_id: string | null;
  payment_id: string | null;
  amount_cents: number | null;
  currency: string | null;
  reason: string | null;
  matched: boolean | null;
  metadata: Record<string, unknown> | null;
  created_at: string;
}

export type ResolutionKind = "link" | "test" | "not_ours";

/** Payment ids are provider tokens (pay_…, r_…, numeric NOWPayments ids). */
export const PAYMENT_ID_RE = /^[A-Za-z0-9_-]{3,100}$/;

export interface PaymentResolution {
  payment_id: string;
  kind: ResolutionKind;
  user_id: string | null;
  reason: string;
  created_at: string;
}

export interface LedgerPayment {
  payment_id: string;
  provider: string;
  currency: string;
  /** Earliest time the payment was observed (the cash date). */
  paid_at: string;
  /** Highest amount seen (the charge). null = no amount ever delivered. */
  gross_cents: number | null;
  /** Lowest positive amount below gross (Whop net). null = unknown. */
  net_cents: number | null;
  granted: boolean;
  user_id: string | null;
  plan_id: string | null;
  tier: string | null;
  failure_reasons: string[];
  last_seen_at: string;
  resolution: PaymentResolution | null;
}

export interface LedgerRefund {
  refund_id: string;
  provider: string;
  currency: string;
  refunded_at: string;
  amount_cents: number | null;
  kind: "refund" | "dispute";
}

export interface Ledger {
  payments: LedgerPayment[];
  refunds: LedgerRefund[];
}

const PAYMENT_SUCCEEDED = new Set(["payment.succeeded", "payment_succeeded"]);

function whopEvent(row: LedgerEventRow): string {
  const m = row.metadata ?? {};
  const v = (m.whop_event ?? m.event) as unknown;
  return typeof v === "string" ? v : "";
}

export function isRefundEvent(name: string): boolean {
  return /^refund[._]/.test(name) || name === "payment.refunded" || name === "payment_refunded";
}

export function isDisputeEvent(name: string): boolean {
  return /^dispute[._]/.test(name) || /^dispute_alert[._]/.test(name) || name === "payment.disputed" || name === "payment_disputed";
}

/** A delivery that tells us money arrived (or the app granted on a payment). */
export function isPaymentRow(row: LedgerEventRow): boolean {
  if (!row.payment_id) return false;
  if (row.event === "grant_succeeded") return true;
  return row.event === "webhook_received" && PAYMENT_SUCCEEDED.has(whopEvent(row));
}

function cents(v: unknown): number | null {
  const n = typeof v === "number" ? v : typeof v === "string" ? Number(v) : NaN;
  return Number.isFinite(n) ? Math.round(n) : null;
}

/**
 * Collapse payment_events into one record per payment id plus one per refund
 * id. grant_failed rows attach their reason (and user) to the payment they
 * name, so a payment that never granted keeps its failure history.
 */
export function buildLedger(rows: LedgerEventRow[], resolutions: PaymentResolution[] = []): Ledger {
  const byPayment = new Map<string, LedgerPayment & { amounts: number[] }>();
  const refunds = new Map<string, LedgerRefund>();
  const resolutionById = new Map(resolutions.map((r) => [r.payment_id, r]));
  const failures = new Map<string, LedgerEventRow[]>();

  for (const row of rows) {
    const id = row.payment_id;
    if (!id) continue;
    const name = whopEvent(row);
    if (row.event === "webhook_received" && (isRefundEvent(name) || isDisputeEvent(name))) {
      const amount = cents(row.amount_cents);
      const prev = refunds.get(id);
      const currency = (row.currency ?? "eur").toUpperCase();
      if (!prev) {
        refunds.set(id, {
          refund_id: id,
          provider: row.provider ?? "whop",
          currency,
          refunded_at: row.created_at,
          amount_cents: amount,
          kind: isDisputeEvent(name) ? "dispute" : "refund",
        });
      } else {
        if (Date.parse(row.created_at) < Date.parse(prev.refunded_at)) prev.refunded_at = row.created_at;
        if (amount != null && (prev.amount_cents == null || amount > prev.amount_cents)) prev.amount_cents = amount;
      }
      continue;
    }
    if (row.event === "grant_failed") {
      const list = failures.get(id) ?? [];
      list.push(row);
      failures.set(id, list);
      continue;
    }
    if (!isPaymentRow(row)) continue;
    let p = byPayment.get(id);
    if (!p) {
      p = {
        payment_id: id,
        provider: row.provider ?? "whop",
        currency: (row.currency ?? "eur").toUpperCase(),
        paid_at: row.created_at,
        gross_cents: null,
        net_cents: null,
        granted: false,
        user_id: null,
        plan_id: null,
        tier: null,
        failure_reasons: [],
        last_seen_at: row.created_at,
        resolution: resolutionById.get(id) ?? null,
        amounts: [],
      };
      byPayment.set(id, p);
    }
    if (Date.parse(row.created_at) < Date.parse(p.paid_at)) p.paid_at = row.created_at;
    if (Date.parse(row.created_at) > Date.parse(p.last_seen_at)) p.last_seen_at = row.created_at;
    const amount = cents(row.amount_cents);
    if (amount != null) p.amounts.push(amount);
    if (row.event === "grant_succeeded") {
      p.granted = true;
      if (row.user_id) p.user_id = row.user_id;
      if (row.tier) p.tier = row.tier;
    }
    if (!p.plan_id && row.plan_id) p.plan_id = row.plan_id;
    if (!p.tier && row.tier) p.tier = row.tier;
  }

  for (const [id, list] of failures) {
    let p = byPayment.get(id);
    if (!p) {
      // A paid payment known only from a failed grant (e.g. checkout verify
      // confirmed it while the webhook was rejected) still belongs in the
      // queue. Rows without a positive amount (claim releases) do not.
      const firstPaid = list.find((f) => (cents(f.amount_cents) ?? 0) > 0);
      if (!firstPaid) continue;
      p = {
        payment_id: id,
        provider: firstPaid.provider ?? "whop",
        currency: (firstPaid.currency ?? "eur").toUpperCase(),
        paid_at: list.reduce((m, f) => (Date.parse(f.created_at) < Date.parse(m) ? f.created_at : m), firstPaid.created_at),
        gross_cents: null,
        net_cents: null,
        granted: false,
        user_id: null,
        plan_id: null,
        tier: null,
        failure_reasons: [],
        last_seen_at: firstPaid.created_at,
        resolution: resolutionById.get(id) ?? null,
        amounts: [],
      };
      byPayment.set(id, p);
    }
    for (const f of list) {
      if (f.reason && !p.failure_reasons.includes(f.reason)) p.failure_reasons.push(f.reason);
      if (!p.user_id && f.user_id) p.user_id = f.user_id;
      if (!p.plan_id && f.plan_id) p.plan_id = f.plan_id;
      if (!p.tier && f.tier) p.tier = f.tier;
      if (Date.parse(f.created_at) > Date.parse(p.last_seen_at)) p.last_seen_at = f.created_at;
      const amount = cents(f.amount_cents);
      if (amount != null && p.amounts.length === 0) p.amounts.push(amount);
    }
  }

  const payments: LedgerPayment[] = [];
  for (const p of byPayment.values()) {
    const { amounts, ...rest } = p;
    if (amounts.length > 0) {
      const gross = Math.max(...amounts);
      const positives = amounts.filter((a) => a > 0 && a < gross);
      rest.gross_cents = gross;
      rest.net_cents = positives.length > 0 ? Math.min(...positives) : null;
    }
    payments.push(rest);
  }
  payments.sort((a, b) => Date.parse(b.paid_at) - Date.parse(a.paid_at));
  const refundList = [...refunds.values()].sort((a, b) => Date.parse(b.refunded_at) - Date.parse(a.refunded_at));
  return { payments, refunds: refundList };
}

/** Money that counts: positive gross, and not dismissed as test / not ours. */
export function countsAsMoneyIn(p: LedgerPayment): boolean {
  if (p.gross_cents == null || p.gross_cents <= 0) return false;
  return !(p.resolution && (p.resolution.kind === "test" || p.resolution.kind === "not_ours"));
}

/** A EUR 0 card-on-file trial start. Never money. */
export function isTrialStart(p: LedgerPayment): boolean {
  return p.gross_cents === 0;
}

/** Paid, never granted, not resolved: the Unresolved payments queue. */
export function isUnresolvedPayment(p: LedgerPayment): boolean {
  return p.gross_cents != null && p.gross_cents > 0 && !p.granted && !p.resolution;
}

// ── Money in (cash basis) ───────────────────────────────────────────────

export interface MoneyMonth {
  month: string;
  paid_payments: number;
  trial_starts: number;
  gross_cents: number;
  /** Fees Whop reported (gross minus net) for payments where net is known. */
  fees_known_cents: number;
  payments_with_fee_known: number;
  refunds_cents: number;
  refunds: number;
  /** gross minus refunds booked this month. */
  cash_cents: number;
}

export interface MoneyIn {
  currency: "EUR";
  today: { gross_cents: number; refunds_cents: number; cash_cents: number };
  month_to_date: { gross_cents: number; refunds_cents: number; cash_cents: number };
  /** Cash per Vienna day, oldest first, 7 entries. */
  series_7d: number[];
  days_7d: string[];
  months: MoneyMonth[];
  lifetime_gross_cents: number;
  /** Payments and refunds in other currencies, never converted into EUR. */
  other_currencies: Array<{ currency: string; paid_payments: number; gross_cents: number; refunds_cents: number }>;
  refunds_without_amount: number;
  basis: string;
}

export const MONEY_IN_BASIS =
  "Cash basis: paid payments by payment date at the gross charge, refunds subtracted on the day they happened, Vienna calendar days. EUR only; other currencies are listed apart and never converted. Payments marked as test or not ours are excluded. Gross is the highest amount recorded for a payment: when checkout verify ran it is the plan's list price, otherwise the amount Whop delivered, which can already be after fees. Net and fees show only where both amounts were recorded. Source: payment_events (Whop and mentor packages); NOWPayments crypto, silent since June 2026, is not included. Disputes are listed, not subtracted.";

export function computeMoneyIn(ledger: Ledger, now: Date, monthsBack = 6): MoneyIn {
  const today = viennaDay(now);
  const thisMonth = viennaMonth(now);
  const days = lastViennaDays(now, 7);
  const months = lastViennaMonths(now, monthsBack);
  const series = new Map(days.map((d) => [d, 0]));
  const monthRows = new Map<string, MoneyMonth>(
    months.map((m) => [m, { month: m, paid_payments: 0, trial_starts: 0, gross_cents: 0, fees_known_cents: 0, payments_with_fee_known: 0, refunds_cents: 0, refunds: 0, cash_cents: 0 }]),
  );
  const t = { gross_cents: 0, refunds_cents: 0, cash_cents: 0 };
  const mtd = { gross_cents: 0, refunds_cents: 0, cash_cents: 0 };
  const other = new Map<string, { currency: string; paid_payments: number; gross_cents: number; refunds_cents: number }>();
  let lifetime = 0;
  let refundsWithoutAmount = 0;

  for (const p of ledger.payments) {
    const day = viennaDay(p.paid_at);
    const month = day.slice(0, 7);
    if (isTrialStart(p) && p.currency === "EUR") {
      const mr = monthRows.get(month);
      if (mr) mr.trial_starts += 1;
      continue;
    }
    if (!countsAsMoneyIn(p)) continue;
    const gross = p.gross_cents as number;
    if (p.currency !== "EUR") {
      const o = other.get(p.currency) ?? { currency: p.currency, paid_payments: 0, gross_cents: 0, refunds_cents: 0 };
      o.paid_payments += 1;
      o.gross_cents += gross;
      other.set(p.currency, o);
      continue;
    }
    lifetime += gross;
    if (series.has(day)) series.set(day, (series.get(day) ?? 0) + gross);
    if (day === today) t.gross_cents += gross;
    if (month === thisMonth) mtd.gross_cents += gross;
    const mr = monthRows.get(month);
    if (mr) {
      mr.paid_payments += 1;
      mr.gross_cents += gross;
      if (p.net_cents != null) {
        mr.fees_known_cents += gross - p.net_cents;
        mr.payments_with_fee_known += 1;
      }
    }
  }

  for (const r of ledger.refunds) {
    if (r.kind !== "refund") continue;
    if (r.amount_cents == null) {
      refundsWithoutAmount += 1;
      continue;
    }
    if (r.currency !== "EUR") {
      const o = other.get(r.currency) ?? { currency: r.currency, paid_payments: 0, gross_cents: 0, refunds_cents: 0 };
      o.refunds_cents += r.amount_cents;
      other.set(r.currency, o);
      continue;
    }
    const day = viennaDay(r.refunded_at);
    const month = day.slice(0, 7);
    if (series.has(day)) series.set(day, (series.get(day) ?? 0) - r.amount_cents);
    if (day === today) t.refunds_cents += r.amount_cents;
    if (month === thisMonth) mtd.refunds_cents += r.amount_cents;
    const mr = monthRows.get(month);
    if (mr) {
      mr.refunds += 1;
      mr.refunds_cents += r.amount_cents;
    }
  }

  t.cash_cents = t.gross_cents - t.refunds_cents;
  mtd.cash_cents = mtd.gross_cents - mtd.refunds_cents;
  for (const mr of monthRows.values()) mr.cash_cents = mr.gross_cents - mr.refunds_cents;

  return {
    currency: "EUR",
    today: t,
    month_to_date: mtd,
    series_7d: days.map((d) => series.get(d) ?? 0),
    days_7d: days,
    months: [...monthRows.values()],
    lifetime_gross_cents: lifetime,
    other_currencies: [...other.values()],
    refunds_without_amount: refundsWithoutAmount,
    basis: MONEY_IN_BASIS,
  };
}

// ── Paying people ───────────────────────────────────────────────────────

export const REAL_RAILS: ReadonlySet<string> = new Set(["whop", "stripe", "nowpayments"]);

export interface GrantedEntryLike {
  payment_id?: string | null;
  amount_cents?: number | null;
}

export interface SubscriptionLike {
  id?: string;
  user_id: string | null;
  tier: string | null;
  status: string | null;
  payment_provider: string | null;
  amount_cents: number | null;
  provider_payment_id?: string | null;
  granted_payment_ids?: GrantedEntryLike[] | null;
  expires_at: string | null;
  started_at?: string | null;
  created_at?: string | null;
}

/** Payment ids that contributed to a row (latest first by convention). */
export function rowPaymentIds(s: SubscriptionLike): string[] {
  const ids: string[] = [];
  if (s.provider_payment_id) ids.push(s.provider_payment_id);
  for (const e of Array.isArray(s.granted_payment_ids) ? s.granted_payment_ids : []) {
    if (e && typeof e.payment_id === "string" && !ids.includes(e.payment_id)) ids.push(e.payment_id);
  }
  return ids;
}

/** True when money changed hands for this row. */
export function rowHasPositivePayment(s: SubscriptionLike, paymentsById?: Map<string, LedgerPayment>): boolean {
  if ((s.amount_cents ?? 0) > 0) return true;
  for (const e of Array.isArray(s.granted_payment_ids) ? s.granted_payment_ids : []) {
    if ((e?.amount_cents ?? 0) > 0) return true;
  }
  if (paymentsById) {
    for (const id of rowPaymentIds(s)) {
      const p = paymentsById.get(id);
      if (p && countsAsMoneyIn(p)) return true;
    }
  }
  return false;
}

export function isActiveUnexpired(s: SubscriptionLike, now: Date): boolean {
  if (s.status !== "active") return false;
  return !s.expires_at || Date.parse(s.expires_at) > now.getTime();
}

export interface PayerClassification {
  paying: Set<string>;
  inTrial: Set<string>;
  staffExcluded: Set<string>;
  /**
   * a-seed-seats: real learners holding a live seed seat (30 Pro days from a
   * venue code) and not paying. Listed beside the paying count, never in it.
   */
  seatHolders: Set<string>;
}

/** a-seed-seats: the seat row (tier seed_seat, provider "seat", amount 0). */
export const SEAT_HOLDERS_BASIS =
  "Seed seats = real learners with a live 30-day Pro seat from a venue code (tier seed_seat, no payment). They are listed beside the paying count and never counted in it; a seat holder who buys a plan counts as paying.";

export const PAYING_BASIS =
  "Paying = distinct real learners with an active, unexpired subscription on a real payment rail (Whop, Stripe, NOWPayments) and at least one positive payment. A trial with no charge yet counts as in trial, not paying. Manual and comped grants are not paying. " + STAFF_TEST_BASIS;

export function classifyPayers(
  subs: SubscriptionLike[],
  usersById: Map<string, AccountLike>,
  now: Date,
  paymentsById?: Map<string, LedgerPayment>,
): PayerClassification {
  const paying = new Set<string>();
  const trial = new Set<string>();
  const staff = new Set<string>();
  const seats = new Set<string>();
  for (const s of subs) {
    if (!s.user_id) continue;
    if (!isActiveUnexpired(s, now)) continue;
    if (s.tier === "seed_seat") {
      if (!isStaffOrTestAccount(usersById.get(s.user_id))) seats.add(s.user_id);
      continue;
    }
    if (!REAL_RAILS.has(s.payment_provider ?? "")) continue;
    if (isStaffOrTestAccount(usersById.get(s.user_id))) {
      staff.add(s.user_id);
      continue;
    }
    if (rowHasPositivePayment(s, paymentsById)) paying.add(s.user_id);
    else trial.add(s.user_id);
  }
  for (const id of paying) {
    trial.delete(id);
    seats.delete(id);
  }
  return { paying, inTrial: trial, staffExcluded: staff, seatHolders: seats };
}

/**
 * First positive, granted EUR or other payment per learner: the date a
 * learner became a payer. Used for "new paying learners (7d)".
 */
export function firstPaidAtByUser(ledger: Ledger): Map<string, string> {
  const out = new Map<string, string>();
  for (const p of ledger.payments) {
    if (!p.user_id || !p.granted || !countsAsMoneyIn(p)) continue;
    const prev = out.get(p.user_id);
    if (!prev || Date.parse(p.paid_at) < Date.parse(prev)) out.set(p.user_id, p.paid_at);
  }
  return out;
}

// ── Payment health (one diagnosis for Overview and Payments) ────────────

export interface DeliveryRow {
  result: string;
  error: string | null;
  received_at: string;
}

/** The webhook writes this exact prefix when a signed-looking delivery fails. */
export const SECRET_MISMATCH_PREFIX = "verification failed despite";

export function isSuspectedSecretMismatch(d: DeliveryRow): boolean {
  return d.result === "sig_invalid" && (d.error ?? "").startsWith(SECRET_MISMATCH_PREFIX);
}

export function isServerError(d: DeliveryRow): boolean {
  return d.result === "other_error";
}

export function isUnsignedProbe(d: DeliveryRow): boolean {
  return d.result === "sig_invalid" && !isSuspectedSecretMismatch(d);
}

export type HealthLevel = "alarm" | "attention" | "ok" | "quiet";

export interface PaymentHealth {
  level: HealthLevel;
  diagnosis: string;
  /** Needs a human in the last 24h: unresolved payments seen + suspected mismatches. */
  failures_24h: number;
  probes_24h: number;
  unresolved_total: number;
  unresolved_cents_by_currency: Record<string, number>;
  suspected_mismatch_7d: number;
  /** Deliveries the webhook could not process (e.g. secret unset, DB error). */
  server_errors_7d: number;
  probes_7d: number;
  processed_7d: number;
  deliveries_7d: number;
}

function money(centsValue: number, currency: string): string {
  return `${currency} ${(centsValue / 100).toFixed(2)}`;
}

export function computePaymentHealth(deliveries: DeliveryRow[], ledger: Ledger, now: Date): PaymentHealth {
  const t24 = now.getTime() - DAY_MS;
  const t7 = now.getTime() - 7 * DAY_MS;
  const in7 = deliveries.filter((d) => Date.parse(d.received_at) >= t7);
  const in24 = in7.filter((d) => Date.parse(d.received_at) >= t24);
  const mismatch7 = in7.filter(isSuspectedSecretMismatch).length;
  const errors7 = in7.filter(isServerError).length;
  const probes7 = in7.filter(isUnsignedProbe).length;
  const processed7 = in7.filter((d) => d.result === "processed" || d.result === "dup").length;
  const signed7 = in7.length - probes7;
  const rejected24 = in24.filter((d) => isSuspectedSecretMismatch(d) || isServerError(d)).length;
  const probes24 = in24.filter(isUnsignedProbe).length;
  const rejected7 = mismatch7 + errors7;

  const unresolved = ledger.payments.filter(isUnresolvedPayment);
  const unresolvedCents: Record<string, number> = {};
  for (const p of unresolved) unresolvedCents[p.currency] = (unresolvedCents[p.currency] ?? 0) + (p.gross_cents ?? 0);
  const unresolved24 = unresolved.filter((p) => Date.parse(p.last_seen_at) >= t24).length;

  let level: HealthLevel;
  let diagnosis: string;
  const probeNote = probes7 > 0 ? ` ${probes7} unsigned probe${probes7 === 1 ? "" : "s"} rejected in 7 days (normal internet noise, no action).` : "";
  const unresolvedText = unresolved.length > 0
    ? `${unresolved.length} paid payment${unresolved.length === 1 ? "" : "s"} never granted Pro (${Object.entries(unresolvedCents).map(([c, v]) => money(v, c)).join(", ")}). Resolve ${unresolved.length === 1 ? "it" : "them"} in Unresolved payments.`
    : "";
  const rejectedText = [
    mismatch7 > 0 ? `${mismatch7} signed-looking deliver${mismatch7 === 1 ? "y was" : "ies were"} rejected for the signature` : "",
    errors7 > 0 ? `${errors7} deliver${errors7 === 1 ? "y" : "ies"} failed with a server error` : "",
  ].filter(Boolean).join(" and ");
  if (rejected7 > 0 && processed7 === 0) {
    level = "alarm";
    diagnosis = `ALARM: ${rejectedText} in the last 7 days and none processed. Payments may arrive and not grant. Check WHOP_WEBHOOK_SECRET and the server logs, then re-deliver from Whop.${unresolvedText ? " " + unresolvedText : ""}`;
  } else if (unresolved.length > 0 || rejected7 > 0 || (signed7 > 0 && processed7 === 0)) {
    level = "attention";
    const parts: string[] = [];
    if (unresolvedText) parts.push(unresolvedText);
    if (rejected7 > 0) parts.push(`${rejectedText} in 7 days while ${processed7} processed; watch the webhook.`);
    else if (signed7 > 0 && processed7 === 0) parts.push(`${signed7} Whop deliver${signed7 === 1 ? "y" : "ies"} in 7 days and none processed; open the deliveries.`);
    diagnosis = parts.join(" ") + probeNote;
  } else if (signed7 === 0) {
    level = "quiet";
    diagnosis = `No signed Whop delivery in the last 7 days. Quiet is normal when nobody paid; every paid payment so far is granted or resolved.${probeNote}`;
  } else {
    level = "ok";
    diagnosis = `${processed7} Whop deliver${processed7 === 1 ? "y" : "ies"} processed in 7 days; every paid payment is granted or resolved.${probeNote}`;
  }

  return {
    level,
    diagnosis,
    failures_24h: unresolved24 + rejected24,
    probes_24h: probes24,
    unresolved_total: unresolved.length,
    unresolved_cents_by_currency: unresolvedCents,
    suspected_mismatch_7d: mismatch7,
    server_errors_7d: errors7,
    probes_7d: probes7,
    processed_7d: processed7,
    deliveries_7d: in7.length,
  };
}

// ── Roster helpers ──────────────────────────────────────────────────────

export function daysLeft(expiresAt: string | null, now: Date): number | null {
  if (!expiresAt) return null;
  const ms = Date.parse(expiresAt) - now.getTime();
  if (!Number.isFinite(ms)) return null;
  return Math.ceil(ms / DAY_MS);
}

/** Human access window from a tier's duration, e.g. "1 month", "3 months". */
export function durationLabel(months: number | null | undefined, tier: string | null): string {
  if (tier === "notes_pro_trial") return "Trial, then monthly";
  if (!months || months < 1) return tier ?? "Unknown plan";
  return months === 1 ? "1 month" : `${months} months`;
}
