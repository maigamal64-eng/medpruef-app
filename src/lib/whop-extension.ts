/**
 * Can this learner pay now to extend active Pro? (a21 renewal fix)
 *
 * Off by default (`WHOP_EXTENSIONS_ENABLED`). Reason (review 2026-10-12): the
 * grant extends the newest live Whop row in place and re-pins its membership
 * (whop-grant.ts), so a later membership-only deactivation of either the new
 * or the old membership can revoke the merged row, taking the earlier time and
 * the paid extension together. Turn the flag on only once an extension gets
 * its own row and membership pin starting at the old end, and a
 * membership-only revoke flips only the row pinned to that membership.
 *
 * Even with the flag on, a payment adds time only when the newest live Whop
 * row ends when the account ends; access from a manual, crypto or referral
 * grant, or a hand extension (PUYP), would gain no days.
 */
import type { SupabaseClient } from "@supabase/supabase-js";

export type ExtensionAvailability = "available" | "unavailable" | "error";

export function whopExtensionsEnabled(env: Record<string, string | undefined> = process.env): boolean {
  return env.WHOP_EXTENSIONS_ENABLED === "true";
}

export async function extensionAvailability(
  sb: SupabaseClient,
  userId: string,
  accountExpiresAt: string | null,
  env: Record<string, string | undefined> = process.env,
): Promise<ExtensionAvailability> {
  if (!whopExtensionsEnabled(env) || !accountExpiresAt) return "unavailable";
  const { data, error } = await sb.from("subscriptions")
    .select("expires_at").eq("user_id", userId).eq("payment_provider", "whop").eq("status", "active")
    .order("expires_at", { ascending: false }).limit(1);
  if (error) return "error";
  const rowEnd = Date.parse(String(data?.[0]?.expires_at ?? ""));
  return Number.isFinite(rowEnd) && Math.abs(rowEnd - Date.parse(accountExpiresAt)) <= 60_000 ? "available" : "unavailable";
}
