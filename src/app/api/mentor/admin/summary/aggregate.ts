/**
 * Mentor admin cost view: the pure half (W3-COSTVIEW).
 *
 * Takes plain rows read from the mentor ledger tables and returns the frozen
 * MentorAdminSummary (src/lib/mentor/contract.ts). No I/O, no clock, no env:
 * everything arrives as an argument, so every number below is unit-testable.
 *
 * Money is micro-USD of TRUE API cost, as stored. Admin only: learners never
 * see dollars. Ids only, never emails (this module never sees a users row).
 *
 * Field semantics (frozen here, because the contract only names the shapes):
 *  - Mentor spend = SUM(cost_micro) of ledger kinds 'settle' and 'house_cost'
 *    in the UTC month, the same rule ai_spend_month applies.
 *  - by_day.mentor_micro counts BOTH kinds; house_micro is the part of it that
 *    the house paid (kind 'house_cost'), so house_micro <= mentor_micro and
 *    SUM(by_day.mentor_micro) = spend.mentor_micro.
 *  - top_users.spent_micro counts kind 'settle' only (what users were billed).
 *    messages = distinct request_id (one message is up to 3 API calls).
 *  - overruns = calls this month that cost more than their reserved ceiling.
 *    The ledger stores the ceiling as hold_micro = -ceiling on settle rows.
 *  - lots_by_package is lifetime (lots span months): sold vs consumed.
 *    live_remaining_micro counts only status 'live' lots with
 *    starts_at <= now < expires_at. The rest of (granted - spent - clawed)
 *    is expired unused credit.
 *  - Breaker: resting when total >= cap, exactly as the guard decides it
 *    (a message starts only while spend is strictly below the cap).
 */

import { laneCapMicro } from "@/lib/ai/limits";
import type { MentorConfig } from "@/lib/mentor/config";
import {
  MENTOR_PACKAGE_IDS,
  type MentorAdminSummary,
  type MentorPackageId,
} from "@/lib/mentor/contract";

// ─── Input rows (what the loader selects) ───────────────────────────────

export interface LedgerCallRow {
  user_id: string | null;
  kind: "settle" | "house_cost";
  cost_micro: number | null;
  /** Negative on settle rows: -ceiling of the reservation it closed. */
  hold_micro: number | null;
  request_id: string | null;
  model: string | null;
  input_tokens: number | null;
  output_tokens: number | null;
  cache_read_tokens: number | null;
  created_at: string;
}

export interface LotRow {
  user_id: string;
  package_id: string;
  status: string;
  granted_micro: number;
  spent_micro: number;
  clawed_back_micro: number;
  starts_at: string;
  expires_at: string;
}

export interface ClawbackRow {
  lot_id: string | null;
  user_id: string | null;
  package_id: string | null;
  /** Ledger delta: negative for a clawback. */
  delta_micro_usd: number;
  created_at: string;
}

export interface StaleReservationRow {
  request_id: string;
  call_index: number;
  user_id: string;
  ceiling_micro: number;
  created_at: string;
}

export interface DbFlagRow {
  enabled: boolean;
  env: string;
  rollout_pct: number;
}

import type { MentorTurnRow } from "@/lib/mentor/outcomes";
import { buildMentorQuality } from "./quality";

export interface SummaryInputs {
  turns?: MentorTurnRow[];
  /** UTC month the ledger rows cover, YYYY-MM. */
  month: string;
  now: Date;
  /** Every settle and house_cost row of the month (complete, never a sample). */
  ledger: readonly LedgerCallRow[];
  lots: readonly LotRow[];
  /** Newest first; the loader limits how many. */
  clawbacks: readonly ClawbackRow[];
  /** Open reservations older than RESERVE_STALE_MINUTES, oldest first. */
  staleReservations: readonly StaleReservationRow[];
  /** debt_micro of every wallet with debt > 0. */
  walletDebts: readonly number[];
  dbFlag: DbFlagRow | null;
  /** ai_spend_month(month): mentor ledger + legacy Anthropic rows. */
  spendTotalMicro: number;
  /** ai_spend_cap(floor, pct). */
  capMicro: number;
  config: MentorConfig;
  /** MUX-106 A: the split read is installed, so each lane has its own cap. */
  splitCaps?: boolean;
}

export const TOP_USERS_LIMIT = 10;
export const CLAWBACKS_LIMIT = 25;
export const STALE_RESERVATIONS_LIMIT = 50;

/** Sold packages always get a row, even with no lots, so "sold: 0" is visible. */
const SOLD_PACKAGE_IDS: readonly MentorPackageId[] = ["mentor_basis", "mentor_plus", "mentor_topup"];

// ─── Helpers ────────────────────────────────────────────────────────────

/** Non-finite or negative numbers (a bad row) count as 0, never NaN into a total. */
function n(v: unknown): number {
  const x = typeof v === "string" ? Number(v) : v;
  return typeof x === "number" && Number.isFinite(x) && x > 0 ? x : 0;
}

function isPackageId(v: string | null | undefined): v is MentorPackageId {
  return !!v && (MENTOR_PACKAGE_IDS as readonly string[]).includes(v);
}

/** "YYYY-MM-DD" in UTC. */
export function utcDay(d: Date): string {
  return d.toISOString().slice(0, 10);
}

/** UTC month bounds: [start, end) as Dates. Throws on a malformed month. */
export function monthBounds(month: string): { start: Date; end: Date } {
  const m = /^(\d{4})-(0[1-9]|1[0-2])$/.exec(month);
  if (!m) throw new RangeError(`month must be YYYY-MM, got ${month}`);
  const y = Number(m[1]);
  const mo = Number(m[2]) - 1;
  return { start: new Date(Date.UTC(y, mo, 1)), end: new Date(Date.UTC(y, mo + 1, 1)) };
}

/** Every UTC day of `month` up to `now` (whole month when `now` is past it). */
export function daysOfMonthUpTo(month: string, now: Date): string[] {
  const { start, end } = monthBounds(month);
  const days: string[] = [];
  for (let t = start.getTime(); t < end.getTime() && t <= now.getTime(); t += 86_400_000) {
    days.push(utcDay(new Date(t)));
  }
  return days;
}

/** pct of cap, one decimal. A cap of 0 reads as 100 once anything is spent. */
/**
 * MUX-106 A: the spend card and the breaker state from one place. With split
 * caps the mentor rests on its own share; before the a38 changeset the shared
 * total decides, exactly as the guard does.
 */
export function spendView(totalMicro: number, mentorMicro: number, capMicro: number, mentorSharePct: number, splitCaps: boolean): { spend: MentorAdminSummary["spend"]; resting: boolean } {
  const legacyMicro = Math.max(0, totalMicro - mentorMicro);
  const mentorCap = laneCapMicro(capMicro, "mentor", mentorSharePct);
  const legacyCap = laneCapMicro(capMicro, "legacy", mentorSharePct);
  return {
    spend: {
      mentor_micro: mentorMicro,
      legacy_micro: legacyMicro,
      total_micro: totalMicro,
      cap_micro: capMicro,
      pct_of_cap: pctOfCap(totalMicro, capMicro),
      split_caps: splitCaps,
      mentor_cap_micro: mentorCap,
      legacy_cap_micro: legacyCap,
      mentor_pct_of_cap: pctOfCap(mentorMicro, mentorCap),
      legacy_pct_of_cap: pctOfCap(legacyMicro, legacyCap),
    },
    resting: splitCaps ? mentorMicro >= mentorCap : totalMicro >= capMicro,
  };
}

export function pctOfCap(totalMicro: number, capMicro: number): number {
  if (!(capMicro > 0)) return totalMicro > 0 ? 100 : 0;
  return Math.round((totalMicro / capMicro) * 1000) / 10;
}

// ─── The aggregate ──────────────────────────────────────────────────────

export function buildAdminSummary(input: SummaryInputs): MentorAdminSummary {
  const { now, config } = input;
  const nowMs = now.getTime();

  // Spend, by day, by model, per user: one pass over the ledger rows.
  const day = new Map<string, { mentor: number; calls: number; house: number }>();
  for (const d of daysOfMonthUpTo(input.month, now)) day.set(d, { mentor: 0, calls: 0, house: 0 });
  const model = new Map<string, { micro: number; calls: number; inp: number; out: number; cache: number }>();
  const user = new Map<string, { spent: number; requests: Set<string> }>();
  let mentorMicro = 0;
  let overruns = 0;

  for (const r of input.ledger) {
    if (r.kind !== "settle" && r.kind !== "house_cost") continue;
    const cost = n(r.cost_micro);
    mentorMicro += cost;

    const key = (r.created_at ?? "").slice(0, 10);
    let bucket = day.get(key);
    if (!bucket) {
      bucket = { mentor: 0, calls: 0, house: 0 };
      day.set(key, bucket);
    }
    bucket.mentor += cost;
    bucket.calls += 1;
    if (r.kind === "house_cost") bucket.house += cost;

    const modelKey = r.model && r.model.trim() !== "" ? r.model : "unknown";
    const m = model.get(modelKey) ?? { micro: 0, calls: 0, inp: 0, out: 0, cache: 0 };
    m.micro += cost;
    m.calls += 1;
    m.inp += n(r.input_tokens);
    m.out += n(r.output_tokens);
    m.cache += n(r.cache_read_tokens);
    model.set(modelKey, m);

    const ceiling = -Number(r.hold_micro ?? 0);
    if (Number.isFinite(ceiling) && ceiling > 0 && cost > ceiling) overruns += 1;

    if (r.kind === "settle" && r.user_id) {
      const u = user.get(r.user_id) ?? { spent: 0, requests: new Set<string>() };
      u.spent += cost;
      if (r.request_id) u.requests.add(r.request_id);
      user.set(r.user_id, u);
    }
  }

  // Totals: the RPC is the source for the cap check; never let the legacy
  // remainder go negative if a row landed between the two reads.
  const totalMicro = Math.max(n(input.spendTotalMicro), mentorMicro);
  const capMicro = n(input.capMicro);
  const spendNow = spendView(totalMicro, mentorMicro, capMicro, config.mentorCapSharePct, input.splitCaps === true);

  // Lots: live remaining per user and sold vs consumed per package.
  const liveByUser = new Map<string, number>();
  const pkg = new Map<string, { lots: number; granted: number; spent: number; clawed: number; live: number }>();
  for (const l of input.lots) {
    const p = pkg.get(l.package_id) ?? { lots: 0, granted: 0, spent: 0, clawed: 0, live: 0 };
    const granted = n(l.granted_micro);
    const spent = n(l.spent_micro);
    const clawed = n(l.clawed_back_micro);
    p.lots += 1;
    p.granted += granted;
    p.spent += spent;
    p.clawed += clawed;
    const isLive =
      l.status === "live" && Date.parse(l.starts_at) <= nowMs && nowMs < Date.parse(l.expires_at);
    if (isLive) {
      const remaining = Math.max(granted - spent - clawed, 0);
      p.live += remaining;
      liveByUser.set(l.user_id, (liveByUser.get(l.user_id) ?? 0) + remaining);
    }
    pkg.set(l.package_id, p);
  }

  const lotsByPackage: MentorAdminSummary["lots_by_package"] = [];
  const row = (id: string, p: { lots: number; granted: number; spent: number; clawed: number; live: number } | undefined) => ({
    package_id: id as MentorPackageId,
    lots: p?.lots ?? 0,
    granted_micro: p?.granted ?? 0,
    spent_micro: p?.spent ?? 0,
    clawed_back_micro: p?.clawed ?? 0,
    live_remaining_micro: p?.live ?? 0,
  });
  for (const id of MENTOR_PACKAGE_IDS) {
    const p = pkg.get(id);
    if (!p && !SOLD_PACKAGE_IDS.includes(id)) continue;
    lotsByPackage.push(row(id, p));
  }
  // A package the code does not know (a row added in the DB) must still show:
  // dropping it would hide granted credit.
  for (const id of [...pkg.keys()].filter((k) => !isPackageId(k)).sort()) lotsByPackage.push(row(id, pkg.get(id)));

  const topUsers = [...user.entries()]
    .map(([user_id, u]) => ({
      user_id,
      spent_micro: u.spent,
      messages: u.requests.size,
      available_micro: liveByUser.get(user_id) ?? 0,
    }))
    .sort((a, b) => b.spent_micro - a.spent_micro || a.user_id.localeCompare(b.user_id))
    .slice(0, TOP_USERS_LIMIT);

  const clawbacks = input.clawbacks
    .filter((c) => c.lot_id && c.user_id && isPackageId(c.package_id))
    .slice(0, CLAWBACKS_LIMIT)
    .map((c) => ({
      lot_id: c.lot_id as string,
      user_id: c.user_id as string,
      package_id: c.package_id as MentorPackageId,
      clawed_micro: Math.max(-Number(c.delta_micro_usd), 0) || 0,
      at: c.created_at,
    }));

  const stale = input.staleReservations.slice(0, STALE_RESERVATIONS_LIMIT).map((r) => ({
    request_id: r.request_id,
    call_index: r.call_index,
    user_id: r.user_id,
    ceiling_micro: n(r.ceiling_micro),
    age_minutes: Math.max(Math.floor((nowMs - Date.parse(r.created_at)) / 60_000), 0),
  }));

  return {
    quality: buildMentorQuality(input.turns ?? []),
    generated_at: now.toISOString(),
    month: input.month,
    spend: spendNow.spend,
    by_day: [...day.entries()]
      .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
      .map(([d, v]) => ({ day: d, mentor_micro: v.mentor, calls: v.calls, house_micro: v.house })),
    by_model: [...model.entries()]
      .map(([m, v]) => ({
        model: m,
        mentor_micro: v.micro,
        calls: v.calls,
        input_tokens: v.inp,
        output_tokens: v.out,
        cache_read_tokens: v.cache,
      }))
      .sort((a, b) => b.mentor_micro - a.mentor_micro || a.model.localeCompare(b.model)),
    top_users: topUsers,
    stale_reservations: stale,
    lots_by_package: lotsByPackage,
    clawbacks,
    overruns,
    debt_total_micro: input.walletDebts.reduce((s, d) => s + n(d), 0),
    state: {
      ai_features_enabled: config.aiFeaturesEnabled,
      mentor_enabled: config.enabled,
      packages_enabled: config.packagesEnabled,
      topups_enabled: config.topupsEnabled,
      db_flag: input.dbFlag
        ? { enabled: !!input.dbFlag.enabled, env: input.dbFlag.env, rollout_pct: n(input.dbFlag.rollout_pct) }
        : null,
      resting: spendNow.resting,
      beta_allowlist_size: config.betaUserIds.length,
    },
  };
}
