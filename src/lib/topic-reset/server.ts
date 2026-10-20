import type { SupabaseClient } from "@supabase/supabase-js";
import { isDbUnavailable } from "@/lib/db-unavailable";
import { missingSchema } from "./index";

/**
 * Distinct questions of archived (not restored) answers of one exam. The free
 * sample counts them (src/lib/free-tier.ts) so a reset never hands back a
 * second free taste. Not installed yet: empty. `strict`: any other failed
 * read throws (the paywall decision only follows a proven read); otherwise
 * empty (the count fails open, like the history read beside it).
 */
export async function readResetArchiveIds(
  sb: SupabaseClient,
  userId: string,
  examType: string,
  strict: boolean,
): Promise<Set<number>> {
  const out = new Set<number>();
  try {
    const { data, error } = await sb
      .from("progress_resets")
      .select("question_ids")
      .eq("user_id", userId)
      .eq("exam_type", examType)
      .is("restored_at", null)
      .order("created_at", { ascending: false })
      .limit(1000);
    if (error) {
      if (missingSchema(error)) return out;
      throw error;
    }
    for (const row of (data ?? []) as { question_ids?: unknown }[]) {
      if (!Array.isArray(row.question_ids)) continue;
      for (const id of row.question_ids) if (typeof id === "number" && Number.isInteger(id)) out.add(id);
    }
    return out;
  } catch (err) {
    if (strict || isDbUnavailable(err)) throw err;
    console.error("[topic-reset] archive id read failed", { examType, err });
    return out;
  }
}
