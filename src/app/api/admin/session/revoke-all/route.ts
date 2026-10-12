import { NextResponse } from "next/server";
import { getServiceClient } from "@/lib/supabase";
import { adminRouteShell } from "@/lib/admin/shell";
import { adminErrorResponse } from "@/lib/admin/error-response";
import { logAdminAction } from "@/lib/admin/audit";

export const dynamic = "force-dynamic";

/**
 * POST /api/admin/session/revoke-all (ADM-17)
 *
 * Signs the calling admin out on every device, including this one, by
 * stamping their own users.session_invalidated_at. requireUser rejects every
 * token issued before the stamp, so a lost phone's 90-day owner token stops
 * working without SQL. Acts only on the caller; other accounts use
 * /api/admin/users/<id>/force-refresh-session.
 */
export const POST = adminRouteShell(
  async ({ req, actor }) => {
    const now = new Date().toISOString();
    const { error } = await getServiceClient()
      .from("users")
      .update({ session_invalidated_at: now })
      .eq("id", actor.userId);
    if (error) return adminErrorResponse(error, "/api/admin/session/revoke-all");

    await logAdminAction({
      req,
      actorId: actor.userId,
      actorEmail: actor.email,
      action: "revoke_own_sessions",
      targetType: "user",
      targetId: actor.userId,
      payload: { invalidated_at: now },
    });
    return NextResponse.json({ ok: true, invalidated_at: now });
  },
  { route: "/api/admin/session/revoke-all", rateLimit: { limit: 5, windowMs: 60_000 } },
);
