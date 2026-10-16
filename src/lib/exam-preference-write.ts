/**
 * The one write of a learner's exam choice (users.active_exam, exam_date,
 * daily_goal). Used by the in-app picker route (PATCH
 * /api/user/exam-preference) and by the one-tap sitting link
 * (a-sitting-one-tap), so both save a choice the same way. Callers validate
 * the values first; this only writes the given columns of the given account.
 */
import type { SupabaseClient } from "@supabase/supabase-js";

export interface ExamPreferenceUpdate {
  active_exam?: string;
  exam_date?: string | null;
  daily_goal?: number;
}

export async function saveExamPreference(
  sb: SupabaseClient,
  userId: string,
  update: ExamPreferenceUpdate,
): Promise<{ error: { message: string } | null }> {
  const { error } = await sb.from("users").update(update).eq("id", userId);
  return { error: error ?? null };
}
