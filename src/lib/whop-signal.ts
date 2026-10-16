/**
 * Whop renewal and case signals (a-whop-cancel-signal, Whop review G8 and the
 * cancel-signal-webhook opportunity, 16 Oct 2026).
 *
 * Two kinds of Whop event carry news Kassa needs the same day, and neither
 * may ever change access:
 *   - renewal: a payer turned automatic renewal off (or back on). Whop names
 *     it `membership.cancel_at_period_end_changed`; a v1 hook may only offer
 *     `membership.updated`, whose envelope then carries
 *     `previous_attributes.cancel_at_period_end`. Both are read here.
 *   - case: a Resolution Center case (`resolution_center_case.*`, legacy
 *     `resolution.*`). Whop decides an unanswered case after 7 days.
 *
 * The route logs one user_events row per delivery (deduplicated on the
 * Standard Webhooks `webhook-id`), never grants, never revokes, and alerts
 * [name] through the secretary bot only while WHOP_SIGNAL_ALERTS_ENABLED is
 * 'true' and TELEGRAM_SECRETARY_TOKEN is set. Alert text carries ids, plan
 * kind, dates and Whop's cancel category: never an email, a name or the
 * buyer's free-text reason.
 *
 * Pure except `sendSecretaryAlert` and `readWhopMembershipCancelState`.
 */
import crypto from "node:crypto";
import { whopHeaders } from "@/lib/whop-api";
import { WHOP_FETCH_TIMEOUT_MS } from "@/lib/whop-timeouts";
import { safeWhopManageUrl } from "@/lib/whop-subscription-snapshot";
import { isWhopMembershipId } from "@/lib/whop-ids";

export const SIGNAL_CLAIM_PROVIDER = "whop_signal";
export const RENEWAL_SIGNAL_EVENT = "whop_renewal_signal";
export const CASE_SIGNAL_EVENT = "whop_case_signal";
/** user_events.user_id is NOT NULL; an unmatched signal is still logged (same sentinel as whop_revoke_unmatched). */
export const UNMATCHED_USER_ID = "whop-webhook";
/** [name]'s chat on the secretary bot (fixed: the bot is [name]-only by design). */
export const SECRETARY_CHAT_ID = "0";

const RENEWAL_EVENTS = new Set([
  "membership.cancel_at_period_end_changed",
  "membership_cancel_at_period_end_changed",
]);
const MEMBERSHIP_UPDATED = new Set(["membership.updated", "membership_updated"]);
const CASE_EVENTS = new Set([
  "resolution_center_case.created", "resolution_center_case_created",
  "resolution_center_case.updated", "resolution_center_case_updated",
  "resolution_center_case.decided", "resolution_center_case_decided",
  "resolution.created", "resolution_created",
  "resolution.updated", "resolution_updated",
  "resolution.decided", "resolution_decided",
]);

const rec = (v: unknown): Record<string, unknown> => (v && typeof v === "object" && !Array.isArray(v) ? (v as Record<string, unknown>) : {});
const str = (v: unknown): string | null => (typeof v === "string" && v.trim() ? v.trim() : null);
/**
 * Whop's machine categories only (too_expensive, product_not_received). Anything
 * else may be buyer text, so it is reported as "other" and never copied.
 */
const category = (v: string | null): string | null => (v ? (/^[a-z0-9_]{1,40}$/i.test(v) ? v : "other") : null);
/** Short, single-line, safe for a plain-text alert. */
const clip = (v: string | null, max = 60): string | null => (v ? v.replace(/[\r\n\t]+/g, " ").replace(/—/g, "-").slice(0, max) : null);

function isoOrNull(v: unknown): string | null {
  if (typeof v === "number" && Number.isFinite(v)) return new Date(v > 1e12 ? v : v * 1000).toISOString();
  if (typeof v === "string") {
    const t = Date.parse(v);
    return Number.isFinite(t) ? new Date(t).toISOString() : null;
  }
  return null;
}

export interface RenewalSignal {
  kind: "renewal";
  event: string;
  membershipId: string | null;
  /** The new value; null when the payload does not say. */
  cancelAtPeriodEnd: boolean | null;
  periodEnd: string | null;
  status: string | null;
  planId: string | null;
  productId: string | null;
  /** Whop's cancel category (cancel_option / feedback_option), never the free-text reason. */
  cancelOption: string | null;
  manageUrl: string | null;
  metaUserId: string | null;
}

export interface CaseSignal {
  kind: "case";
  event: string;
  caseId: string | null;
  status: string | null;
  reason: string | null;
  outcome: string | null;
  refund: string | null;
  amount: number | null;
  currency: string | null;
  responseDueAt: string | null;
  paymentId: string | null;
  membershipId: string | null;
  planId: string | null;
  productId: string | null;
  escalated: boolean | null;
}

export type WhopSignal = RenewalSignal | CaseSignal;

function readRenewal(event: string, data: Record<string, unknown>): RenewalSignal {
  const ownId = str(data.id);
  const membership = rec(data.membership);
  const feedback = rec(data.feedback_option);
  const flag = data.cancel_at_period_end;
  return {
    kind: "renewal",
    event,
    membershipId: isWhopMembershipId(ownId) ? ownId : (isWhopMembershipId(str(data.membership_id)) ? str(data.membership_id) : isWhopMembershipId(str(membership.id)) ? str(membership.id) : null),
    cancelAtPeriodEnd: typeof flag === "boolean" ? flag : null,
    periodEnd: isoOrNull(data.current_period_end) ?? isoOrNull(data.renewal_period_end) ?? isoOrNull(data.expires_at),
    status: clip(str(data.status), 30),
    planId: str(data.plan_id) ?? str(rec(data.plan).id),
    productId: str(data.product_id) ?? str(rec(data.product).id),
    cancelOption: category(str(data.cancel_option) ?? str(feedback.title) ?? str(feedback.name) ?? (typeof data.feedback_option === "string" ? str(data.feedback_option) : null)),
    manageUrl: safeWhopManageUrl(data.manage_url),
    metaUserId: str(rec(data.metadata).medpruef_user_id),
  };
}

function readCase(event: string, data: Record<string, unknown>): CaseSignal {
  const payment = rec(data.payment);
  const amount = typeof data.amount === "number" && Number.isFinite(data.amount) ? data.amount
    : typeof data.amount === "string" && Number.isFinite(Number(data.amount)) ? Number(data.amount) : null;
  const paymentId = str(payment.id) ?? str(data.payment_id);
  const membershipId = str(data.membership_id) ?? str(rec(data.membership).id);
  return {
    kind: "case",
    event,
    caseId: str(data.id),
    status: clip(str(data.status), 40),
    reason: category(str(data.reason) ?? str(data.issue)),
    outcome: clip(str(data.outcome), 30),
    refund: clip(str(data.refund), 20),
    amount,
    currency: clip(str(data.currency), 5),
    responseDueAt: isoOrNull(data.response_due_at) ?? isoOrNull(data.due_date),
    paymentId: paymentId && paymentId.startsWith("pay_") ? paymentId : null,
    membershipId: isWhopMembershipId(membershipId) ? membershipId : null,
    planId: str(data.plan_id) ?? str(rec(data.plan).id),
    productId: str(data.product_id) ?? str(rec(data.product).id),
    escalated: typeof data.escalated === "boolean" ? data.escalated : null,
  };
}

/**
 * The signal an event carries, or null when it is not one. A
 * `membership.updated` counts only when its envelope names a change of
 * cancel_at_period_end (previous_attributes); other membership updates fall
 * through to the quiet ack.
 */
export function classifyWhopSignal(event: string, payload: unknown): WhopSignal | null {
  const env = rec(payload);
  const data = rec(env.data ?? payload);
  if (RENEWAL_EVENTS.has(event)) return readRenewal(event, data);
  if (MEMBERSHIP_UPDATED.has(event)) {
    // Whop documents previous_attributes on the envelope; read data's copy too, in case.
    const prev = Object.hasOwn(rec(env.previous_attributes), "cancel_at_period_end") ? rec(env.previous_attributes) : rec(data.previous_attributes);
    if (!Object.hasOwn(prev, "cancel_at_period_end")) return null;
    const signal = readRenewal(event, data);
    // Whop reports the field changed but repeats the same value: not news.
    if (typeof prev.cancel_at_period_end === "boolean" && prev.cancel_at_period_end === signal.cancelAtPeriodEnd) return null;
    return signal;
  }
  if (CASE_EVENTS.has(event)) return readCase(event, data);
  return null;
}

/**
 * The payment id an event may log. Only `payment.*` events read the payload's
 * own id as a payment; every other event (membership, case, unknown) offers a
 * payment id only through an explicit field or an id that is itself `pay_…`,
 * so a `mem_…` or `reso_…` never lands in payment_events as a payment.
 */
export function gatedPaymentId(event: string, data: unknown, extracted: string | null): string | null {
  if (/^payment[._]/.test(event)) return extracted;
  const d = rec(data);
  const explicit = str(d.payment_id) ?? str(rec(d.payment).id) ?? str(d.receipt_id);
  if (explicit) return explicit;
  const own = str(d.id);
  return own && own.startsWith("pay_") ? own : null;
}

/** Retries of one Whop message share its `webhook-id`; without one, the body hash stands in. */
export function signalClaimKey(webhookId: string | null, rawBody: string): string {
  const id = webhookId && /^[A-Za-z0-9_.:-]{1,120}$/.test(webhookId) ? webhookId : `sha256:${crypto.createHash("sha256").update(rawBody, "utf8").digest("hex").slice(0, 40)}`;
  return `whop_signal:${id}`;
}

/** Shared by the webhook and the daily read: one renewal state per membership and period. */
export function renewalStateKey(membershipId: string, cancelAtPeriodEnd: boolean, periodEnd: string | null): string {
  return `whop_signal_state:${membershipId}:${cancelAtPeriodEnd ? "off" : "on"}:${periodEnd ? periodEnd.slice(0, 10) : "none"}`;
}

export type SignalProduct = "Pro" | "Mentor" | "unknown plan";

export interface AlertContext {
  userId: string | null;
  product: SignalProduct;
  origin: string;
  source: "webhook" | "daily_read";
}

const day = (iso: string | null): string | null => (iso ? iso.slice(0, 10) : null);

/** Plain-text secretary-bot message, ids and dates only, no em dash, at most 4000 chars. */
export function formatSignalAlert(signal: WhopSignal, ctx: AlertContext): string {
  const base = ctx.origin.replace(/\/+$/, "");
  const learner = ctx.userId ? `Learner: ${base}/admin/users/${ctx.userId}` : "Learner: not matched (no pinned subscription for this membership)";
  const lines: string[] = [];
  if (signal.kind === "renewal") {
    const head = signal.cancelAtPeriodEnd === false
      ? "renewal turned back ON"
      : signal.cancelAtPeriodEnd === true ? "renewal turned OFF (cancel at period end)" : "renewal setting changed";
    lines.push(`[MedPrüf] Kassa: ${head}`);
    lines.push(`Plan: ${ctx.product}${signal.planId ? ` (${signal.planId})` : ""}, membership ${signal.membershipId ?? "unknown"}`);
    if (signal.periodEnd) lines.push(`${signal.cancelAtPeriodEnd === false ? "Next charge" : "Access ends"}: ${day(signal.periodEnd)}`);
    if (signal.cancelOption) lines.push(`Cancel reason (category): ${signal.cancelOption}`);
    lines.push(learner);
    lines.push("No access was changed.");
  } else {
    lines.push(`[MedPrüf] Kassa: Resolution Center case ${signal.event.split(/[._]/).pop() ?? "event"}`);
    lines.push(`Case ${signal.caseId ?? "unknown"}, status ${signal.status ?? "unknown"}${signal.reason ? `, reason ${signal.reason}` : ""}`);
    if (signal.amount != null) lines.push(`Amount: ${signal.amount} ${(signal.currency ?? "").toUpperCase()}`.trim());
    if (signal.responseDueAt) lines.push(`Response due: ${day(signal.responseDueAt)} (Whop decides unanswered cases)`);
    if (signal.outcome || signal.refund) lines.push(`Outcome: ${signal.outcome ?? "open"}, refund: ${signal.refund ?? "none yet"}`);
    lines.push(`Plan: ${ctx.product}${signal.paymentId ? `, payment ${signal.paymentId}` : ""}`);
    lines.push(learner);
    lines.push("Answer it in Whop > Resolution Center. No access was changed.");
  }
  if (ctx.source === "daily_read") lines.push("(seen by the daily membership read)");
  return lines.join("\n").replace(/—/g, "-").slice(0, 4000);
}

export interface SignalAlertConfig { enabled: boolean; token: string | null; origin: string }

export function readSignalAlertConfig(env: Record<string, string | undefined> = process.env): SignalAlertConfig {
  const token = env.TELEGRAM_SECRETARY_TOKEN?.trim() || null;
  return {
    enabled: env.WHOP_SIGNAL_ALERTS_ENABLED === "true" && Boolean(token),
    token,
    origin: env.NEXT_PUBLIC_SITE_URL || "https://medpruf.com",
  };
}

export type AlertOutcome = "sent" | "not_sent" | "off";

/**
 * One sendMessage to [name]'s chat on the secretary bot. Plain text (no parse
 * mode), 8 s budget, the token never logged. The bot runs on a tg-inbox
 * webhook: this code never calls getUpdates.
 */
export async function sendSecretaryAlert(
  text: string,
  config: SignalAlertConfig,
  fetchImpl: typeof fetch = fetch,
): Promise<AlertOutcome> {
  if (!config.enabled || !config.token) return "off";
  try {
    const res = await fetchImpl(`https://api.telegram.org/bot${config.token}/sendMessage`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ chat_id: SECRETARY_CHAT_ID, text, disable_web_page_preview: true }),
      signal: AbortSignal.timeout(8_000),
    });
    if (!res.ok) {
      console.error(`[whop-signal] secretary alert failed: HTTP ${res.status}`);
      return "not_sent";
    }
    return "sent";
  } catch (err) {
    console.error(`[whop-signal] secretary alert failed: ${err instanceof Error ? err.name : "error"}`);
    return "not_sent";
  }
}

// ── Daily read fallback (WHOP_CANCEL_READ_ENABLED) ────────────────────

export function whopCancelReadEnabled(env: Record<string, string | undefined> = process.env): boolean {
  return env.WHOP_CANCEL_READ_ENABLED === "true";
}

export interface MembershipCancelRead {
  /** HTTP status, 0 for a timeout or network error, null when no read was made. */
  status: number | null;
  signal: RenewalSignal | null;
}

/** One bounded, read-only GET /memberships/{id}. Never a write. */
export async function readWhopMembershipCancelState(
  membershipId: string,
  fetchImpl: typeof fetch = fetch,
  env: Record<string, string | undefined> = process.env,
): Promise<MembershipCancelRead> {
  const apiKey = env.WHOP_API_KEY || env.WHOP_APP_API_KEY;
  if (!apiKey || !isWhopMembershipId(membershipId)) return { status: null, signal: null };
  try {
    const res = await fetchImpl(`https://api.whop.com/api/v1/memberships/${encodeURIComponent(membershipId)}`, {
      method: "GET",
      headers: whopHeaders(apiKey),
      cache: "no-store",
      signal: AbortSignal.timeout(WHOP_FETCH_TIMEOUT_MS),
    });
    if (!res.ok) return { status: res.status, signal: null };
    const body = rec(await res.json());
    if (str(body.id) !== membershipId) return { status: res.status, signal: null };
    return { status: res.status, signal: readRenewal("daily_read", body) };
  } catch {
    return { status: 0, signal: null };
  }
}

/**
 * What the daily read reports for one membership, given which state keys
 * already exist: a new "off" for this period once; "on" again only after an
 * "off" was recorded for the same period. A membership already ended
 * (canceled, expired) is the deactivation path's business, not this one.
 */
export function dailyReadDecision(
  signal: RenewalSignal,
  hasKey: (key: string) => boolean,
): { report: boolean; key: string | null } {
  if (!signal.membershipId || signal.cancelAtPeriodEnd === null) return { report: false, key: null };
  if (signal.status && !["active", "trialing", "canceling", "past_due"].includes(signal.status)) return { report: false, key: null };
  const offKey = renewalStateKey(signal.membershipId, true, signal.periodEnd);
  if (signal.cancelAtPeriodEnd) return hasKey(offKey) ? { report: false, key: offKey } : { report: true, key: offKey };
  const onKey = renewalStateKey(signal.membershipId, false, signal.periodEnd);
  return hasKey(offKey) && !hasKey(onKey) ? { report: true, key: onKey } : { report: false, key: onKey };
}

const DAY_MS = 86_400_000;

/**
 * Stable order (membership id), rotated by the day number so a list longer
 * than one run's reads is covered over consecutive days.
 */
export function rotateForDay<T>(items: readonly T[], perRun: number, nowMs: number): T[] {
  if (items.length <= perRun) return [...items];
  const start = (Math.floor(nowMs / DAY_MS) * perRun) % items.length;
  return [...items.slice(start), ...items.slice(0, start)];
}
