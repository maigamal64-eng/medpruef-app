/**
 * Question report status rules (a15: QLT-03, TR-10, UX-ADM-01).
 *
 * Pure helpers shared by the learner "My reports" list, its API and the
 * admin review queue. No I/O here so every rule is unit-tested.
 *
 * Learner-visible state is derived from the stored status plus the
 * structured reporter outcome the admin picks on resolution. Internal
 * admin notes are never part of it.
 */

/** Outcome the admin picks for the reporter. Stored in question_suggestions.context.reporter_outcome. */
export const REPORTER_OUTCOMES = ["fixed", "accepted", "not_an_error", "needs_info"] as const;
export type ReporterOutcome = (typeof REPORTER_OUTCOMES)[number];

/** Outcomes allowed per admin action. */
export const OUTCOMES_FOR_ACTION: Record<"approve" | "reject", readonly ReporterOutcome[]> = {
  approve: ["fixed", "accepted"],
  reject: ["not_an_error", "needs_info"],
};

export function parseReporterOutcome(value: unknown, action: "approve" | "reject"): ReporterOutcome | null {
  if (typeof value !== "string") return null;
  return (OUTCOMES_FOR_ACTION[action] as readonly string[]).includes(value) ? (value as ReporterOutcome) : null;
}

/** What the learner sees in My reports. */
export type LearnerReportState = "open" | "accepted" | "fixed" | "not_an_error" | "needs_info" | "closed";

export function learnerReportState(input: {
  status: string | null | undefined;
  outcome?: unknown;
  applied?: boolean;
}): LearnerReportState {
  const outcome = typeof input.outcome === "string" ? input.outcome : null;
  switch (input.status) {
    case "pending":
      return "open";
    case "approved":
      if (input.applied || outcome === "fixed") return "fixed";
      return "accepted";
    case "rejected":
      return outcome === "needs_info" ? "needs_info" : "not_an_error";
    case "reverted":
      return "closed";
    default:
      return "closed";
  }
}

/** Read the server-only context fields that drive the learner state. */
export function reportContextFacts(context: unknown): { outcome: ReporterOutcome | null; applied: boolean; notifiedAt: string | null } {
  const ctx = context && typeof context === "object" && !Array.isArray(context) ? (context as Record<string, unknown>) : {};
  const outcome = typeof ctx.reporter_outcome === "string" && (REPORTER_OUTCOMES as readonly string[]).includes(ctx.reporter_outcome)
    ? (ctx.reporter_outcome as ReporterOutcome)
    : null;
  const applied = !!ctx.applied_edit && typeof ctx.applied_edit === "object";
  const notifiedAt = typeof ctx.notified_at === "string" ? ctx.notified_at : null;
  return { outcome, applied, notifiedAt };
}

/** Median of a numeric list, or null when empty. */
export function median(values: number[]): number | null {
  const sorted = values.filter((v) => Number.isFinite(v) && v >= 0).sort((a, b) => a - b);
  if (!sorted.length) return null;
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2;
}

export const TURNAROUND_MIN_SAMPLE = 5;

/**
 * Typical turnaround from resolved reports: median hours from submission
 * to resolution. Computed from data, never hardcoded. Returns null hours
 * when fewer than TURNAROUND_MIN_SAMPLE reports were resolved.
 */
export function turnaroundFromRows(rows: Array<{ created_at: string | null; resolved_at: string | null }>): { median_hours: number | null; sample: number } {
  const hours: number[] = [];
  for (const row of rows) {
    if (!row.created_at || !row.resolved_at) continue;
    const start = Date.parse(row.created_at);
    const end = Date.parse(row.resolved_at);
    if (!Number.isFinite(start) || !Number.isFinite(end) || end < start) continue;
    hours.push((end - start) / 3_600_000);
  }
  const m = median(hours);
  if (hours.length < TURNAROUND_MIN_SAMPLE || m === null) return { median_hours: null, sample: hours.length };
  return { median_hours: Math.max(1, Math.round(m)), sample: hours.length };
}

const URL_MAX = 500;

/**
 * UX-ADM-01 (3): validate the learner-supplied page URL on new reports.
 * A bad value is dropped (never a 400): the report itself still matters.
 * Only http(s) URLs or site paths are kept. Existing rows are not rewritten.
 * Server-owned keys (applied edit, outcome, notification state) are never
 * accepted from the learner.
 */
/** Context keys only the server writes; a learner-supplied value is dropped. */
// a-intercom-into-n2n3-1021 (Reviewer P2-1): the Intercom ticket keys are server-owned too.
export const SERVER_OWNED_REPORT_KEYS = ["applied_edit", "reverted_edit", "reporter_outcome", "reporter_note_shared", "notified_at", "notified_outcome", "notify_error", "fix_reward", "intercom_ticket_id", "intercom_ticket_error"] as const;

/**
 * a-rewards-program: the applied-fix reward stamped on a report by the resolve
 * route ({credits, at, lot_id, clawed_back_at?}). The credits the learner
 * still holds for it, or null (none, or taken back).
 */
export function fixRewardCredits(context: unknown): number | null {
  const ctx = context && typeof context === "object" && !Array.isArray(context) ? (context as Record<string, unknown>) : {};
  const r = ctx.fix_reward;
  if (!r || typeof r !== "object" || Array.isArray(r)) return null;
  const { credits, clawed_back_at } = r as { credits?: unknown; clawed_back_at?: unknown };
  if (typeof clawed_back_at === "string") return null;
  return typeof credits === "number" && Number.isFinite(credits) && credits > 0 ? credits : null;
}

export function sanitizeReportContext(context: Record<string, unknown>): Record<string, unknown> {
  const next = { ...context };
  for (const key of SERVER_OWNED_REPORT_KEYS) delete next[key];
  if ("url" in next) {
    const raw = next.url;
    let keep: string | null = null;
    if (typeof raw === "string" && raw.length > 0 && raw.length <= URL_MAX) {
      try {
        const parsed = new URL(raw, "https://medpruf.com");
        if (parsed.protocol === "https:" || parsed.protocol === "http:") keep = raw;
      } catch {
        keep = null;
      }
    }
    if (keep === null) delete next.url;
    else next.url = keep;
  }
  return next;
}

/**
 * UX-ADM-01 (1): a render-safe page label for a stored context.url.
 * Never throws: any value is coerced to a string, parsed if possible,
 * otherwise shown raw and trimmed to 60 characters.
 */
export function safeParsePath(value: unknown): string | null {
  if (value === null || value === undefined) return null;
  const raw = String(value);
  if (!raw) return null;
  try {
    const parsed = new URL(raw, "https://medpruf.com");
    return `${parsed.pathname}${parsed.search}`.slice(0, 60);
  } catch {
    return raw.slice(0, 60);
  }
}
