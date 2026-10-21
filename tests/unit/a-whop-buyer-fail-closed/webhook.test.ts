/**
 * a-whop-buyer-fail-closed (Whop review G10, G16): with WHOP_BUYER_FAIL_CLOSED
 * on, a 401/403 from GET /memberships/{id} on the grant and revoke paths
 * answers 503, grants or revokes nothing, releases the payment claim and
 * raises one alert row per hour. A payload with no membership id still
 * resolves by email. Dunning links use the membership's manage_url, else the
 * buyer's Whop memberships page.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";
import { whopSignedHeaders, useWhopV1Secret } from "../helpers/whop-signed";
import { createFakeSupabase, eqVal, type FakeCall, type FakeResult } from "../helpers/fake-supabase";

vi.mock("@sentry/nextjs", () => ({ captureMessage: vi.fn(), captureException: vi.fn() }));
vi.mock("@/lib/webhook-logger", () => ({ logWebhookAttempt: vi.fn() }));
vi.mock("@/lib/paymentEvents", () => ({ logPaymentEvent: vi.fn() }));
vi.mock("@/lib/reddit-capi", () => ({ sendRedditConversion: vi.fn() }));
const mail = vi.hoisted(() => ({ send: vi.fn() }));
vi.mock("@/lib/email/zoho", () => ({ sendZohoEmail: mail.send }));
// release-int-8: a-whop-webhook-ack sends the dunning mail after the response; run deferred work inline here.
vi.mock("@/lib/after-response", () => ({ afterResponse: vi.fn(async (_label: string, task: () => Promise<void>) => { await task(); }) }));
vi.mock("@/lib/referral-exam-reward", () => ({ qualifyReferralOnActivity: vi.fn(), isReferralExamRewardEnabled: () => false }));

const USER = "573a6d8c-7871-4c77-8b88-d0748b7f4785";
const PAYER = "3e814abc-3c3f-4ef3-b55a-9f03b63a5841";

const store = vi.hoisted(() => ({ calls: [] as unknown[], claims: new Set<string>(), activeSubs: [] as unknown[], failRelease: false }));
vi.mock("@/lib/supabase", () => ({
  getServiceClient: () => {
    const { sb } = createFakeSupabase((c: FakeCall): FakeResult | undefined => {
      store.calls.push(c);
      if (c.table === "processed_webhook_events" && c.op === "insert") {
        const p = c.payload as { provider: string; event_id: string };
        const key = `${p.provider}:${p.event_id}`;
        if (store.claims.has(key)) return { error: { code: "23505", message: "duplicate key" } };
        store.claims.add(key);
        return { data: { event_id: p.event_id } };
      }
      if (c.table === "processed_webhook_events" && c.op === "delete") {
        if (store.failRelease) return { error: { message: "timeout" } };
        store.claims.delete(`${eqVal(c, "provider")}:${eqVal(c, "event_id")}`);
        return { data: null };
      }
      if (c.table === "processed_webhook_events" && c.op === "select") return { data: null };
      // a-intercom-into-n2n3-1021: the dunning mail reads the do-not-email list first.
      if (c.table === "mail_suppression" && c.op === "select") return { data: [] };
      if (c.table === "users" && c.op === "select") {
        const id = eqVal(c, "id") as string | undefined;
        if (id === USER || id === PAYER) {
          return { data: { id, tier: "free", tier_expires_at: null, role: "user", email: id === PAYER ? "payer@example.com" : "learner@example.test", first_name: "L", language_code: "de" } };
        }
        if (c.filters.some((f) => f.kind === "ilike")) return { data: [{ id: PAYER }] };
        return { data: null };
      }
      if (c.table === "subscriptions" && c.op === "select") return { data: store.activeSubs };
      if (c.table === "subscriptions" && c.op === "insert") return { data: { id: "sub_new" } };
      if (c.table === "payment_events" && c.op === "select") return { data: [] };
      if (c.table === "user_events" && c.op === "select") return { data: [] };
      return {};
    });
    return sb;
  },
}));

import { POST } from "@/app/api/webhooks/whop/route";
import { logPaymentEvent } from "@/lib/paymentEvents";

const calls = () => store.calls as FakeCall[];
const grants = () => calls().filter((c) => (c.table === "subscriptions" && c.op !== "select") || (c.table === "users" && c.op === "update"));
const deniedRows = () => calls().filter((c) => c.table === "user_events" && c.op === "insert" && (c.payload as { event_type: string }).event_type === "whop_membership_read_denied");
const membershipReads = () => vi.mocked(fetch).mock.calls.filter(([u]) => String(u).includes("/api/v1/memberships/"));

function deliver(action: string, data: Record<string, unknown>) {
  return POST(new NextRequest("https://medpruf.com/api/webhooks/whop", {
    method: "POST",
    headers: whopSignedHeaders(JSON.stringify({ action, data })),
    body: JSON.stringify({ action, data }),
  }));
}

// An unpinned renewal: membership id, null metadata, no checkout tie, the payer's email.
const renewal = (id: string, extra: Record<string, unknown> = {}) => ({
  id, billing_reason: "subscription_cycle", plan: { id: "plan_m19" }, membership: { id: "mem_UNPINNED" },
  user: { email: "payer@example.com" }, metadata: null, final_amount: 19, amount_after_fees: 17.72, currency: "eur", ...extra,
});

function membershipStatus(status: number, body: Record<string, unknown> = {}) {
  vi.stubGlobal("fetch", vi.fn(async (url: unknown) =>
    String(url).includes("/api/v1/memberships/") ? new Response(JSON.stringify(body), { status }) : new Response("{}", { status: 404 })));
}

beforeEach(() => {
  useWhopV1Secret();
  process.env.WHOP_PLAN_FIRST_MONTH_19 = "plan_m19";
  process.env.WHOP_API_KEY = "test_key";
  store.calls = [];
  store.claims = new Set();
  store.activeSubs = [];
  store.failRelease = false;
  vi.mocked(logPaymentEvent).mockClear();
  mail.send.mockReset();
  mail.send.mockResolvedValue({ ok: true });
  membershipStatus(403);
});
afterEach(() => {
  vi.unstubAllGlobals();
  delete process.env.WHOP_BUYER_FAIL_CLOSED;
  delete process.env.WHOP_API_KEY;
});

describe("grant path, WHOP_BUYER_FAIL_CLOSED=true", () => {
  beforeEach(() => { process.env.WHOP_BUYER_FAIL_CLOSED = "true"; });

  for (const status of [401, 403]) {
    it(`membership read ${status}: 503, no grant, claim released, one alert row`, async () => {
      membershipStatus(status);
      const res = await deliver("payment.succeeded", renewal(`pay_d${status}`));
      expect(res.status).toBe(503);
      expect(grants()).toEqual([]);
      expect(store.claims.has(`whop:pay_d${status}`)).toBe(false);
      expect(deniedRows()).toHaveLength(1);
      expect((deniedRows()[0].payload as { event_data: Record<string, unknown> }).event_data).toMatchObject({
        cause: `http_${status}`, path: "grant", payment_id: `pay_d${status}`, membership_id: "mem_UNPINNED", fail_closed: true,
      });
      // The payer-email account was never looked up.
      expect(calls().some((c) => c.table === "users" && c.filters.some((f) => f.kind === "ilike"))).toBe(false);
    });
  }

  it("the release is logged as membership_read_denied, not a database fault", async () => {
    await deliver("payment.succeeded", renewal("pay_reason"));
    const rows = vi.mocked(logPaymentEvent).mock.calls.map((c) => c[1]).filter((e) => e.event === "grant_failed");
    expect(rows.map((r) => r.reason)).toEqual(["membership_read_denied"]);
  });

  it("a claim that cannot be released is logged as claim_stranded (Sentry error), still 503 and no grant", async () => {
    store.failRelease = true;
    const res = await deliver("payment.succeeded", renewal("pay_stuck"));
    expect(res.status).toBe(503);
    expect(grants()).toEqual([]);
    const rows = vi.mocked(logPaymentEvent).mock.calls.map((c) => c[1]).filter((e) => e.event === "grant_failed");
    expect(rows).toEqual([expect.objectContaining({ reason: "claim_stranded", paymentId: "pay_stuck" })]);
  });

  it("dunning with a 403 read and no other tie: 503, no email sent, no recover claim taken", async () => {
    const res = await deliver("payment.failed", { ...renewal("pay_dun403"), status: "open", recovery_url: null });
    expect(res.status).toBe(503);
    expect(mail.send).not.toHaveBeenCalled();
    expect([...store.claims].some((k) => k.startsWith("whop:recover:"))).toBe(false);
    expect((deniedRows()[0].payload as { event_data: { path: string } }).event_data.path).toBe("recovery");
  });

  it("Whop's redelivery in the same hour is processed again (claim was free) and does not alert twice; it grants once the key can read", async () => {
    expect((await deliver("payment.succeeded", renewal("pay_retry"))).status).toBe(503);
    expect((await deliver("payment.succeeded", renewal("pay_retry"))).status).toBe(503);
    expect(deniedRows()).toHaveLength(1);
    expect(grants()).toEqual([]);
    // Key fixed: the membership carries the subscriber in its metadata.
    membershipStatus(200, { id: "mem_UNPINNED", metadata: { medpruef_user_id: USER }, manage_url: "https://whop.com/billing/manage/mem_UNPINNED" });
    const ok = await deliver("payment.succeeded", renewal("pay_retry"));
    expect(ok.status).toBe(200);
    expect(await ok.json()).toMatchObject({ activated: true });
    const insert = calls().find((c) => c.table === "subscriptions" && c.op === "insert");
    expect((insert!.payload as { user_id: string }).user_id).toBe(USER);
  });

  it("a readable membership with no tie is unmapped (manual link), never credited to the payer's email account", async () => {
    membershipStatus(200, { id: "mem_UNPINNED", metadata: {} });
    const res = await deliver("payment.succeeded", renewal("pay_notie"));
    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({ ok: false });
    expect(grants()).toEqual([]);
    expect(store.claims.has("whop:pay_notie")).toBe(true);
  });

  it("a payload without a membership id still resolves by email and grants", async () => {
    const res = await deliver("payment.succeeded", { ...renewal("pay_nomem"), membership: null, billing_reason: "subscription_create" });
    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({ activated: true });
    const insert = calls().find((c) => c.table === "subscriptions" && c.op === "insert");
    expect((insert!.payload as { user_id: string }).user_id).toBe(PAYER);
    expect(membershipReads()).toHaveLength(0);
  });
});

describe("grant path, flag off (default)", () => {
  it("a 403 keeps today's email fallback and grants, but records the denial", async () => {
    const res = await deliver("payment.succeeded", renewal("pay_off"));
    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({ activated: true });
    expect(deniedRows()).toHaveLength(1);
    expect((deniedRows()[0].payload as { event_data: { fail_closed: boolean } }).event_data.fail_closed).toBe(false);
  });
});

describe("revoke path, WHOP_BUYER_FAIL_CLOSED=true", () => {
  beforeEach(() => { process.env.WHOP_BUYER_FAIL_CLOSED = "true"; });

  it("membership.deactivated with a 403 read: 503, nothing revoked, the revoke receipt is not consumed", async () => {
    const res = await deliver("membership.deactivated", { id: "mem_UNPINNED", user: { email: "payer@example.com" } });
    expect(res.status).toBe(503);
    expect(calls().some((c) => c.table === "subscriptions" && c.op === "update")).toBe(false);
    expect(calls().some((c) => c.table === "users" && c.op === "update")).toBe(false);
    expect([...store.claims].some((k) => k.startsWith("whop:cancel:"))).toBe(false);
    expect((deniedRows()[0].payload as { event_data: { path: string } }).event_data.path).toBe("revoke");
  });
});

describe("dunning link (G16)", () => {
  const failed = (id: string) => ({ ...renewal(id), metadata: { medpruef_user_id: USER }, status: "open", recovery_url: null, member: { id: "mber_X" } });

  it("uses the Whop memberships page when resolution never read the membership API (payment metadata)", async () => {
    store.activeSubs = [];
    membershipStatus(200, { id: "mem_UNPINNED", metadata: {}, manage_url: "https://whop.com/billing/manage/mem_UNPINNED" });
    // No pin and only payment metadata: the API is not read, so the generic page is used.
    await deliver("payment.failed", failed("pay_f1"));
    const html = (mail.send.mock.calls[0][0] as { htmlBody: string }).htmlBody;
    expect(html).toContain("https://whop.com/@me/settings/memberships");
    expect(html).not.toContain("billing/manage/mber_");
  });

  it("links the manage_url read from Whop when resolution reached the membership API", async () => {
    membershipStatus(200, { id: "mem_UNPINNED", metadata: { medpruef_user_id: USER }, manage_url: "https://whop.com/billing/manage/mem_UNPINNED" });
    await deliver("payment.failed", { ...failed("pay_f2"), metadata: null });
    const html = (mail.send.mock.calls[0][0] as { htmlBody: string }).htmlBody;
    expect(html).toContain("https://whop.com/billing/manage/mem_UNPINNED");
  });

  it("drops a manage_url that is not an https whop.com link", async () => {
    membershipStatus(200, { id: "mem_UNPINNED", metadata: { medpruef_user_id: USER }, manage_url: "https://evil.example/whop" });
    await deliver("payment.failed", { ...failed("pay_f3"), metadata: null });
    const html = (mail.send.mock.calls[0][0] as { htmlBody: string }).htmlBody;
    expect(html).toContain("https://whop.com/@me/settings/memberships");
    expect(html).not.toContain("evil.example");
  });
});
