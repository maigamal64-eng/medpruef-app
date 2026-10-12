/**
 * learner-segments: the Users list segments for the activation leak
 * (UX-ADM-19). Server-side filters with counts, learners only, no email
 * export. Predicates live in admin_user_directory_v2 and
 * admin_user_segment_counts (20261203090000_a16_admin_people.sql).
 */

export const USER_SEGMENTS = [
  "never_answered",
  "onboarding_incomplete",
  "no_exam_date",
  "pro_inactive_7d",
  "exam_30d",
] as const;

export type UserSegment = (typeof USER_SEGMENTS)[number];

export const SEGMENT_LABELS: Record<UserSegment, { label: string; hint: string }> = {
  never_answered: { label: "Never answered", hint: "No answer recorded yet" },
  onboarding_incomplete: { label: "Onboarding incomplete", hint: "Neither completed nor skipped onboarding" },
  no_exam_date: { label: "No exam date", hint: "No sitting date saved" },
  pro_inactive_7d: { label: "Pro, inactive 7d+", hint: "Current Pro access, no learner activity for 7 days or more" },
  exam_30d: { label: "Exam within 30 days", hint: "Saved exam date in the next 30 Vienna days" },
};

/** Pro inactive reveals entitlements, so it needs revenue.read. */
export function segmentNeedsRevenue(segment: UserSegment): boolean {
  return segment === "pro_inactive_7d";
}

export function readSegment(value: string | null | undefined): UserSegment | "all" {
  return (USER_SEGMENTS as readonly string[]).includes(value ?? "") ? (value as UserSegment) : "all";
}

/** PostgREST / Postgres error for a function that is not deployed yet. */
export function isMissingFunction(error: { code?: string | null; message?: string | null } | null | undefined): boolean {
  if (!error) return false;
  return error.code === "PGRST202" || error.code === "42883" || /could not find the function/i.test(error.message ?? "");
}
