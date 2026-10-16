/**
 * Server reads of the learner's own timed part runs (a-cram-part-plan).
 * Owner-scoped by the signed session's user id; counts only, never question
 * content. Subjects are joined from questions.topic at read time, as the
 * trend route does; removed questions are left out. Exam answers never write
 * answer_history: this only reads exam_simulations.
 */
import { viennaToday } from "@/lib/exam-dates";
import type { getServiceClient } from "@/lib/supabase";
import { CRAM_PRESET_IDS, PART_OF_PRESET, isCramPresetId, runSubjects, runWeakSubjects, type CramPresetId, type PartRunSummary } from "./index";

type Db = ReturnType<typeof getServiceClient>;

/** Runs older than this never feed a drill day or a card. */
export const PART_RUN_LOOKBACK_DAYS = 30;
/** Drill days look back 7 days and the cards show the newest run, so a few rows are enough (Nano disk IO). */
export const MAX_PART_RUNS = 3;
const ID_CHUNK = 400;

/**
 * The learner's finished kp_sip4 / kp_sip5 runs of the last 30 days, newest
 * first (at most `limit`, default 3), optionally of one preset, with each
 * run's subjects below 60 percent. Throws on a failed read (the caller
 * decides whether the plan or card goes on without it).
 */
export async function loadPartRuns(
  sb: Db,
  userId: string,
  now: Date = new Date(),
  opts: { presetIds?: readonly CramPresetId[]; limit?: number } = {},
): Promise<PartRunSummary[]> {
  const presetIds = opts.presetIds && opts.presetIds.length > 0 ? opts.presetIds : CRAM_PRESET_IDS;
  const limit = Math.max(1, Math.min(MAX_PART_RUNS, opts.limit ?? MAX_PART_RUNS));
  const since = new Date(now.getTime() - PART_RUN_LOOKBACK_DAYS * 86_400_000).toISOString();
  const { data, error } = await sb
    .from("exam_simulations")
    .select("question_ids, grading, config, completed_at")
    .eq("user_id", userId)
    .eq("status", "completed")
    .eq("exam_type", "kenntnispruefung")
    .in("config->>presetId", [...presetIds])
    .gte("completed_at", since)
    .order("completed_at", { ascending: false })
    .limit(limit);
  if (error) throw error;
  const rows = (data ?? []).map((r) => {
    const config = r.config && typeof r.config === "object" ? (r.config as Record<string, unknown>) : {};
    return {
      presetId: config.presetId,
      kind: config.kind,
      completedAt: typeof r.completed_at === "string" ? r.completed_at : null,
      questionIds: Array.isArray(r.question_ids) ? (r.question_ids as unknown[]).filter((n): n is number => typeof n === "number") : [],
      grading: r.grading && typeof r.grading === "object" ? (r.grading as Record<string, { is_correct?: unknown } | undefined>) : null,
    };
  }).filter((r) => isCramPresetId(r.presetId) && r.kind !== "kaf" && r.completedAt && r.questionIds.length > 0);
  if (rows.length === 0) return [];

  const ids = [...new Set(rows.flatMap((r) => r.questionIds))];
  const topicById = new Map<number, string>();
  for (let i = 0; i < ids.length; i += ID_CHUNK) {
    const { data: qs, error: qErr } = await sb.from("questions").select("id, topic").in("id", ids.slice(i, i + ID_CHUNK));
    if (qErr) throw qErr;
    for (const q of qs ?? []) if (typeof q.topic === "string") topicById.set(Number(q.id), q.topic);
  }

  return rows.map((r) => {
    const presetId = r.presetId as keyof typeof PART_OF_PRESET;
    return {
      presetId,
      day: viennaToday(new Date(r.completedAt!)),
      weak: runWeakSubjects(runSubjects(r.questionIds, r.grading, topicById), PART_OF_PRESET[presetId]),
    };
  });
}
