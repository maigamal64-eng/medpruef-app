/**
 * Admin action alert (a19, ADM-03 option A, TR-14). Pure.
 *
 * One message to the internal default [name] bot only when something needs
 * [name]: a paid payment that did not grant access, a refund or dispute, a
 * new PUYP proof, Whop deliveries rejected with a signed-looking secret
 * mismatch, a question reported a second (or further) time. Links carry
 * ids only, never emails or names. Each item has a stable key prefixed
 * `alert:` (so it can never match a payment-id claim in the shared
 * processed_webhook_events table); the cron claims keys before sending, so an item is pushed once (a repeat report
 * re-alerts when its count grows).
 *
 * Off by default: ADMIN_ACTION_ALERT_ENABLED must be 'true' and the
 * internal bot token TELEGRAM_OPS_FORWARD_TOKEN must be set. The customer
 * bot token (TELEGRAM_BOT_TOKEN) is never used for internal messages.
 */

import type { SpendMeter } from "@/lib/ai/workspace-spend";
import type { DeliveryRow, LedgerPayment, LedgerRefund } from "./money-rules";
import { isSuspectedSecretMismatch, isUnresolvedPayment, viennaDay } from "./money-rules";

/** Default [name] bot chat (workspace Telegram routing rule). */
export const DEFAULT_ALERT_CHAT_ID = "0";
export const ALERT_CLAIM_PROVIDER = "admin_alert";
/** One message lists at most this many items; the rest go out on the next run. */
export const MAX_ITEMS_PER_MESSAGE = 20;
/** A payment still inside its grant window (webhook retry, verify) is not alerted yet. */
const PAYMENT_GRACE_MS = 30 * 60_000;

export interface AlertItem {
  key: string;
  kind: "unresolved_payment" | "refund" | "dispute" | "puyp" | "whop_rejected" | "repeat_report" | "ai_spend";
  line: string;
  path: string;
}

export interface AlertInputs {
  payments: readonly LedgerPayment[];
  refunds: readonly LedgerRefund[];
  deliveries: readonly DeliveryRow[];
  puyp: ReadonlyArray<{ id: string | number; created_at: string }>;
  /** Pending reports with their question's total report count. */
  repeatReports: ReadonlyArray<{ report_id: number; question_id: number; count: number }>;
  /** Anthropic workspace spend meter (a-anthropic-features); null when unreadable. */
  aiSpend?: Pick<SpendMeter, "workspace" | "state" | "trigger" | "monthPct" | "dayPct"> | null;
}

const HOURS_48 = 48 * 3_600_000;

export function buildAlertItems(input: AlertInputs, now: Date): AlertItem[] {
  const items: AlertItem[] = [];
  for (const p of input.payments) {
    if (!isUnresolvedPayment(p)) continue;
    if (now.getTime() - Date.parse(p.last_seen_at) < PAYMENT_GRACE_MS) continue;
    items.push({ key: `alert:unresolved:${p.payment_id}`, kind: "unresolved_payment", line: `Payment ${p.payment_id} was paid but did not grant access`, path: "/admin/payments#unresolved" });
  }
  for (const r of input.refunds) {
    const at = Date.parse(r.refunded_at);
    if (!Number.isFinite(at) || now.getTime() - at > HOURS_48) continue;
    items.push({ key: `alert:${r.kind}:${r.refund_id}`, kind: r.kind, line: `${r.kind === "dispute" ? "Dispute" : "Refund"} ${r.refund_id} (check access)`, path: "/admin/payments#refunds" });
  }
  for (const a of input.puyp) {
    items.push({ key: `alert:puyp:${a.id}`, kind: "puyp", line: `New PUYP proof #${a.id} waits for review (72-hour promise)`, path: "/admin/puyp" });
  }
  // Rejected deliveries collapse to one item per Vienna day.
  const rejectedByDay = new Map<string, number>();
  for (const d of input.deliveries) {
    if (!isSuspectedSecretMismatch(d)) continue;
    const day = viennaDay(d.received_at);
    rejectedByDay.set(day, (rejectedByDay.get(day) ?? 0) + 1);
  }
  for (const [day, n] of rejectedByDay) {
    items.push({ key: `alert:whop_rejected:${day}`, kind: "whop_rejected", line: `${n} Whop deliver${n === 1 ? "y" : "ies"} rejected on ${day} (signing secret mismatch?)`, path: "/admin/payments#deliveries" });
  }
  // One item per question; the key carries the count so a further report alerts again.
  const byQuestion = new Map<number, { report_id: number; count: number }>();
  for (const r of input.repeatReports) {
    if (r.count < 2) continue;
    const prev = byQuestion.get(r.question_id);
    if (!prev || r.report_id > prev.report_id) byQuestion.set(r.question_id, { report_id: r.report_id, count: r.count });
  }
  for (const [qid, r] of byQuestion) {
    items.push({ key: `alert:repeat:${qid}:${r.count}`, kind: "repeat_report", line: `Question #${qid} reported ${r.count} times`, path: `/admin/questions?tab=reviews&report=${r.report_id}` });
  }
  // AI spend: one item per workspace, period and state (a month alarm alerts
  // once a month, a day alarm once a day; reaching the soft stop alerts again).
  const m = input.aiSpend;
  if (m && (m.state === "alarm" || m.state === "soft_stop") && m.trigger) {
    const period = m.trigger === "month" ? now.toISOString().slice(0, 7) : now.toISOString().slice(0, 10);
    const pctNow = m.trigger === "month" ? m.monthPct : m.dayPct;
    const what = m.state === "soft_stop" ? "free and house-funded AI is resting, paid learners continue" : "alarm";
    items.push({
      key: `alert:ai_spend:${m.workspace}:${m.trigger}:${period}:${m.state}`,
      kind: "ai_spend",
      line: `AI spend ${m.workspace} at ${pctNow ?? "?"} % of the ${m.trigger === "month" ? "monthly" : "daily"} budget (${what})`,
      path: "/admin/overview",
    });
  }
  return items;
}

/** The Telegram text, tagged [MedPrüf], ids only. Capped to stay under Telegram's 4096 limit. */
export function formatAlertMessage(items: readonly AlertItem[], origin: string): string {
  const base = origin.replace(/\/+$/, "");
  const lines = items.slice(0, MAX_ITEMS_PER_MESSAGE).map((i) => `- ${i.line}: ${base}${i.path}`);
  const more = items.length > MAX_ITEMS_PER_MESSAGE ? [`and ${items.length - MAX_ITEMS_PER_MESSAGE} more: ${base}/admin/overview`] : [];
  return [`[MedPrüf] Needs you (${items.length})`, ...lines, ...more].join("\n").slice(0, 4000);
}

export interface AlertConfig {
  enabled: boolean;
  token: string | null;
  chatId: string;
  origin: string;
}

export function readAlertConfig(env: Record<string, string | undefined> = process.env): AlertConfig {
  return {
    enabled: env.ADMIN_ACTION_ALERT_ENABLED === "true",
    token: env.TELEGRAM_OPS_FORWARD_TOKEN || null,
    chatId: env.ADMIN_ALERT_TELEGRAM_CHAT_ID || DEFAULT_ALERT_CHAT_ID,
    origin: env.NEXT_PUBLIC_SITE_URL || "https://medpruf.com",
  };
}
