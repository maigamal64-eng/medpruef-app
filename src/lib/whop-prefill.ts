/**
 * a-whop-email-prefill: put the learner's own confirmed address into the
 * hosted Whop checkout link, so the page does not open on an empty email
 * field (checkout-drop audit: 10 of 12 unpaid openers never entered a card).
 *
 * Whop's public checkout_configurations API has no prefill field (request
 * body read 15 Oct 2026: affiliate_code, checkout_styling, currency,
 * metadata, payment_method_configuration, redirect_url, plan / plan_id,
 * mode). Whop documents `?email=` and `?name=` URL parameters for its
 * embedded checkout only; whether the hosted purchase_url honours `email` is
 * unverified, so this stays behind WHOP_CHECKOUT_PREFILL_ENABLED (server,
 * default off) until a staff checkout shows it on the Whop page.
 *
 * Rules:
 * - The Whop API request is never changed; only the URL handed back to the
 *   client carries the parameter. Every stored or logged copy stays the bare
 *   purchase_url (payment_events keeps email_hash only).
 * - Only the account's own address, only with users.email_verified_at set.
 * - Never throws, never logs the address or the prefilled URL.
 */

export function whopCheckoutPrefillEnabled(): boolean {
  return process.env.WHOP_CHECKOUT_PREFILL_ENABLED === "true";
}

export interface PrefillAccount {
  email?: string | null;
  email_verified_at?: string | null;
}

// Reserved and synthetic top-level names never reach a payment page.
const RESERVED_TLD = /\.(invalid|test|local|localhost|example)$/i;

/** The address to prefill, or null when it must not be used. */
export function prefillAddress(account: PrefillAccount | null | undefined): string | null {
  if (!account || !account.email_verified_at) return null;
  if (typeof account.email !== "string") return null;
  const email = account.email.trim();
  if (email.length < 3 || email.length > 254 || /\s/.test(email)) return null;
  const at = email.indexOf("@");
  if (at < 1 || at !== email.lastIndexOf("@")) return null;
  const domain = email.slice(at + 1);
  const dot = domain.lastIndexOf(".");
  if (dot < 1 || dot === domain.length - 1) return null;
  if (RESERVED_TLD.test(domain) || /^example\./i.test(domain)) return null;
  return email;
}

/**
 * The URL to return to the client: the bare purchase_url with `email` added,
 * or the bare URL unchanged when the flag is off, the address is not
 * confirmed, or the link is not an https Whop link.
 */
export function prefillCheckoutUrl(bareUrl: string, account: PrefillAccount | null | undefined): string {
  if (!whopCheckoutPrefillEnabled()) return bareUrl;
  const email = prefillAddress(account);
  if (!email) return bareUrl;
  try {
    const url = new URL(bareUrl);
    const host = url.hostname.toLowerCase();
    if (url.protocol !== "https:" || !(host === "whop.com" || host.endsWith(".whop.com"))) return bareUrl;
    url.searchParams.set("email", email);
    return url.toString();
  } catch {
    return bareUrl;
  }
}

type UsersReader = {
  from(table: "users"): {
    select(columns: string): {
      eq(column: string, value: string): {
        maybeSingle(): PromiseLike<{ data: unknown; error: unknown }>;
      };
    };
  };
};

/**
 * Reads the signed-in account's address and confirmation stamp, only while
 * the flag is on (flag off: no read at all). Any failure reads as "no
 * prefill"; nothing is logged.
 */
export async function loadPrefillAccount(sb: unknown, userId: string): Promise<PrefillAccount | null> {
  if (!whopCheckoutPrefillEnabled()) return null;
  try {
    const { data, error } = await (sb as UsersReader).from("users").select("email,email_verified_at").eq("id", userId).maybeSingle();
    if (error || !data || typeof data !== "object") return null;
    const row = data as { email?: unknown; email_verified_at?: unknown };
    return {
      email: typeof row.email === "string" ? row.email : null,
      email_verified_at: typeof row.email_verified_at === "string" ? row.email_verified_at : null,
    };
  } catch {
    return null;
  }
}
