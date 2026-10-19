/**
 * Guarantee Ticket, defined once (a-pricing-v2). Pricing card, terms page,
 * FAQ, the learner's renewal form, the admin queue and the reminder email
 * render from here, so the proof rule, the cap and the refund sentence cannot
 * drift between surfaces.
 *
 * Facts:
 *   - one payment, exactly 12 months (TIERS.guarantee_ticket), Mentor credits
 *     included at the Cohort level per 30-day slice (included.ts)
 *   - a free renewal year on proof of EITHER an official result that shows a
 *     failed exam OR a registration confirmation for a sitting after the
 *     ticket ends
 *   - at most TICKET_MAX_RENEWALS renewal years per ticket
 *   - a request is possible while the ticket runs and up to
 *     TICKET_REQUEST_GRACE_DAYS after it ended; an approval adds 12 months
 *     to the later of the ticket end and the decision day (never shorter)
 *   - proof files: private bucket, admins only, deleted
 *     TICKET_PROOF_RETENTION_DAYS after the decision
 *   - an extension, never a cash refund; the statutory withdrawal right stays
 * Formal Sie, no em dashes. Pure (no I/O).
 */
import type { BillingLang } from "@/lib/billing-copy";
import { REFUND } from "@/lib/content-truth";

export const TICKET_MAX_RENEWALS = 2;
export const TICKET_RENEWAL_MONTHS = 12;
export const TICKET_REQUEST_GRACE_DAYS = 30;
export const TICKET_PROOF_RETENTION_DAYS = 30;
export const TICKET_REMINDER_DAYS = 30;
// Vercel functions refuse request bodies above about 4.5 MB (review P3).
export const TICKET_PROOF_MAX_BYTES = 4 * 1024 * 1024;
export const TICKET_PROOF_TYPES = ["image/png", "image/jpeg", "image/webp", "application/pdf"] as const;

export type TicketProofKind = "failed_result" | "booked_sitting";

const DAY_MS = 86_400_000;

export interface TicketRow { id: string; tier: string; status: string; expires_at: string | null }

/**
 * May a renewal be requested for this ticket now? Returns the reason it may
 * not. `approved` = approved requests so far; `pending` = one is waiting.
 */
export function ticketRequestBlocker(t: TicketRow | null, approved: number, pending: boolean, now: Date = new Date()):
  | null | "no_ticket" | "no_end" | "too_late" | "cap_reached" | "pending" | "inactive" {
  if (!t || t.tier !== "guarantee_ticket") return "no_ticket";
  if (t.status !== "active" && t.status !== "expired") return "inactive";
  if (!t.expires_at) return "no_end";
  const end = Date.parse(t.expires_at);
  if (!Number.isFinite(end)) return "no_end";
  if (end + TICKET_REQUEST_GRACE_DAYS * DAY_MS < now.getTime()) return "too_late";
  if (approved >= TICKET_MAX_RENEWALS) return "cap_reached";
  if (pending) return "pending";
  return null;
}

/** A booked sitting counts only when it falls after the ticket ends (Vienna day of the end or later). */
export function sittingAfterTicket(sittingDate: string, ticketEnd: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(sittingDate)) return false;
  const end = Date.parse(ticketEnd);
  if (!Number.isFinite(end)) return false;
  return Date.parse(`${sittingDate}T23:59:59Z`) > end;
}

/** Only an https link without credentials, at most 500 characters. */
export function safeProofLink(raw: unknown): string | null {
  if (typeof raw !== "string") return null;
  const trimmed = raw.trim();
  if (!trimmed || trimmed.length > 500) return null;
  try {
    const url = new URL(trimmed);
    if (url.protocol !== "https:" || url.username || url.password) return null;
    return url.href;
  } catch {
    return null;
  }
}

export interface TicketTermRow { label: string; value: string }

/** The renewal terms as label/value rows. `mentorCredits` null hides the Mentor row. */
export function ticketTerms(lang: BillingLang, mentorCredits: number | null): TicketTermRow[] {
  const de = lang === "de";
  const rows: TicketTermRow[] = [
    {
      label: de ? "Laufzeit" : "Length",
      value: de ? "12 Monate ab dem Kauf, eine Zahlung, keine automatische Verlängerung." : "12 months from purchase, one payment, no automatic renewal.",
    },
  ];
  if (mentorCredits !== null) {
    rows.push({
      label: de ? "KI-Mentor" : "AI Mentor",
      value: de ? `Inklusive: ${mentorCredits} Credits für den KI-Mentor je 30 Tage, solange das Ticket läuft.` : `Included: ${mentorCredits} AI Mentor credits per 30 days while the ticket runs.`,
    });
  }
  rows.push(
    {
      label: de ? "Kostenloses Verlängerungsjahr" : "Free renewal year",
      value: de
        ? "Sie erhalten ein weiteres Jahr kostenlos, wenn Sie eines davon nachweisen: ein offizielles Ergebnis, mit dem Sie eine Prüfung nicht bestanden haben, oder eine Anmeldebestätigung für einen Prüfungstermin nach dem Ende Ihres Tickets."
        : "You receive another year free when you prove one of these: an official result showing you did not pass an exam, or a registration confirmation for a sitting after your ticket ends.",
    },
    {
      label: de ? "Höchstens" : "At most",
      value: de ? `${TICKET_MAX_RENEWALS === 2 ? "Zwei" : TICKET_MAX_RENEWALS} Verlängerungsjahre je Ticket.` : `${TICKET_MAX_RENEWALS === 2 ? "Two" : TICKET_MAX_RENEWALS} renewal years per ticket.`,
    },
    {
      label: de ? "Nachweis" : "Proof",
      value: de
        ? `Sie laden das Dokument hoch (PDF oder Bild) oder senden einen Link, solange Ihr Ticket läuft oder bis ${TICKET_REQUEST_GRACE_DAYS} Tage nach seinem Ende. Wir prüfen es in der Regel innerhalb weniger Werktage. Nur MedPrüf-Admins sehen den Nachweis, und wir löschen die Datei ${TICKET_PROOF_RETENTION_DAYS} Tage nach der Entscheidung.`
        : `You upload the document (PDF or image) or send a link while your ticket runs or up to ${TICKET_REQUEST_GRACE_DAYS} days after it ends. We usually check it within a few working days. Only MedPrüf admins see the proof, and we delete the file ${TICKET_PROOF_RETENTION_DAYS} days after the decision.`,
    },
    {
      label: de ? "Erinnerung" : "Reminder",
      value: de ? `${TICKET_REMINDER_DAYS} Tage vor dem Ende erinnern wir Sie per E-Mail.` : `We remind you by email ${TICKET_REMINDER_DAYS} days before the end.`,
    },
  );
  return rows;
}

export function ticketNotRefund(lang: BillingLang): string {
  const de = lang === "de";
  const days = REFUND.window_days;
  return de
    ? `Das Verlängerungsjahr verlängert Ihren Zugang, es ist keine Geldrückerstattung. Die Rückerstattung innerhalb von ${days} Tagen nach dem Kauf und Ihr gesetzliches Rücktrittsrecht bleiben davon unberührt.`
    : `The renewal year extends your access; it is not a cash refund. The refund within ${days} days of purchase and your statutory right of withdrawal are not affected.`;
}

/** One-line scope for the pricing hero while v2 is on. */
export function ticketScopeLine(lang: BillingLang): string {
  const de = lang === "de";
  return de
    ? "Kostenlose Verlängerungsjahre auf Nachweis gibt es nur mit dem Garantie-Ticket."
    : "Free renewal years on proof come only with the Guarantee Ticket.";
}
