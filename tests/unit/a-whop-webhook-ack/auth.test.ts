/**
 * a-whop-webhook-ack (G4): the Whop webhook accepts only the v1 Standard
 * Webhooks HMAC. The legacy static `webhook-secret` header is never read as a
 * credential, and WHOP_WEBHOOK_SECRET is not needed.
 */
import fs from "node:fs";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";
import { createFakeSupabase, type FakeResult } from "../helpers/fake-supabase";
import { TEST_WHOP_V1_SECRET, useWhopV1Secret, whopSignedHeaders } from "../helpers/whop-signed";

const h = vi.hoisted(() => ({ logWebhookAttempt: vi.fn(), logPaymentEvent: vi.fn() }));
vi.mock("@sentry/nextjs", () => ({ captureMessage: vi.fn(), captureException: vi.fn() }));
vi.mock("@/lib/webhook-logger", () => ({ logWebhookAttempt: h.logWebhookAttempt }));
vi.mock("@/lib/paymentEvents", () => ({ logPaymentEvent: h.logPaymentEvent }));
vi.mock("@/lib/reddit-capi", () => ({ sendRedditConversion: vi.fn() }));
vi.mock("@/lib/email/zoho", () => ({ sendZohoEmail: vi.fn() }));
vi.mock("@/lib/supabase", () => ({
  getServiceClient: () => createFakeSupabase(() => ({}) as FakeResult).sb,
}));

import { POST } from "@/app/api/webhooks/whop/route";
import * as whop from "@/lib/whop";

const URL_ = "https://medpruf.com/api/webhooks/whop";
// An event the route acknowledges without touching money, so the test sees
// only the auth decision.
const body = JSON.stringify({ type: "payment.created", data: { id: "evt_x" } });

function post(headers: Record<string, string>, raw = body) {
  return POST(new NextRequest(URL_, { method: "POST", headers: { "content-type": "application/json", ...headers }, body: raw }));
}

beforeEach(() => {
  useWhopV1Secret();
  h.logWebhookAttempt.mockReset();
  h.logPaymentEvent.mockReset();
});
afterEach(() => {
  delete process.env.WHOP_WEBHOOK_SECRET;
  delete process.env.WHOP_WEBHOOK_SECRET_V1;
});

describe("Whop webhook auth (v1 HMAC only)", () => {
  it("accepts a signed v1 delivery with WHOP_WEBHOOK_SECRET unset", async () => {
    expect(process.env.WHOP_WEBHOOK_SECRET).toBeUndefined();
    const res = await post(whopSignedHeaders(body));
    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({ ok: true });
  });

  it("refuses a forged legacy webhook-secret header with 401, even when it equals a configured secret", async () => {
    process.env.WHOP_WEBHOOK_SECRET = "ws_known_legacy_value";
    for (const value of ["ws_known_legacy_value", "known_legacy_value", TEST_WHOP_V1_SECRET]) {
      const res = await post({ "webhook-secret": value });
      expect(res.status).toBe(401);
    }
    expect(h.logWebhookAttempt).toHaveBeenCalledWith(expect.objectContaining({
      result: "sig_invalid", error: "legacy webhook-secret header is no longer accepted",
    }));
  });

  it("refuses the legacy header with 401 when WHOP_WEBHOOK_SECRET is unset", async () => {
    const res = await post({ "webhook-secret": TEST_WHOP_V1_SECRET });
    expect(res.status).toBe(401);
  });

  it("refuses a body that does not match its signature", async () => {
    const headers = whopSignedHeaders(body);
    const res = await post(headers, body.replace("evt_x", "evt_y"));
    expect(res.status).toBe(401);
    // computePaymentHealth alarms on this prefix (money-rules SECRET_MISMATCH_PREFIX).
    const logged = h.logWebhookAttempt.mock.calls[0][0] as { error: string };
    expect(logged.error.startsWith("verification failed despite")).toBe(true);
  });

  it("refuses a signature made with another key", async () => {
    const res = await post(whopSignedHeaders(body, { keyHex: "00".repeat(32) }));
    expect(res.status).toBe(401);
  });

  it("refuses a replay older than 5 minutes", async () => {
    const res = await post(whopSignedHeaders(body, { timestampSec: Math.floor(Date.now() / 1000) - 600 }));
    expect(res.status).toBe(401);
  });

  it("refuses a body HMAC-signed with the leaked legacy WHOP_WEBHOOK_SECRET (the real G4 forgery)", async () => {
    const legacyHex = "ab".repeat(32);
    process.env.WHOP_WEBHOOK_SECRET = `ws_${legacyHex}`;
    const res = await post(whopSignedHeaders(body, { keyHex: legacyHex }));
    expect(res.status).toBe(401);
  });

  it("never falls back to WHOP_WEBHOOK_SECRET when the V1 secret is missing", async () => {
    delete process.env.WHOP_WEBHOOK_SECRET_V1;
    process.env.WHOP_WEBHOOK_SECRET = TEST_WHOP_V1_SECRET;
    expect((await post(whopSignedHeaders(body))).status).toBe(503);
  });

  it("answers 503 and logs it when no HMAC secret is configured", async () => {
    delete process.env.WHOP_WEBHOOK_SECRET_V1;
    const res = await post(whopSignedHeaders(body));
    expect(res.status).toBe(503);
    expect(h.logWebhookAttempt).toHaveBeenCalledWith(expect.objectContaining({ error: "WHOP_WEBHOOK_SECRET_V1 not configured" }));
  });

  it("the static-header verifier is gone from the library and the route", () => {
    expect((whop as Record<string, unknown>).verifyWhopSecretHeader).toBeUndefined();
    const route = fs.readFileSync(path.join(process.cwd(), "src/app/api/webhooks/whop/route.ts"), "utf8");
    expect(route).not.toContain("verifyWhopSecretHeader");
    expect(route).not.toMatch(/headers\.get\("webhook-secret"\)/);
  });
});
