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
 * / 5xx / 429), we return `provider_unavailable` so the caller can 5xx and
 * let Whop retry, instead of guessing by email.
 *
 * a-whop-buyer-fail-closed (Whop review G10), behind WHOP_BUYER_FAIL_CLOSED
 * (only the literal 'true'; default off = the behaviour above):
 *   - a 401/403 from GET /memberships/{id} (or no API key at all) is also
 *     `provider_unavailable` (reason denied / no_key): the caller releases its
 *     claim and answers 503, so the payment waits instead of being credited
 *     to the payer's email account;
 *   - step 6 (email) runs only when the payload carries NO membership id; a
 *     membership the steps above cannot tie stays `unresolved` (manual link).
 * Off, a 401/403 still continues to email, as before. On or off, a denied or
 * keyless read writes one `whop_membership_read_denied` alert row per hour
 * (claim, then user_events row, then Sentry) for the Mac notifier and the
 * checkout-failure-watch mail. Only flip the flag after a read-only
 * GET /memberships/{id} with the production key answers 200.
 */
import * as Sentry from "@sentry/nextjs";
import { whopHeaders } from "@/lib/whop-api";
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
  /** true when no Whop API key is configured (status is then a synthetic 401). */
  noKey?: boolean;
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
  | { kind: "provider_unavailable"; status: number; reason: UnavailableReason };

/** Why the buyer could not be resolved right now (the caller answers 503). */
export type UnavailableReason = "transient" | "denied" | "no_key" | "db";

/** Which webhook path asked (alert context only). */
export type BuyerPath = "grant" | "revoke" | "recovery" | "trial_ending";

export interface ResolverDeps {
  fetchMembership?: (membershipId: string) => Promise<WhopMembershipLookup>;
  /** Overrides WHOP_BUYER_FAIL_CLOSED (tests). */
  failClosed?: boolean;
  /** Overrides the clock used for the hourly alert key (tests). */
  now?: () => Date;
}

/** WHOP_BUYER_FAIL_CLOSED: only the literal 'true' switches it on. */
export function buyerFailClosedEnabled(): boolean {
  return process.env.WHOP_BUYER_FAIL_CLOSED === "true";
}

export const MEMBERSHIP_DENIED_EVENT = "whop_membership_read_denied";
export const MEMBERSHIP_DENIED_CLAIM_PROVIDER = "whop_membership_denied";
/** Same bucket as the other Whop alert rows (user_events.user_id is NOT NULL). */
const ALERT_USER_BUCKET = "whop-webhook";

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function escapeLike(value: string): string {
  return value.replace(/\\/g, "\\\\").replace(/[%_]/g, (c) => `\\${c}`);
}

/** A buyer-facing link from Whop: https on whop.com (or a subdomain), no credentials. */
export function whopHttpsUrl(value: unknown): string | null {
  if (typeof value !== "string" || !value) return null;
  try {
    const url = new URL(value);
    const host = url.hostname.toLowerCase();
    return url.protocol === "https:" && !url.username && !url.password &&
      (host === "whop.com" || host.endsWith(".whop.com")) ? url.href : null;
  } catch {
    return null;
  }
}

/** Read one Whop membership with the server's scoped key. Never throws. */
export async function fetchWhopMembership(membershipId: string): Promise<WhopMembershipLookup> {
  const apiKey = process.env.WHOP_API_KEY || process.env.WHOP_APP_API_KEY;
  const empty = { metaUserId: null, manageUrl: null, checkoutConfigId: null };
  if (!apiKey) return { ok: false, status: 401, noKey: true, ...empty };
  try {
    const res = await fetch(
      `https://api.whop.com/api/v1/memberships/${encodeURIComponent(membershipId)}`,
      { headers: whopHeaders(apiKey) }
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
      manageUrl: whopHttpsUrl(d.manage_url),
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
  input: BuyerInput & { path?: BuyerPath; paymentId?: string | null },
  deps: ResolverDeps = {}
): Promise<BuyerResolution> {
  try {
    return await resolveInner(sb, input, deps);
  } catch (err) {
    // A DB read failed mid-resolution. Falling through to the email step here
    // would reintroduce the wrong-account bug under a blip: report it as
    // unavailable so the caller releases its claim and lets Whop retry.
    Sentry.captureException(err, { tags: { lib: "whop-buyer", step: "resolve" } });
    return { kind: "provider_unavailable", status: -1, reason: "db" };
  }
}

async function resolveInner(
  sb: SupabaseClient,
  input: BuyerInput & { path?: BuyerPath; paymentId?: string | null },
  deps: ResolverDeps
): Promise<BuyerResolution> {
  const fetchMembership = deps.fetchMembership ?? fetchWhopMembership;
  const failClosed = deps.failClosed ?? buyerFailClosedEnabled();
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
      return { kind: "provider_unavailable", status: m.status, reason: "transient" };
    } else if (m.noKey || m.status === 401 || m.status === 403) {
      // The key cannot read memberships (missing scope, rotated key, wrong
      // account, or no key). Not transient, but guessing by the payer's email
      // is the wrong-account grant (Mezoo/Bader) this resolver exists to stop.
      await alertMembershipReadDenied(sb, {
        status: m.status,
        noKey: Boolean(m.noKey),
        membershipId: input.membershipId,
        paymentId: input.paymentId ?? null,
        path: input.path ?? null,
        failClosed,
        now: deps.now?.() ?? new Date(),
      });
      if (failClosed) {
        return { kind: "provider_unavailable", status: m.status, reason: m.noKey ? "no_key" : "denied" };
      }
    } else {
      Sentry.captureMessage(
        `whop_membership_lookup_failed: GET /v1/memberships/${input.membershipId} -> HTTP ${m.status}; ${failClosed ? "no email fallback" : "falling back to email"}`,
        "warning"
      );
    }
  }

  // 6. Email, last. Refuse when ambiguous. Fail-closed: only when the payload
  // names no membership (the payer's Whop email is not the subscriber's proof).
  if (failClosed && input.membershipId) {
    Sentry.captureMessage(
      `whop_buyer_unresolved: membership ${input.membershipId} has no pin/metadata/checkout tie; email match refused (manual link)`,
      "warning"
    );
    return { kind: "unresolved", manageUrl };
  }
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

export interface MembershipDeniedAlert {
  status: number;
  noKey: boolean;
  membershipId: string | null;
  paymentId: string | null;
  path: BuyerPath | null;
  failClosed: boolean;
  now: Date;
}

/**
 * One alert per hour per status while the key cannot read memberships: a
 * claim in processed_webhook_events, then one user_events row (ids and status
 * only, never an email), then Sentry. A failed row frees the claim so the next
 * delivery alerts again. Never throws.
 */
export async function alertMembershipReadDenied(sb: Pick<SupabaseClient, "from">, a: MembershipDeniedAlert): Promise<{ alerted: boolean }> {
  const cause = a.noKey ? "no_key" : `http_${a.status}`;
  const hour = a.now.toISOString().slice(0, 13);
  const claimKey = `${cause}:${hour}`;
  const summary = `Whop membership read ${a.noKey ? "has no API key" : `denied (HTTP ${a.status})`}: membership=${a.membershipId ?? "none"} ` +
    `payment=${a.paymentId ?? "none"} path=${a.path ?? "unknown"}; ${a.failClosed ? "delivery answered 503, Whop retries" : "fail-closed is off, resolution continues to email"}`;
  try {
    const { data: claim, error: claimErr } = await sb
      .from("processed_webhook_events")
      .insert({ provider: MEMBERSHIP_DENIED_CLAIM_PROVIDER, event_id: claimKey, payload: { claimed_at: a.now.toISOString() } })
      .select("event_id")
      .maybeSingle();
    if (claimErr) {
      if ((claimErr as { code?: string }).code === "23505") return { alerted: false };
      Sentry.captureMessage(`${summary}; alert claim failed: ${String(claimErr.message ?? "").slice(0, 120)}`, "error");
      return { alerted: false };
    }
    if (!claim) return { alerted: false };
    const { error: rowErr } = await sb.from("user_events").insert({
      user_id: ALERT_USER_BUCKET,
      event_type: MEMBERSHIP_DENIED_EVENT,
      event_data: {
        cause,
        status: a.status,
        membership_id: a.membershipId,
        payment_id: a.paymentId,
        path: a.path,
        fail_closed: a.failClosed,
        hour,
      },
    });
    if (rowErr) {
      const { error: freeErr } = await sb.from("processed_webhook_events").delete().eq("provider", MEMBERSHIP_DENIED_CLAIM_PROVIDER).eq("event_id", claimKey);
      Sentry.captureMessage(
        `${summary}; alert row not written: ${String(rowErr.message ?? "").slice(0, 120)}${freeErr ? "; alert claim stuck, this hour stays silent" : ""}`,
        "error"
      );
      return { alerted: false };
    }
    Sentry.captureMessage(summary, { level: "error", tags: { lib: "whop-buyer", cause, path: a.path ?? "unknown" } });
    return { alerted: true };
  } catch (err) {
    Sentry.captureMessage(`${summary}; alert threw: ${err instanceof Error ? err.message.slice(0, 120) : "unknown"}`, "error");
    return { alerted: false };
  }
}
