/**
 * a-fo-10: per-topic attempt stats from user_topic_strength.
 *
 * record_quiz_answer adds one to `answered` (and to `correct` for a right
 * answer) for every non-duplicate answer, so the table holds the same attempt
 * counts get_user_topic_attempt_stats computes by scanning answer_history
 * joined to questions, as one primary-key range read. It replaces only the
 * attempt stats: distinct-question counts (get_user_topic_progress) and the
 * newest-attempt rule (get_user_topic_last_correct) still come from their RPCs.
 *
 * Known difference: the table keeps the topic a question had when it was
 * answered, the RPC groups by the topic it has now. The parity gate in the
 * a-fo-10 handover compares both on topics never reclassified.
 *
 * Flag TOPIC_STRENGTH_READS (server, default OFF): only the literal 'true'
 * switches /api/user/topic-progress to the table. Read at call time.
 */

export function topicStrengthReadsEnabled(env: Record<string, string | undefined> = process.env): boolean {
  return env.TOPIC_STRENGTH_READS === "true";
}

/** Same topic key as get_user_topic_attempt_stats: coalesce(nullif(topic, ''), 'Unknown'). */
export function attemptTopicKey(topic: unknown): string {
  return typeof topic === "string" && topic !== "" ? topic : "Unknown";
}

export interface AttemptStatsRow {
  topic: string;
  attempts: number;
  correct_attempts: number;
}

/** user_topic_strength rows to the get_user_topic_attempt_stats row shape. */
export function attemptStatsFromStrength(
  rows: ReadonlyArray<{ topic?: unknown; answered?: unknown; correct?: unknown }> | null | undefined,
): AttemptStatsRow[] {
  const byTopic = new Map<string, AttemptStatsRow>();
  for (const row of rows ?? []) {
    const topic = attemptTopicKey(row.topic);
    const entry = byTopic.get(topic) ?? { topic, attempts: 0, correct_attempts: 0 };
    entry.attempts += Math.max(0, Number(row.answered) || 0);
    entry.correct_attempts += Math.max(0, Number(row.correct) || 0);
    byTopic.set(topic, entry);
  }
  return [...byTopic.values()];
}
