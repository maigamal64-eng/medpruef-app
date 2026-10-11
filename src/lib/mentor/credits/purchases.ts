/** Durable checkout correlation and pending-purchase lifecycle. No provider writes. */
import type { SupabaseClient } from "@supabase/supabase-js";
import type { MentorSoldPackageId } from "../config";
import { isUuid } from "./db";
import { isSoldPackageId } from "./packages";

type Db = Pick<SupabaseClient, "from" | "rpc">;
export const PURCHASE_RETRY_MS = 30 * 60_000;
export const PURCHASE_EXPIRY_MS = 24 * 3600_000;

export interface MentorPurchase {
  checkout_session_id: string;
  whop_checkout_session_id: string | null;
  purchase_url?: string | null;
  user_id: string;
  package_id: MentorSoldPackageId;
  created_at: string;
  expires_at: string;
  status: "pending" | "granted" | "failed" | "refunded" | "expired" | "superseded";
  payment_id: string | null;
  lot_id: string | null;
  granted_micro: number | null;
}
export interface PendingMentorPurchase {
  checkout_session_id: string;
  package_id: MentorSoldPackageId;
  since: string;
  retry_allowed: boolean;
}

const COLUMNS = "checkout_session_id,whop_checkout_session_id,purchase_url,user_id,package_id,created_at,expires_at,status,payment_id,lot_id,granted_micro";

function purchaseRow(value: unknown): MentorPurchase | null {
  if (!value || typeof value !== "object") return null;
  const row = value as MentorPurchase;
  if (!isUuid(row.checkout_session_id) || !isSoldPackageId(row.package_id) || !Number.isFinite(Date.parse(row.created_at))) return null;
  return row;
}

/** Atomic SQL guard holds the user wallet lock across membership check and pending insertion. */
export async function beginMentorPurchase(db: Db, args: {
  userId: string; packageId: MentorSoldPackageId; checkoutSessionId: string; retryPending: boolean;
}): Promise<{ ok: true } | { ok: false; reason: "already_subscribed" | "pending_purchase"; checkoutSessionId?: string }> {
  const { data, error } = await db.rpc("mentor_begin_purchase", {
    p_user: args.userId,
    p_package: args.packageId,
    p_checkout_session_id: args.checkoutSessionId,
    p_retry: args.retryPending,
  });
  if (error) throw new Error("mentor_begin_purchase failed");
  const result = data as { ok?: boolean; reason?: string; checkout_session_id?: string } | null;
  if (result?.ok === true) return { ok: true };
  if (result?.reason === "already_subscribed" || result?.reason === "pending_purchase") return { ok: false, reason: result.reason, ...(typeof result.checkout_session_id === "string" ? { checkoutSessionId: result.checkout_session_id } : {}) };
  throw new Error("mentor_begin_purchase invalid response");
}

/** Fail closed: verification always scopes the purchase to the signed-in buyer. */
export async function getMentorPurchase(db: Db, userId: string, checkoutSessionId: string): Promise<MentorPurchase | null> {
  if (!isUuid(checkoutSessionId)) return null;
  const { data, error } = await db.from("ai_mentor_purchase").select(COLUMNS)
    .eq("user_id", userId).eq("checkout_session_id", checkoutSessionId).maybeSingle();
  if (error) throw new Error("mentor purchase read failed");
  return purchaseRow(data);
}

/** Read view for /usage. The guard has a hard 24-hour ceiling even before the next checkout sweeps it. */
export async function readPendingPurchase(db: Db, userId: string, now = Date.now()): Promise<PendingMentorPurchase | null> {
  const { data, error } = await db.from("ai_mentor_purchase").select(COLUMNS).eq("user_id", userId)
    .eq("status", "pending").gt("expires_at", new Date(now).toISOString())
    .gt("created_at", new Date(now - PURCHASE_EXPIRY_MS).toISOString()).order("created_at", { ascending: false }).limit(1);
  if (error) throw new Error("mentor pending purchase read failed");
  const row = purchaseRow(Array.isArray(data) ? data[0] : null);
  if (!row || Date.parse(row.created_at) + PURCHASE_EXPIRY_MS <= now || Date.parse(row.expires_at) <= now) return null;
  return {
    checkout_session_id: row.checkout_session_id, package_id: row.package_id, since: row.created_at,
    retry_allowed: now - Date.parse(row.created_at) >= PURCHASE_RETRY_MS,
  };
}

/** Save the provider ID before returning its URL. A fast webhook may already have granted the row. */
export async function attachWhopCheckout(db: Db, userId: string, sessionId: string, whopId: string, purchaseUrl?: string): Promise<void> {
  const { data, error } = await db.from("ai_mentor_purchase").update({ whop_checkout_session_id: whopId, ...(purchaseUrl ? { purchase_url: purchaseUrl } : {}) })
    .eq("user_id", userId).eq("checkout_session_id", sessionId).select("checkout_session_id").maybeSingle();
  if (error || !data) throw new Error("mentor checkout session persistence failed");
}

/** Correlation metadata is present on initial payments; renewals have no purchase to change. */
export function checkoutSessionFromPayment(value: unknown): string | null {
  const rec = (v: unknown): Record<string, unknown> => v && typeof v === "object" ? v as Record<string, unknown> : {};
  const d = rec(value);
  for (const meta of [rec(d.metadata), rec(rec(d.membership).metadata), rec(rec(d.payment).metadata)]) {
    if (typeof meta.checkout_session_id === "string" && isUuid(meta.checkout_session_id)) return meta.checkout_session_id;
  }
  return null;
}

export async function markPurchaseGranted(db: Db, args: {
  userId: string; packageId: MentorSoldPackageId; checkoutSessionId: string; paymentId: string;
  lotId: string | null; grantedMicro: number | null;
}): Promise<void> {
  const purchase = await getMentorPurchase(db, args.userId, args.checkoutSessionId);
  if (!purchase || purchase.package_id !== args.packageId) throw new Error("mentor grant purchase mismatch");
  // Renewal metadata can retain the initial checkout correlation. Keep the
  // initial receipt pinned to its original payment; renewal credits are unchanged.
  if (purchase.payment_id && purchase.payment_id !== args.paymentId) return;
  if (purchase.status === "refunded") return;
  if (purchase.status === "granted" && purchase.payment_id === args.paymentId) return;
  const { error } = await db.from("ai_mentor_purchase").update({
    status: "granted", payment_id: args.paymentId, lot_id: args.lotId, granted_micro: args.grantedMicro,
    granted_at: new Date().toISOString(),
  }).eq("user_id", args.userId).eq("package_id", args.packageId)
    .eq("checkout_session_id", args.checkoutSessionId).neq("status", "refunded");
  if (error) throw new Error("mentor granted purchase persistence failed");
}

/** Only the identified purchase is released; a late event cannot clear a newer checkout. */
export async function clearPendingPurchase(db: Db, args: {
  status: "failed" | "refunded"; checkoutSessionId?: string | null; paymentIds?: string[];
}): Promise<void> {
  const updates: Array<PromiseLike<unknown>> = [];
  const patch = { status: args.status };
  if (args.checkoutSessionId && isUuid(args.checkoutSessionId)) {
    let q = db.from("ai_mentor_purchase").update(patch).eq("checkout_session_id", args.checkoutSessionId);
    if (args.status === "failed") q = q.eq("status", "pending");
    updates.push(q);
  }
  if (args.paymentIds?.length) {
    let q = db.from("ai_mentor_purchase").update(patch).in("payment_id", args.paymentIds);
    if (args.status === "failed") q = q.eq("status", "pending");
    updates.push(q);
  }
  // Sequential writes preserve the refund-before-grant event ordering contract.
  for (const update of updates) {
    const { error } = await update as { error: unknown };
    if (error) throw new Error("mentor purchase release failed");
  }
}
