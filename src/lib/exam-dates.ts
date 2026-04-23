/**
 * Known upcoming Austrian medical-licensing exam dates.
 *
 * Used by the PUYP flow to suggest the next attempt date when an
 * admin approves an extension. The admin UI accepts an override, so
 * this map is a convenience default rather than a source of truth —
 * once a date passes, either update this file OR enter the new date
 * manually in the admin UI.
 *
 * Source: `context/LAUNCH-BRIEF.md` (April 23 2026 B2B campaign kit)
 * and medprüf user-flow research. When a cycle passes, bump the entry
 * to the next known date. If the next date isn't announced, leave
 * the last-known value; the admin UI will flag it as stale.
 *
 * The Date literal uses UTC midnight to avoid DST edge cases. When
 * building the subscription's new `expires_at`, add the cohort buffer
 * (~2 weeks past the exam date so the user can study until the day
 * OF the exam) at the call site.
 */

export type PuypExamType = "kenntnispruefung" | "kmp_innsbruck" | "pharma";

/**
 * ISO-date (YYYY-MM-DD) of the next known exam for each type.
 *
 * Updated 2026-04-23:
 *   - Kenntnisprüfung Wien: next published ~18 May 2026 + autumn cycle.
 *   - KMP Innsbruck: 2026 dates are 4 Mar / 27 May / 17 Jun — we
 *     publish the nearest future date.
 *   - Pharmakologie: 26 Jun 2026. After that date passes the next
 *     cycle isn't public — admin overrides manually.
 */
export const NEXT_EXAM_DATE: Record<PuypExamType, string> = {
  kenntnispruefung: "2026-05-18",
  kmp_innsbruck: "2026-05-27",
  pharma: "2026-06-26",
};

/**
 * Suggested new `expires_at` for a PUYP extension covering the next
 * cycle. The user needs the subscription to stay live through at
 * least the exam date itself, plus a small buffer so they can study
 * the morning of the exam and check results afterwards.
 *
 * Default buffer is 14 days past the exam date — long enough to see
 * results come back for most Austrian exam boards.
 */
export function suggestNextExpiresAt(
  examType: PuypExamType,
  bufferDays: number = 14
): Date {
  const iso = NEXT_EXAM_DATE[examType];
  if (!iso) {
    // Unknown exam_type — fall back to 3 months from now so the
    // user isn't locked out while the admin researches the next cycle.
    const fallback = new Date();
    fallback.setUTCMonth(fallback.getUTCMonth() + 3);
    return fallback;
  }
  const d = new Date(`${iso}T23:59:59Z`);
  d.setUTCDate(d.getUTCDate() + bufferDays);
  return d;
}
