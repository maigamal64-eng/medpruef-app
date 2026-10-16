/**
 * a-tg-checkout-context: where a checkout was opened from (server-safe, pure).
 *
 * The client sends one enum value in the checkout POST body of
 * /api/whop/checkout, /api/whop/trial and /api/mentor/checkout. The server
 * keeps it only when it is one of these four values and writes it into the
 * metadata of the existing `checkout_session_created` payment event (no new
 * column). It is counts-only and client-asserted: never authorization, never
 * a price or access decision. An unknown or missing value is dropped
 * silently, so an old tab keeps working.
 *
 *   tg_webapp  Telegram Mini App (tgWebAppData seen in this tab, or /tg-welcome)
 *   tg_inapp   Telegram's in-app browser (user agent only, best effort)
 *   pwa        installed app (display-mode standalone)
 *   browser    everything else
 *
 * TG_CHECKOUT_OPENLINK_ENABLED (server env, default off; next.config.ts
 * mirrors it into NEXT_PUBLIC_TG_CHECKOUT_OPENLINK at build) turns on the
 * Telegram.WebApp.openLink hand-off, the `via=tg_webapp` return hint on the
 * Whop redirect URL and the sessionless return state of the success pages.
 */

export const CHECKOUT_CONTEXTS = ["tg_webapp", "tg_inapp", "pwa", "browser"] as const;
export type CheckoutContext = (typeof CHECKOUT_CONTEXTS)[number];

/** The enum value, or null for anything else (dropped, never a 400). */
export function parseCheckoutContext(value: unknown): CheckoutContext | null {
  return typeof value === "string" && (CHECKOUT_CONTEXTS as readonly string[]).includes(value)
    ? (value as CheckoutContext)
    : null;
}

/** `{ context }` to spread into payment-event metadata, or nothing. */
export function contextMetadata(value: unknown): { context: CheckoutContext } | Record<string, never> {
  const context = parseCheckoutContext(value);
  return context ? { context } : {};
}

/** Server runtime flag (the Whop redirect hint). */
export function tgCheckoutOpenLinkEnabled(): boolean {
  return process.env.TG_CHECKOUT_OPENLINK_ENABLED === "true";
}

/** Client build mirror (openLink hand-off, SDK on the purchase page, sessionless return state). */
export const TG_CHECKOUT_OPENLINK_BUILD = process.env.NEXT_PUBLIC_TG_CHECKOUT_OPENLINK === "true";

/** Query parameter the success pages read to name the app the learner started in. */
export const RETURN_HINT_PARAM = "via";

/**
 * Appends `via=tg_webapp` to a Whop redirect URL only when the flag is on
 * and the checkout came from the Mini App; otherwise the URL is unchanged.
 */
export function withReturnHint(url: string, context: unknown, enabled = tgCheckoutOpenLinkEnabled()): string {
  if (!enabled || parseCheckoutContext(context) !== "tg_webapp") return url;
  return `${url}${url.includes("?") ? "&" : "?"}${RETURN_HINT_PARAM}=tg_webapp`;
}

/** The only accepted hint; anything else reads as no hint. */
export function parseReturnHint(value: string | null | undefined): "tg_webapp" | null {
  return value === "tg_webapp" ? "tg_webapp" : null;
}

/** Hard-coded way back into Telegram (the bot chat holds the Mini App button). Never taken from a URL. */
export const TELEGRAM_RETURN_URL = "https://t.me/MedPruefBot";
