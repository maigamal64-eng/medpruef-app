import type { SupabaseClient } from "@supabase/supabase-js";
import { isMailSuppressed } from "@/lib/mail-suppression";
import { isPaidAccess } from "@/lib/auth-guard";
import type { ResumeAccount } from "@/lib/checkout-resume";
import { captureServerError } from "@/lib/sentry-capture";
import { decideCheckoutReturn, resumeExcludedIds, RETURN_WINDOW_MS, type ReturnDecision } from "@/lib/checkout-return-read";

/**
 * Step two of the return read, shared by /api/checkout-return and the stall
 * prompt's eligibility route: the account row, a refunded history and the
 * do-not-contact list, read only for a learner who would otherwise qualify
 * (a-checkout-resume order). null = unreadable, which hides everything.
 */
export async function loadReturnAccount(sb: SupabaseClient, base: ResumeAccount): Promise<ResumeAccount | null> {
  const { data: user, error: userErr } = await sb.from("users").select("id, email, role, tier").eq("id", base.id).maybeSingle();
  if (userErr || !user) return null;
  const { data: refunded, error: refErr } = await sb.from("subscriptions").select("id").eq("user_id", base.id).eq("status", "refunded").limit(1);
  if (refErr) return null;
  const email = (user.email as string | null) ?? null;
  // A Telegram-only account has no address, so no list entry can exist for it.
  const doNotContact = email ? await isMailSuppressed(sb, email, "marketing") : false;
  return { ...base, role: user.role as string | null, tier: user.tier as string | null, email, doNotContact, refunded: (refunded ?? []).length > 0 };
}

type Guard = { userId: string; role?: string | null; tier?: string | null; tierExpiresAt?: string | null };

/**
 * The whole return decision for the signed-in learner, cheapest read first: the
 * learner's recent payment events decide with what the guard already knows; only a
 * learner who would qualify costs the users, refund and do-not-contact reads.
 * `error` = a read failed (the caller answers a retryable status, never "no").
 */
export async function returnDecisionFor(sb: SupabaseClient, guard: Guard, route: string): Promise<{ error: true } | { error: false; decision: ReturnDecision }> {
  const { data: events, error: evErr } = await sb
    .from("payment_events")
    .select("event, created_at, tier")
    .eq("user_id", guard.userId)
    .in("event", ["checkout_redirected", "grant_succeeded", "grant_failed", "webhook_received"])
    .gte("created_at", new Date(Date.now() - RETURN_WINDOW_MS).toISOString())
    .order("created_at", { ascending: false })
    .limit(100);
  if (evErr) {
    captureServerError(evErr, { route, phase: "events" });
    return { error: true };
  }
  const excluded = resumeExcludedIds();
  const base: ResumeAccount = { id: guard.userId, role: guard.role, tier: guard.tier, paidAccess: isPaidAccess(guard as never), doNotContact: false };
  const early = decideCheckoutReturn({ enabled: true, excluded, account: base, events: events ?? [] });
  if (!early.show) return { error: false, decision: early };
  const account = await loadReturnAccount(sb, base);
  if (!account) return { error: true };
  return { error: false, decision: decideCheckoutReturn({ enabled: true, excluded, account, events: events ?? [] }) };
}

/** True when this learner already has a row of the type since the redirect (null = unreadable). */
export async function hasEventSince(sb: SupabaseClient, userId: string, eventType: string, sinceIso: string, route: string): Promise<boolean | null> {
  const { data, error } = await sb.from("user_events").select("id").eq("user_id", userId).eq("event_type", eventType).gte("created_at", sinceIso).limit(1);
  if (error) {
    captureServerError(error, { route, phase: `seen_${eventType}` });
    return null;
  }
  return (data ?? []).length > 0;
}
