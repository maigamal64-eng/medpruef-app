/**
 * Plain-language copy for the Ops approvals page (UX-ADM-13/14, ADM-16 A).
 * Pure and client-safe: the page renders these sentences and tables instead
 * of raw ids and JSON. Live target state comes from ops_admin_queue (a17);
 * rows from the legacy list (before the changeset) fall back to the
 * prepare-time prediction and say so.
 */

export type OpsOperation = "entitlement.grant" | "feedback.triage" | "content.review" | "notes.moderation";
export type OpsGroup = "needs_decision" | "approved_waiting" | "done" | "expired";

export interface OpsTarget {
  kind?: string;
  user_id?: string | null;
  current_tier?: string | null;
  current_expiry?: string | null;
  expiry_if_run_now?: string | null;
  is_banned?: boolean;
  feedback_id?: number;
  current_status?: string | null;
  message_excerpt?: string | null;
  note_tail?: string | null;
  suggestion_id?: number;
  question_id?: number | null;
  report_type?: string | null;
  report_reason?: string | null;
  details_excerpt?: string | null;
  report_id?: string;
  report_status?: string | null;
  report_detail?: string | null;
  note_id?: string;
  note_owner_id?: string | null;
  note_title?: string | null;
  note_excerpt?: string | null;
  note_visibility?: string | null;
  note_is_active?: boolean | null;
}

export interface OpsQueueItem {
  id: string;
  operation: string;
  status: string;
  payload: Record<string, unknown>;
  payload_hash: string;
  target_hash: string;
  predicted_effect: Record<string, unknown> | null;
  expires_at: string;
  created_at: string;
  principal_id: string;
  principal_name?: string | null;
  principal_kind?: "oauth" | "token" | null;
  principal_active?: boolean | null;
  decided_at?: string | null;
  decided_by?: string | null;
  decision_reason?: string | null;
  approved_by?: string | null;
  approved_at?: string | null;
  executed_at?: string | null;
  result?: Record<string, unknown> | null;
  target?: OpsTarget | null;
}

export const REJECT_PRESETS = ["Wrong target", "Wrong amount", "Not now"] as const;
export const REJECT_REASON_MAX = 300;

/** Access changes need a reason (the ADM-25 rule); the database enforces the same. */
export function rejectReasonRequired(operation: string): boolean {
  return operation === "entitlement.grant";
}

export function validRejectReason(operation: string, reason: string): boolean {
  const value = reason.trim();
  if (value.length > REJECT_REASON_MAX) return false;
  return rejectReasonRequired(operation) ? value.length >= 3 : true;
}

function time(value: string | null | undefined): number {
  const parsed = value ? Date.parse(value) : NaN;
  return Number.isFinite(parsed) ? parsed : NaN;
}

export function opsGroup(item: Pick<OpsQueueItem, "status" | "expires_at">, now: number): OpsGroup {
  const live = time(item.expires_at) > now;
  if (item.status === "prepared") return live ? "needs_decision" : "expired";
  if (item.status === "approved") return live ? "approved_waiting" : "expired";
  if (item.status === "succeeded" || item.status === "rejected") return "done";
  return "expired";
}

/** One label from the server status; never "succeeded · expired" (ADM-ops-truth-02). */
export function opsStatusLabel(item: Pick<OpsQueueItem, "status" | "expires_at">, now: number): string {
  switch (opsGroup(item, now)) {
    case "needs_decision": return "Waiting for you";
    case "approved_waiting": return "Approved, not run yet";
    case "expired": return "Expired, nothing changed";
    default: return item.status === "rejected" ? "Rejected" : "Done";
  }
}

export const GROUP_TITLES: Record<OpsGroup, string> = {
  needs_decision: "Needs your decision",
  approved_waiting: "Approved, waiting for the agent to run it",
  done: "Done",
  expired: "Expired",
};

const DATE = new Intl.DateTimeFormat("en-GB", { day: "numeric", month: "short", year: "numeric", timeZone: "Europe/Vienna" });
const DATE_TIME = new Intl.DateTimeFormat("en-GB", { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit", timeZone: "Europe/Vienna" });
export function opsDate(value: string | null | undefined): string {
  const t = time(value);
  return Number.isFinite(t) ? DATE.format(new Date(t)) : "unknown date";
}
export function opsDateTime(value: string | null | undefined): string {
  const t = time(value);
  return Number.isFinite(t) ? DATE_TIME.format(new Date(t)) : "unknown time";
}

export function countdown(expiresAt: string, now: number): string {
  const ms = time(expiresAt) - now;
  if (!Number.isFinite(ms)) return "Expiry unknown";
  if (ms <= 0) return "Expired";
  const minutes = Math.ceil(ms / 60_000);
  if (minutes < 60) return `Expires in ${minutes} min`;
  const hours = Math.floor(minutes / 60);
  const rest = minutes % 60;
  return rest ? `Expires in ${hours} h ${rest} min` : `Expires in ${hours} h`;
}

function str(value: unknown): string | null {
  return typeof value === "string" && value.trim() ? value.trim() : null;
}
function num(value: unknown): number | null {
  const n = typeof value === "number" ? value : typeof value === "string" ? Number(value) : NaN;
  return Number.isFinite(n) ? n : null;
}

function accessText(tier: unknown, expiry: unknown): string {
  const t = str(tier);
  if (!t) return "Unknown";
  if (t === "free") return "Free";
  const e = str(expiry);
  const label = t === "pro" ? "Pro" : t;
  return e ? `${label} until ${opsDate(e)}` : `${label}, no end date`;
}

const FEEDBACK_STATUS: Record<string, string> = { new: "New", reviewed: "Reviewed", resolved: "Resolved", dismissed: "Dismissed" };
const statusWord = (value: unknown) => FEEDBACK_STATUS[String(value)] ?? (str(value) ?? "Unknown");

export interface OpsHeadline {
  /** Sentence before the learner link (or the whole sentence when no learner). */
  lead: string;
  /** Learner rendered as a profile link between lead and tail. */
  learnerId: string | null;
  tail: string;
}

/** "Give 30 days of Pro to <learner>." style headline (UX-ADM-13). */
export function opsHeadline(item: OpsQueueItem): OpsHeadline {
  const p = item.payload ?? {};
  const t = item.target ?? {};
  switch (item.operation) {
    case "entitlement.grant": {
      const days = num(p.days);
      return { lead: `Give ${days ?? "?"} ${days === 1 ? "day" : "days"} of Pro to`, learnerId: str(p.user_id), tail: "" };
    }
    case "feedback.triage":
      return { lead: `Mark feedback #${num(p.feedback_id) ?? "?"} as ${statusWord(p.status).toLowerCase()}`, learnerId: str(t.user_id), tail: "" };
    case "content.review": {
      const verb = p.status === "approved" ? "Accept" : "Dismiss";
      const question = num(t.question_id);
      return { lead: `${verb} question report #${num(p.question_suggestion_id) ?? "?"}${question ? ` on question ${question}` : ""}`, learnerId: null, tail: "" };
    }
    case "notes.moderation": {
      const title = str(t.note_title);
      const note = title ? `the note "${title}"` : "the reported note";
      return { lead: p.decision === "takedown" ? `Take down ${note}` : `Keep ${note} and close the report`, learnerId: null, tail: "" };
    }
    default:
      return { lead: `Unrecognised action (${item.operation})`, learnerId: null, tail: "" };
  }
}

export interface OpsChangeRow { label: string; before: string; after: string }

/** Before and after, from live state when available (a17), else from the prediction. */
export function opsChanges(item: OpsQueueItem): OpsChangeRow[] {
  const p = item.payload ?? {};
  const t = item.target ?? {};
  const prediction = item.predicted_effect ?? {};
  switch (item.operation) {
    case "entitlement.grant": {
      const live = t.kind === "learner";
      const before = live ? accessText(t.current_tier, t.current_expiry) : accessText(prediction.previous_tier, prediction.previous_expiry);
      const after = live ? t.expiry_if_run_now : prediction.predicted_expiry;
      return [{ label: "Access", before, after: str(after) ? `Pro until ${opsDate(str(after))}` : "Pro" }];
    }
    case "feedback.triage": {
      const before = t.kind === "feedback" ? t.current_status : (p.from_status ?? prediction.previous_status);
      const rows: OpsChangeRow[] = [{ label: "Status", before: statusWord(before), after: statusWord(p.status) }];
      if (str(p.note)) rows.push({ label: "Internal note", before: "Kept as is", after: `Adds: "${str(p.note)}"` });
      return rows;
    }
    case "content.review": {
      const current = str(t.current_status) ?? "pending";
      const before = current === "pending" ? "Pending" : current.charAt(0).toUpperCase() + current.slice(1);
      return [{ label: "Report status", before, after: p.status === "approved" ? "Accepted" : "Dismissed" }];
    }
    case "notes.moderation": {
      const visible = t.note_visibility === "public" && t.note_is_active !== false;
      const rows: OpsChangeRow[] = [{ label: "Report", before: t.report_status === "open" ? "Open" : statusWord(t.report_status), after: p.decision === "takedown" ? "Actioned" : "Dismissed" }];
      rows.push({
        label: "Note",
        before: t.kind === "note_report" ? (visible ? "Public" : t.note_is_active === false ? "Hidden" : "Private") : "Unknown",
        after: p.decision === "takedown" ? "Hidden from Explore and from its author's library" : "Unchanged",
      });
      return rows;
    }
    default:
      return [];
  }
}

/** The confirm-dialog sentence for Approve (ADM-ops-safety-04). */
export function opsApproveConfirmation(item: OpsQueueItem, learnerName: string | null): string {
  const h = opsHeadline(item);
  const who = h.learnerId ? ` ${learnerName ?? "this learner"}` : "";
  const change = opsChanges(item)[0];
  const effect = change ? ` ${change.label}: ${change.before} becomes ${change.after}.` : "";
  return `${h.lead}${who}.${effect} The agent can then run it once before ${opsDateTime(item.expires_at)}.`;
}

/** What happened after the decision (UX-ADM-13: show the execution outcome). */
export function opsOutcome(item: OpsQueueItem, now: number): string {
  const group = opsGroup(item, now);
  if (item.status === "rejected") {
    return `Rejected ${opsDateTime(item.decided_at)}${item.decision_reason ? `: ${item.decision_reason}` : ""}.`;
  }
  if (item.status === "succeeded") {
    const r = item.result ?? {};
    const when = item.executed_at ? ` ${opsDateTime(item.executed_at)}` : "";
    if (item.operation === "entitlement.grant" && str(r.tier_expires_at)) return `Done${when}. Learner has Pro until ${opsDate(str(r.tier_expires_at))}.`;
    if (item.operation === "feedback.triage") return `Done${when}. Feedback is ${statusWord(r.status).toLowerCase()}${r.note_appended ? ", note added" : ""}.`;
    if (item.operation === "notes.moderation") return `Done${when}. ${r.takedown ? "Note hidden; the earlier visibility is kept for a restore." : "Report closed, note unchanged."}`;
    return `Done${when}.`;
  }
  if (group === "approved_waiting") return `Approved ${opsDateTime(item.approved_at ?? item.decided_at)}. Nothing changes until the agent runs it.`;
  if (group === "expired") return "Expired before it ran. Nothing changed.";
  return "";
}

export function isOpsQueueItem(value: unknown): value is OpsQueueItem {
  if (!value || typeof value !== "object") return false;
  const v = value as Record<string, unknown>;
  return typeof v.id === "string" && typeof v.operation === "string" && typeof v.status === "string"
    && typeof v.payload_hash === "string" && typeof v.expires_at === "string" && !!v.payload && typeof v.payload === "object";
}
