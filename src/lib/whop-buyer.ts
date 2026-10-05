/**
 * Whop buyer -> MedPrüf user resolution (2026-10-02 payment-integrity fix A).
 *
 * WHY: renewal charges (`billing_reason=subscription_cycle`) carry
 * `metadata: null`. The webhook used to fall straight back to the Whop
 * account EMAIL, which is the payer's Whop login, not necessarily the
 * MedPrüf account that started the subscription. Two real cases:
 *   - Maxim: membership mem_O9ek… was created by MedPrüf user 3fc19458, but
 *     the 09-18 renewal was credited to 4eeac38d (email match).
 *   - Mezoo/Bader: trial membership mem_Uxpg… belongs to 96ce5086, but the
 *     Whop payer email is f2f8957a's, so the 10-07 renewal would have
 *     credited f2f8957a while 96ce5086 dropped to free.
 *
 * Resolution order (first hit wins; email is LAST and only when nothing
 * membership-bound is available):
 *   1. DB pin: a subscriptions row whose whop_membership_id = mem_… (written
 *      at every grant from now on; Revenue Ops can set it to re-route).
 *   2. Payment metadata medpruef_user_id (first payment of a session).
 *   3. Metadata echoed on the embedded membership object (v2 envelopes).
 *   4. Checkout configuration (ch_…) -> our own payment_events
 *      checkout_session_created row (the user who created the session).
 *      Survives renewals and needs no Whop API permission.
 *   5. Whop membership API (GET /v1/memberships/{id}) metadata.
 *   6. Email (case-insensitive exact, refused when ambiguous).
 *
 * If a membership id is present and the Whop API fails TRANSIENTLY (network
 * / 5xx), we return `provider_unavailable` so the caller can 5xx and let
 * Whop retry, instead of guessing by email. A permission error (401/403)
 * is not transient: it is Sentry-flagged and resolution continues.
 */
import * as Sentry from "@sentry/nextjs";
import type { SupabaseClient } from "@supabase/supabase-js";

export type BuyerSource =
  | "membership_pin"
  | "payment_metadata"
  | "membership_payload_metadata"
  | "checkout_session"
  | "membership_api"
  | "email";

export interface BuyerInput {
  membershipId: string | null;
  metaUserId: string | null;
  membershipMetaUserId?: string | null;
  checkoutConfigId: string | null;
  email: string | null;
}

export interface WhopMembershipLookup {
  ok: boolean;
  /** HTTP status of the lookup (0 = network failure). */
  status: number;
  metaUserId: string | null;
  manageUrl: string | null;
  checkoutConfigId: string | null;
}

export type BuyerResolution =
  | {
      kind: "resolved";
      userId: string;
      source: BuyerSource;
      manageUrl: string | null;
    }
  | { kind: "unresolved"; manageUrl: string | null }
  | { kind: "provider_unavailable"; status: number };

export interface ResolverDeps {
  fetchMembership?: (membershipId: string) => Promise<WhopMembershipLookup>;
}

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function escapeLike(value: string): string {
  return value.replace(/\\/g, "\\\\").replace(/[%_]/g, (c) => `\\${c}`);
}

/** Read one Whop membership with the server's scoped key. Never throws. */
export async function fetchWhopMembership(membershipId: string): Promise<WhopMembershipLookup> {
  const apiKey = process.env.WHOP_API_KEY || process.env.WHOP_APP_API_KEY;
  const empty = { metaUserId: null, manageUrl: null, checkoutConfigId: null };
  if (!apiKey) return { ok: false, status: 401, ...empty };
  try {
    const res = await fetch(
      `https://api.whop.com/api/v1/memberships/${encodeURIComponent(membershipId)}`,
      { headers: { Authorization: `Bearer ${apiKey}`, Accept: "application/json" } }
    );
    if (!res.ok) return { ok: false, status: res.status, ...empty };
    const d = (await res.json()) as Record<string, unknown>;
    const meta = (d.metadata && typeof d.metadata === "object" ? d.metadata : {}) as Record<
      string,
      unknown
    >;
    const s = (v: unknown) => (typeof v === "string" && v ? v : null);
    return {
      ok: true,
      status: res.status,
      metaUserId: s(meta.medpruef_user_id) ?? s(meta.user_id),
      manageUrl: s(d.manage_url),
      checkoutConfigId: s(d.checkout_configuration_id),
    };
  } catch {
    return { ok: false, status: 0, ...empty };
  }
}

/** Thrown when a resolver DB read fails: callers must not fall through to email. */
class ResolverDbError extends Error {}

async function userExists(sb: SupabaseClient, id: string | null | undefined): Promise<string | null> {
  if (!id || !UUID_RE.test(id)) return null;
  const { data, error } = await sb.from("users").select("id").eq("id", id).maybeSingle();
  if (error) throw new ResolverDbError(error.message);
  return (data?.id as string | undefined) ?? null;
}

export async function resolveWhopBuyer(
  sb: SupabaseClient,
  input: BuyerInput,
  deps: ResolverDeps = {}
): Promise<BuyerResolution> {
  try {
    return await resolveInner(sb, input, deps);
  } catch (err) {
    // A DB read failed mid-resolution. Falling through to the email step here
    // would reintroduce the wrong-account bug under a blip: report it as
    // unavailable so the caller releases its claim and lets Whop retry.
    Sentry.captureException(err, { tags: { lib: "whop-buyer", step: "resolve" } });
    return { kind: "provider_unavailable", status: -1 };
  }
}

async function resolveInner(
  sb: SupabaseClient,
  input: BuyerInput,
  deps: ResolverDeps
): Promise<BuyerResolution> {
  const fetchMembership = deps.fetchMembership ?? fetchWhopMembership;
  let manageUrl: string | null = null;

  // 1. DB pin on the membership id.
  if (input.membershipId) {
    const { data: pinned, error: pinErr } = await sb
      .from("subscriptions")
      .select("user_id, updated_at")
      .eq("payment_provider", "whop")
      .eq("whop_membership_id", input.membershipId)
      .order("updated_at", { ascending: false })
      .limit(1);
    if (pinErr) throw new ResolverDbError(pinErr.message);
    const pinnedUser = (pinned?.[0] as { user_id?: string } | undefined)?.user_id ?? null;
    if (pinnedUser) return { kind: "resolved", userId: pinnedUser, source: "membership_pin", manageUrl };
  }

  // 2. Payment metadata.
  const fromMeta = await userExists(sb, input.metaUserId);
  if (fromMeta) return { kind: "resolved", userId: fromMeta, source: "payment_metadata", manageUrl };

  // 3. Metadata on the embedded membership object.
  const fromMembershipMeta = await userExists(sb, input.membershipMetaUserId);
  if (fromMembershipMeta) {
    return { kind: "resolved", userId: fromMembershipMeta, source: "membership_payload_metadata", manageUrl };
  }

  // 4. Checkout configuration -> the session creator in our own ledger.
  let checkoutConfigId = input.checkoutConfigId;
  const fromCheckout = async (ch: string | null): Promise<string | null> => {
    if (!ch) return null;
    const { data, error } = await sb
      .from("payment_events")
      .select("user_id")
      .eq("checkout_session_id", ch)
      .not("user_id", "is", null)
      .limit(5);
    if (error) throw new ResolverDbError(error.message);
    const ids = Array.from(
      new Set(((data ?? []) as Array<{ user_id: string | null }>).map((r) => r.user_id).filter(Boolean))
    ) as string[];
    return ids.length === 1 ? ids[0] : null;
  };
  const viaCheckout = await fromCheckout(checkoutConfigId);
  if (viaCheckout) return { kind: "resolved", userId: viaCheckout, source: "checkout_session", manageUrl };

  // 5. Whop membership API.
  if (input.membershipId) {
    const m = await fetchMembership(input.membershipId);
    if (m.ok) {
      manageUrl = m.manageUrl;
      const fromApi = await userExists(sb, m.metaUserId);
      if (fromApi) return { kind: "resolved", userId: fromApi, source: "membership_api", manageUrl };
      if (!checkoutConfigId && m.checkoutConfigId) {
        checkoutConfigId = m.checkoutConfigId;
        const viaApiCheckout = await fromCheckout(checkoutConfigId);
        if (viaApiCheckout) {
          return { kind: "resolved", userId: viaApiCheckout, source: "checkout_session", manageUrl };
        }
      }
    } else if (m.status === 0 || m.status >= 500 || m.status === 429) {
      // Transient: do NOT guess by email; let Whop retry the delivery.
      return { kind: "provider_unavailable", status: m.status };
    } else {
      Sentry.captureMessage(
        `whop_membership_lookup_denied: GET /v1/memberships/${input.membershipId} -> HTTP ${m.status}; falling back to email`,
        "warning"
      );
    }
  }

  // 6. Email, last. Refuse when ambiguous.
  if (input.email) {
    const { data, error } = await sb.from("users").select("id").ilike("email", escapeLike(input.email.trim())).limit(2);
    if (error) throw new ResolverDbError(error.message);
    const rows = (data ?? []) as Array<{ id: string }>;
    if (rows.length === 1) {
      if (input.membershipId) {
        Sentry.captureMessage(
          `whop_buyer_email_fallback: membership ${input.membershipId} resolved by email only (no pin/metadata/checkout tie)`,
          "warning"
        );
      }
      return { kind: "resolved", userId: rows[0].id, source: "email", manageUrl };
    }
  }

  return { kind: "unresolved", manageUrl };
}
