import { NextRequest, NextResponse } from "next/server";
import { requireUser, isGuardFailure } from "@/lib/auth-guard";
import { getServiceClient } from "@/lib/supabase";
import { createHmac } from "node:crypto";

export const dynamic = "force-dynamic";

/**
 * POST /api/intercom/identify
 *
 * Returns the Intercom identity payload for the logged-in user, including the
 * server-computed identity-verification HMAC:
 *   user_hash = HMAC-SHA256(user_id, INTERCOM_IDENTITY_SECRET)
 *
 * The secret NEVER leaves the server — only the resulting hash (which is meant
 * to be used client-side) is returned. Failures return 200 with { ok:false } so
 * the Messenger gracefully falls back to an anonymous boot instead of erroring.
 */
export async function POST(req: NextRequest) {
  const guard = await requireUser(req);
  if (isGuardFailure(guard)) return guard.error;
  const { userId } = guard;

  const secret = process.env.INTERCOM_IDENTITY_SECRET;
  if (!secret) {
    return NextResponse.json({ ok: false, reason: "not_configured" }, { status: 200 });
  }

  try {
    const sb = getServiceClient();
    const { data: user, error } = await sb
      .from("users")
      .select("id, email, first_name, last_name, created_at, tier, active_exam, exam_date")
      .eq("id", userId)
      .single();

    if (error || !user) {
      return NextResponse.json({ ok: false, reason: "user_not_found" }, { status: 200 });
    }

    const user_hash = createHmac("sha256", secret).update(String(user.id)).digest("hex");
    const name = [user.first_name, user.last_name].filter(Boolean).join(" ").trim();
    const created_at = user.created_at
      ? Math.floor(new Date(user.created_at).getTime() / 1000)
      : undefined;
    const exam_date = user.exam_date
      ? Math.floor(new Date(user.exam_date).getTime() / 1000)
      : undefined;

    return NextResponse.json({
      ok: true,
      user_id: String(user.id),
      user_hash,
      email: user.email ?? undefined,
      name: name || undefined,
      created_at,
      // Custom attributes for Outbound segmentation (sent to the Messenger boot).
      tier: user.tier ?? undefined,
      active_exam: user.active_exam ?? undefined,
      exam_date,
    });
  } catch (err) {
    console.error("[intercom/identify] error:", err);
    return NextResponse.json({ ok: false, reason: "error" }, { status: 200 });
  }
}
