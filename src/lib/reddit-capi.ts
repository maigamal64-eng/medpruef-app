import crypto from "crypto";

/**
 * Reddit Conversions API (CAPI) v2 sender, server-side (2026-07-01 Reddit pivot).
 *
 * Endpoint: https://ads-api.reddit.com/api/v2.0/conversions/events/{PIXEL_ID}
 *   (the path id is the PIXEL id a2_j9ef7eziw829, NOT a separate account id).
 * Auth: `Authorization: Bearer [secret]`.
 *
 * DORMANT until REDDIT_CAPI_TOKEN is set (clean no-op, same discipline as the
 * pixel loaders). Fails-open, NEVER throws, so a CAPI hiccup can never break
 * signup or checkout. This is the consent-independent + ad-blocker-proof
 * complement to the client Reddit Pixel; the two are DEDUPED on a shared
 * `conversion_id` (Reddit drops the duplicate).
 *
 * Attribution: Reddit requires >= 1 signal per event. Strongest is the Reddit
 * click id (`rdt_cid`), captured from the ad landing URL; we also send hashed
 * email + ip + user_agent when available.
 *
 * REMAINING SETUP (when [name] provides the token, see the handoff):
 *   1. Set REDDIT_CAPI_TOKEN (server-only) in Vercel.
 *   2. Set REDDIT_CAPI_TEST_MODE=true, fire a test signup, confirm it lands in
 *      Reddit Events Manager Test Events, then set it false.
 *   3. Confirm field hashing (email is SHA-256 here; verify Reddit's current
 *      requirement for ip_address raw-vs-hashed against Test Events).
 */

const PIXEL_ID = process.env.NEXT_PUBLIC_REDDIT_PIXEL_ID;
const TOKEN = process.env.REDDIT_CAPI_TOKEN;
const TEST_MODE =
  (process.env.REDDIT_CAPI_TEST_MODE ?? "false").toLowerCase() === "true";

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
  /** Dedup key shared with the client pixel (e.g. the user id or Whop payment id). */
  conversionId: string;
  email?: string | null;
  ip?: string | null;
  userAgent?: string | null;
  /** rdt_cid from the ad landing URL (strongest attribution signal). */
  clickId?: string | null;
  externalId?: string | null;
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
    if (input.clickId) user.click_id = input.clickId;

    const body = {
      test_mode: TEST_MODE,
      events: [
        {
          event_at: new Date().toISOString(),
          event_type: { tracking_type: input.trackingType },
          user,
          event_metadata: {
            conversion_id: input.conversionId,
            ...(input.currency ? { currency: input.currency } : {}),
            ...(input.valueDecimal != null ? { value_decimal: input.valueDecimal } : {}),
            ...(input.itemCount != null ? { item_count: input.itemCount } : {}),
          },
        },
      ],
    };

    await fetch(`https://ads-api.reddit.com/api/v2.0/conversions/events/${PIXEL_ID}`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${TOKEN}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify(body),
    });
  } catch {
    /* CAPI must never block the app flow */
  }
}
