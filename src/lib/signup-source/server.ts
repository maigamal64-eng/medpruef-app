/**
 * Writes `users.signup_source` for an account /api/auth has just created
 * (a-signup-source-1029). A sign-in never calls it.
 *
 * Flag off (SIGNUP_SOURCE_ENABLED unset): no database call at all, so the
 * code is safe before migration 20270116090000_a_signup_source is applied.
 * Flag on: one UPDATE guarded by `signup_source IS NULL` (first write wins);
 * written whatever DISABLE_ANALYTICS_WRITES says (one row per signup, not
 * telemetry); a failure is a rate-limited Sentry warning, never an auth error.
 */
import type { SupabaseClient } from "@supabase/supabase-js";
import { captureServerError } from "@/lib/sentry-capture";
import { SIGNUP_SOURCE_RE, signupSourceEnabled, type SignupSource } from "./index";

export type SignupSourceWrite = "written" | "exists" | "noop" | "failed";

const WARN_EVERY_MS = 60 * 60 * 1000;
const lastWarn = new Map<string, number>();

function warnOnce(reason: string, err: unknown): void {
  const now = Date.now();
  if ((lastWarn.get(reason) ?? 0) > now - WARN_EVERY_MS) return;
  lastWarn.set(reason, now);
  captureServerError(err instanceof Error ? err : new Error(`signup_source ${reason}`), {
    route: "/api/auth",
    phase: "signup_source",
    reason,
  });
}

/** Test seam: forget the per-instance warning clock. */
export function resetSignupSourceWarnings(): void {
  lastWarn.clear();
}

export async function writeSignupSource(
  sb: SupabaseClient,
  userId: string,
  source: SignupSource,
  env: Record<string, string | undefined> = process.env,
): Promise<SignupSourceWrite> {
  if (!userId || !signupSourceEnabled(env)) return "noop";
  if (!SIGNUP_SOURCE_RE.test(source.key)) return "noop";
  try {
    const { data, error } = await sb
      .from("users")
      .update({ signup_source: source.key, signup_source_basis: source.basis })
      .eq("id", userId)
      .is("signup_source", null)
      .select("id");
    if (!error) return Array.isArray(data) && data.length === 0 ? "exists" : "written";
    warnOnce(`update_${error.code ?? "error"}`, new Error(`signup_source update failed: ${error.code ?? "unknown"}`));
    return "failed";
  } catch (e) {
    warnOnce("threw", e);
    return "failed";
  }
}
