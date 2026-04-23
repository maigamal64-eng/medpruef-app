/**
 * admin audit logging — insert a row into admin_audit_log for every
 * admin mutation. §2.7 of the April 23 admin revamp sprint.
 *
 * Call from any /api/admin/* (or equivalent) route after you've already
 * passed the requireAdmin guard. Never throws — a failed audit write
 * won't fail the request, it'll be captured in Sentry.
 */

import type { NextRequest } from "next/server";
import { getServiceClient } from "@/lib/supabase";
import { captureServerError } from "@/lib/sentry-capture";

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
  /** Optional: UUID of the entity. */
  targetId?: string;
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

    const { error } = await sb.from("admin_audit_log").insert({
      actor_id: args.actorId,
      actor_email: args.actorEmail,
      action: args.action,
      target_type: args.targetType ?? null,
      target_id: args.targetId ?? null,
      payload: args.payload ?? {},
      ip_address: ip,
      user_agent: userAgent,
    });

    if (error) {
      captureServerError(error, {
        route: "admin/audit",
        action: args.action,
        actorId: args.actorId,
      });
    }
  } catch (err) {
    // Never let an audit write failure take down a request. The Sentry
    // capture above + this fallback means we get visibility either way.
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
