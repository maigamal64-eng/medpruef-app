/**
 * Experience reward (a-free-credit-hooks L5): mentor credits once per person
 * as a thank-you for an honest first-party testimonial, whatever it says.
 * MENTOR_EXPERIENCE_REWARD_ENABLED, default OFF.
 *
 *  - The learner writes it in the app (POST /api/feedback with
 *    context.kind = "testimonial"); public use needs a separate consent tick
 *    stored with the text. Signed-in learners only (an anonymous note cannot
 *    be rewarded).
 *  - Eligibility (product.json L5): 20 distinct questions on 2+ Vienna days,
 *    or ever paid. The card is shown only to eligible learners, the
 *    submission and the grant both re-check it, so the "whatever you write"
 *    promise always holds for whoever can see it.
 *  - An admin grants the reward in /admin/feedback (spam filter only: the
 *    reward never depends on sentiment, rating or length; nothing in code
 *    reads the text). Lot source experience_reward, key testimonial:<user>,
 *    one per person ever (UNIQUE(source, source_id)); banned accounts never.
 *  - Never for Google, Trustpilot or app-store reviews: those platforms forbid
 *    incentives. Nothing here links to or mentions them.
 */

import type { SupabaseClient } from "@supabase/supabase-js";
import type { FreeCreditConfig } from "./free-credits";
import { grantReward, type RewardRef } from "./rewards";

type Db = Pick<SupabaseClient, "from" | "rpc">;

export const TESTIMONIAL_KIND = "testimonial";
/** Keys only an admin may write on a feedback row's context. */
// a-intercom-into-n2n3-1021 (Reviewer P2-1): the Intercom ticket keys are server-owned too.
export const ADMIN_ONLY_CONTEXT_KEYS = ["first_replied_at", "first_replied_by", "reward_granted_at", "reward_granted_by", "reward_lot_id", "reward_note", "testimonial", "exam_report", "intercom_ticket_id", "intercom_ticket_error"] as const;

export interface TestimonialInput { consentPublic: boolean }

/**
 * The learner-side context of a testimonial. Returns null when the body is
 * not a valid testimonial (consent must be an explicit boolean).
 */
export function testimonialContext(raw: Record<string, unknown>, now: Date): Record<string, unknown> | null {
  if (typeof raw.consent_public !== "boolean") return null;
  return {
    kind: TESTIMONIAL_KIND,
    testimonial: { submitted_at: now.toISOString(), consent_public: raw.consent_public, consent_version: "2026-10-14" },
    ...(typeof raw.lang === "string" && raw.lang.length <= 5 ? { lang: raw.lang } : {}),
  };
}

export interface Eligibility { distinctQuestions: number; activeDays: number; everPaid: boolean; meetsBar: boolean }

/**
 * L5 bar, shown to the admin (who decides): 20 distinct questions on 2+
 * Vienna days, or ever paid. Throws on a read error.
 */
export async function readExperienceEligibility(sb: Pick<SupabaseClient, "from">, userId: string): Promise<Eligibility> {
  const [answers, subs] = await Promise.all([
    sb.from("answer_history").select("question_id, created_at").eq("user_id", userId).order("created_at", { ascending: false }).limit(1000),
    sb.from("subscriptions").select("id").eq("user_id", userId).gt("amount_cents", 0).in("status", ["active", "expired", "cancelled"]).limit(1),
  ]);
  if (answers.error) throw new Error(`eligibility answers read failed: ${answers.error.code ?? "unknown"}`);
  if (subs.error) throw new Error(`eligibility payments read failed: ${subs.error.code ?? "unknown"}`);
  const rows = (answers.data ?? []) as Array<{ question_id: number | null; created_at: string }>;
  const day = new Intl.DateTimeFormat("en-CA", { timeZone: "Europe/Vienna", year: "numeric", month: "2-digit", day: "2-digit" });
  const distinctQuestions = new Set(rows.map((r) => r.question_id).filter((q) => q !== null)).size;
  const activeDays = new Set(rows.map((r) => day.format(new Date(r.created_at)))).size;
  const everPaid = (subs.data ?? []).length > 0;
  return { distinctQuestions, activeDays, everPaid, meetsBar: everPaid || (distinctQuestions >= 20 && activeDays >= 2) };
}

export type RewardResult =
  | { ok: true; lotId: string | null; credits: number; expiresAt: string }
  | { ok: false; reason: "not_testimonial" | "not_exam_report" | "anonymous" | "banned" | "below_bar" | "already_rewarded" | "grant_failed" | "not_found" | "cap_reached" | "sitting_unknown" };

interface FeedbackRow { id: number; user_id: string | null; context: Record<string, unknown> | null }

/**
 * Shared admin path for a feedback-row reward (testimonial, exam report):
 * read the row, check its kind, the account and the L5 bar, grant through
 * grantReward, stamp the row. A stamp that failed after an earlier grant is
 * repaired on retry (the grant comes back as a duplicate).
 */
export async function grantFeedbackRowReward(
  sb: Db,
  feedbackId: number | string,
  actorId: string,
  now: Date,
  spec: {
    kind: string;
    wrongKind: "not_testimonial" | "not_exam_report";
    ref: (row: FeedbackRow & { user_id: string }) => RewardRef | "sitting_unknown";
    credits: number;
    expiryDays: number;
    breaker?: () => Promise<boolean>;
  },
): Promise<RewardResult> {
  const fb = await sb.from("user_feedback").select("id, user_id, context").eq("id", feedbackId).maybeSingle();
  if (fb.error) throw new Error(`feedback read failed: ${fb.error.code ?? "unknown"}`);
  if (!fb.data) return { ok: false, reason: "not_found" };
  const row = fb.data as FeedbackRow;
  const ctx = row.context ?? {};
  if (ctx.kind !== spec.kind) return { ok: false, reason: spec.wrongKind };
  if (!row.user_id) return { ok: false, reason: "anonymous" };
  const ref = spec.ref(row as FeedbackRow & { user_id: string });
  if (ref === "sitting_unknown") return { ok: false, reason: "sitting_unknown" };
  if (typeof ctx.reward_granted_at === "string") return { ok: false, reason: "already_rewarded" };
  const banned = await sb.from("users").select("is_banned").eq("id", row.user_id).maybeSingle();
  if (banned.error) throw new Error(`user read failed: ${banned.error.code ?? "unknown"}`);
  if (!banned.data || (banned.data as { is_banned?: boolean | null }).is_banned === true) return { ok: false, reason: "banned" };
  if (!(await readExperienceEligibility(sb, row.user_id)).meetsBar) return { ok: false, reason: "below_bar" };

  const g = await grantReward(sb, { ref, credits: spec.credits, expiryDays: spec.expiryDays, now, breaker: spec.breaker });
  if (!g.ok) return { ok: false, reason: g.reason === "not_found" ? "banned" : g.reason };
  const stamp = { ...ctx, reward_granted_at: now.toISOString(), reward_granted_by: actorId, reward_lot_id: g.lotId, ...(g.duplicate ? { reward_note: "already_rewarded_for_this_key" } : {}) };
  const upd = await sb.from("user_feedback").update({ context: stamp }).eq("id", row.id).is("context->>reward_granted_at", null);
  if (upd.error) throw new Error(`feedback stamp failed: ${upd.error.code ?? "unknown"}`);
  // Already thanked under this key (another row or a retry): nothing new is granted.
  if (g.duplicate) return { ok: false, reason: "already_rewarded" };
  return { ok: true, lotId: g.lotId, credits: g.credits, expiresAt: g.expiresAt };
}

/** Grant the reward for one feedback row (admin path). Never twice per person. */
export async function grantExperienceReward(sb: Db, feedbackId: number | string, actorId: string, fc: Pick<FreeCreditConfig, "experienceCredits" | "experienceExpiryDays">, now: Date): Promise<RewardResult> {
  return grantFeedbackRowReward(sb, feedbackId, actorId, now, {
    kind: TESTIMONIAL_KIND,
    wrongKind: "not_testimonial",
    ref: (row) => ({ kind: "testimonial", userId: row.user_id }),
    credits: fc.experienceCredits,
    expiryDays: fc.experienceExpiryDays,
  });
}
