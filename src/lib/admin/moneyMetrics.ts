/**
 * moneyMetrics: server-side loaders for the shared money definitions in
 * ./money-rules (ADM-01 A). Every admin money number (Overview, Payments,
 * the paid roster, Growth, the control plane) reads its rows through here
 * and classifies them with the same pure rules.
 *
 * READ-ONLY. Imported only by admin-shelled API routes and other server
 * metrics modules, never by a client page.
 */

import type { SupabaseClient } from "@supabase/supabase-js";
import { assertReadSucceeded } from "./read-result";
import {
  buildLedger,
  type AccountLike,
  type DeliveryRow,
  type Ledger,
  type LedgerEventRow,
  type PaymentResolution,
  type SubscriptionLike,
} from "./money-rules";

const PAGE = 1000;
const MAX_PAGES = 50;

/** Page through a select so the 1000-row REST cap never truncates money. */
async function readAll<T>(
  build: (from: number, to: number) => PromiseLike<{ data: unknown; error: unknown }>,
): Promise<T[]> {
  const out: T[] = [];
  for (let page = 0; page < MAX_PAGES; page++) {
    const res = await build(page * PAGE, page * PAGE + PAGE - 1);
    assertReadSucceeded(res);
    const rows = (res.data ?? []) as T[];
    out.push(...rows);
    if (rows.length < PAGE) return out;
  }
  throw new Error("Money ledger exceeded the read budget; refusing to report a truncated total.");
}

const LEDGER_COLUMNS =
  "id, event, provider, user_id, tier, plan_id, payment_id, amount_cents, currency, reason, matched, metadata, created_at";

/** Every payment_events row that names a payment or refund id. */
export async function loadLedgerRows(sb: SupabaseClient, paymentId?: string): Promise<LedgerEventRow[]> {
  return readAll<LedgerEventRow>((from, to) => {
    let q = sb
      .from("payment_events")
      .select(LEDGER_COLUMNS)
      .in("event", ["webhook_received", "grant_succeeded", "grant_failed"])
      .not("payment_id", "is", null);
    if (paymentId) q = q.eq("payment_id", paymentId);
    return q.order("id", { ascending: true }).range(from, to);
  });
}

export interface ResolutionsRead {
  rows: PaymentResolution[];
  /** False until the a14 changeset (payment_resolutions) is applied. */
  available: boolean;
}

function isMissingRelation(error: unknown): boolean {
  const code = (error as { code?: string } | null)?.code;
  return code === "42P01" || code === "PGRST205";
}

export async function loadResolutions(sb: SupabaseClient, paymentId?: string): Promise<ResolutionsRead> {
  let q = sb.from("payment_resolutions").select("payment_id, kind, user_id, reason, created_at");
  if (paymentId) q = q.eq("payment_id", paymentId);
  const res = await q.limit(5000);
  if (res.error) {
    if (isMissingRelation(res.error)) return { rows: [], available: false };
    throw res.error;
  }
  return { rows: (res.data ?? []) as PaymentResolution[], available: true };
}

export async function loadLedger(sb: SupabaseClient): Promise<{ ledger: Ledger; resolutionsAvailable: boolean }> {
  const [rows, resolutions] = await Promise.all([loadLedgerRows(sb), loadResolutions(sb)]);
  return { ledger: buildLedger(rows, resolutions.rows), resolutionsAvailable: resolutions.available };
}

export interface AccountRow extends AccountLike {
  id: string;
  first_name?: string | null;
  last_name?: string | null;
  created_at?: string | null;
  tier_expires_at?: string | null;
}

export async function loadAccounts(sb: SupabaseClient): Promise<AccountRow[]> {
  return readAll<AccountRow>((from, to) =>
    sb
      .from("users")
      .select("id, email, role, tier, first_name, last_name, created_at, tier_expires_at")
      .order("created_at", { ascending: true })
      .range(from, to),
  );
}

export const SUBSCRIPTION_COLUMNS =
  "id, user_id, tier, status, payment_provider, payment_method, amount_cents, currency, provider_payment_id, granted_payment_ids, expires_at, started_at, created_at, cancelled_at, updated_at";

export interface SubscriptionRow extends SubscriptionLike {
  id: string;
  payment_method?: string | null;
  currency?: string | null;
  cancelled_at?: string | null;
  updated_at?: string | null;
}

/** Active rows plus rows that ended or changed in the lookback window. */
export async function loadSubscriptions(sb: SupabaseClient, sinceIso: string): Promise<SubscriptionRow[]> {
  const [active, recent] = await Promise.all([
    readAll<SubscriptionRow>((from, to) =>
      sb.from("subscriptions").select(SUBSCRIPTION_COLUMNS).eq("status", "active").order("id").range(from, to),
    ),
    readAll<SubscriptionRow>((from, to) =>
      sb
        .from("subscriptions")
        .select(SUBSCRIPTION_COLUMNS)
        .neq("status", "active")
        .gte("updated_at", sinceIso)
        .order("id")
        .range(from, to),
    ),
  ]);
  const byId = new Map<string, SubscriptionRow>();
  for (const r of [...active, ...recent]) byId.set(r.id, r);
  return [...byId.values()];
}

/** Whop deliveries in the window (pre-verification truth). */
export async function loadWhopDeliveries(sb: SupabaseClient, sinceIso: string): Promise<DeliveryRow[]> {
  return readAll<DeliveryRow>((from, to) =>
    sb
      .from("webhook_attempts")
      .select("result, error, received_at")
      .eq("provider", "whop")
      .gte("received_at", sinceIso)
      .order("received_at", { ascending: false })
      .range(from, to),
  );
}

export function accountsById(rows: AccountRow[]): Map<string, AccountRow> {
  return new Map(rows.map((r) => [r.id, r]));
}
