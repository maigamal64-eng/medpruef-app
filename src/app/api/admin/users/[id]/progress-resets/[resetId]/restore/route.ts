import { NextResponse } from "next/server";
import { getServiceClient } from "@/lib/supabase";
import { adminRouteShell } from "@/lib/admin/shell";
import { forgetInFlight } from "@/lib/inflight";
import { LONG_DB_TIMEOUT_MS } from "@/lib/db-unavailable";
import { RESTORE_HTTP, UUID_RE, isRestoreStatus, missingSchema } from "@/lib/topic-reset";

export const dynamic = "force-dynamic";
export const maxDuration = 30;

/**
 * POST /api/admin/users/<id>/progress-resets/<resetId>/restore (users.write).
 * Body { reason?: string }. One transaction (topic_progress_restore): merges
 * the archived rows back (answers re-inserted, a schedule the learner built
 * since the reset is kept, counters added), stamps restored_at and writes
 * the admin_audit_log row 'progress_reset_restore'. A second press answers
 * 409 already_restored. Not gated on TOPIC_RESET_ENABLED: a backup stays
 * restorable after the learner surface is switched off.
 */
export const POST = adminRouteShell(
  async ({ req, actor }) => {
    const segments = new URL(req.url).pathname.split("/");
    const userId = segments[segments.length - 4];
    const resetId = segments[segments.length - 2];
    if (!userId || !UUID_RE.test(userId) || !resetId || !UUID_RE.test(resetId)) {
      return NextResponse.json({ error: "Invalid id" }, { status: 400 });
    }
    let reason: string | null = null;
    try {
      const body = await req.json();
      if (typeof body?.reason === "string") reason = body.reason.slice(0, 500);
    } catch {
      /* body optional */
    }
    const { data, error } = await getServiceClient({ timeoutMs: LONG_DB_TIMEOUT_MS }).rpc("topic_progress_restore", {
      p_reset: resetId,
      p_user: userId,
      p_actor: actor.userId,
      p_actor_email: actor.email,
      p_reason: reason,
    });
    if (error) {
      if (missingSchema(error)) return NextResponse.json({ error: "Not installed", code: "unavailable" }, { status: 503 });
      throw error;
    }
    const result = (data ?? {}) as { status?: unknown; counts?: unknown };
    if (!isRestoreStatus(result.status)) return NextResponse.json({ error: "Internal error" }, { status: 500 });
    if (result.status === "restored") forgetInFlight(`topic-progress:${userId}:`);
    return NextResponse.json(
      { ok: result.status === "restored", code: result.status, ...(result.status === "restored" ? { counts: result.counts ?? {} } : {}) },
      { status: RESTORE_HTTP[result.status] },
    );
  },
  { route: "/api/admin/users/<id>/progress-resets/<resetId>/restore", rateLimit: { limit: 20, windowMs: 60_000 } },
);
