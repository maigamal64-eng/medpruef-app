/**
 * Feedback and question reports as Intercom tickets (a-intercom-feedback-tickets).
 *
 * Behind MEDPRUF_INTERCOM_TICKETS_ENABLED (literal 'true', default OFF). With
 * the flag off nothing here makes a network call and the routes behave as
 * before. A ticket is created AFTER the database write, after the response;
 * a failure never changes what the learner or the admin sees. The ticket id
 * is kept in the row's context (`intercom_ticket_id`), no migration.
 *
 * Nothing the admin types is sent: no admin note, no answer text. The learner
 * is told about the outcome by the ticket type's "Resolved" state message,
 * which is configured in Intercom (Lektor copy). Medical answer text in a
 * human reply is the admin's act and needs two Visite reads first.
 */

import type { SupabaseClient } from "@supabase/supabase-js";
import { intercomRequest, intercomToken, type IntercomFetch } from "@/lib/intercom/tickets-api";
import { contactEmail, type SyncUserRow } from "@/lib/intercom/contact-payload";

export const TICKETS_FLAG = "MEDPRUF_INTERCOM_TICKETS_ENABLED";
export const QUESTION_TYPE_ENV = "MEDPRUF_INTERCOM_TICKET_TYPE_QUESTION";
export const FEEDBACK_TYPE_ENV = "MEDPRUF_INTERCOM_TICKET_TYPE_FEEDBACK";
export const TICKET_ID_KEY = "intercom_ticket_id";
export const TICKET_ERROR_KEY = "intercom_ticket_error";

export type TicketKind = "question" | "feedback";
export type TicketTable = "question_suggestions" | "user_feedback";
export type TicketState = "in_progress" | "resolved";

const TABLE_FOR: Record<TicketKind, TicketTable> = { question: "question_suggestions", feedback: "user_feedback" };

/**
 * On only when the runtime flag and its build copy agree (next.config.ts copies
 * MEDPRUF_INTERCOM_TICKETS_ENABLED into NEXT_PUBLIC_MEDPRUF_INTERCOM_TICKETS), so
 * no ticket is filed by a build whose privacy page does not name it.
 */
export function ticketsEnabled(): boolean {
  return process.env[TICKETS_FLAG] === "true" && process.env.NEXT_PUBLIC_MEDPRUF_INTERCOM_TICKETS === "true" && intercomToken() !== null;
}

export function ticketTypeId(kind: TicketKind): string | null {
  const v = process.env[kind === "question" ? QUESTION_TYPE_ENV : FEEDBACK_TYPE_ENV]?.trim();
  return v && /^\d{1,20}$/.test(v) ? v : null;
}

/** The ticket id stored on a row's context, or null. */
export function storedTicketId(context: unknown): string | null {
  const v = context && typeof context === "object" ? (context as Record<string, unknown>)[TICKET_ID_KEY] : null;
  // Ticket ids are short tokens (numeric strings at Intercom); nothing with a
  // slash, dot or space is ever used in a request path (Reviewer P2-1).
  return typeof v === "string" && /^[A-Za-z0-9_-]{1,40}$/.test(v) ? v : null;
}

/** Path only, never a query string (it can carry ids or tokens). */
export function pageOf(value: unknown): string {
  if (typeof value !== "string" || !value) return "";
  try {
    return new URL(value, "https://medpruf.com").pathname.slice(0, 100);
  } catch {
    return "";
  }
}

const clip = (v: unknown, n: number): string => (typeof v === "string" ? v.trim().slice(0, n) : "");

export interface CreateOutcome {
  created: boolean;
  reason?: "disabled" | "anonymous" | "no_type" | "no_contact" | "lookup_failed" | "create_failed" | "store_failed";
  ticketId?: string;
}

async function findContactId(db: SupabaseClient, userId: string, f?: IntercomFetch): Promise<string | null | "error"> {
  const search = async (field: string, value: string) => {
    const r = await intercomRequest("POST", "/contacts/search", { query: { field, operator: "=", value }, pagination: { per_page: 1 } }, f);
    if (!r.ok) return "error" as const;
    const data = Array.isArray(r.json.data) ? (r.json.data as Array<{ id?: unknown; external_id?: unknown }>) : [];
    // A contact found by address that carries another account's external_id is not this learner's.
    const ext = data[0]?.external_id;
    if (field === "email" && typeof ext === "string" && ext && ext !== userId) return null;
    return typeof data[0]?.id === "string" ? data[0].id : null;
  };
  const byExternal = await search("external_id", userId);
  if (byExternal === "error") return "error";
  if (byExternal) return byExternal;
  const { data: user, error } = await db.from("users").select("email, email_verified_at, email_status").eq("id", userId).maybeSingle();
  if (error) return "error";
  if (!user) return null;
  // An address that is not proven (contactEmail: confirmed and not 'unverified') could belong to someone else's contact.
  const email = contactEmail({ id: userId, ...(user as Omit<SyncUserRow, "id">) });
  if (!email) return null;
  return search("email", email);
}

async function remember(db: SupabaseClient, table: TicketTable, rowId: number | string, patch: Record<string, unknown>): Promise<boolean> {
  const { data: row, error } = await db.from(table).select("context").eq("id", rowId).maybeSingle();
  if (error || !row) return false;
  const base = (row.context && typeof row.context === "object" ? row.context : {}) as Record<string, unknown>;
  const { data: saved, error: updErr } = await db
    .from(table)
    .update({ context: { ...base, ...patch } })
    .eq("id", rowId)
    .is(`context->>${TICKET_ID_KEY}`, null)
    .select("id")
    .maybeSingle();
  return !updErr && !!saved;
}

async function createTicket(
  db: SupabaseClient,
  kind: TicketKind,
  rowId: number | string,
  userId: string | null,
  title: string,
  description: string,
  attributes: Record<string, string>,
  f?: IntercomFetch,
): Promise<CreateOutcome> {
  if (!ticketsEnabled()) return { created: false, reason: "disabled" };
  // An anonymous report has no contact to notify, so no ticket.
  if (!userId) return { created: false, reason: "anonymous" };
  const typeId = ticketTypeId(kind);
  if (!typeId) return { created: false, reason: "no_type" };
  const contact = await findContactId(db, userId, f);
  if (contact === "error") return { created: false, reason: "lookup_failed" };
  // Contacts are created by the learner sync, never here.
  if (!contact) return { created: false, reason: "no_contact" };
  const res = await intercomRequest(
    "POST",
    "/tickets",
    { ticket_type_id: typeId, contacts: [{ id: contact }], ticket_attributes: { _default_title_: title, _default_description_: description, ...attributes } },
    f,
  );
  const id = res.ok && typeof res.json.id === "string" ? res.json.id : null;
  if (!id) return { created: false, reason: "create_failed" };
  const stored = await remember(db, TABLE_FOR[kind], rowId, { [TICKET_ID_KEY]: id });
  return stored ? { created: true, ticketId: id } : { created: true, ticketId: id, reason: "store_failed" };
}

export interface QuestionReportInput {
  suggestionId: number | string;
  questionId: number;
  userId: string | null;
  type: string;
  reason: string | null;
  details: string | null;
}

export async function createQuestionReportTicket(db: SupabaseClient, input: QuestionReportInput, f?: IntercomFetch): Promise<CreateOutcome> {
  if (!ticketsEnabled()) return { created: false, reason: "disabled" };
  let examType = "";
  const { data: q } = await db.from("questions").select("exam_type").eq("id", input.questionId).maybeSingle();
  if (typeof q?.exam_type === "string") examType = q.exam_type;
  const reason = clip(input.reason, 120);
  return createTicket(
    db, "question", input.suggestionId, input.userId,
    `Fragenmeldung: Frage ${input.questionId}`,
    clip(input.details, 1000) || reason || "Fragenmeldung",
    { question_id: String(input.questionId), exam_type: examType, reason: `${clip(input.type, 20)}: ${reason}`.slice(0, 160) },
    f,
  );
}

export interface FeedbackInput {
  feedbackId: number | string;
  userId: string | null;
  message: string;
  context: Record<string, unknown>;
}

export async function createFeedbackTicket(db: SupabaseClient, input: FeedbackInput, f?: IntercomFetch): Promise<CreateOutcome> {
  // A testimonial is a consent record, not a support request. An exam report
  // (a-rewards-program) is the same kind of reward-bearing record, handled on
  // /admin/feedback (a-intercom-into-n2n3-1021).
  if (input.context.kind === "testimonial" || input.context.kind === "exam_report") return { created: false, reason: "disabled" };
  const source = clip(input.context.source, 40) || "app";
  const page = pageOf(input.context.url);
  return createTicket(db, "feedback", input.feedbackId, input.userId, "Feedback", clip(input.message, 2000), { source, page }, f);
}

const stateCache = new Map<string, { at: number; ids: Partial<Record<TicketState, string>> }>();
const STATE_TTL_MS = 10 * 60_000;

async function stateId(kind: TicketKind, state: TicketState, f?: IntercomFetch): Promise<string | null> {
  const typeId = ticketTypeId(kind);
  if (!typeId) return null;
  const hit = stateCache.get(typeId);
  if (hit && Date.now() - hit.at < STATE_TTL_MS && hit.ids[state]) return hit.ids[state] ?? null;
  const r = await intercomRequest("GET", `/ticket_types/${typeId}`, undefined, f);
  if (!r.ok) return null;
  const states = (r.json.ticket_states as { data?: Array<{ id?: unknown; category?: unknown }> } | undefined)?.data ?? [];
  const ids: Partial<Record<TicketState, string>> = {};
  for (const s of states) {
    if (typeof s.id !== "string") continue;
    if (s.category === "resolved" && !ids.resolved) ids.resolved = s.id;
    if (s.category === "in_progress" && !ids.in_progress) ids.in_progress = s.id;
  }
  stateCache.set(typeId, { at: Date.now(), ids });
  return ids[state] ?? null;
}

export function resetTicketStateCache(): void {
  stateCache.clear();
}

export interface MoveOutcome {
  moved: boolean;
  reason?: "disabled" | "no_ticket" | "no_state" | "update_failed";
}

/** Moves the row's ticket to a state. No ticket on the row means nothing to move. */
export async function moveTicket(
  db: SupabaseClient,
  kind: TicketKind,
  rowId: number | string,
  state: TicketState,
  f?: IntercomFetch,
): Promise<MoveOutcome> {
  if (!ticketsEnabled()) return { moved: false, reason: "disabled" };
  // Re-read: the id may have been stored after the caller read the row.
  const { data: row } = await db.from(TABLE_FOR[kind]).select("context").eq("id", rowId).maybeSingle();
  const ticketId = storedTicketId(row?.context);
  if (!ticketId) return { moved: false, reason: "no_ticket" };
  const sid = await stateId(kind, state, f);
  if (!sid) return { moved: false, reason: "no_state" };
  const r = await intercomRequest("PUT", `/tickets/${encodeURIComponent(ticketId)}`, { ticket_state_id: sid }, f);
  return r.ok ? { moved: true } : { moved: false, reason: "update_failed" };
}
