import { NextRequest, NextResponse } from "next/server";
import { safeEqual } from "@/lib/security/timing-safe";
import { getServiceClient } from "@/lib/supabase";
import { sendZohoEmail, type SendZohoEmailArgs } from "@/lib/email/zoho";

export type ReminderDb = ReturnType<typeof getServiceClient>;
export const enabled = (name: string) => process.env[name] === "true";
export const noStore = { "Cache-Control": "no-store", "Referrer-Policy": "no-referrer" };
export function cronAuthorized(req: NextRequest): boolean {
  const secret = process.env.CRON_SECRET;
  return !!secret && safeEqual(req.headers.get("authorization"), `Bearer ${secret}`);
}
export function cronError(status: number, error: string) {
  return NextResponse.json({ error }, { status, headers: noStore });
}
export function assertDb(error: { message: string } | null) {
  // Do not return database messages, email addresses or provider bodies.
  if (error) throw new Error("Reminder database operation failed");
}
export function escapeHtml(value: string): string {
  return value.replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]!);
}
// Use the canonical HTTPS origin, never a caller-supplied Host header.
export const SITE = "https://medpruf.com";
export function unsubscribeUrl(kind: "exam" | "study", token: string): string {
  return `${SITE}/api/${kind === "exam" ? "reminders" : "nudge"}?unsub=${encodeURIComponent(token)}`;
}

export interface Delivery {
  keys: Record<string, string | number>;
  isSubscribed: () => Promise<boolean>;
  mail: SendZohoEmailArgs;
  onSent?: () => Promise<void>;
}
export async function deliverBatch(db: ReminderDb, table: string, deliveries: Delivery[], dryRun: boolean, now: Date) {
  const counts = { eligible: deliveries.length, pending: 0, sent: 0, failed: 0, skipped: 0 };
  for (const delivery of deliveries) {
    let query = db.from(table).select("id");
    for (const [key, value] of Object.entries(delivery.keys)) query = query.eq(key, value);
    const existing = await query.maybeSingle();
    assertDb(existing.error);
    if (existing.data) { counts.skipped++; continue; }
    if (!await delivery.isSubscribed()) { counts.skipped++; continue; }
    counts.pending++;
    if (dryRun) continue;

    // Atomic unique insertion before the provider call fences concurrent cron
    // invocations and crash retries. Claimed/failed rows are NEVER auto-retried:
    // an ambiguous provider response cannot establish non-delivery.
    const claim = await db.from(table).insert({ ...delivery.keys, status: "claimed" }).select("id").single();
    if (claim.error?.code === "23505") { counts.skipped++; continue; }
    assertDb(claim.error);
    if (!claim.data) throw new Error("Reminder reservation missing");
    // Re-check opt-out after acquiring the reservation, right before sending.
    if (!await delivery.isSubscribed()) { counts.skipped++; continue; }
    let ok = false;
    try { ok = (await sendZohoEmail(delivery.mail)).ok; } catch { /* held for manual reconciliation */ }
    const stamp = await db.from(table).update({ status: ok ? "sent" : "failed", sent_at: ok ? now.toISOString() : null }).eq("id", claim.data.id);
    assertDb(stamp.error);
    if (ok) { counts.sent++; await delivery.onSent?.(); } else counts.failed++;
  }
  return counts;
}

export async function loadSubscriptions(db: ReminderDb, table: string, columns: string, filter: "exam" | "study") {
  const result: Record<string, unknown>[] = [];
  // Explicit pagination avoids PostgREST's default 1000-row truncation.
  for (let page = 0; page < 100; page++) {
    let query = db.from(table).select(columns).order("id").range(page * 100, page * 100 + 99);
    query = filter === "exam" ? query.eq("confirmed", true).is("unsubscribed_at", null) : query.eq("opt_in", true).eq("channel", "email");
    const { data, error } = await query;
    assertDb(error);
    const rows = (data ?? []) as unknown as Record<string, unknown>[];
    result.push(...rows);
    if (rows.length < 100) return result;
  }
  throw new Error("Reminder audience exceeds batch safety limit");
}
