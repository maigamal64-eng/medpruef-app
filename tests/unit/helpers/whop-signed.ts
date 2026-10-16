/**
 * Signed Whop v1 deliveries for route tests (a-whop-webhook-ack). The webhook
 * accepts only the Standard Webhooks HMAC keyed by WHOP_WEBHOOK_SECRET_V1, so
 * every test request is signed the way Whop signs it:
 * base64(HMAC-SHA256(key, `${id}.${timestamp}.${body}`)) in `webhook-signature`.
 */
import crypto from "node:crypto";

export const TEST_WHOP_V1_HEX = "5e1f0c2d3b4a69788796a5b4c3d2e1f00f1e2d3c4b5a69788796a5b4c3d2e1f0";
export const TEST_WHOP_V1_SECRET = `ws_${TEST_WHOP_V1_HEX}`;

let counter = 0;

/** Standard Webhooks headers for one body, signed with the test V1 secret. */
export function whopSignedHeaders(body: string, opts: { id?: string; timestampSec?: number; keyHex?: string } = {}): Record<string, string> {
  counter += 1;
  const id = opts.id ?? `msg_test_${counter}`;
  const ts = String(opts.timestampSec ?? Math.floor(Date.now() / 1000));
  const sig = crypto.createHmac("sha256", Buffer.from(opts.keyHex ?? TEST_WHOP_V1_HEX, "hex")).update(`${id}.${ts}.${body}`).digest("base64");
  return { "content-type": "application/json", "webhook-id": id, "webhook-timestamp": ts, "webhook-signature": `v1,${sig}` };
}

/** `{ headers, body }` for a NextRequest init. */
export function whopSigned(body: string): { headers: Record<string, string>; body: string } {
  return { headers: whopSignedHeaders(body), body };
}

/** Production shape after this change: only the V1 secret is set. */
export function useWhopV1Secret(): void {
  process.env.WHOP_WEBHOOK_SECRET_V1 = TEST_WHOP_V1_SECRET;
  delete process.env.WHOP_WEBHOOK_SECRET;
}
