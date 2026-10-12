import { adminErrorResponse } from "@/lib/admin/error-response";
import { NextResponse } from "next/server";
import { getServiceClient } from "@/lib/supabase";
import { adminRouteShell } from "@/lib/admin/shell";

export const dynamic = "force-dynamic";
export const maxDuration = 30;

/**
 * GET /api/admin/referrals?status=qualified|pending|rewarded
 *
 * Returns the CASH payout queue with referrer + referee snapshots.
 *
 * Excludes reward_type='pro_until_exam' rows (2026-07-11): those are
 * the non-cash exam-reward mechanic (src/lib/referral-exam-reward.ts)
 * and have their own review queue at GET
 * /api/admin/referrals/pending-exam-rewards + confirm endpoint at
 * POST /api/admin/referrals/grant-exam-reward. Without this filter, a
 * qualified pro_until_exam row (reward_credit_cents=0) would render
 * here with a live "Mark paid" button, and clicking it would flip
 * status='rewarded' via the CASH mark-paid route -- which never grants
 * Pro, just silently marks the row done and hides it from the real
 * exam-reward queue. See mark-paid/route.ts for the matching guard.
 */
export const GET = adminRouteShell(
  async ({ req }) => {
    const sb = getServiceClient();
    const url = new URL(req.url);
    const status = url.searchParams.get("status") || "qualified";

    const query = sb
      .from("referrals")
      .select(
        "id, referrer_user_id, referee_user_id, referral_code, status, reward_credit_cents, qualified_at, rewarded_at, created_at, hold_expires_at, hold_reason, reward_type"
      )
      .neq("reward_type", "pro_until_exam")
      .order("qualified_at", { ascending: false, nullsFirst: false })
      .limit(200);

    if (status !== "all") {
      query.eq("status", status);
    }

    const { data, error } = await query;
    if (error) {
      return adminErrorResponse(error, "/api/admin/referrals");
    }

    // Hydrate referrer + referee emails for UI.
    const userIds = new Set<string>();
    for (const row of data || []) {
      if (row.referrer_user_id) userIds.add(row.referrer_user_id as string);
      if (row.referee_user_id) userIds.add(row.referee_user_id as string);
    }
    const userMap: Record<
      string,
      { email: string | null; first_name: string | null; payout_method: string | null }
    > = {};
    if (userIds.size > 0) {
      const { data: users } = await sb
        .from("users")
        .select("id, email, first_name, payout_method")
        .in("id", Array.from(userIds));
      for (const u of users || []) {
        userMap[u.id as string] = {
          email: (u.email as string) || null,
          first_name: (u.first_name as string) || null,
          payout_method: (u.payout_method as string) || null,
        };
      }
    }

    return NextResponse.json({
      items: (data || []).map((row) => ({
        ...row,
        referrer: row.referrer_user_id
          ? userMap[row.referrer_user_id as string] || null
          : null,
        referee: row.referee_user_id
          ? userMap[row.referee_user_id as string] || null
          : null,
      })),
    });
  },
  { route: "/api/admin/referrals" }
);
