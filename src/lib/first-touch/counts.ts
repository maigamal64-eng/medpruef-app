/**
 * Monday first-touch read (a-first-touch). Pure fold over rows the script
 * scripts/growth/first-touch-count.ts reads; counts and keys only, never an id.
 *
 * Signup key: the `first_touch` the server wrote on the account's
 * user_registered row; for rows written before FIRST_TOUCH_ENABLED it is
 * derived from the row's utm attribution with the same rule. An account with
 * a row but no key is `untagged`; an account without a row is `no_row` (every
 * account created before the write shipped on 12 Oct 2026), never backfilled.
 *
 * Staff and test accounts are excluded with money-rules isStaffOrTestAccount;
 * payers use REAL_RAILS and rowHasPositivePayment (the hqlib definitions).
 * Segment at M1 mirrors hqlib/segments.py (decision hq-segment-lens).
 */
import {
  REAL_RAILS,
  isStaffOrTestAccount,
  rowHasPositivePayment,
  type SubscriptionLike,
} from "@/lib/admin/money-rules";
import type { OfficialSitting } from "@/lib/exam-dates";
import { FIRST_TOUCH_KEY_RE, firstTouchFromAttribution, leverOf, type Lever } from "./index";

export interface CountUser {
  id: string;
  created_at: string;
  email?: string | null;
  role?: string | null;
  tier?: string | null;
  exam_date?: string | null;
  active_exam?: string | null;
  ob_date?: string | null;
  ob_src?: string | null;
}

export interface RegRow {
  user_id: string;
  created_at: string;
  event_data: Record<string, unknown> | null;
}

export type Segment = "stichprobentest" | "vienna_sip" | "unknown";

const KEY_SEGMENT: Record<string, Segment> = { sip4a: "vienna_sip", sip5a: "vienna_sip", stichprobentest: "stichprobentest" };
const BANK_SEGMENT: Record<string, Segment> = { kenntnispruefung: "vienna_sip", kmp_innsbruck: "stichprobentest" };
const ISO = /^\d{4}-\d{2}-\d{2}/;

function day(v: unknown): string | null {
  return typeof v === "string" && ISO.test(v) ? v.slice(0, 10) : null;
}

/** hqlib segments.classify, segment only: named sitting, then exam_date, then the bank opened. */
export function segmentOf(u: CountUser, sittings: readonly Pick<OfficialSitting, "exam_key" | "date" | "date_end">[]): Segment {
  for (const raw of [u.ob_date, u.exam_date]) {
    const d = day(raw);
    if (!d) continue;
    const segs = new Set<Segment>();
    for (const s of sittings) {
      const end = s.date_end ?? s.date;
      if (s.date <= d && d <= end && KEY_SEGMENT[s.exam_key]) segs.add(KEY_SEGMENT[s.exam_key]);
    }
    if (segs.size === 1) return [...segs][0];
  }
  for (const bank of [u.active_exam, u.ob_src]) {
    if (bank && BANK_SEGMENT[bank]) return BANK_SEGMENT[bank];
  }
  return "unknown";
}

/** The first-touch key of one user_registered row, or null (untagged). */
export function keyOfRow(row: RegRow | undefined): string | null {
  const data = row?.event_data;
  if (!data) return null;
  const stored = data.first_touch;
  if (typeof stored === "string" && FIRST_TOUCH_KEY_RE.test(stored)) return stored;
  const attr = data.attribution && typeof data.attribution === "object" ? (data.attribution as Record<string, string>) : null;
  return firstTouchFromAttribution(attr)?.key ?? null;
}

const PAID_STATUSES = new Set(["active", "expired", "cancelled"]);

/**
 * Money changed hands (money-rules rowHasPositivePayment) with proof of a
 * payment, not only an invoice amount: a positive granted_payment_ids entry,
 * or a positive amount with a provider payment id and a start (the win-back
 * evidence rule). A cancelled, never-paid invoice keeps its amount but has
 * neither, so it never counts.
 */
export function hasPaymentEvidence(s: SubscriptionLike): boolean {
  if (!rowHasPositivePayment(s)) return false;
  const granted = Array.isArray(s.granted_payment_ids) ? s.granted_payment_ids : [];
  if (granted.some((e) => (e?.amount_cents ?? 0) > 0)) return true;
  return (s.amount_cents ?? 0) > 0 && !!s.provider_payment_id && !!s.started_at;
}

function paidAt(s: SubscriptionLike): number | null {
  if (!s.user_id || !REAL_RAILS.has(s.payment_provider ?? "")) return null;
  if (!PAID_STATUSES.has(s.status ?? "")) return null;
  if (!hasPaymentEvidence(s)) return null;
  const t = Date.parse(s.started_at ?? s.created_at ?? "");
  return Number.isFinite(t) ? t : null;
}

/** First positive real-rail payment per learner (ms). */
export function firstPaidByUser(subs: SubscriptionLike[]): Map<string, number> {
  const out = new Map<string, number>();
  for (const s of subs) {
    const t = paidAt(s);
    if (t === null) continue;
    const prev = out.get(s.user_id as string);
    if (prev === undefined || t < prev) out.set(s.user_id as string, t);
  }
  return out;
}

interface Cell {
  n: number;
  payers: number;
}
interface Group {
  n: number;
  tagged: number;
  payers: number;
  no_row: number;
  untagged_row: number;
  by_lever: Record<string, Cell>;
}

function group(): Group {
  return { n: 0, tagged: 0, payers: 0, no_row: 0, untagged_row: 0, by_lever: {} };
}

function add(g: Group, lever: Lever, paid: boolean): void {
  g.n += 1;
  if (paid) g.payers += 1;
  if (lever === "no_row") g.no_row += 1;
  else if (lever === "untagged") g.untagged_row += 1;
  else g.tagged += 1;
  const c = (g.by_lever[lever] ??= { n: 0, payers: 0 });
  c.n += 1;
  if (paid) c.payers += 1;
}

export interface FirstTouchCounts {
  window_days: number;
  signups: Group & {
    tagged_share: string;
    by_key: Array<{ key: string; lever: Lever; signups: number; payers: number }>;
    by_segment: Record<Segment, Group>;
  };
  new_payers: Group & { tagged_share: string; by_segment: Record<Segment, Group> };
  staff_excluded: number;
  definitions: string;
}

const share = (k: number, n: number) => `${k} of ${n}`;

export function foldFirstTouch(input: {
  windowDays: number;
  sinceMs: number;
  signups: CountUser[];
  /** Real accounts that first paid inside the window (any signup date). */
  payerUsers: CountUser[];
  regRows: RegRow[];
  subs: SubscriptionLike[];
  sittings: readonly Pick<OfficialSitting, "exam_key" | "date" | "date_end">[];
  partnerCodes?: ReadonlySet<string>;
  /** Campaign codes (lower case). A code key outside this set and partnerCodes prints as code:other. */
  campaignCodes?: ReadonlySet<string>;
}): FirstTouchCounts {
  const partner = input.partnerCodes ?? new Set<string>();
  const campaign = input.campaignCodes ?? new Set<string>();
  // A typed personal referral code names one referrer: never printed.
  const printable = (key: string): string => {
    const [kind, rest] = key.split(":", 2);
    if ((kind === "code" || kind === "gratis") && !partner.has(rest) && !campaign.has(rest)) return `${kind}:other`;
    return key;
  };
  const firstReg = new Map<string, RegRow>();
  for (const r of [...input.regRows].sort((a, b) => a.created_at.localeCompare(b.created_at))) {
    if (!firstReg.has(r.user_id)) firstReg.set(r.user_id, r);
  }
  const firstPaid = firstPaidByUser(input.subs);
  const leverFor = (u: CountUser): { lever: Lever; key: string | null } => {
    const row = firstReg.get(u.id);
    if (!row) return { lever: "no_row", key: null };
    const key = keyOfRow(row);
    return { lever: leverOf(key, partner), key };
  };

  let staff = 0;
  const signups = { ...group(), tagged_share: "", by_key: [] as FirstTouchCounts["signups"]["by_key"], by_segment: { stichprobentest: group(), vienna_sip: group(), unknown: group() } as Record<Segment, Group> };
  const byKey = new Map<string, { lever: Lever; signups: number; payers: number }>();
  for (const u of input.signups) {
    if (isStaffOrTestAccount(u)) { staff += 1; continue; }
    const { lever, key } = leverFor(u);
    const paid = firstPaid.has(u.id) && (firstPaid.get(u.id) as number) >= Date.parse(u.created_at) - 60_000;
    add(signups, lever, paid);
    add(signups.by_segment[segmentOf(u, input.sittings)], lever, paid);
    if (key) {
      const shown = printable(key);
      const c = byKey.get(shown) ?? { lever, signups: 0, payers: 0 };
      c.signups += 1;
      if (paid) c.payers += 1;
      byKey.set(shown, c);
    }
  }
  signups.tagged_share = share(signups.tagged, signups.n);
  signups.by_key = [...byKey.entries()]
    .map(([key, c]) => ({ key, ...c }))
    .sort((a, b) => b.signups - a.signups || a.key.localeCompare(b.key));

  const payers = { ...group(), tagged_share: "", by_segment: { stichprobentest: group(), vienna_sip: group(), unknown: group() } as Record<Segment, Group> };
  for (const u of input.payerUsers) {
    if (isStaffOrTestAccount(u)) continue;
    const t = firstPaid.get(u.id);
    if (t === undefined || t < input.sinceMs) continue;
    const { lever } = leverFor(u);
    add(payers, lever, true);
    add(payers.by_segment[segmentOf(u, input.sittings)], lever, true);
  }
  payers.tagged_share = share(payers.tagged, payers.n);

  return {
    window_days: input.windowDays,
    signups,
    new_payers: payers,
    staff_excluded: staff,
    definitions:
      "Signups = real accounts created in the window (money-rules staff and test predicate). Key = user_registered.event_data.first_touch, else derived from its utm attribution. " +
      "Tagged = a key; untagged_row = a row without one; no_row = no user_registered row (accounts before 12 Oct 2026). Payers among signups = a positive real-rail payment after signup. " +
      "New payers = real learners whose first positive real-rail payment started in the window, by their signup key. Segment = hqlib segment lens (named sitting, exam_date, bank opened).",
  };
}
