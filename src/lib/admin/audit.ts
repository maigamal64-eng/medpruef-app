/**
 * admin audit logging — insert a row into admin_audit_log for every
 * admin mutation. §2.7 of the April 23 admin revamp sprint + §5 of the
 * post-audit-rescue sprint (April 23).
 *
 * Call from any /api/admin/* (or equivalent) route after you've already
 * passed the requireAdmin guard. Never throws — a failed audit write
 * won't fail the request, it'll be captured in Sentry.
 *
 * DB column `target_id` is `uuid` (see migration 20260423400000). If a
 * caller passes a non-UUID identifier (e.g. an integer question_id, a
 * bigserial waitlist id, a referral_code string), the raw value is
 * stashed into `payload.target_ref` instead and `target_id` stays null.
 * That keeps the column typed without losing the reference — admins can
 * still filter by `target_type` and inspect `payload.target_ref` in the
 * UI.
 */

import type { NextRequest } from "next/server";
import { getServiceClient } from "@/lib/supabase";
import { captureServerError } from "@/lib/sentry-capture";

const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export interface LogAdminActionArgs {
  /** The live request — used to extract IP + user agent. */
  req: NextRequest;
  /** Admin UUID from requireAdmin()'s GuardSuccess.userId. */
  actorId: string;
  /** Admin email (lookup once; cached in the guard result soon). */
  actorEmail: string;
  /** Verb describing the mutation. e.g. 'grant_free_month', 'approve_puyp'. */
  action: string;
  /** Optional: what kind of entity was touched. */
  targetType?: string;
  /**
   * Optional: identifier for the target. If a UUID, it lands in the
   * `target_id` column; otherwise it's preserved in `payload.target_ref`.
   * Accepts string or number for ergonomic integer-id callers.
   */
  targetId?: string | number | null;
  /** Optional: arbitrary structured data (inputs, deltas, etc.). */
  payload?: Record<string, unknown>;
}

export async function logAdminAction(args: LogAdminActionArgs): Promise<void> {
  try {
    const sb = getServiceClient();
    const ip =
      args.req.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ||
      args.req.headers.get("x-real-ip") ||
      null;
    const userAgent = args.req.headers.get("user-agent") || null;

    // Split a UUID targetId from anything else. DB column is `uuid`, so
    // an int or freeform string would 22P02 (invalid input syntax for
    // type uuid) and the whole insert would silently fail in the
    // fire-and-forget wrapper.
    let targetUuid: string | null = null;
    let targetRef: string | number | null = null;
    if (args.targetId != null) {
      if (typeof args.targetId === "string" && UUID_RE.test(args.targetId)) {
        targetUuid = args.targetId;
      } else {
        targetRef = args.targetId;
      }
    }

    const payload = {
      ...(args.payload ?? {}),
      ...(targetRef != null ? { target_ref: targetRef } : {}),
    };

    const { error } = await sb.from("admin_audit_log").insert({
      actor_id: args.actorId,
      actor_email: args.actorEmail,
      action: args.action,
      target_type: args.targetType ?? null,
      target_id: targetUuid,
      payload,
      ip_address: ip,
      user_agent: userAgent,
    });

    if (error) {
      // Belt-and-braces visibility: Sentry catches the error AND we
      // emit a console.error so it shows up in `vercel logs` even if
      // Sentry's quota is exhausted or the integration is paused.
      // Before adding console.error, an insert failure was silently
      // swallowed and the only signal was admin_audit_log staying at
      // 0 rows (review-2026-04-25-A3).
      console.error("[admin/audit] insert failed", {
        action: args.action,
        actor: args.actorId,
        message: error.message,
        code: error.code,
      });
      captureServerError(error, {
        route: "admin/audit",
        action: args.action,
        actorId: args.actorId,
      });
    }
  } catch (err) {
    // Never let an audit write failure take down a request. The Sentry
    // capture above + this fallback means we get visibility either way.
    console.error("[admin/audit] threw", {
      action: args.action,
      actor: args.actorId,
      message: err instanceof Error ? err.message : String(err),
    });
    captureServerError(err, {
      route: "admin/audit",
      action: args.action,
      actorId: args.actorId,
    });
  }
}

/**
 * Resolve actorEmail from users table given a UUID. Small helper for
 * routes that don't already have the email in scope. Cached across calls
 * in the same function instance.
 */
const emailCache = new Map<string, { email: string; at: number }>();
const EMAIL_CACHE_TTL_MS = 5 * 60_000;

export async function resolveActorEmail(userId: string): Promise<string> {
  const now = Date.now();
  const hit = emailCache.get(userId);
  if (hit && now - hit.at < EMAIL_CACHE_TTL_MS) return hit.email;

  try {
    const sb = getServiceClient();
    const { data } = await sb
      .from("users")
      .select("email")
      .eq("id", userId)
      .maybeSingle();
    const email = (data?.email as string) || "unknown@medpruf.com";
    emailCache.set(userId, { email, at: now });
    return email;
  } catch {
    return "unknown@medpruf.com";
  }
}
