/**
 * Exam report reward (a-rewards-program, plan.json J10). A learner who sat an
 * official sitting tells us in their own words how it went (organisation,
 * format, which subject areas came up, what would have helped). Thank-you:
 * REWARDS_EXAM_REPORT_ENABLED, default OFF, 150 credits once per sitting per
 * person, granted by an admin in /admin/feedback after a spam check.
 *
 *  - Sent through POST /api/feedback with context.kind = "exam_report" and
 *    context.sitting_key = "<exam_key>:<date>" of an official sitting whose
 *    last day passed at most 30 days ago (rewards-program.ts). Public use
 *    needs a separate consent tick, stored with the text.
 *  - Signed-in learners at the L5 bar only (as the testimonial); the grant
 *    re-checks the bar, the account and the monthly breaker.
 *  - The reward never depends on what the report says. Nothing in code reads
 *    the text.
 */

import type { SupabaseClient } from "@supabase/supabase-js";
import { openReportSittings, pastSittingByKey, type RewardConfig } from "@/lib/rewards-program";
import { grantFeedbackRowReward, type RewardResult } from "./experience";
import { readExamReportGrantsThisMonth } from "./rewards";

type Db = Pick<SupabaseClient, "from" | "rpc">;

export const EXAM_REPORT_KIND = "exam_report";
export const EXAM_REPORT_CONSENT_VERSION = "2026-10-15";

/**
 * The learner-side context of an exam report, or a reason it is refused.
 * The sitting must be open for reports today; consent an explicit boolean.
 */
export function examReportContext(raw: Record<string, unknown>, now: Date, windowDays?: number): Record<string, unknown> | "bad_consent" | "sitting_closed" {
  if (typeof raw.consent_public !== "boolean") return "bad_consent";
  const sitting = openReportSittings(now, windowDays).find((s) => s.key === raw.sitting_key);
  if (!sitting) return "sitting_closed";
  return {
    kind: EXAM_REPORT_KIND,
    sitting_key: sitting.key,
    exam_report: { submitted_at: now.toISOString(), sitting_key: sitting.key, consent_public: raw.consent_public, consent_version: EXAM_REPORT_CONSENT_VERSION },
    ...(typeof raw.lang === "string" && raw.lang.length <= 5 ? { lang: raw.lang } : {}),
  };
}

/** Has this learner already sent a report for this sitting? Throws on a read error. */
export async function hasExamReport(sb: Pick<SupabaseClient, "from">, userId: string, sittingKey: string): Promise<boolean> {
  const { data, error } = await sb.from("user_feedback").select("id").eq("user_id", userId)
    .eq("context->>kind", EXAM_REPORT_KIND).eq("context->>sitting_key", sittingKey).limit(1);
  if (error) throw new Error(`exam report read failed: ${error.code ?? "unknown"}`);
  return (data ?? []).length > 0;
}

/** Admin path: grant the exam report reward for one feedback row. */
export async function grantExamReportReward(sb: Db, feedbackId: number | string, actorId: string, rc: Pick<RewardConfig, "examReportCredits" | "examReportExpiryDays" | "examReportMonthlyCap">, now: Date): Promise<RewardResult> {
  return grantFeedbackRowReward(sb, feedbackId, actorId, now, {
    kind: EXAM_REPORT_KIND,
    wrongKind: "not_exam_report",
    ref: (row) => {
      const sitting = pastSittingByKey(row.context?.sitting_key, now);
      return sitting ? { kind: "exam_report", userId: row.user_id, sittingKey: sitting.key } : "sitting_unknown";
    },
    credits: rc.examReportCredits,
    expiryDays: rc.examReportExpiryDays,
    breaker: async () => (await readExamReportGrantsThisMonth(sb, now)) >= rc.examReportMonthlyCap,
  });
}
