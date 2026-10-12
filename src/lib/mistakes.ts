/** Shared by /api/user/mistakes and the open "Meine Fehler" pool (UX-PRA-55/56). */
export const MISTAKES_PAGE = 20;
export const MISTAKE_STATES = ["open", "corrected", "all"] as const;
export type MistakeState = (typeof MISTAKE_STATES)[number];

/** True when get_mistake_rows does not exist yet (a23 changeset unapplied). */
export function isMissingRuleError(error: { code?: string; message?: string } | null): boolean {
  if (!error) return false;
  return error.code === "PGRST202" || error.code === "42883" || /get_mistake_rows/.test(error.message ?? "");
}
