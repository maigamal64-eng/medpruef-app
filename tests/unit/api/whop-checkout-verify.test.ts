import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";
import { createFakeSupabase } from "../helpers/fake-supabase";
const h = vi.hoisted(() => ({
  owner: { tier: "pro", role: "user", tier_expires_at: "2026-01-01T00:00:00Z", email: "synthetic@example.test" } as Record<string, unknown>,
  subs: [] as unknown[],
  events: [] as unknown[],
  fallbackRows: [] as unknown[],
  calls: [] as unknown[],
}));
const sentry = vi.hoisted(() => ({ captureMessage: vi.fn(), captureException: vi.fn() }));
vi.mock("@sentry/nextjs", () => sentry);
vi.mock("@/lib/paymentEvents", () => ({ logPaymentEvent: vi.fn(), hashEmail: vi.fn() }));
vi.mock("@/lib/reddit-capi", () => ({ sendRedditConversion: vi.fn() }));
vi.mock("@/lib/auth-guard", () => ({ requireUser: async () => ({ userId: "22222222-2222-4222-8222-222222222222" }) }));
vi.mock("@/lib/rate-limit", () => ({ checkRateLimit: () => ({ allowed: true }), rateKey: () => "synthetic", rateLimitHeaders: () => ({}) }));
vi.mock("@/lib/supabase", () => ({ getServiceClient: () => {
  const { sb, calls } = createFakeSupabase(c => {
    if (c.table === "users" && c.op === "select") return { data: c.single ? h.owner : [{ id: "22222222-2222-4222-8222-222222222222" }] };
    if (c.table === "users" && c.op === "update") { h.owner = { ...h.owner, ...(c.payload as object) }; return { data: { id: "22222222-2222-4222-8222-222222222222" } }; }
    if (c.table === "subscriptions" && c.op === "select") return { data: h.subs };
    if (c.table === "subscriptions" && c.op === "insert") return { data: { id: "sub_synthetic" } };
    if (c.table === "processed_webhook_events" && c.op === "insert") return { data: { event_id: (c.payload as { event_id: string }).event_id } };
    // Step 3b reads webhook_received rows; every other payment_events read gets h.events.
    if (c.table === "payment_events" && c.op === "select") {
      const ev = c.filters.find((f) => f.kind === "eq" && f.column === "event");
      return { data: ev?.value === "webhook_received" ? h.fallbackRows : h.events };
    }
    return {};
  });
  h.calls = calls;
  return sb;
} }));
import { POST } from "@/app/api/whop/checkout/verify/route";
import { hashEmail } from "@/lib/paymentEvents";
const req = () => new NextRequest("https://x/api/whop/checkout/verify", {method:"POST", body: JSON.stringify({tier:"first_month_19"})});
beforeEach(() => {
  delete process.env.WHOP_API_KEY; delete process.env.WHOP_APP_API_KEY;
  h.owner = { tier: "pro", role: "user", tier_expires_at: "2026-01-01T00:00:00Z", email: "synthetic@example.test" };
  h.subs = [];
  h.events = [];
  h.fallbackRows = [];
});
afterEach(() => { vi.unstubAllEnvs(); });
describe("checkout verify authoritative access", () => {
  it("does not report an expired Pro tier as an activated purchase", async () => {
    const body = await (await POST(req())).json();
    expect(body.granted).toBe(false);
  });
  it("repairs a previous subscription write before needing another provider lookup", async () => {
    h.owner.tier = "free";
    h.subs = [{ expires_at: "2031-01-01T00:00:00Z" }];
    const body = await (await POST(req())).json();
    expect(body.granted).toBe(true);
    expect(h.owner.tier).toBe("pro");
    expect(h.calls.some((c: unknown) => (c as {table:string;op:string}).table === "subscriptions" && (c as {op:string}).op !== "select")).toBe(false);
  });
  it("an extension is not granted until the end date moves past the previous end", async () => {
    vi.stubEnv("WHOP_EXTENSIONS_ENABLED", "true");
    const from = "2031-01-01T00:00:00.000Z";
    h.owner = { tier: "pro", role: "user", tier_expires_at: from, email: "synthetic@example.test" };
    h.subs = [{ expires_at: from }];
    const ext = () => new NextRequest("https://x/api/whop/checkout/verify", { method: "POST", body: JSON.stringify({ tier: "first_month_19", extends_from: from }) });
    expect(await (await POST(ext())).json()).toMatchObject({ granted: false, reason: "extension_pending" });
    h.owner.tier_expires_at = "2031-02-01T00:00:00.000Z";
    h.subs = [{ expires_at: "2031-02-01T00:00:00.000Z" }];
    expect(await (await POST(ext())).json()).toMatchObject({ granted: true, already: true });
  });
  it("ignores extends_from while WHOP_EXTENSIONS_ENABLED is off (default)", async () => {
    const from = "2031-01-01T00:00:00.000Z";
    h.owner = { tier: "pro", role: "user", tier_expires_at: from, email: "synthetic@example.test" };
    h.subs = [{ expires_at: from }];
    for (const flag of ["", "TRUE", "1"]) {
      vi.stubEnv("WHOP_EXTENSIONS_ENABLED", flag);
      const ext = new NextRequest("https://x/api/whop/checkout/verify", { method: "POST", body: JSON.stringify({ tier: "first_month_19", extends_from: from }) });
      expect(await (await POST(ext)).json()).toMatchObject({ granted: true, already: true });
    }
  });
  it("already:true says whether a grant landed after the latest checkout (receipt line on the success page)", async () => {
    h.owner = { tier: "pro", role: "user", tier_expires_at: "2031-01-01T00:00:00.000Z", email: "synthetic@example.test" };
    h.events = [{ event: "grant_succeeded" }, { event: "checkout_redirected" }];
    expect(await (await POST(req())).json()).toMatchObject({ granted: true, already: true, paid_after_checkout: true });
    h.events = [{ event: "checkout_redirected" }, { event: "grant_succeeded" }];
    expect(await (await POST(req())).json()).toMatchObject({ already: true, paid_after_checkout: false });
    h.events = [];
    expect(await (await POST(req())).json()).toMatchObject({ already: true, paid_after_checkout: false });
  });
});

// JAVASCRIPT-NEXTJS-19: the ledger scan pages by cursor, filters with plan_ids
// and never lets repeated rows or another plan's membership decide a grant.
describe("checkout verify ledger scan", () => {
  const PLAN = "plan_redacted4b0850d6";
  const recent = () => new Date(Date.now() - 3600_000).toISOString();
  const urls: string[] = [];
  function stubWhop(memberships: () => unknown, payments: () => unknown) {
    vi.stubGlobal("fetch", vi.fn(async (input: string) => {
      urls.push(input);
      const body = input.includes("/memberships") ? memberships() : payments();
      return new Response(JSON.stringify(body), { status: 200 });
    }));
  }
  beforeEach(() => {
    urls.length = 0;
    sentry.captureMessage.mockClear();
    vi.stubEnv("WHOP_API_KEY", "k_synthetic");
    vi.stubEnv("WHOP_PLAN_FIRST_MONTH_19", PLAN);
    vi.stubEnv("WHOP_COMPANY_ID", "biz_synthetic");
    h.owner = { tier: "free", role: "user", tier_expires_at: null, email: "synthetic@example.test" };
  });
  afterEach(() => { vi.unstubAllGlobals(); });

  it("one membership repeated on every page is one email candidate, never email_ambiguous; no paid row yet stays pending", async () => {
    const copy = { id: "mem_redacted1d1a3c26", status: "active", plan: { id: PLAN }, member: { email: "Synthetic@Example.test" }, created_at: recent() };
    stubWhop(
      () => ({ data: [copy, { ...copy }], page_info: { end_cursor: "c1", has_next_page: true }, total_count: 1 }),
      () => ({ data: [], page_info: { end_cursor: null, has_next_page: false }, total_count: 0 }),
    );
    const body = await (await POST(req())).json();
    // Whop shows the buyer's valid membership: never a verified absence.
    expect(body).toMatchObject({ granted: false, reason: "payment_not_found", settled: false });
    expect(urls.some((u) => u.includes("/payments"))).toBe(true);
    const messages = sentry.captureMessage.mock.calls.map((c) => String(c[0]));
    expect(messages.some((m) => m.includes("email_ambiguous") || m.includes("ambiguous"))).toBe(false);
    expect(messages.some((m) => m.includes("whop_ledger_truncated"))).toBe(false);
    const membershipUrls = urls.filter((u) => u.includes("/memberships")).map((u) => new URL(u));
    expect(membershipUrls.length).toBeGreaterThan(0);
    for (const u of membershipUrls) {
      expect(u.searchParams.get("plan_ids")).toBe(PLAN);
      expect(u.searchParams.has("plan_id")).toBe(false);
      expect(u.searchParams.has("page")).toBe(false);
    }
  });

  it("a membership on another plan (e.g. the trial) never stands in for the paid tier", async () => {
    stubWhop(
      () => ({ data: [{ id: "mem_redacted2888d38f", status: "trialing", plan: { id: "plan_synthetic_trial" }, metadata: { medpruef_user_id: "22222222-2222-4222-8222-222222222222" }, member: { email: "other@example.test" }, created_at: recent() }], page_info: { end_cursor: "c1", has_next_page: false } }),
      () => ({ data: [{ id: "pay_redactedfb4d6557", status: "paid", member: { id: "mem_redacted2888d38f" }, created_at: recent() }], page_info: { end_cursor: "c1", has_next_page: false } }),
    );
    const body = await (await POST(req())).json();
    expect(body).toMatchObject({ granted: false, reason: "membership_not_found" });
    expect(h.calls.some((c: unknown) => (c as { table: string; op: string }).table === "subscriptions" && (c as { op: string }).op !== "select")).toBe(false);
  });

  it("a failed payments read in the email fallback is not a verified absence", async () => {
    vi.stubGlobal("fetch", vi.fn(async (input: string) => input.includes("/memberships")
      ? new Response(JSON.stringify({ data: [{ id: "mem_redacted9f704f00", status: "active", plan: { id: PLAN }, member: { email: "synthetic@example.test" }, created_at: recent() }], page_info: { end_cursor: "c", has_next_page: false } }), { status: 200 })
      : new Response("{}", { status: 502 })));
    expect(await (await POST(req())).json()).toMatchObject({ granted: false, reason: "payment_not_found", settled: false });
  });

  it("a membership row without a plan is not trusted for the tier", async () => {
    stubWhop(
      () => ({ data: [{ id: "mem_redacted302e5f5e", status: "active", metadata: { medpruef_user_id: "22222222-2222-4222-8222-222222222222" }, member: { email: "other@example.test" }, created_at: recent() }], page_info: { end_cursor: "c", has_next_page: false } }),
      () => ({ data: [], page_info: { end_cursor: "c", has_next_page: false } }),
    );
    expect(await (await POST(req())).json()).toMatchObject({ granted: false, reason: "membership_not_found" });
  });

  it("matches a payment to the membership by membership.id, not the mber_ member id", async () => {
    stubWhop(
      () => ({ data: [{ id: "mem_redacted17d58a64", status: "active", plan: { id: PLAN }, metadata: { medpruef_user_id: "22222222-2222-4222-8222-222222222222" }, created_at: recent() }], page_info: { end_cursor: "c", has_next_page: false } }),
      () => ({ data: [{ id: "pay_redacted2a2fce61", status: "paid", member: { id: "mber_synthetic05" }, membership: { id: "mem_redacted17d58a64" }, created_at: recent() }], page_info: { end_cursor: "c", has_next_page: false } }),
    );
    await POST(req());
    // The payment was recognised: the route went on to claim its id.
    expect(h.calls.some((c: unknown) => (c as { table: string; op: string }).table === "processed_webhook_events" && (c as { op: string }).op === "insert")).toBe(true);
  });

  it("a paid row that Whop marks refunded is not granted", async () => {
    stubWhop(
      () => ({ data: [{ id: "mem_redactede310132e", status: "active", plan: { id: PLAN }, metadata: { medpruef_user_id: "22222222-2222-4222-8222-222222222222" }, created_at: recent() }], page_info: { end_cursor: "c", has_next_page: false } }),
      () => ({ data: [{ id: "pay_redacted73aa15e0", status: "paid", refunded_amount: 19, membership: { id: "mem_redactede310132e" }, created_at: recent() }], page_info: { end_cursor: "c", has_next_page: false } }),
    );
    expect(await (await POST(req())).json()).toMatchObject({ granted: false, reason: "payment_not_found", settled: false });
    expect(h.calls.some((c: unknown) => (c as { table: string; op: string }).table === "processed_webhook_events" && (c as { op: string }).op === "insert")).toBe(false);
  });
});

// a-whop-verify-fallback-guard (Whop review 16 Oct, G1): step 3b grants only
// from a payment.succeeded delivery with a pay_ id that Whop's own payment
// record confirms (paid, not refunded, this tier's plan). Rows the webhook
// writes for every other delivery never grant, whatever their amount.
describe("checkout verify step 3b payment_events fallback", () => {
  const PLAN = "plan_redacted4b0850d6";
  const recent = () => new Date(Date.now() - 3600_000).toISOString();
  const reads: string[] = [];
  let paymentRead: (id: string) => Response;
  const claims = () => h.calls.filter((c: unknown) => (c as { table: string; op: string }).table === "processed_webhook_events" && (c as { op: string }).op === "insert");
  const subscriptionWrites = () => h.calls.filter((c: unknown) => (c as { table: string; op: string }).table === "subscriptions" && (c as { op: string }).op !== "select");
  const row = (whopEvent: string, paymentId: string, extra: Record<string, unknown> = {}) => ({
    id: 900 + reads.length + Math.floor(Math.random() * 1000),
    event: "webhook_received",
    payment_id: paymentId,
    tier: null,
    amount_cents: 1900,
    metadata: { event: whopEvent, whop_event: whopEvent },
    created_at: recent(),
    ...extra,
  });
  const paid = (id: string, extra: Record<string, unknown> = {}) =>
    new Response(JSON.stringify({ id, status: "paid", plan: { id: PLAN }, membership: { id: "mem_redactedd933c8f5" }, final_amount: 19, currency: "eur", created_at: recent(), ...extra }), { status: 200 });

  beforeEach(() => {
    reads.length = 0;
    sentry.captureMessage.mockClear();
    vi.mocked(hashEmail).mockReturnValue("hash_synthetic");
    vi.stubEnv("WHOP_API_KEY", "k_synthetic");
    vi.stubEnv("WHOP_PLAN_FIRST_MONTH_19", PLAN);
    vi.stubEnv("WHOP_COMPANY_ID", "biz_synthetic");
    h.owner = { tier: "free", role: "user", tier_expires_at: null, email: "synthetic@example.test" };
    paymentRead = (id) => paid(id);
    vi.stubGlobal("fetch", vi.fn(async (input: string) => {
      const single = /\/payments\/(pay_[A-Za-z0-9_]+)/.exec(input);
      if (single) {
        reads.push(single[1]);
        return paymentRead(single[1]);
      }
      // Memberships and the payments list are empty: 3a has no candidate.
      return new Response(JSON.stringify({ data: [], page_info: { end_cursor: null, has_next_page: false }, total_count: 0 }), { status: 200 });
    }));
  });
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.mocked(hashEmail).mockReset();
  });

  it("asks the database only for payment.succeeded rows with a pay_ id", async () => {
    await POST(req());
    const q = h.calls.find((c: unknown) => {
      const call = c as { table: string; filters: Array<{ kind: string; column: string; value: unknown }> };
      return call.table === "payment_events" && call.filters.some((f) => f.column === "event" && f.value === "webhook_received");
    }) as { filters: Array<{ kind: string; column: string; value: unknown }> } | undefined;
    expect(q).toBeDefined();
    expect(q!.filters).toEqual(expect.arrayContaining([
      { kind: "eq", column: "metadata->>whop_event", value: "payment.succeeded" },
      { kind: "like", column: "payment_id", value: "pay_%" },
    ]));
  });

  for (const [whopEvent, paymentId] of [
    ["payment.failed", "pay_synthfailed"],
    ["refund.created", "ref_synthrefund"],
    ["refund.created", "pay_synthrefund"],
    ["dispute.created", "pay_synthdispute"],
    ["membership.went_valid", "mem_synthvalid"],
    ["membership.deactivated", "mem_synthdeact"],
    ["payment.pending", "pay_synthpending"],
  ] as const) {
    it(`a ${whopEvent} row (${paymentId.slice(0, 4)}) with the plan's amount grants nothing`, async () => {
      h.fallbackRows = [row(whopEvent, paymentId)];
      const body = await (await POST(req())).json();
      expect(body.granted).toBe(false);
      expect(reads).toEqual([]);
      expect(claims()).toEqual([]);
      expect(subscriptionWrites()).toEqual([]);
    });
  }

  it("a payment.succeeded row for another tier grants nothing (no amount-only match)", async () => {
    h.fallbackRows = [row("payment.succeeded", "pay_synthother", { tier: "premium_pass_guaranteed", amount_cents: 1900 })];
    const body = await (await POST(req())).json();
    expect(body.granted).toBe(false);
    expect(reads).toEqual([]);
    expect(claims()).toEqual([]);
  });

  it("a payment.succeeded row that Whop confirms (paid, this plan) grants and pins the membership", async () => {
    h.fallbackRows = [row("payment.succeeded", "pay_synthok")];
    const body = await (await POST(req())).json();
    expect(reads).toEqual(["pay_synthok"]);
    expect(claims()).toHaveLength(1);
    expect((claims()[0] as { payload: { event_id: string } }).payload.event_id).toBe("pay_synthok");
    expect(body).toMatchObject({ granted: true, payment_ref: "pay_synthok" });
    const write = subscriptionWrites()[0] as { payload: Record<string, unknown> } | undefined;
    expect(write?.payload).toMatchObject({ whop_membership_id: "mem_redactedd933c8f5" });
  });

  it("a row with the requested tier set still needs the re-read and grants once confirmed", async () => {
    h.fallbackRows = [row("payment.succeeded", "pay_synthtier", { tier: "first_month_19" })];
    expect(await (await POST(req())).json()).toMatchObject({ granted: true });
    expect(reads).toEqual(["pay_synthtier"]);
  });

  for (const [label, response, cause] of [
    ["status pending", (id: string) => paid(id, { status: "pending" }), "fallback_not_paid"],
    ["status failed", (id: string) => paid(id, { status: "failed" }), "fallback_not_paid"],
    ["a refunded amount", (id: string) => paid(id, { refunded_amount: 19 }), "fallback_refunded"],
    ["a refunded status", (id: string) => paid(id, { status: "refunded" }), "fallback_refunded"],
    ["another plan", (id: string) => paid(id, { plan: { id: "plan_synthetic_trial" } }), "fallback_plan_mismatch"],
    ["no plan", (id: string) => paid(id, { plan: null }), "fallback_plan_mismatch"],
    ["another account in its metadata", (id: string) => paid(id, { metadata: { medpruef_user_id: "33333333-3333-4333-8333-333333333333" } }), "fallback_other_account"],
    ["HTTP 500", () => new Response("{}", { status: 500 }), "fallback_reread_failed"],
    ["HTTP 403", () => new Response("{}", { status: 403 }), "fallback_reread_failed"],
    ["another payment id", () => paid("pay_synthsomeoneelse"), "fallback_reread_failed"],
  ] as const) {
    it(`a payment.succeeded row grants nothing when Whop's record shows ${label}`, async () => {
      h.fallbackRows = [row("payment.succeeded", "pay_synthrefused")];
      paymentRead = response as (id: string) => Response;
      const body = await (await POST(req())).json();
      expect(reads).toEqual(["pay_synthrefused"]);
      expect(body).toMatchObject({ granted: false, reason: "payment_unmatched", payment_ref: "pay_synthrefused" });
      expect(claims()).toEqual([]);
      expect(subscriptionWrites()).toEqual([]);
      const messages = sentry.captureMessage.mock.calls.map((c) => String(c[0]));
      expect(messages.some((m) => m.includes(cause.replace("fallback_", "")))).toBe(true);
    });
  }

  it("re-reads at most three candidates; a confirmed fourth is never reached", async () => {
    h.fallbackRows = ["pay_a1", "pay_a2", "pay_a3", "pay_a4"].map((id) => row("payment.succeeded", id));
    paymentRead = (id) => (id === "pay_a4" ? paid(id) : paid(id, { status: "failed" }));
    const body = await (await POST(req())).json();
    expect(reads).toEqual(["pay_a1", "pay_a2", "pay_a3"]);
    expect(body).toMatchObject({ granted: false, reason: "payment_unmatched" });
    expect(claims()).toEqual([]);
  });

  it("a failed row next to a confirmed succeeded row grants only the succeeded payment", async () => {
    h.fallbackRows = [row("payment.failed", "pay_synthdecl"), row("payment.succeeded", "pay_synthgood")];
    const body = await (await POST(req())).json();
    expect(reads).toEqual(["pay_synthgood"]);
    expect(body).toMatchObject({ granted: true, payment_ref: "pay_synthgood" });
  });
});
