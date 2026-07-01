import crypto from "crypto";

/**
 * Reddit Conversions API (CAPI) sender, server-side (2026-07-01 Reddit pivot).
 *
 * Built to Reddit's CURRENT v3 spec (confirmed against Events Manager's own
 * "Send to Developer" payload, 2026-07-01):
 *
 *   POST https://ads-api.reddit.com/api/v3/pixels/{PIXEL_ID}/conversion_events
 *   Authorization: Bearer {REDDIT_CAPI_TOKEN}
 *   {
 *     "data": { "events": [ {
 *       "event_at": <Unix epoch MILLISECONDS, <= 7 days old>,
 *       "action_source": "website",
 *       "type": { "tracking_type": "SignUp" },
 *       "click_id": "<rdt_cid>",              // event-level, optional
 *       "test_id": "<t2_...>",                // ONLY when validating; omit in prod
 *       "user": { "email": <sha256 lower>, "external_id", "ip_address", "user_agent" },
 *       "metadata": { "conversion_id": <dedup key>, "currency", "value", "item_count" }
 *     } ] }
 *   }
 *
 * DORMANT until REDDIT_CAPI_TOKEN is set (clean no-op). Fails-open, NEVER throws,
 * so a CAPI hiccup can't break signup/checkout. It is the consent-independent +
 * ad-blocker-proof complement to the client Reddit Pixel; the two are DEDUPED on
 * a shared `metadata.conversion_id` == the pixel's `conversionId` (Reddit drops
 * the duplicate within a 7-day window).
 *
 * TEST routing: set REDDIT_CAPI_TEST_ID to the id Reddit shows under Events
 * Manager → "Send test events" (e.g. t2_...). While set, every event carries
 * `test_id` and routes to Test Events instead of counting as a real conversion.
 * DELETE that env var to go live in production.
 *
 * ⚠️ 2026-07-01 token note: the first token [name] generated returned 401
 * UNAUTHORIZED on this exact endpoint AND on authenticated reads (verified via
 * curl + python) — i.e. Reddit rejected the token itself, not the request shape
 * (which matches the spec above). Fix is token-side: re-copy the FULL token
 * (it's ~820 chars — easy to truncate) or regenerate it in Events Manager, then
 * verify with the ready-to-run curl in the handoff before relying on it.
 */

const PIXEL_ID = process.env.NEXT_PUBLIC_REDDIT_PIXEL_ID;
const TOKEN = process.env.REDDIT_CAPI_TOKEN;
/** When set (a t2_... test id from Events Manager), events route to Test Events. Unset in prod. */
const TEST_ID = process.env.REDDIT_CAPI_TEST_ID || "";

function sha256(value: string): string {
  return crypto.createHash("sha256").update(value.trim().toLowerCase()).digest("hex");
}

export type RedditTrackingType =
  | "SignUp"
  | "Purchase"
  | "Lead"
  | "ViewContent"
  | "PageVisit";

export interface RedditConversionInput {
  trackingType: RedditTrackingType;
  /** Dedup key shared with the client pixel's `conversionId` (e.g. user id or Whop payment id). */
  conversionId: string;
  email?: string | null;
  ip?: string | null;
  userAgent?: string | null;
  /** rdt_cid from the ad landing URL (strongest attribution signal); event-level. */
  clickId?: string | null;
  externalId?: string | null;
  /** Maps to metadata.value (decimal), for Purchase events. */
  valueDecimal?: number | null;
  currency?: string;
  itemCount?: number | null;
}

/** True only when the token is provisioned; lets callers skip building inputs. */
export function isRedditCapiLive(): boolean {
  return Boolean(TOKEN && PIXEL_ID);
}

export async function sendRedditConversion(input: RedditConversionInput): Promise<void> {
  if (!TOKEN || !PIXEL_ID) return; // dormant until the token is provisioned

  try {
    const user: Record<string, unknown> = {};
    if (input.email) user.email = sha256(input.email);
    if (input.externalId) user.external_id = input.externalId;
    if (input.ip) user.ip_address = input.ip;
    if (input.userAgent) user.user_agent = input.userAgent;

    const metadata: Record<string, unknown> = { conversion_id: input.conversionId };
    if (input.currency) metadata.currency = input.currency;
    if (input.valueDecimal != null) metadata.value = input.valueDecimal;
    if (input.itemCount != null) metadata.item_count = input.itemCount;

    const event: Record<string, unknown> = {
      event_at: Date.now(), // Unix epoch MILLISECONDS (spec: must be <= 7 days old)
      action_source: "website",
      type: { tracking_type: input.trackingType },
      user,
      metadata,
    };
    if (input.clickId) event.click_id = input.clickId; // event-level, not inside user
    if (TEST_ID) event.test_id = TEST_ID; // routes to Test Events; omit in prod

    const res = await fetch(
      `https://ads-api.reddit.com/api/v3/pixels/${PIXEL_ID}/conversion_events`,
      {
        method: "POST",
        headers: {
          Authorization: `Bearer ${TOKEN}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ data: { events: [event] } }),
      },
    );

    // Fails-open (never throws), BUT a non-2xx must be VISIBLE. Otherwise a
    // schema/endpoint/token mismatch is silent during token-time validation:
    // you register, nothing appears in Reddit, and you have zero diagnostics.
    // Reddit's error body names the cause (e.g. UNAUTHORIZED = bad token) — log
    // it. In TEST mode, also log the accepted case so validation sees a positive.
    if (!res.ok) {
      const errBody = await res.text().catch(() => "<no body>");
      console.error(
        `[reddit-capi] ${input.trackingType} rejected: HTTP ${res.status} ${errBody}`,
      );
    } else if (TEST_ID) {
      console.log(
        `[reddit-capi] TEST ${input.trackingType} accepted (HTTP ${res.status}) — confirm in Reddit Events Manager → Test Events`,
      );
    }
  } catch (e) {
    // Network-level reject only (DNS/timeout); still never blocks the flow.
    console.error(
      `[reddit-capi] ${input.trackingType} send failed:`,
      e instanceof Error ? e.message : e,
    );
  }
}
