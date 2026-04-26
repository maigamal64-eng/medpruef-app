import { NextResponse } from "next/server";
import { getServiceClient } from "@/lib/supabase";
import { adminRouteShell } from "@/lib/admin/shell";
import { logAdminAction } from "@/lib/admin/audit";
import { captureServerError } from "@/lib/sentry-capture";

export const dynamic = "force-dynamic";

/**
 * POST /api/admin/users/<id>/force-refresh-session
 *
 * Stamps users.session_invalidated_at = now() for the target user.
 * The next time that user makes any authenticated request, the
 * `requireUser` guard will see their session is older than the stamp
 * and respond with HTTP 401 + { code: 'REFRESH_REQUIRED' }. The
 * client's authFetch interceptor catches that, clears caches +
 * localStorage, and forces a fresh /api/auth.
 *
 * Why we need this (review-2026-04-26-B1):
 *   Obai (542fc71b) was granted Pro at 20:07 UTC. He logged out + back
 *   in BEFORE the Supabase grant landed at 20:34, so /api/auth
 *   returned tier='free'. The Samsung browser cached that response
 *   under SW. After 20:34 his DB row said pro but his client showed
 *   free chrome. Admin had no way to invalidate the cache. Result:
 *   user thought "AI chat is broken" because the locked free-tier
 *   variant kept rendering.
 *
 * Idempotent: re-stamping is fine; client gets one extra refresh.
 *
 * Body: { reason?: string } — optional admin note for the audit log.
 *
 * Response 200:
 *   { ok: true, invalidated_at: <ISO> }
 *
 * Response 404:
 *   { error: "User not found" }
 *
 * Audit-logged via logAdminAction with action='force_refresh_session'.
 */
export const POST = adminRouteShell(
  async ({ req, actor }) => {
    const url = new URL(req.url);
    const segments = url.pathname.split("/");
    // /api/admin/users/<id>/force-refresh-session
    const id = segments[segments.length - 2];
    if (!id || !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(id)) {
      return NextResponse.json({ error: "Invalid user id" }, { status: 400 });
    }

    let reason: string | undefined;
    try {
      const body = await req.json();
      if (typeof body?.reason === "string") {
        reason = body.reason.slice(0, 500);
      }
    } catch {
      /* body optional */
    }

    try {
      const sb = getServiceClient();

      // Verify the target exists.
      const { data: target, error: lookupErr } = await sb
        .from("users")
        .select("id, email, tier, session_invalidated_at")
        .eq("id", id)
        .maybeSingle();
      if (lookupErr) {
        captureServerError(lookupErr, {
          route: "/api/admin/users/<id>/force-refresh-session",
          phase: "lookup",
          targetId: id,
        });
        return NextResponse.json({ error: "Lookup failed" }, { status: 500 });
      }
      if (!target) {
        return NextResponse.json({ error: "User not found" }, { status: 404 });
      }

      const now = new Date().toISOString();
      const { error: updErr } = await sb
        .from("users")
        .update({ session_invalidated_at: now })
        .eq("id", id);
      if (updErr) {
        captureServerError(updErr, {
          route: "/api/admin/users/<id>/force-refresh-session",
          phase: "update",
          targetId: id,
        });
        return NextResponse.json(
          { error: "Update failed" },
          { status: 500 },
        );
      }

      await logAdminAction({
        req,
        actorId: actor.userId,
        actorEmail: actor.email,
        action: "force_refresh_session",
        targetType: "user",
        targetId: id,
        payload: {
          target_email: target.email,
          target_tier: target.tier,
          previous_invalidated_at: target.session_invalidated_at,
          reason: reason ?? null,
          invalidated_at: now,
        },
      });

      return NextResponse.json({ ok: true, invalidated_at: now });
    } catch (err) {
      captureServerError(err, {
        route: "/api/admin/users/<id>/force-refresh-session",
      });
      return NextResponse.json({ error: "Internal error" }, { status: 500 });
    }
  },
  {
    route: "/api/admin/users/<id>/force-refresh-session",
    rateLimit: { limit: 30, windowMs: 60_000 },
  },
);
