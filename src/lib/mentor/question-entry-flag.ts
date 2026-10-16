/**
 * a-mentor-question-entry-v2: one outcome-specific mentor entry per answered
 * practice card with the question drafted, the prepared-message first-run card
 * at 0 credits and the question kept through checkout. Only the literal string
 * "true" turns it on; absent, empty or any other value keeps today's entries.
 * The env name is written out in full so Next.js inlines it into client bundles.
 */
export function mentorQuestionEntryV2(value: string | undefined = process.env.NEXT_PUBLIC_MENTOR_QUESTION_ENTRY_V2): boolean {
  return value === "true";
}
