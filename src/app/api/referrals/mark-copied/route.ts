import { NextRequest, NextResponse } from "next/server";
import { getServiceClient } from "@/lib/supabase";
import { requireUser } from "@/lib/auth-guard";
import { captureServerError } from "@/lib/sentry-capture";

export const dynamic = "force-dynamic";

/**
 * POST /api/referrals/mark-copied
 *
 * Stamps `user_announcements.referral_code_copied_at = now()` for the
 * authed caller. Idempotent — calling it twice in a row is a no-op
 * (we only stamp when the column is NULL to preserve the ORIGINAL
 * copy timestamp for analytics). If the row doesn't exist yet (edge
 * case — the user somehow skipped /api/announcements/state), we
 * insert one.
 *
 * This powers:
 *   - The amber nudge-dot on the sidebar "Empfehlungen" link
 *     (visible only while copied_at IS NULL)
 *   - Analytics event `referral_code_copied` emitted client-side
 *
 * Added 2026-04-24 (rescue-sprint §4 — "show code first, defer payout
 * setup"). The existing /api/referrals/status endpoint returns the
 * new `referralCodeCopiedAt` field so the hook + sidebar stay in sync
 * without a second round-trip.
 */
export async function POST(req: NextRequest) {
  const guard = await requireUser(req);
  if ("error" in guard) return guard.error;
  const userId = guard.userId;

  try {
    const sb = getServiceClient();

    // Does a row exist yet?
    const { data: existing, error: selErr } = await sb
      .from("user_announcements")
      .select("user_id, referral_code_copied_at")
      .eq("user_id", userId)
      .maybeSingle();

    if (selErr) {
      captureServerError(selErr, {
        route: "/api/referrals/mark-copied",
        userId,
        phase: "select",
      });
      return NextResponse.json({ error: "Internal error" }, { status: 500 });
    }

    const nowIso = new Date().toISOString();

    if (!existing) {
      const { error: insErr } = await sb
        .from("user_announcements")
        .insert({ user_id: userId, referral_code_copied_at: nowIso });
      if (insErr) {
        captureServerError(insErr, {
          route: "/api/referrals/mark-copied",
          userId,
          phase: "insert",
        });
        return NextResponse.json({ error: "Internal error" }, { status: 500 });
      }
      return NextResponse.json({
        ok: true,
        copiedAt: nowIso,
        firstTime: true,
      });
    }

    // Already recorded? Preserve the original timestamp — the caller
    // is likely firing the POST again on a second copy click.
    if (existing.referral_code_copied_at) {
      return NextResponse.json({
        ok: true,
        copiedAt: existing.referral_code_copied_at,
        firstTime: false,
      });
    }

    const { error: updErr } = await sb
      .from("user_announcements")
      .update({ referral_code_copied_at: nowIso })
      .eq("user_id", userId);

    if (updErr) {
      captureServerError(updErr, {
        route: "/api/referrals/mark-copied",
        userId,
        phase: "update",
      });
      return NextResponse.json({ error: "Internal error" }, { status: 500 });
    }

    return NextResponse.json({
      ok: true,
      copiedAt: nowIso,
      firstTime: true,
    });
  } catch (err) {
    captureServerError(err, {
      route: "/api/referrals/mark-copied",
      userId,
    });
    return NextResponse.json({ error: "Internal error" }, { status: 500 });
  }
}
