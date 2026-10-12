/**
 * learner-history: audit categories and readable summaries for the audit
 * page and the learner "Admin history" block (ADM-15 option A,
 * pick-admin-15, UX-ADM-34).
 *
 * Categories are derived from the action name and target type so every
 * existing row (including those written by database functions) lands in
 * exactly one bucket. Unknown actions fall into System, never disappear.
 */

export const AUDIT_CATEGORIES = ["people", "content", "system"] as const;
export type AuditCategory = (typeof AUDIT_CATEGORIES)[number];

export const AUDIT_CATEGORY_LABELS: Record<AuditCategory, string> = {
  people: "People and access",
  content: "Content",
  system: "System",
};

const PEOPLE_TARGETS = new Set(["user", "subscription", "role", "admin_role", "membership", "puyp", "referral", "payment", "session", "waitlist"]);
const CONTENT_TARGETS = new Set(["question", "question_suggestion", "suggestion", "note", "note_report", "feedback", "explanation", "media"]);
const PEOPLE_ACTION = /(user|grant|entitle|ban|lock|session|role|access|member|puyp|referral|subscri|payment|tier|trial|waitlist|gamification|progress|profile)/;
const CONTENT_ACTION = /(question|suggest|note|report|media|explanation|feedback|duplicate|takedown|content)/;

export function classifyAuditRow(action: string | null | undefined, targetType: string | null | undefined): AuditCategory {
  const a = (action ?? "").toLowerCase();
  const t = (targetType ?? "").toLowerCase();
  if (CONTENT_TARGETS.has(t)) return "content";
  if (PEOPLE_TARGETS.has(t)) return "people";
  if (CONTENT_ACTION.test(a)) return "content";
  if (PEOPLE_ACTION.test(a)) return "people";
  return "system";
}

function short(value: unknown, max = 160): string | null {
  if (value === null || value === undefined) return null;
  const text = typeof value === "string" ? value : JSON.stringify(value);
  const t = text.trim();
  if (!t) return null;
  return t.length > max ? `${t.slice(0, max)}…` : t;
}

/**
 * One line a person can read: reason first, then what changed. Money and
 * entitlement values only for revenue readers; never emails or raw JSON.
 */
export function summarizeAuditPayload(
  _action: string,
  payload: Record<string, unknown> | null | undefined,
  opts: { revenue: boolean },
): string | null {
  if (!payload || typeof payload !== "object") return null;
  const parts: string[] = [];
  const reason = short(payload.reason ?? payload.note ?? payload.admin_note);
  if (reason) parts.push(`Reason: ${reason}`);
  if (typeof payload.days === "number") parts.push(`${payload.days} days`);
  if (opts.revenue && typeof payload.new_expiry === "string") parts.push(`until ${payload.new_expiry.slice(0, 10)}`);
  if (Array.isArray(payload.applied_fields) && payload.applied_fields.length) {
    parts.push(`Changed ${payload.applied_fields.filter((f) => typeof f === "string").join(", ")}`);
  }
  if (typeof payload.status === "string") parts.push(`Status ${payload.status}`);
  if (payload.reset_gamification === true) parts.push("Progress counters reset");
  if (opts.revenue && typeof payload.tier === "string") parts.push(`Tier ${payload.tier}`);
  return parts.length ? parts.join(" · ") : null;
}

export const AUDIT_BASIS =
  "Admin actions through the admin API and Ops approvals. Direct database writes outside these paths are not recorded, which is why agents must use the admin API, the Ops lane or a named guarded changeset (fleet rule, pick-admin-15).";
