import { NextResponse } from "next/server";
import { getServiceClient } from "@/lib/supabase";
import { adminRouteShell } from "@/lib/admin/shell";
import { logAdminAction } from "@/lib/admin/audit";

export const dynamic = "force-dynamic";

/**
 * POST /api/admin/referrals/mark-paid
 * Body: { referral_id: string, txid?: string, notes?: string }
 *
 * Flips referrals.status='rewarded' and stamps rewarded_at.
 * Emits an admin_audit_log row with the txid + notes in payload.
 */
export const POST = adminRouteShell(
  async ({ req, actor }) => {
    let body: { referral_id?: string; txid?: string; notes?: string };
    try {
      body = await req.json();
    } catch {
      return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
    }
    if (!body.referral_id) {
      return NextResponse.json(
        { error: "referral_id required" },
        { status: 400 }
      );
    }

    const sb = getServiceClient();
    const now = new Date().toISOString();

    // Only allow transitions from qualified → rewarded.
    const { data: current, error: fetchErr } = await sb
      .from("referrals")
      .select("id, status")
      .eq("id", body.referral_id)
      .maybeSingle();
    if (fetchErr) {
      return NextResponse.json({ error: fetchErr.message }, { status: 500 });
    }
    if (!current) {
      return NextResponse.json(
        { error: "Referral not found" },
        { status: 404 }
      );
    }
    if (current.status !== "qualified") {
      return NextResponse.json(
        { error: `Cannot mark paid from status=${current.status}` },
        { status: 409 }
      );
    }

    const { error: updErr } = await sb
      .from("referrals")
      .update({ status: "rewarded", rewarded_at: now })
      .eq("id", body.referral_id);
    if (updErr) {
      return NextResponse.json({ error: updErr.message }, { status: 500 });
    }

    await logAdminAction({
      req,
      actorId: actor.userId,
      actorEmail: actor.email,
      action: "mark_referral_paid",
      targetType: "referral",
      targetId: body.referral_id,
      payload: {
        txid: body.txid ?? null,
        notes: body.notes ?? null,
        previous_status: current.status,
      },
    });

    return NextResponse.json({ ok: true, referral_id: body.referral_id });
  },
  { route: "/api/admin/referrals/mark-paid", rateLimit: { limit: 30, windowMs: 60_000 } }
);
