/**
 * The single writer of `user_registered` (a-first-touch). Called by /api/auth
 * only, and only for an account it has just created; a sign-in never calls it.
 *
 * Flag off (FIRST_TOUCH_ENABLED unset): exactly today's row through
 * recordEventSafe (awaited, so a Vercel freeze cannot drop it).
 * Flag on: the row is a signup ledger, not telemetry:
 *   - written even while DISABLE_ANALYTICS_WRITES is on (one row per signup);
 *   - at most one per account (an existing row is kept, nothing added);
 *   - carries `first_touch` (one key, FIRST_TOUCH_KEY_RE) and its basis;
 *   - a failed insert is a rate-limited Sentry warning, never an auth error.
 */
import type { SupabaseClient } from "@supabase/supabase-js";
import { attributionForEvent, type Attribution } from "@/lib/attribution";
import { captureServerError } from "@/lib/sentry-capture";
import { recordEventSafe } from "@/lib/user-events";
import { firstTouchEnabled, type FirstTouch } from "./index";

export const SIGNUP_EVENT = "user_registered";

export interface SignupArgs {
  userId: string;
  source: "email" | "telegram";
  method: string;
  attribution: Attribution | null;
  firstTouch: FirstTouch | null;
}

export type SignupResult = "written" | "exists" | "failed" | "noop";

const WARN_EVERY_MS = 60 * 60 * 1000;
const lastWarn = new Map<string, number>();

function warnOnce(reason: string, err: unknown): void {
  const now = Date.now();
  if ((lastWarn.get(reason) ?? 0) > now - WARN_EVERY_MS) return;
  lastWarn.set(reason, now);
  captureServerError(err instanceof Error ? err : new Error(`user_registered ${reason}`), {
    route: "/api/auth",
    phase: "first_touch_signup",
    reason,
  });
}

/** Test seam: forget the per-instance warning clock. */
export function resetSignupWarnings(): void {
  lastWarn.clear();
}

/** The event_data of the row (pure, shared by both paths). */
export function signupEventData(args: SignupArgs, withFirstTouch: boolean): Record<string, unknown> {
  const campaign = attributionForEvent(args.attribution);
  return {
    source: args.source,
    method: args.method,
    ...(campaign ? { attribution: campaign } : {}),
    ...(withFirstTouch
      ? { first_touch: args.firstTouch?.key ?? null, first_touch_basis: args.firstTouch?.basis ?? null }
      : {}),
  };
}

export async function recordSignup(sb: SupabaseClient, args: SignupArgs): Promise<SignupResult> {
  if (!args.userId) return "noop";
  if (!firstTouchEnabled()) {
    const r = await recordEventSafe(sb, { userId: args.userId, eventType: SIGNUP_EVENT, data: signupEventData(args, false) });
    return r.ok ? "written" : r.reason === "noop" ? "noop" : "failed";
  }
  try {
    const { data: prior, error: readErr } = await sb
      .from("user_events")
      .select("id")
      .eq("user_id", args.userId)
      .eq("event_type", SIGNUP_EVENT)
      .limit(1);
    // A failed read still writes: a rare second row beats a lost signup.
    if (!readErr && Array.isArray(prior) && prior.length > 0) return "exists";
    const { error } = await sb.from("user_events").insert({
      user_id: args.userId,
      event_type: SIGNUP_EVENT,
      event_data: signupEventData(args, true),
    });
    if (!error) return "written";
    warnOnce(`insert_${error.code ?? "error"}`, new Error(`user_registered insert failed: ${error.code ?? "unknown"}`));
    return "failed";
  } catch (e) {
    warnOnce("threw", e);
    return "failed";
  }
}
