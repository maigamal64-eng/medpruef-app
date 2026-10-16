/**
 * Guarantee Ticket renewal on proof, server side (a-pricing-v2). Rules and
 * copy: ./ticket.ts. Schema: ticket_renewal_requests and
 * admin_ticket_renewal_decide (20270103090000, unapplied).
 *
 * Privacy: proof files live in the private bucket `ticket-proofs` under
 * <user_id>/<request_id>.<ext>, are shown only to admins through 5-minute
 * signed URLs, and are deleted TICKET_PROOF_RETENTION_DAYS after the
 * decision (runTicketProofCleanup). A request stores the kind, the file path
 * or an https link, an optional sitting date and an optional short note;
 * nothing else about the learner.
 */
import type { SupabaseClient } from "@supabase/supabase-js";
import { sendUnlessSuppressed } from "@/lib/mail-suppression";
import { ticketReminderEmailsEnabled } from "./flag";
import { ticketEndingMail } from "./emails";
import {
  TICKET_MAX_RENEWALS,
  TICKET_PROOF_RETENTION_DAYS,
  TICKET_REMINDER_DAYS,
  ticketRequestBlocker,
  type TicketRow,
} from "./ticket";

export const TICKET_PROOF_BUCKET = "ticket-proofs";
const DAY_MS = 86_400_000;

export interface TicketRequestView {
  id: string;
  kind: string;
  status: string;
  created_at: string;
  decided_at: string | null;
  decision_reason: string | null;
  new_expires_at: string | null;
  sitting_date: string | null;
}

export interface LearnerTicketState {
  ticket: { id: string; expires_at: string | null; status: string } | null;
  renewalsUsed: number;
  maxRenewals: number;
  pending: TicketRequestView | null;
  history: TicketRequestView[];
  blocker: ReturnType<typeof ticketRequestBlocker>;
}

/** The learner's newest Guarantee Ticket and its requests. Throws on a read error. */
export async function loadLearnerTicket(sb: SupabaseClient, userId: string, now: Date = new Date()): Promise<LearnerTicketState> {
  const { data: subs, error } = await sb.from("subscriptions")
    .select("id, tier, status, expires_at")
    .eq("user_id", userId).eq("tier", "guarantee_ticket").in("status", ["active", "expired"])
    .order("created_at", { ascending: false }).limit(1);
  if (error) throw error;
  const ticket = ((subs ?? [])[0] ?? null) as TicketRow | null;
  if (!ticket) return { ticket: null, renewalsUsed: 0, maxRenewals: TICKET_MAX_RENEWALS, pending: null, history: [], blocker: "no_ticket" };
  const { data: reqs, error: reqError } = await sb.from("ticket_renewal_requests")
    .select("id, kind, status, created_at, decided_at, decision_reason, new_expires_at, sitting_date")
    .eq("subscription_id", ticket.id).eq("user_id", userId)
    .order("created_at", { ascending: false }).limit(10);
  if (reqError) throw reqError;
  const history = (reqs ?? []) as TicketRequestView[];
  const renewalsUsed = history.filter((r) => r.status === "approved").length;
  const pending = history.find((r) => r.status === "pending") ?? null;
  return {
    ticket: { id: ticket.id, expires_at: ticket.expires_at, status: ticket.status },
    renewalsUsed,
    maxRenewals: TICKET_MAX_RENEWALS,
    pending,
    history,
    blocker: ticketRequestBlocker(ticket, renewalsUsed, Boolean(pending), now),
  };
}

export function proofExtension(mime: string): string | null {
  return mime === "image/png" ? "png" : mime === "image/jpeg" ? "jpg" : mime === "image/webp" ? "webp" : mime === "application/pdf" ? "pdf" : null;
}

/**
 * Delete proof files of requests decided more than the retention period ago,
 * then stamp proof_deleted_at. The path stays as a record that a file existed.
 * Bounded per run; a storage failure leaves the row for the next run.
 */
export async function runTicketProofCleanup(sb: SupabaseClient, now: Date = new Date()): Promise<{ deleted: number; failed: number; skipped?: string }> {
  const cutoff = new Date(now.getTime() - TICKET_PROOF_RETENTION_DAYS * DAY_MS).toISOString();
  const { data, error } = await sb.from("ticket_renewal_requests")
    .select("id, proof_path")
    .neq("status", "pending").lt("decided_at", cutoff)
    .not("proof_path", "is", null).is("proof_deleted_at", null)
    .order("decided_at", { ascending: true }).limit(100);
  if (error) {
    // Before the changeset is applied the table does not exist: nothing to do.
    if ((error as { code?: string }).code === "42P01" || /does not exist|schema cache/i.test(error.message ?? "")) return { deleted: 0, failed: 0, skipped: "not_applied" };
    throw error;
  }
  const rows = (data ?? []) as Array<{ id: string; proof_path: string }>;
  if (rows.length === 0) return { deleted: 0, failed: 0 };
  const { error: removeError } = await sb.storage.from(TICKET_PROOF_BUCKET).remove(rows.map((r) => r.proof_path));
  if (removeError) return { deleted: 0, failed: rows.length };
  const { error: stampError } = await sb.from("ticket_renewal_requests")
    .update({ proof_deleted_at: now.toISOString() })
    .in("id", rows.map((r) => r.id)).is("proof_deleted_at", null);
  if (stampError) return { deleted: 0, failed: rows.length };
  return { deleted: rows.length, failed: 0 };
}

/**
 * "Your ticket ends in 30 days": tickets whose end falls 29 to 30 days from
 * now, at most one mail per ticket and end date (a claim in
 * processed_webhook_events before the send, never released after an
 * attempt). Off unless TICKET_REMINDER_EMAILS_ENABLED.
 */
export async function runTicketEndingReminders(sb: SupabaseClient, siteUrl: string, now: Date = new Date()): Promise<{ sent: number; skipped: number; failed: number; enabled: boolean }> {
  if (!ticketReminderEmailsEnabled()) return { sent: 0, skipped: 0, failed: 0, enabled: false };
  const from = new Date(now.getTime() + (TICKET_REMINDER_DAYS - 1) * DAY_MS).toISOString();
  const to = new Date(now.getTime() + TICKET_REMINDER_DAYS * DAY_MS).toISOString();
  const { data, error } = await sb.from("subscriptions")
    .select("id, user_id, expires_at")
    .eq("tier", "guarantee_ticket").eq("status", "active")
    .gt("expires_at", from).lte("expires_at", to).limit(200);
  if (error) throw error;
  let sent = 0, skipped = 0, failed = 0;
  for (const t of (data ?? []) as Array<{ id: string; user_id: string; expires_at: string }>) {
    const { data: user, error: userError } = await sb.from("users").select("email, language_code").eq("id", t.user_id).maybeSingle();
    if (userError || !user?.email) { skipped++; continue; }
    const { count, error: countError } = await sb.from("ticket_renewal_requests")
      .select("id", { count: "exact", head: true }).eq("subscription_id", t.id).eq("status", "approved");
    if (countError) { failed++; continue; }
    const key = `ticket_ending:${t.id}:${t.expires_at.slice(0, 10)}`;
    const { data: claim, error: claimError } = await sb.from("processed_webhook_events")
      .insert({ provider: "mail_reminder", event_id: key, payload: { reason: "ticket_ending", subscription_id: t.id, claimed_at: now.toISOString() } })
      .select("event_id").maybeSingle();
    if (claimError || !claim) { skipped++; continue; }
    const lang = user.language_code === "de" || !user.language_code ? "de" : "en";
    const mail = ticketEndingMail({ lang, endsAt: t.expires_at, renewalsUsed: count ?? 0, formUrl: `${siteUrl}/ticket-renewal` });
    const result = await sendUnlessSuppressed(sb, "transactional", { to: String(user.email), subject: mail.subject, htmlBody: mail.htmlBody });
    if (result.ok) sent++; else failed++;
  }
  return { sent, skipped, failed, enabled: true };
}
