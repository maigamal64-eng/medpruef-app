/** MUX-48: feedback sent from /mentor* carries context.source = "mentor". */
export const MENTOR_FEEDBACK_SOURCE = "mentor" as const;

export function feedbackSource(pathname: string | null | undefined): typeof MENTOR_FEEDBACK_SOURCE | undefined {
  return pathname === "/mentor" || pathname?.startsWith("/mentor/") ? MENTOR_FEEDBACK_SOURCE : undefined;
}

/** Admin filter: tagged rows, plus older rows whose page was /mentor*. */
export function isMentorFeedback(context: Record<string, unknown> | null | undefined): boolean {
  if (!context) return false;
  if (context.source === MENTOR_FEEDBACK_SOURCE) return true;
  return typeof context.pathname === "string" && feedbackSource(context.pathname) !== undefined;
}
