import { NextResponse } from "next/server";
import { getServiceClient } from "@/lib/supabase";
import { adminRouteShell } from "@/lib/admin/shell";
import { canAccessAdminPermission, loadAdminPermissionSnapshot } from "@/lib/admin/permissions";
import { opsWaitingCount } from "@/lib/ops/owner";

export const dynamic = "force-dynamic";

type Key =
  | "question_reports"
  | "note_reports"
  | "feedback"
  | "ops_actions"
  | "puyp"
  | "referral_payouts"
  | "referral_rewards";

/**
 * GET /api/admin/inbox (a15 UX-ADM-16, a18 UX-ADM-06 / ADM-11 A)
 *
 * Open-item counts for the Inbox menu chips, the Today "Needs you" list,
 * the phone bottom bar and the tab titles, plus the oldest open item per
 * queue so Today can show how long it has waited. Head-only counts and one
 * timestamp per queue: no rows, no learner identity.
 *
 * A count the admin may not read is null and absent from `failed`. A count
 * that could not be read is null AND listed in `failed`, so a badge shows
 * "--" instead of a false "clear".
 */
export const GET = adminRouteShell(async ({ actor }) => {
  const permissions = await loadAdminPermissionSnapshot(actor.userId);
  const canContent = canAccessAdminPermission(permissions, "content.read");
  const canFeedback = canAccessAdminPermission(permissions, "feedback.read");
  const canRevenue = canAccessAdminPermission(permissions, "revenue.read");
  // a17: Ops actions waiting for the owner. Owner only; null while approvals are off.
  const isOwner = Boolean(permissions?.roles.some((role) => role.key === "owner"));
  const db = getServiceClient();
  const failed: Key[] = [];

  type Head = PromiseLike<{ count: number | null; error: unknown }>;
  type Oldest = PromiseLike<{ data: Array<Record<string, unknown>> | null; error: unknown }>;
  const read = async (key: Key, allowed: boolean, head: () => Head, oldest?: () => Oldest, column = "created_at") => {
    if (!allowed) return { count: null, oldest: null };
    try {
      const [h, o] = await Promise.all([head(), oldest ? oldest() : Promise.resolve(null)]);
      if (h.error || typeof h.count !== "number") throw h.error ?? new Error("count");
      const at = o && !o.error ? o.data?.[0]?.[column] : null;
      return { count: h.count, oldest: h.count > 0 && typeof at === "string" ? at : null };
    } catch {
      failed.push(key);
      return { count: null, oldest: null };
    }
  };

  const [questionReports, noteReports, feedback, puyp, referralPayouts, referralRewards, opsActions] = await Promise.all([
    read("question_reports", canContent,
      () => db.from("question_suggestions").select("id", { count: "exact", head: true }).eq("status", "pending"),
      () => db.from("question_suggestions").select("created_at").eq("status", "pending").order("created_at", { ascending: true }).limit(1)),
    read("note_reports", canContent,
      () => db.from("note_reports").select("id", { count: "exact", head: true }).eq("status", "open"),
      () => db.from("note_reports").select("created_at").eq("status", "open").order("created_at", { ascending: true }).limit(1)),
    read("feedback", canFeedback,
      () => db.from("user_feedback").select("id", { count: "exact", head: true }).in("status", ["new", "reviewed"]),
      () => db.from("user_feedback").select("created_at").in("status", ["new", "reviewed"]).order("created_at", { ascending: true }).limit(1)),
    // PUYP: a failed-exam proof not yet verified (same rule as the PUYP queue).
    read("puyp", canRevenue,
      () => db.from("exam_attempts").select("id", { count: "exact", head: true }).eq("result", "fail").is("verified_at", null),
      () => db.from("exam_attempts").select("created_at").eq("result", "fail").is("verified_at", null).order("created_at", { ascending: true }).limit(1)),
    // Legacy cash referrals qualified and waiting for a payout.
    read("referral_payouts", canRevenue,
      () => db.from("referrals").select("id", { count: "exact", head: true }).eq("status", "qualified").eq("reward_type", "cash"),
      () => db.from("referrals").select("qualified_at").eq("status", "qualified").eq("reward_type", "cash").order("qualified_at", { ascending: true }).limit(1),
      "qualified_at"),
    // Exam rewards waiting for the admin grant confirm.
    read("referral_rewards", canRevenue,
      () => db.from("referrals").select("id", { count: "exact", head: true }).eq("reward_type", "pro_until_exam").eq("hold_reason", "exam_reward_pending_review"),
      () => db.from("referrals").select("hold_expires_at").eq("reward_type", "pro_until_exam").eq("hold_reason", "exam_reward_pending_review").order("hold_expires_at", { ascending: true }).limit(1),
      "hold_expires_at"),
    isOwner ? opsWaitingCount(actor.userId) : Promise.resolve(null),
  ]);

  return NextResponse.json(
    {
      question_reports: questionReports.count,
      note_reports: noteReports.count,
      feedback: feedback.count,
      puyp: puyp.count,
      referral_payouts: referralPayouts.count,
      referral_rewards: referralRewards.count,
      ops_actions: opsActions,
      oldest: {
        question_reports: questionReports.oldest,
        note_reports: noteReports.oldest,
        feedback: feedback.oldest,
        puyp: puyp.oldest,
        referral_payouts: referralPayouts.oldest,
        referral_rewards: referralRewards.oldest,
      },
      failed,
      generated_at: new Date().toISOString(),
    },
    { headers: { "Cache-Control": "private, no-store" } },
  );
}, { route: "/api/admin/inbox", rateLimit: { limit: 120, windowMs: 60_000 } });
