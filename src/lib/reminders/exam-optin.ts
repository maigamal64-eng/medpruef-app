/**
 * a-d5b: the signed-in, in-app opt-in to exam deadline reminders (Settings
 * card and the quiet line under the Home deadline line).
 *
 * The destination is always the account's own address, read on the server
 * (never a body field). The double opt-in stays: the learner's own request
 * mails the confirmation link as soon as links can be signed (D5b option A),
 * independent of EXAM_REMINDERS_ENABLED, which keeps gating the dated sends
 * only. The open /api/reminders form keeps its b19 gate.
 */
import { randomUUID } from "node:crypto";
import { OFFICIAL_KEYS_BY_BANK, asPuypExamType, type PuypExamType } from "@/lib/exam-dates";
import { isUiLanguage, renderLang } from "@/lib/language-model";
import { assertDb, type ReminderDb } from "./common";
import { examConsentActive, subscribeExamAddress, type ConfirmationMail } from "./exam-consent";
import { deliverableDestination } from "./study-consent";

/** The signed confirm link lives 24 hours (signReminderToken), so a pending state does too. */
export const CONFIRM_LINK_MS = 24 * 60 * 60_000;

export type ExamOptInState = "off" | "pending" | "confirmed";
export interface ExamOptInView {
  available: true;
  /** The account's deliverable address, or null (no address or a bounced one). */
  email: string | null;
  /** The bank whose deadlines are mailed, or null when the bank has none the sender serves. */
  exam: PuypExamType | null;
  state: ExamOptInState;
}

/**
 * The bank to subscribe, only when the sender can actually mail its deadlines.
 * The Stichprobentest is filed per university and the schedule never picks a
 * filing university for a signup, so a kmp_innsbruck learner would be
 * promised mails that never come: no prompt for that bank.
 */
export function reminderBankFor(activeExam: unknown): PuypExamType | null {
  const bank = asPuypExamType(typeof activeExam === "string" ? activeExam : "");
  if (!bank) return null;
  return OFFICIAL_KEYS_BY_BANK[bank].some((key) => key !== "stichprobentest") ? bank : null;
}

type Owner = { email?: string | null; email_status?: string | null; language_code?: string | null; active_exam?: string | null };
type Row = { exam_type: string; confirmed: unknown; unsubscribed_at: unknown; consent_version: unknown; consent_email: unknown; confirmation_sent_at: unknown };

async function loadOwner(db: ReminderDb, userId: string): Promise<Owner | null> {
  const owner = await db.from("users").select("email,email_status,language_code,active_exam").eq("id", userId).maybeSingle();
  assertDb(owner.error);
  return owner.data as Owner | null;
}

/** Pure: the state of an address from its rows for this bank and for "all". */
export function examOptInStateFromRows(rows: Row[], email: string, now = Date.now()): ExamOptInState {
  if (rows.some((row) => examConsentActive(row, email))) return "confirmed";
  const pending = rows.some((row) => {
    const sent = typeof row.confirmation_sent_at === "string" ? Date.parse(row.confirmation_sent_at) : NaN;
    if (!Number.isFinite(sent) || now - sent >= CONFIRM_LINK_MS) return false;
    // An opt-out after the last link revoked that link (the RPC rotates it).
    const out = typeof row.unsubscribed_at === "string" ? Date.parse(row.unsubscribed_at) : NaN;
    return !Number.isFinite(out) || sent > out;
  });
  return pending ? "pending" : "off";
}

/**
 * Reviewer P1 (a-d5b): the in-app surface only sees and changes rows this
 * account owns (user_id). users.email is not proven (any free address can be
 * set), so the address alone never reveals, links or revokes a subscription
 * someone else made through the emailed link.
 */
async function stateFor(db: ReminderDb, userId: string, email: string, exam: PuypExamType | null, now: number): Promise<ExamOptInState> {
  const rows = await db.from("exam_reminders")
    .select("exam_type,confirmed,unsubscribed_at,consent_version,consent_email,confirmation_sent_at")
    .eq("user_id", userId)
    .eq("email", email)
    .in("exam_type", exam ? [exam, "all"] : ["all"])
    .limit(10);
  assertDb(rows.error);
  return examOptInStateFromRows((rows.data ?? []) as Row[], email, now);
}

export async function readExamOptIn(db: ReminderDb, userId: string, now = Date.now()): Promise<ExamOptInView> {
  const owner = await loadOwner(db, userId);
  const email = deliverableDestination(owner);
  const exam = reminderBankFor(owner?.active_exam);
  if (!email) return { available: true, email: null, exam, state: "off" };
  return { available: true, email, exam, state: await stateFor(db, userId, email, exam, now) };
}

export type StartResult =
  | { ok: true; view: ExamOptInView; mail: ConfirmationMail }
  | { ok: false; reason: "no_email" | "unsupported_exam" | "managed_elsewhere" | "send_failed" };

/** Opt in the account's own address for its bank and mail the confirmation link (D5b option A). */
export async function startExamOptIn(db: ReminderDb, userId: string, now = Date.now()): Promise<StartResult> {
  const owner = await loadOwner(db, userId);
  const email = deliverableDestination(owner);
  if (!email) return { ok: false, reason: "no_email" };
  const exam = reminderBankFor(owner?.active_exam);
  if (!exam) return { ok: false, reason: "unsupported_exam" };
  const view = async (): Promise<ExamOptInView> => ({ available: true, email, exam, state: await stateFor(db, userId, email, exam, now) });
  // Already on (for this bank or for every exam): nothing to send.
  if (await stateFor(db, userId, email, exam, now) === "confirmed") return { ok: true, view: await view(), mail: "skipped" };
  const existing = await db.from("exam_reminders").select("id,user_id,confirmed,unsubscribed_at,consent_version,consent_email").eq("email", email).eq("exam_type", exam).maybeSingle();
  assertDb(existing.error);
  const row = existing.data as { id: number; user_id: string | null; confirmed: unknown; unsubscribed_at: unknown; consent_version: unknown; consent_email: unknown } | null;
  if (row && row.user_id !== userId) {
    // An active subscription this account does not own stays with its link
    // (its mails carry the opt-out). A row without consent may be taken over:
    // the confirmation only ever reaches the address itself.
    if (examConsentActive(row, email)) return { ok: false, reason: "managed_elsewhere" };
    let claim = db.from("exam_reminders").update({ user_id: userId }).eq("id", row.id);
    claim = row.user_id === null ? claim.is("user_id", null) : claim.eq("user_id", row.user_id);
    const claimed = await claim.select("id").maybeSingle();
    assertDb(claimed.error);
    if (!claimed.data) return { ok: false, reason: "managed_elsewhere" };
  }
  const locale = isUiLanguage(owner?.language_code) ? renderLang(owner.language_code) : "en";
  const result = await subscribeExamAddress(db, { email, exam, locale, source: "app-optin", userId }, true);
  if (result.mail === "failed") return { ok: false, reason: "send_failed" };
  // Nothing went out: free the slot so the card never shows a link as pending.
  if (result.mail === "withheld" && result.rowId != null) assertDb((await db.from("exam_reminders").update({ confirmation_sent_at: null }).eq("id", result.rowId)).error);
  return { ok: true, view: await view(), mail: result.mail };
}

/**
 * Opt-out from the app: every subscription row this account owns (any exam,
 * any earlier address), with the same columns the unsubscribe RPC sets, so
 * the outstanding confirm link dies too. Rows made through the open form
 * without this account stay with the link in each mail.
 */
export async function stopExamOptIn(db: ReminderDb, userId: string): Promise<ExamOptInView> {
  const owner = await loadOwner(db, userId);
  const email = deliverableDestination(owner);
  const exam = reminderBankFor(owner?.active_exam);
  const revoked = await db.from("exam_reminders")
    .update({ unsubscribed_at: new Date().toISOString(), confirmed: false, consent_email: null, consent_confirmed_at: null, consent_version: null, confirmation_token: randomUUID() })
    .eq("user_id", userId);
  assertDb(revoked.error);
  return { available: true, email, exam, state: "off" };
}
