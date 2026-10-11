/** Checkout confirmation from the one payment lot owned by this purchase. */
import type { SupabaseClient } from "@supabase/supabase-js";
import { creditsFromMicro } from "../config";
import type { MentorPurchaseReceipt } from "../contract";
import { getMentorPurchase } from "./purchases";
import { isSoldPackageId } from "./packages";
type Db = Pick<SupabaseClient, "from" | "rpc">;

/** Whop's documented membership date, never a locally calculated billing interval. */
export function confirmedRenewal(member: unknown): string | null {
  if (!member || typeof member !== "object") return null;
  const m = member as Record<string, unknown>;
  if (m.cancel_at_period_end === true || m.payment_collection_paused === true || m.status !== "active") return null;
  if (typeof m.renewal_period_end !== "string" || !Number.isFinite(Date.parse(m.renewal_period_end))) return null;
  return new Date(m.renewal_period_end).toISOString();
}
export async function readPurchaseReceipt(db: Db, userId: string, checkoutId: string): Promise<MentorPurchaseReceipt | null> {
  const purchase = await getMentorPurchase(db, userId, checkoutId);
  if (purchase?.status !== "granted" || !purchase.payment_id) return null;
  const { data, error } = await db.from("ai_credit_lot").select("package_id,granted_micro,expires_at,renews_at")
    .eq("user_id", userId).eq("source", "whop_payment").eq("source_id", purchase.payment_id)
    .eq("package_id", purchase.package_id).eq("status", "live").maybeSingle();
  if (error) throw new Error("mentor receipt read failed");
  if (!data || !isSoldPackageId(data.package_id) || !Number.isFinite(Date.parse(data.expires_at))) return null;
  const micro = Number(data.granted_micro);
  if (!Number.isSafeInteger(micro) || micro <= 0) return null;
  const renewal = typeof data.renews_at === "string" && Number.isFinite(Date.parse(data.renews_at)) ? data.renews_at : null;
  return { package_id: data.package_id, credits: creditsFromMicro(micro), expires_at: data.expires_at, renews_at: data.package_id === "mentor_topup" ? null : renewal };
}
/** Transactional, payment-keyed event. Repeated polls and other tabs are harmless. */
export async function recordPurchaseCompleted(db: Db, userId: string, checkoutId: string): Promise<void> {
  const { error } = await db.rpc("mentor_record_purchase_completed", { p_user: userId, p_checkout_session_id: checkoutId });
  if (error) throw new Error("mentor completed receipt event failed");
}
