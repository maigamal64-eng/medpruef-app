/**
 * Win-back credits when paid access ends (a-winback-credits, plan J11,
 * product.json L9). REWARDS_WINBACK_ENABLED, default OFF.
 *
 * Once a day (/api/cron/trial-reminder, after its expiry sweep) every learner
 * whose PAID access ended between WINBACK_GRACE_HOURS and WINBACK_LOOKBACK_DAYS
 * ago gets one mentor lot: 100 credits valid 30 days (amounts in
 * free-credits.ts). The 48-hour grace lets a late refund or a Whop dunning
 * retry land first. The bank stays at the free sample; this is a warm reason
 * to come back, not a comp.
 *
 * Who (decideWinback, pure, first failing rule wins):
 *   - an ended subscription row (expired, or cancelled: a recurring cancel or
 *     a Whop deactivation after a failed renewal; an active row past its end
 *     counts too) on a real payment rail with evidence of a payment (a
 *     positive granted_payment_ids entry, or a positive amount together with
 *     a provider payment id and a start date); a EUR 0 card trial, a manual
 *     grant or a checkout that was never paid gets nothing;
 *   - the row ended inside the window (a daily job; without the lookback the
 *     first run after the switch would gift every old lapse);
 *   - the learner has no access now (effectiveAccessEnd = none, and no active
 *     row that has not ended): a cancel with surviving paid time or a manual
 *     extension still has access;
 *   - not banned, not admin, not a staff or test account;
 *   - never after a refund or chargeback: any refunded or disputed row of the
 *     learner (ever), or a refund revoke event (matched or unmatched) in the
 *     last 90 days, blocks it; a refund that arrives after the grant claws
 *     the unspent part back on the next daily run (clawbackRefundedWinbacks);
 *   - at most one win-back lot per learner per WINBACK_COOLDOWN_DAYS (a read
 *     of earlier lots), and one per ended row (UNIQUE(source, source_id)).
 *
 * Grants run only while the mentor can be opened by a lapsed learner:
 * both masters on and MENTOR_ACCESS_SCOPE paid or signed_in (a lapsed learner
 * is tier free; "paid" admits holders of a live lot). Under the beta scope a
 * lot would expire in a wallet nobody can open, so the run grants nothing.
 *
 * Lot: package gift_admin, source admin_gift, key reward:winback:<row id>
 * (no lot-source migration). Learners appear only as uid8 in results.
 */

import type { SupabaseClient } from "@supabase/supabase-js";
import { isStaffOrTestAccount, rowHasPositivePayment, REAL_RAILS, type GrantedEntryLike } from "@/lib/admin/money-rules";
import { effectiveAccessEnd } from "@/lib/reminders/access-ending";
import type { MentorConfig } from "../config";
import { creditsFromMicro } from "../config";
import { rpcClawback, rpcGrantCredits } from "./db";
import { creditsToMicro, FREE_CREDIT_MICRO_PER_CREDIT, isWinbackLot, winbackSourceId, WINBACK_LOT, type FreeCreditConfig } from "./free-credits";

/** An end is granted no earlier than this after it (refund and dunning retries land first). */
export const WINBACK_GRACE_HOURS = 48;
/** ...and no later than this: older ends are never backfilled. */
export const WINBACK_LOOKBACK_DAYS = 9;
export const WINBACK_COOLDOWN_DAYS = 90;
/** The in-app note shows a win-back lot granted in this many days. */
export const WINBACK_NOTE_DAYS = 30;
/** Rows written by one grant carry the same instant; allow clock noise only. */
const SAME_END_TOLERANCE_MS = 60_000;
const DAY_MS = 86_400_000;
const HOUR_MS = 3_600_000;
/** Win-back lots can live at most 180 days (REWARDS_WINBACK_EXPIRY_DAYS range); the clawback pass looks that far back. */
const MAX_LOT_DAYS = 180;
/** Revoke events that carry kind "refunded" (refund or chargeback). */
const REFUND_EVENT_TYPES: readonly string[] = ["whop_subscription_revoked", "whop_revoke_unmatched"];

/** Statuses that mean money was taken back (refund or chargeback). */
export const REFUND_STATUSES: ReadonlySet<string> = new Set(["refunded", "chargeback", "disputed"]);
const ENDED_STATUSES: readonly string[] = ["expired", "cancelled"];

export interface WinbackRow {
  id: string;
  status: string | null;
  payment_provider: string | null;
  amount_cents: number | null;
  granted_payment_ids?: GrantedEntryLike[] | null;
  provider_payment_id?: string | null;
  started_at?: string | null;
  expires_at: string | null;
  cancelled_at: string | null;
}

export interface WinbackOwner {
  role?: string | null;
  tier?: string | null;
  tier_expires_at?: string | null;
  email?: string | null;
  is_banned?: boolean | null;
}

export type WinbackKind = "access_end" | "cancelled";

export type WinbackDecision =
  | "grant"
  | "skip_no_user"
  | "skip_banned"
  | "skip_staff_or_test"
  | "skip_still_covered"
  | "skip_no_paid_end"
  | "skip_refund"
  | "skip_cooldown";

export interface WinbackDecisionInput {
  owner: WinbackOwner | null;
  /** Every subscription row of the learner (all statuses). */
  rows: WinbackRow[];
  /** Newest earlier win-back lot of the learner (created_at ms), null if none. */
  lastWinbackAtMs: number | null;
  /** A refund revoke event for this learner in the last 90 days. */
  refundEvent: boolean;
  nowMs: number;
  lookbackDays?: number;
  graceHours?: number;
}

export interface WinbackDecisionOutput {
  decision: WinbackDecision;
  /** The ended row the lot is keyed on (latest end in the window). */
  subscriptionId: string | null;
  kind: WinbackKind | null;
  endedAtMs: number | null;
}

/**
 * When a row's access ended: a cancel ends at its cancel time (or earlier
 * end); anything else at expires_at. A row with no end date never gave
 * dated access (a never-paid checkout closed as cancelled): null.
 */
export function rowEndedAtMs(r: WinbackRow): number | null {
  const exp = r.expires_at ? Date.parse(r.expires_at) : NaN;
  if (!Number.isFinite(exp)) return null;
  if (r.status === "cancelled") {
    const cancel = r.cancelled_at ? Date.parse(r.cancelled_at) : NaN;
    return Number.isFinite(cancel) ? Math.min(cancel, exp) : exp;
  }
  return exp;
}

/**
 * Money changed hands for this row on a real rail: a positive
 * granted_payment_ids entry, or a positive amount with a provider payment id
 * and a start date. amount_cents alone is the invoice price of a checkout
 * that may never have been paid.
 */
export function isPaidRealRailRow(r: WinbackRow): boolean {
  if (!REAL_RAILS.has(r.payment_provider ?? "")) return false;
  const entries = Array.isArray(r.granted_payment_ids) ? r.granted_payment_ids : [];
  if (entries.some((e) => (e?.amount_cents ?? 0) > 0 && typeof e?.payment_id === "string" && e.payment_id.length > 0)) return true;
  return (r.amount_cents ?? 0) > 0 && Boolean(r.provider_payment_id) && Boolean(r.started_at)
    && rowHasPositivePayment({ user_id: null, tier: null, status: r.status, payment_provider: r.payment_provider, amount_cents: r.amount_cents, granted_payment_ids: null, expires_at: r.expires_at });
}

/** An ended (or past-end) paid row whose access ended inside [now - lookback, now - grace]. */
function endedInWindow(r: WinbackRow, nowMs: number, lookbackDays: number, graceHours: number): number | null {
  const isEnded = ENDED_STATUSES.includes(r.status ?? "") || r.status === "active";
  if (!isEnded || !isPaidRealRailRow(r)) return null;
  const end = rowEndedAtMs(r);
  if (end === null || end > nowMs - graceHours * HOUR_MS || end < nowMs - lookbackDays * DAY_MS) return null;
  return end;
}

/** Refund or chargeback evidence: any refunded/disputed row ever, or a refund revoke event (read for 90 days). */
export function hasRefundEvidence(rows: readonly WinbackRow[], refundEvent: boolean): boolean {
  return refundEvent || rows.some((r) => REFUND_STATUSES.has(r.status ?? ""));
}

/** Account rules shared by the grant and the mail promise. */
function accountBlock(owner: WinbackOwner | null): WinbackDecision | null {
  if (!owner) return "skip_no_user";
  if (owner.is_banned === true) return "skip_banned";
  if (isStaffOrTestAccount(owner)) return "skip_staff_or_test";
  return null;
}

/** Pure decision for one learner. */
export function decideWinback(input: WinbackDecisionInput): WinbackDecisionOutput {
  const { owner, rows, nowMs } = input;
  const lookbackDays = input.lookbackDays ?? WINBACK_LOOKBACK_DAYS;
  const graceHours = input.graceHours ?? WINBACK_GRACE_HOURS;
  const none = (decision: WinbackDecision, extra: Partial<WinbackDecisionOutput> = {}): WinbackDecisionOutput =>
    ({ decision, subscriptionId: null, kind: null, endedAtMs: null, ...extra });
  const blocked = accountBlock(owner);
  if (blocked || !owner) return none(blocked ?? "skip_no_user");
  if (effectiveAccessEnd(owner, nowMs).kind !== "none") return none("skip_still_covered");
  // An active row that has not ended (or is open-ended) is still access.
  const stillActive = rows.some((r) => {
    if (r.status !== "active") return false;
    const exp = r.expires_at ? Date.parse(r.expires_at) : NaN;
    return !Number.isFinite(exp) || exp > nowMs;
  });
  if (stillActive) return none("skip_still_covered");

  let pick: WinbackRow | null = null;
  let pickEnd = -Infinity;
  for (const r of rows) {
    const end = endedInWindow(r, nowMs, lookbackDays, graceHours);
    if (end === null) continue;
    if (end > pickEnd || (end === pickEnd && pick !== null && r.id > pick.id)) { pick = r; pickEnd = end; }
  }
  if (!pick) return none("skip_no_paid_end");
  const found = { subscriptionId: pick.id, kind: (pick.status === "cancelled" ? "cancelled" : "access_end") as WinbackKind, endedAtMs: pickEnd };
  if (hasRefundEvidence(rows, input.refundEvent)) return none("skip_refund", found);
  if (input.lastWinbackAtMs !== null && input.lastWinbackAtMs > nowMs - WINBACK_COOLDOWN_DAYS * DAY_MS) return none("skip_cooldown", found);
  return { decision: "grant", ...found };
}

/** Grants only while a lapsed (tier free) learner can open the mentor. */
export function winbackMentorReachable(config: Pick<MentorConfig, "aiFeaturesEnabled" | "enabled" | "accessScope">): boolean {
  return config.aiFeaturesEnabled && config.enabled && config.accessScope !== "beta";
}

// ── Loading ────────────────────────────────────────────────────────────

type Db = Pick<SupabaseClient, "from" | "rpc">;

class WinbackReadError extends Error {
  constructor(step: string) {
    super(`winback read failed: ${step}`);
    this.name = "WinbackReadError";
  }
}

const ID_CHUNK = 100;
function chunks<T>(list: T[], size = ID_CHUNK): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < list.length; i += size) out.push(list.slice(i, i + size));
  return out;
}

const ROW_COLUMNS = "id, user_id, status, payment_provider, amount_cents, granted_payment_ids, provider_payment_id, started_at, expires_at, cancelled_at";

export interface WinbackFacts {
  owner: WinbackOwner | null;
  rows: WinbackRow[];
  lastWinbackAtMs: number | null;
  refundEvent: boolean;
}

/** Owner, rows, earlier win-back lots and refund events for these learners. Throws WinbackReadError. */
export async function loadWinbackFacts(sb: Db, userIds: string[], now: Date): Promise<Map<string, WinbackFacts>> {
  const facts = new Map<string, WinbackFacts>();
  for (const id of userIds) facts.set(id, { owner: null, rows: [], lastWinbackAtMs: null, refundEvent: false });
  const cooldownIso = new Date(now.getTime() - WINBACK_COOLDOWN_DAYS * DAY_MS).toISOString();
  for (const ids of chunks(userIds)) {
    const users = await sb.from("users").select("id, email, role, tier, tier_expires_at, is_banned").in("id", ids);
    if (users.error) throw new WinbackReadError("users");
    for (const u of (users.data ?? []) as Array<WinbackOwner & { id: string }>) {
      const f = facts.get(u.id);
      if (f) f.owner = u;
    }
    const rows = await sb.from("subscriptions").select(ROW_COLUMNS).in("user_id", ids).limit(5000);
    if (rows.error) throw new WinbackReadError("subscriptions");
    for (const r of (rows.data ?? []) as Array<WinbackRow & { user_id: string }>) facts.get(r.user_id)?.rows.push(r);
    const lots = await sb.from("ai_credit_lot").select("user_id, source, source_id, created_at")
      .in("user_id", ids).eq("source", WINBACK_LOT.source).like("source_id", `${WINBACK_LOT.prefix}%`).gte("created_at", cooldownIso);
    if (lots.error) throw new WinbackReadError("lots");
    for (const l of (lots.data ?? []) as Array<{ user_id: string; source: string; source_id: string; created_at: string }>) {
      const f = facts.get(l.user_id);
      const at = Date.parse(l.created_at);
      if (!f || !isWinbackLot(l.source, l.source_id) || !Number.isFinite(at)) continue;
      if (f.lastWinbackAtMs === null || at > f.lastWinbackAtMs) f.lastWinbackAtMs = at;
    }
    const events = await sb.from("user_events").select("user_id, event_data")
      .in("user_id", ids).in("event_type", [...REFUND_EVENT_TYPES]).gte("created_at", cooldownIso).limit(1000);
    if (events.error) throw new WinbackReadError("events");
    for (const e of (events.data ?? []) as Array<{ user_id: string; event_data: Record<string, unknown> | null }>) {
      if (e.event_data?.kind === "refunded") { const f = facts.get(e.user_id); if (f) f.refundEvent = true; }
    }
  }
  return facts;
}

/** Learners with a row that ended inside the grant window. Throws WinbackReadError. */
export async function loadWinbackCandidates(sb: Db, now: Date, lookbackDays: number = WINBACK_LOOKBACK_DAYS, graceHours: number = WINBACK_GRACE_HOURS): Promise<string[]> {
  const nowIso = new Date(now.getTime() - graceHours * HOUR_MS).toISOString();
  const fromIso = new Date(now.getTime() - lookbackDays * DAY_MS).toISOString();
  const ids = new Set<string>();
  const reads = [
    sb.from("subscriptions").select("user_id").in("status", ["expired", "active"]).gte("expires_at", fromIso).lte("expires_at", nowIso).limit(5000),
    sb.from("subscriptions").select("user_id").eq("status", "cancelled").gte("cancelled_at", fromIso).lte("cancelled_at", nowIso).limit(5000),
  ];
  for (const [i, q] of reads.entries()) {
    const { data, error } = await q;
    if (error) throw new WinbackReadError(i === 0 ? "candidates_ended" : "candidates_cancelled");
    for (const r of (data ?? []) as Array<{ user_id: string | null }>) if (r.user_id) ids.add(r.user_id);
  }
  return [...ids].sort();
}

// ── Grant run ──────────────────────────────────────────────────────────

export interface WinbackRunResult {
  enabled: boolean;
  /** false: the mentor is closed to lapsed learners (masters off or beta scope); nothing was read. */
  mentor_reachable: boolean;
  candidates: number;
  granted: number;
  duplicates: number;
  /** Win-back lots clawed back because a refund or chargeback arrived after the grant. */
  clawed_back: number;
  skipped: Record<string, number>;
  errors: string[];
}

type EventWriter = (userId: string, eventType: string, data: Record<string, unknown>) => Promise<void>;

/** The daily grant behind REWARDS_WINBACK_ENABLED. Never throws. */
export async function runWinbackGrants(sb: Db, opts: {
  now: Date;
  fc: Pick<FreeCreditConfig, "winbackEnabled" | "winbackCredits" | "winbackExpiryDays">;
  mentor: Pick<MentorConfig, "aiFeaturesEnabled" | "enabled" | "accessScope">;
  recordEvent: EventWriter;
}): Promise<WinbackRunResult> {
  const result: WinbackRunResult = { enabled: opts.fc.winbackEnabled, mentor_reachable: false, candidates: 0, granted: 0, duplicates: 0, clawed_back: 0, skipped: {}, errors: [] };
  if (!opts.fc.winbackEnabled) return result;
  // A refund after an earlier grant is clawed back even while the mentor is closed.
  const claw = await clawbackRefundedWinbacks(sb, opts.now, opts.recordEvent);
  result.clawed_back = claw.clawed;
  result.errors.push(...claw.errors);
  result.mentor_reachable = winbackMentorReachable(opts.mentor);
  if (!result.mentor_reachable) return result;
  const nowMs = opts.now.getTime();
  let facts: Map<string, WinbackFacts>;
  try {
    const ids = await loadWinbackCandidates(sb, opts.now);
    result.candidates = ids.length;
    if (ids.length === 0) return result;
    facts = await loadWinbackFacts(sb, ids, opts.now);
  } catch (err) {
    result.errors.push((err as Error).message);
    return result;
  }
  for (const [userId, f] of facts) {
    const d = decideWinback({ owner: f.owner, rows: f.rows, lastWinbackAtMs: f.lastWinbackAtMs, refundEvent: f.refundEvent, nowMs });
    if (d.decision !== "grant" || !d.subscriptionId) {
      result.skipped[d.decision] = (result.skipped[d.decision] ?? 0) + 1;
      continue;
    }
    const expiresAt = new Date(nowMs + opts.fc.winbackExpiryDays * DAY_MS);
    const g = await rpcGrantCredits(sb, {
      userId,
      packageId: WINBACK_LOT.packageId,
      source: WINBACK_LOT.source,
      sourceId: winbackSourceId(d.subscriptionId),
      micro: creditsToMicro(opts.fc.winbackCredits),
      startsAt: opts.now,
      expiresAt,
    });
    if (!g.ok) {
      result.errors.push(`grant:${userId.slice(0, 8)}: ${g.reason ?? "unknown"}`);
      continue;
    }
    if (g.duplicate) {
      result.duplicates += 1;
      continue;
    }
    result.granted += 1;
    await opts.recordEvent(userId, "winback_credits_granted", {
      subscription_id: d.subscriptionId,
      lot_id: g.lotId,
      kind: d.kind,
      credits: opts.fc.winbackCredits,
      expires_at: expiresAt.toISOString(),
      access_ended_at: d.endedAtMs !== null ? new Date(d.endedAtMs).toISOString() : null,
    });
  }
  return result;
}

// ── Clawback after a late refund ───────────────────────────────────────

/**
 * Live win-back lots whose learner now shows refund or chargeback evidence
 * (none existed at the grant): the unspent part is clawed back
 * (mentor_clawback, idempotent). Runs first in every daily run while the
 * flag is on, so a dispute after the grant costs at most a day of credits.
 * Never throws.
 */
export async function clawbackRefundedWinbacks(sb: Db, now: Date, recordEvent: EventWriter): Promise<{ clawed: number; errors: string[] }> {
  const out = { clawed: 0, errors: [] as string[] };
  try {
    const lots = await sb.from("ai_credit_lot").select("user_id, source, source_id")
      .eq("source", WINBACK_LOT.source).like("source_id", `${WINBACK_LOT.prefix}%`).eq("status", "live")
      .gt("expires_at", now.toISOString()).gte("created_at", new Date(now.getTime() - MAX_LOT_DAYS * DAY_MS).toISOString()).limit(5000);
    if (lots.error) throw new WinbackReadError("live_lots");
    const live = ((lots.data ?? []) as Array<{ user_id: string; source: string; source_id: string }>).filter((l) => isWinbackLot(l.source, l.source_id));
    if (live.length === 0) return out;
    const facts = await loadWinbackFacts(sb, [...new Set(live.map((l) => l.user_id))].sort(), now);
    for (const l of live) {
      const f = facts.get(l.user_id);
      if (!f || !hasRefundEvidence(f.rows, f.refundEvent)) continue;
      const c = await rpcClawback(sb, WINBACK_LOT.source, l.source_id, "winback: refund or chargeback after the grant");
      if (!c.ok) { out.errors.push(`clawback:${l.user_id.slice(0, 8)}: ${c.reason ?? "unknown"}`); continue; }
      if (c.duplicate) continue;
      out.clawed += 1;
      await recordEvent(l.user_id, "winback_credits_clawed_back", { source_id: l.source_id, clawed_credits: creditsFromMicro(c.clawedMicro ?? 0) });
    }
  } catch (err) {
    out.errors.push((err as Error).message);
  }
  return out;
}

// ── Preview (read-only) ────────────────────────────────────────────────

export interface WinbackPreview {
  generated_at: string;
  mentor_reachable: boolean;
  window: { grace_hours: number; lookback_days: number };
  counts: Record<string, number>;
  /** uid8, decision, kind and the Vienna day of the end; never an address or a name. */
  rows: Array<{ user: string; decision: WinbackDecision; kind: WinbackKind | null; ended_day: string | null }>;
}

/** What a grant run would do right now, whatever the flag says. Reads only; throws on a read error. */
export async function previewWinbackGrants(sb: Db, now: Date, mentor: Pick<MentorConfig, "aiFeaturesEnabled" | "enabled" | "accessScope">): Promise<WinbackPreview> {
  const ids = await loadWinbackCandidates(sb, now);
  const facts = ids.length > 0 ? await loadWinbackFacts(sb, ids, now) : new Map<string, WinbackFacts>();
  const counts: Record<string, number> = {};
  const rows: WinbackPreview["rows"] = [];
  const day = new Intl.DateTimeFormat("en-CA", { timeZone: "Europe/Vienna", year: "numeric", month: "2-digit", day: "2-digit" });
  for (const [userId, f] of facts) {
    const d = decideWinback({ owner: f.owner, rows: f.rows, lastWinbackAtMs: f.lastWinbackAtMs, refundEvent: f.refundEvent, nowMs: now.getTime() });
    counts[d.decision] = (counts[d.decision] ?? 0) + 1;
    rows.push({ user: userId.slice(0, 8), decision: d.decision, kind: d.kind, ended_day: d.endedAtMs !== null ? day.format(new Date(d.endedAtMs)) : null });
  }
  return { generated_at: now.toISOString(), mentor_reachable: winbackMentorReachable(mentor), window: { grace_hours: WINBACK_GRACE_HOURS, lookback_days: WINBACK_LOOKBACK_DAYS }, counts, rows };
}

// ── Mail promise ───────────────────────────────────────────────────────

/**
 * Pure: would the grant follow at this end? The same account and refund
 * rules as decideWinback, a paid real-rail active row ending at that date,
 * and no win-back lot in the cooldown before it.
 */
export function winbackPromised(f: WinbackFacts, endMs: number): boolean {
  if (accountBlock(f.owner)) return false;
  if (hasRefundEvidence(f.rows, f.refundEvent)) return false;
  const endsThen = f.rows.some((r) => r.status === "active" && isPaidRealRailRow(r) && r.expires_at !== null
    && Math.abs(Date.parse(r.expires_at) - endMs) <= SAME_END_TOLERANCE_MS);
  if (!endsThen) return false;
  return f.lastWinbackAtMs === null || f.lastWinbackAtMs <= endMs - WINBACK_COOLDOWN_DAYS * DAY_MS;
}

/**
 * May the access-ending mail say "you will get N credits when it ends"? Only
 * while the flag is on, the mentor is reachable and winbackPromised holds.
 * Any read error: no line (never promise blind).
 */
export async function winbackMailPromise(sb: Db, userId: string, endMs: number, opts: {
  fc: Pick<FreeCreditConfig, "winbackEnabled">;
  mentor: Pick<MentorConfig, "aiFeaturesEnabled" | "enabled" | "accessScope">;
  now?: Date;
}): Promise<boolean> {
  if (!opts.fc.winbackEnabled || !winbackMentorReachable(opts.mentor)) return false;
  try {
    const f = (await loadWinbackFacts(sb, [userId], opts.now ?? new Date())).get(userId);
    return f ? winbackPromised(f, endMs) : false;
  } catch {
    return false;
  }
}

// ── Learner note ───────────────────────────────────────────────────────

export interface WinbackNote { lot_id: string; credits: number; expires_at: string }

/** The learner's newest live win-back lot granted in the last WINBACK_NOTE_DAYS, or null. Throws on a read error. */
export async function readWinbackNote(sb: Pick<SupabaseClient, "from">, userId: string, now: Date): Promise<WinbackNote | null> {
  const nowIso = now.toISOString();
  const { data, error } = await sb.from("ai_credit_lot").select("id, source, source_id, granted_micro, spent_micro, clawed_back_micro, expires_at")
    .eq("user_id", userId).eq("source", WINBACK_LOT.source).like("source_id", `${WINBACK_LOT.prefix}%`)
    .eq("status", "live").gt("expires_at", nowIso)
    .gte("created_at", new Date(now.getTime() - WINBACK_NOTE_DAYS * DAY_MS).toISOString())
    .order("created_at", { ascending: false }).limit(1);
  if (error) throw new Error(`winback note read failed: ${error.code ?? "unknown"}`);
  const row = ((data ?? []) as Array<{ id: string; source: string; source_id: string; granted_micro: number | string; spent_micro: number | string | null; clawed_back_micro: number | string | null; expires_at: string }>)[0];
  if (!row || !isWinbackLot(row.source, row.source_id)) return null;
  // What is left of the lot (a grant first pays down any mentor debt), whole credits.
  const left = Number(row.granted_micro) - Number(row.spent_micro ?? 0) - Number(row.clawed_back_micro ?? 0);
  const credits = Number.isFinite(left) ? Math.floor(left / FREE_CREDIT_MICRO_PER_CREDIT) : 0;
  return credits > 0 ? { lot_id: row.id, credits, expires_at: row.expires_at } : null;
}
