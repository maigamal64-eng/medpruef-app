/**
 * Translate daily cap (issue 10, user activity 2026-10-12).
 *
 * Pro and admin are promised unlimited translations, but the daily AI
 * attempt cap shipped on 10 Oct (AI_TRANSLATE_DAILY_ATTEMPTS, 40) also
 * applied to them: the top learner stopped at the 40th translation. Paid
 * callers now take no daily attempt (null = no daily cap); the global spend
 * cap, the per-user monthly cost cap and the per-minute burst guard still
 * apply to everyone. Cached translations return before any gate, so they
 * never count for anyone. Free callers keep min(5, configured cap).
 */
export const FREE_TRANSLATE_DAILY_QUOTA = 5;

export function translateDailyLimit(free: boolean, configuredDailyAttempts: number): number | null {
  if (!free) return null;
  return Math.min(FREE_TRANSLATE_DAILY_QUOTA, configuredDailyAttempts);
}

export interface CapEventClient {
  from(table: "user_events"): {
    insert(row: Record<string, unknown>): PromiseLike<{ error: { message?: string } | null }>;
  };
}

/**
 * A blocked free translation writes translate_cap_hit (the cap rejection
 * used to log nothing). Ids, language and field only; never the text.
 * Best-effort: never throws.
 */
export async function logTranslateCapHit(
  db: CapEventClient,
  input: { userId: string; limit: number; questionId: number; lang: string; field: string },
): Promise<void> {
  try {
    const { error } = await db.from("user_events").insert({
      user_id: input.userId,
      event_type: "translate_cap_hit",
      event_data: { limit: input.limit, question_id: input.questionId, lang: input.lang, field: input.field, gate: "translate_daily" },
    });
    if (error) console.error("[translate] translate_cap_hit insert:", error.message ?? error);
  } catch (err) {
    console.error("[translate] translate_cap_hit insert threw:", err);
  }
}
