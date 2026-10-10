/** Repair denormalized access from existing valid Whop rows, never buy time. */
import type { SupabaseClient } from "@supabase/supabase-js";
import { isPaidTier } from "@/lib/free-tier";

export async function repairWhopUserAccess(sb: SupabaseClient, userId: string): Promise<{
  granted: boolean; tier_expires_at: string | null;
}> {
  if (process.env.WHOP_ATOMIC_GRANTS_ENABLED === "true") {
    const { data, error } = await sb.rpc("repair_whop_user_access", { p_user_id: userId });
    if (error) throw error;
    const result = Array.isArray(data) ? data[0] : data;
    if (!result || typeof result.granted !== "boolean") throw new Error("Invalid atomic entitlement repair result");
    return { granted: result.granted, tier_expires_at: result.tier_expires_at ?? null };
  }
  const { data: owner, error: ownerError } = await sb.from("users")
    .select("tier, role, tier_expires_at").eq("id", userId).maybeSingle();
  if (ownerError) throw ownerError;
  if (!owner) throw new Error("Entitlement owner not found");
  if (owner.role === "admin" || owner.tier === "admin" ||
    (owner.tier === "pro" && owner.tier_expires_at == null)) {
    return { granted: true, tier_expires_at: owner.tier_expires_at ?? null };
  }
  const { data: rows, error } = await sb.from("subscriptions")
    .select("expires_at").eq("user_id", userId).eq("payment_provider", "whop")
    .eq("status", "active").order("expires_at", { ascending: false }).limit(5);
  if (error) throw error;
  const nonExpiring = (rows ?? []).some(r => r.expires_at === null);
  const latest = (rows ?? []).map(r => Date.parse(r.expires_at ?? ""))
    .filter(ms => Number.isFinite(ms) && ms > Date.now())
    .reduce<number | null>((max, ms) => max == null || ms > max ? ms : max, null);
  if (!nonExpiring && latest == null) return {
    granted: isPaidTier(owner.tier, owner.tier_expires_at),
    tier_expires_at: owner.tier_expires_at ?? null,
  };
  const expiry = nonExpiring ? null : new Date(Math.max(latest!, Date.parse(owner.tier_expires_at ?? "") || 0)).toISOString();
  // Snapshot predicates prevent overwriting a manual grant or a completed
  // revocation that changed this user after the read. The gated RPC also
  // locks subscription coverage; this legacy path remains nontransactional.
  let update = sb.from("users").update({ tier: "pro", tier_expires_at: expiry, updated_at: new Date().toISOString() })
    .eq("id", userId).eq("tier", owner.tier);
  update = owner.tier_expires_at == null ? update.is("tier_expires_at", null) : update.eq("tier_expires_at", owner.tier_expires_at);
  const { data: updated, error: writeError } = await update.select("id").maybeSingle();
  if (writeError) throw writeError;
  if (!updated) throw new Error("Entitlement changed during repair");
  // Confirm actual access, rather than reporting only a subscription write.
  const { data: current, error: readError } = await sb.from("users")
    .select("tier, role, tier_expires_at").eq("id", userId).maybeSingle();
  if (readError) throw readError;
  if (!current || !(current.role === "admin" || isPaidTier(current.tier, current.tier_expires_at))) {
    throw new Error("Entitlement reconciliation has not completed");
  }
  return { granted: true, tier_expires_at: current.tier_expires_at ?? null };
}

/**
 * PostgREST filter value for "this jsonb array holds an entry for paymentId".
 * `granted_payment_ids` is jsonb, so the containment operand must be a JSON
 * array literal (`cs.[{"payment_id":"..."}]`). supabase-js `.contains()` with
 * an array argument serializes a Postgres ARRAY literal instead
 * (`cs.{[object Object]}`), which the database rejects with 22P02
 * "invalid input syntax for type json" (the 2026-10-07..09 503 retry loop).
 */
export function grantedPaymentIdsContainsValue(paymentId: string): string {
  return JSON.stringify([{ payment_id: paymentId }]);
}

/** Signed webhook retry: identify the owner from stored grant provenance. */
export async function repairWhopPaymentAccess(sb: SupabaseClient, paymentId: string): Promise<void> {
  const [latest, history] = await Promise.all([
    sb.from("subscriptions").select("user_id").eq("payment_provider", "whop")
      .eq("provider_payment_id", paymentId),
    sb.from("subscriptions").select("user_id").eq("payment_provider", "whop")
      .filter("granted_payment_ids", "cs", grantedPaymentIdsContainsValue(paymentId)),
  ]);
  if (latest.error) throw latest.error;
  if (history.error) throw history.error;
  const owners = new Set<string>([...(latest.data ?? []), ...(history.data ?? [])].map(row => row.user_id));
  if (owners.size > 1) throw new Error("Ambiguous stored payment owner");
  for (const owner of owners) await repairWhopUserAccess(sb, owner);
}
