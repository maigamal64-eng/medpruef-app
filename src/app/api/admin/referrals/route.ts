import { NextResponse } from "next/server";
import { getServiceClient } from "@/lib/supabase";
import { adminRouteShell } from "@/lib/admin/shell";

export const dynamic = "force-dynamic";

/**
 * GET /api/admin/referrals?status=qualified|pending|rewarded
 *
 * Returns the referral queue with referrer + referee snapshots.
 */
export const GET = adminRouteShell(
  async ({ req }) => {
    const sb = getServiceClient();
    const url = new URL(req.url);
    const status = url.searchParams.get("status") || "qualified";

    const query = sb
      .from("referrals")
      .select(
        "id, referrer_user_id, referee_user_id, referral_code, status, reward_credit_cents, qualified_at, rewarded_at, created_at, hold_expires_at, hold_reason"
      )
      .order("qualified_at", { ascending: false, nullsFirst: false })
      .limit(200);

    if (status !== "all") {
      query.eq("status", status);
    }

    const { data, error } = await query;
    if (error) {
      return NextResponse.json({ error: error.message }, { status: 500 });
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
