/**
 * Gerichtsmedizin practice (a44, CNT-25 and SIM-07; decision:pick-gm-placement B).
 *
 * Placement: a labelled topic inside the pharma bank (exam_type 'pharma',
 * topic 'Gerichtsmedizin', tag 'field:gerichtsmedizin'), never a fourth exam
 * type. The reviewed rows are seeded inactive and activated through the b20
 * gate on a release GO; every learner-visible surface stays dark until
 * NEXT_PUBLIC_GM_PRACTICE is the literal 'true', flipped in the same release
 * as the activation (release.md). Pure module, safe on server and client.
 */

export const GM_TOPIC = "Gerichtsmedizin";
export const GM_FIELD_TAG = "field:gerichtsmedizin";
export const GM_SOURCE_FILE = "TRACK_B_AUTHORED_GERICHTSMEDIZIN_2026_10";
export const GM_BANK = "pharma";
/** CNT-25 done bar: the subject is offered only with at least this many active rows. */
export const GM_MIN_ACTIVE = 100;
/** SIM-07: one oral drill session, no preparation time. */
export const GM_DRILL_SECONDS = 600;

/** Build-time flag (client and server). Only the literal 'true' switches it on. */
export function isGmPracticeEnabled(value: string | undefined = process.env.NEXT_PUBLIC_GM_PRACTICE): boolean {
  return value === "true";
}

export function isGmTopic(topic: string | null | undefined): boolean {
  return topic === GM_TOPIC;
}

/** A question row that belongs to the Gerichtsmedizin subject (topic or field tag). */
export function isGmRow(row: { topic?: string | null; tags?: readonly string[] | null; exam_type?: string | null }): boolean {
  if (row.exam_type != null && row.exam_type !== GM_BANK) return false;
  return isGmTopic(row.topic) || (row.tags ?? []).includes(GM_FIELD_TAG);
}

/** The multiple-choice practice link: the pharma bank narrowed to the subject. */
export const GM_QUIZ_HREF = `/quiz?examSource=${GM_BANK}&topic=${encodeURIComponent(GM_TOPIC)}`;
export const GM_DRILL_HREF = "/gm-practice";
