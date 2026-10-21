import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";
import { createFakeSupabase, eqVal, type FakeCall, type FakeResult } from "../helpers/fake-supabase";

const h = vi.hoisted(() => ({
  handler: (() => ({})) as (call: unknown) => unknown,
  sendZohoEmail: vi.fn(),
  calls: [] as unknown[],
}));

vi.mock("@sentry/nextjs", () => ({ captureMessage: vi.fn(), captureException: vi.fn() }));
vi.mock("@/lib/webhook-logger", () => ({ logWebhookAttempt: vi.fn() }));
vi.mock("@/lib/paymentEvents", () => ({ logPaymentEvent: vi.fn() }));
vi.mock("@/lib/reddit-capi", () => ({ sendRedditConversion: vi.fn() }));
vi.mock("@/lib/email/zoho", () => ({ sendZohoEmail: h.sendZohoEmail }));
vi.mock("@/lib/referral-exam-reward", () => ({
  qualifyReferralOnActivity: vi.fn(),
  isReferralExamRewardEnabled: () => true,
}));
vi.mock("@/lib/supabase", () => ({
  getServiceClient: () => {
    const { sb, calls } = createFakeSupabase((c) => h.handler(c) as FakeResult | undefined);
    // share the call log across every getServiceClient() instance
    const orig = sb.from;
    sb.from = (t: string) => {
      const b = orig(t) as Record<string, unknown>;
      const then = b.then as (...a: unknown[]) => unknown;
      void then;
      return b;
    };
    h.calls = calls;
    (globalThis as { __fakeCalls?: unknown[][] }).__fakeCalls ??= [];
    (globalThis as { __fakeCalls?: unknown[][] }).__fakeCalls!.push(calls);
    return sb;
  },
}));

import { POST } from "@/app/api/webhooks/whop/route";
import { captureMessage } from "@sentry/nextjs";
import { logPaymentEvent } from "@/lib/paymentEvents";
import { useWhopV1Secret, whopSigned } from "../helpers/whop-signed";
import { suppressionKey } from "@/lib/mail-suppression";

const MEZOO = "573a6d8c-7871-4c77-8b88-d0748b7f4785";
const PAYER_EMAIL_OWNER = "3e814abc-3c3f-4ef3-b55a-9f03b63a5841";

function allCalls(): FakeCall[] {
  return ((globalThis as { __fakeCalls?: FakeCall[][] }).__fakeCalls ?? []).flat();
}

function deliver(action: string, data: unknown) {
  return POST(
    new NextRequest("https://medpruf.com/api/webhooks/whop", {
      method: "POST",
      ...whopSigned(JSON.stringify({ action, data })),
    })
  );
}

const renewal = {
  id: "pay_redactedfd51769b",
  billing_reason: "subscription_cycle",
  plan: { id: "plan_trial" },
  user: { email: "payer@example.com" },
  membership: { id: "mem_redacted24a53b8f" },
  member: { id: "mber_bs3QbHTs49VWM" },
  metadata: null,
  checkout_configuration_id: "ch_S0bPNhu0eGZIBvL",
  amount_after_fees: 17.92,
  currency: "eur",
};

let claimed: Set<string>;

function baseHandler(extra?: (c: FakeCall) => FakeResult | undefined) {
  return (c: FakeCall): FakeResult | undefined => {
    const x = extra?.(c);
    if (x) return x;
    if (c.table === "processed_webhook_events" && c.op === "insert") {
      const id = (c.payload as { event_id: string }).event_id;
      if (claimed.has(id)) return { error: { code: "23505", message: "duplicate key" } };
      claimed.add(id);
      return { data: { event_id: id } };
    }
    if (c.table === "payment_events" && c.op === "select") {
      return eqVal(c, "checkout_session_id") === "ch_S0bPNhu0eGZIBvL"
        ? { data: [{ user_id: MEZOO }] }
        : { data: [] };
    }
    if (c.table === "users" && c.op === "select") {
      const id = eqVal(c, "id") as string | undefined;
      if (id === MEZOO) return { data: { id, email: "mezoo@example.com", first_name: "M", language_code: "de", tier: "pro", tier_expires_at: new Date(Date.now() + 86400_000).toISOString() } };
      if (id === PAYER_EMAIL_OWNER) return { data: { id } };
      if (c.filters.some((f) => f.kind === "ilike")) return { data: [{ id: PAYER_EMAIL_OWNER }] };
      return { data: null };
    }
    if (c.table === "subscriptions" && c.op === "select") return { data: [] };
    if (c.table === "subscriptions" && c.op === "insert") return { data: { id: "sub_new" } };
    if (c.table === "mail_suppression" && c.op === "select") return { data: [] };
    return {};
  };
}

beforeEach(() => {
  useWhopV1Secret();
  process.env.WHOP_PLAN_NOTES_TRIAL = "plan_trial";
  (globalThis as { __fakeCalls?: unknown[][] }).__fakeCalls = [];
  claimed = new Set();
  delete process.env.WHOP_ATOMIC_GRANTS_ENABLED;
  h.sendZohoEmail.mockReset();
  h.sendZohoEmail.mockResolvedValue({ ok: true });
  // The membership API is never needed when the checkout tie resolves; make
  // any call loud.
  vi.stubGlobal("fetch", vi.fn(async () => new Response("{}", { status: 403 })));
  h.handler = baseHandler() as (call: unknown) => unknown;
});
afterEach(() => {
  vi.unstubAllGlobals();
  delete process.env.WHOP_API_KEY;
  delete process.env.WHOP_ATOMIC_GRANTS_ENABLED;
});

describe("POST /api/webhooks/whop: renewal mapping (fix A)", () => {
  it("credits a renewal with metadata=null to the membership's subscriber, not the payer-email account", async () => {
    const res = await deliver("payment.succeeded", renewal);
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.activated).toBe(true);
    const subInsert = allCalls().find((c) => c.table === "subscriptions" && c.op === "insert");
    expect(subInsert).toBeTruthy();
    expect((subInsert!.payload as { user_id: string }).user_id).toBe(MEZOO);
    // the membership id (mem_), never the member id (mber_), is stored as the pin
    expect((subInsert!.payload as { whop_membership_id: string }).whop_membership_id).toBe("mem_redacted24a53b8f");
    const userUpdate = allCalls().find((c) => c.table === "users" && c.op === "update");
    expect(eqVal(userUpdate!, "id")).toBe(MEZOO);
    expect(allCalls().some((c) => c.table === "users" && c.op === "update" && eqVal(c, "id") === PAYER_EMAIL_OWNER)).toBe(false);
  });

  it("503s and releases the claim (no email guess) when the membership lookup is transiently down", async () => {
    process.env.WHOP_API_KEY = "test_app_key";
    vi.stubGlobal("fetch", vi.fn(async () => new Response("{}", { status: 502 })));
    const res = await deliver("payment.succeeded", { ...renewal, checkout_configuration_id: undefined });
    expect(res.status).toBe(503);
    expect(allCalls().some((c) => c.table === "processed_webhook_events" && c.op === "delete")).toBe(true);
    expect(allCalls().some((c) => c.table === "subscriptions" && c.op === "insert")).toBe(false);
  });
});

describe("POST /api/webhooks/whop: retry repairs entitlement", () => {
  it("retries a failed user update without buying a second subscription window", async () => {
    let sub: Record<string, unknown> | null = null;
    let owner = { id: MEZOO, tier: "free", tier_expires_at: null as string | null };
    let failWrite = true;
    h.handler = baseHandler(c => {
      if (c.table === "subscriptions" && c.op === "insert") {
        sub = { ...(c.payload as Record<string, unknown>), id: "sub_repair" };
        return { data: { id: "sub_repair" } };
      }
      if (c.table === "subscriptions" && c.op === "select") return { data: sub ? [sub] : [] };
      if (c.table === "users" && c.op === "select" && eqVal(c, "id") === MEZOO) return { data: owner };
      if (c.table === "users" && c.op === "update") {
        if (failWrite) return { error: { message: "temporary write failure" } };
        owner = { ...owner, ...(c.payload as typeof owner) };
        return { data: { id: MEZOO } };
      }
      return undefined;
    }) as (call: unknown) => unknown;
    const first = await deliver("payment.succeeded", renewal);
    expect(first.status).toBe(503);
    expect(owner.tier).toBe("free");
    failWrite = false;
    const second = await deliver("payment.succeeded", renewal);
    expect(second.status).toBe(200);
    expect(owner.tier).toBe("pro");
    expect(allCalls().filter(c => c.table === "subscriptions" && c.op === "insert")).toHaveLength(1);
    expect(allCalls().some(c => c.table === "subscriptions" && c.op === "update")).toBe(false);
    expect(allCalls().some(c => c.table === "processed_webhook_events" && c.op === "delete")).toBe(false);
  });
});

describe("POST /api/webhooks/whop: a grant that committed after its deadline (a-db-timeouts)", () => {
  it("the redelivery replays (no second window), restores access and records grant_succeeded once", async () => {
    let sub: Record<string, unknown> | null = null;
    let owner = { id: MEZOO, tier: "free", tier_expires_at: null as string | null };
    h.handler = baseHandler(c => {
      if (c.table === "subscriptions" && c.op === "insert") {
        // The row commits, but the 8 s deadline already reported a failure.
        sub = { ...(c.payload as Record<string, unknown>), id: "sub_late" };
        return { error: { code: "", message: "DbUnavailableError: Database did not answer within 8000 ms" } };
      }
      if (c.table === "subscriptions" && c.op === "select") return { data: sub ? [sub] : [] };
      if (c.table === "users" && c.op === "select" && eqVal(c, "id") === MEZOO) return { data: owner };
      if (c.table === "users" && c.op === "update") { owner = { ...owner, ...(c.payload as typeof owner) }; return { data: { id: MEZOO } }; }
      // releaseWhopClaim frees the payment id for the redelivery.
      if (c.table === "processed_webhook_events" && c.op === "delete") { claimed.delete(eqVal(c, "event_id") as string); return { data: null }; }
      return undefined;
    }) as (call: unknown) => unknown;
    const first = await deliver("payment.succeeded", renewal);
    expect(first.status).toBeGreaterThanOrEqual(500);
    expect(owner.tier).toBe("free");
    vi.mocked(logPaymentEvent).mockClear();
    const second = await deliver("payment.succeeded", renewal);
    expect(second.status).toBe(200);
    expect(await second.json()).toMatchObject({ duplicate: true });
    expect(owner.tier).toBe("pro");
    expect(allCalls().filter(c => c.table === "subscriptions" && c.op === "insert")).toHaveLength(1);
    expect(allCalls().some(c => c.table === "subscriptions" && c.op === "update")).toBe(false);
    expect(vi.mocked(logPaymentEvent)).toHaveBeenCalledWith(expect.anything(), expect.objectContaining({ event: "grant_succeeded", paymentId: "pay_redactedfd51769b", metadata: expect.objectContaining({ mode: "replayed" }) }));
  });
});

describe("POST /api/webhooks/whop: dunning (fix B)", () => {
  const failed = { ...renewal, id: "pay_FAIL1", status: "open", decline_code: "insufficient_funds", recovery_url: null };

  it("dedupes repeat deliveries of the same failed payment (one claim, one email)", async () => {
    const r1 = await deliver("payment.failed", failed);
    const r2 = await deliver("payment.failed", failed);
    const r3 = await deliver("payment.requires_action", failed);
    expect(r1.status).toBe(200);
    expect((await r2.json()).duplicate).toBe(true);
    expect((await r3.json()).duplicate).toBe(true);
    expect(h.sendZohoEmail).toHaveBeenCalledTimes(1);
  });

  it("emails the SUBSCRIBER the Whop memberships page when recovery_url is null (G16: no hand-built mber_ path), and records user_id on the claim", async () => {
    await deliver("payment.failed", failed);
    expect(h.sendZohoEmail).toHaveBeenCalledTimes(1);
    const mail = h.sendZohoEmail.mock.calls[0][0] as { to: string; htmlBody: string };
    expect(mail.to).toBe("mezoo@example.com");
    expect(mail.htmlBody).toContain("https://whop.com/@me/settings/memberships");
    expect(mail.htmlBody).not.toContain("billing/manage/mber_");
    expect(mail.htmlBody).not.toContain("—");
    const claim = allCalls().find((c) => c.table === "processed_webhook_events" && c.op === "insert");
    expect((claim!.payload as { payload: { user_id: string } }).payload.user_id).toBe(MEZOO);
  });

  it("never writes the address into user_events (a-intercom-suppression-sync)", async () => {
    await deliver("payment.failed", { ...failed, id: "pay_FAIL3" });
    const rows = allCalls().filter((c) => c.table === "user_events" && c.op === "insert");
    expect(rows.length).toBeGreaterThan(0);
    // An address pattern, not a bare "@": the manage link https://whop.com/@me/... is no address.
    for (const r of rows) expect(JSON.stringify(r.payload)).not.toMatch(/[\w.+-]+@[\w-]+\.[a-z]{2,}/i);
    expect(rows.some((r) => (r.payload as { event_type: string }).event_type === "whop_dunning_email")).toBe(true);
  });

  it("a suppressed address blocks the dunning mail (scope all row), and the list is read first", async () => {
    h.handler = baseHandler((c) =>
      c.table === "mail_suppression" && c.op === "select"
        ? { data: [{ id: "s1", email_key: suppressionKey("mezoo@example.com"), cause: "hard_bounce", scope: "all", source: "zoho-bounce", created_at: "2026-10-13T00:00:00Z" }] }
        : undefined,
    ) as (call: unknown) => unknown;
    const res = await deliver("payment.failed", { ...failed, id: "pay_FAIL4" });
    expect(res.status).toBe(200);
    expect(h.sendZohoEmail).not.toHaveBeenCalled();
    // a-intercom-into-n2n3-1021: the deferred send (a-whop-webhook-ack) records a
    // withheld mail as whop_dunning_email_failed, outcome no_recipient (final).
    const row = allCalls().find((c) => c.table === "user_events" && (c.payload as { event_type: string }).event_type === "whop_dunning_email_failed");
    expect((row!.payload as { event_data: Record<string, unknown> }).event_data).toMatchObject({ outcome: "no_recipient", reason: "suppressed", will_retry: false });
    expect(JSON.stringify(row!.payload)).not.toContain("mezoo@example.com");
    expect(allCalls().some((c) => c.table === "user_events" && (c.payload as { event_type: string }).event_type === "whop_dunning_email")).toBe(false);
  });

  it("an unreadable list sends nothing and marks the claim not_sent (one retry on Whop's next delivery)", async () => {
    h.handler = baseHandler((c) => (c.table === "mail_suppression" && c.op === "select" ? { error: { message: "timeout" } } : undefined)) as (call: unknown) => unknown;
    const res = await deliver("payment.failed", { ...failed, id: "pay_FAIL6" });
    // a-intercom-into-n2n3-1021: the mail runs after the 200 (a-whop-webhook-ack),
    // so an unreadable list is recorded on the claim, never a 503.
    expect(res.status).toBe(200);
    expect(h.sendZohoEmail).not.toHaveBeenCalled();
    const row = allCalls().find((c) => c.table === "user_events" && (c.payload as { event_type: string }).event_type === "whop_dunning_email_failed");
    expect((row!.payload as { event_data: Record<string, unknown> }).event_data).toMatchObject({ outcome: "not_sent", reason: "suppression_check_failed" });
    expect(allCalls().some((c) => c.table === "processed_webhook_events" && c.op === "delete" && eqVal(c, "event_id") === "recover:pay_FAIL6")).toBe(false);
  });

  it("a marketing-only opt-out does not stop the dunning mail (transactional)", async () => {
    h.handler = baseHandler((c) =>
      c.table === "mail_suppression" && c.op === "select"
        ? { data: [{ id: "s2", email_key: suppressionKey("mezoo@example.com"), cause: "opt_out", scope: "marketing", source: "intercom:contact.unsubscribed", created_at: "2026-10-13T00:00:00Z" }] }
        : undefined,
    ) as (call: unknown) => unknown;
    await deliver("payment.failed", { ...failed, id: "pay_FAIL5" });
    expect(h.sendZohoEmail).toHaveBeenCalledTimes(1);
  });

  it("uses Whop's recovery_url when present", async () => {
    await deliver("payment.failed", { ...failed, id: "pay_FAIL2", recovery_url: "https://whop.com/recover/abc" });
    const mail = h.sendZohoEmail.mock.calls[0][0] as { htmlBody: string };
    expect(mail.htmlBody).toContain("https://whop.com/recover/abc");
  });
});

describe("POST /api/webhooks/whop: dunning grace is per-user (fix B)", () => {
  it("filters the recover:% grace lookup by the revoked user's id", async () => {
    const subscriptionExpiry = new Date(Date.now() + 86400_000).toISOString();
    const updatedAt = new Date().toISOString();
    const owner = { id: MEZOO, role: "user", tier: "pro", tier_expires_at: subscriptionExpiry, updated_at: updatedAt };
    const sub = { id: "sub_1", user_id: MEZOO, tier: "first_month_19", status: "active",
      payment_provider: "whop", expires_at: subscriptionExpiry, amount_cents: 1900,
      started_at: updatedAt, updated_at: updatedAt, provider_payment_id: "pay_x", granted_payment_ids: [],
      whop_membership_id: "mem_GONE" };
    h.handler = baseHandler((c) => {
      // Reads return fresh snapshots; writes return their affected row just
      // like PostgREST UPDATE ... SELECT used by the revoke's CAS guards.
      if (c.table === "users" && c.op === "select" && eqVal(c, "id") === MEZOO) return { data: structuredClone(owner) };
      if (c.table === "users" && c.op === "update") {
        Object.assign(owner, c.payload); return { data: [{ id: MEZOO }] };
      }
      if (c.table === "subscriptions" && c.op === "select") {
        return { data: (!eqVal(c, "status") || eqVal(c, "status") === sub.status) ? [structuredClone(sub)] : [] };
      }
      if (c.table === "subscriptions" && c.op === "update") {
        Object.assign(sub, c.payload); return { data: [{ id: sub.id }] };
      }
      return undefined;
    }) as (call: unknown) => unknown;
    const res = await deliver("membership.deactivated", { id: "mem_GONE" });
    expect(res.status).toBe(200);
    const grace = allCalls().find(
      (c) => c.table === "processed_webhook_events" && c.op === "select" && c.filters.some((f) => f.kind === "like")
    );
    expect(grace).toBeTruthy();
    expect(eqVal(grace!, "payload->>user_id")).toBe(MEZOO);
  });
});

describe("POST /api/webhooks/whop: independent manual coverage", () => {
  it.each([null, "2031-01-01T00:00:00Z"])("preserves manual Pro expiry %s when a shorter membership deactivates", async (manualExpiry) => {
    const owner = { id: MEZOO, role: "user", tier: "pro", tier_expires_at: manualExpiry, updated_at: "2026-10-01T00:00:00Z" };
    const sub = { id: "sub_paid", user_id: MEZOO, tier: "first_month_19", status: "active", payment_provider: "whop",
      expires_at: "2030-01-01T00:00:00Z", amount_cents: 1900, started_at: "2029-12-01T00:00:00Z",
      updated_at: "2026-10-01T00:00:00Z", provider_payment_id: "pay_manual_test", granted_payment_ids: [], whop_membership_id: "mem_MANUAL" };
    h.handler = baseHandler((c) => {
      if (c.table === "users" && c.op === "select" && eqVal(c, "id") === MEZOO) return { data: structuredClone(owner) };
      if (c.table === "subscriptions" && c.op === "select") {
        return { data: (!eqVal(c, "status") || eqVal(c, "status") === sub.status) ? [structuredClone(sub)] : [] };
      }
      if (c.table === "subscriptions" && c.op === "update") {
        Object.assign(sub, c.payload); return { data: [{ id: sub.id }] };
      }
      return undefined;
    }) as (call: unknown) => unknown;
    const res = await deliver("membership.deactivated", { id: "mem_MANUAL" });
    expect(res.status).toBe(200);
    expect(allCalls().some((c) => c.table === "users" && c.op === "update")).toBe(false);
    expect(sub.status).toBe("cancelled");
  });
});

describe("POST /api/webhooks/whop: trial reuse", () => {
  it("refuses a second free window on an account that already trialed", async () => {
    h.handler = baseHandler((c) => {
      if (c.table === "subscriptions" && c.op === "select" && eqVal(c, "tier") === "notes_pro_trial" && eqVal(c, "status") === "active") {
        return { data: [] };
      }
      if (c.table === "subscriptions" && c.op === "select" && eqVal(c, "tier") === "notes_pro_trial") {
        return { data: [{ id: "old_trial", status: "expired" }] };
      }
      return undefined;
    }) as (call: unknown) => unknown;
    const res = await deliver("payment.succeeded", {
      ...renewal,
      id: "pay_TRIAL0",
      billing_reason: "subscription_create",
      amount_after_fees: 0,
      metadata: { medpruef_user_id: MEZOO, tier: "notes_pro_trial" },
    });
    const body = await res.json();
    expect(body.reason).toBe("trial_already_used");
    expect(allCalls().some((c) => c.table === "subscriptions" && c.op === "insert")).toBe(false);
  });
});

describe("POST /api/webhooks/whop: verify-first trial provenance", () => {
  it.each([
    ["no history", null, true],
    ["a renewal only", [{ payment_id: "pay_R", amount_cents: 1900, added_months: 1, granted_at: "2026-10-08T00:00:00.000Z" }], false],
  ] as const)("attaches the EUR 0 payment as the original trial when the verify row has %s", async (_label, history, withEnd) => {
    h.handler = baseHandler((c) => {
      if (c.table === "subscriptions" && c.op === "select" && eqVal(c, "tier") === "notes_pro_trial" && eqVal(c, "status") === "active") {
        return { data: [{ id: "sub_verify", started_at: "2026-10-01T00:00:00+00:00", expires_at: "2026-10-09T00:00:00+00:00", granted_payment_ids: history }] };
      }
      return undefined;
    }) as (call: unknown) => unknown;
    const res = await deliver("payment.succeeded", {
      ...renewal, id: "pay_TRIAL0", billing_reason: "subscription_create", amount_after_fees: 0,
      metadata: { medpruef_user_id: MEZOO, tier: "notes_pro_trial" },
    });
    expect((await res.json()).deduped).toBe(true);
    const attach = allCalls().find((c) => c.table === "subscriptions" && c.op === "update");
    expect(eqVal(attach!, "id")).toBe("sub_verify");
    expect((attach!.payload as { granted_payment_ids: unknown[] }).granted_payment_ids).toEqual([
      { payment_id: "pay_TRIAL0", amount_cents: 0, added_months: 0, granted_at: "2026-10-01T00:00:00.000Z",
        ...(withEnd ? { trial_ends_at: "2026-10-09T00:00:00.000Z" } : {}) },
      ...(history ?? []),
    ]);
  });
  it("leaves recorded trial provenance unchanged", async () => {
    h.handler = baseHandler((c) => {
      if (c.table === "subscriptions" && c.op === "select" && eqVal(c, "tier") === "notes_pro_trial" && eqVal(c, "status") === "active") {
        return { data: [{ id: "sub_verify", started_at: "2026-10-01T00:00:00Z", expires_at: "2026-10-09T00:00:00Z",
          granted_payment_ids: [{ payment_id: "mem_X", amount_cents: 0, added_months: 0, granted_at: "2026-10-01T00:00:00Z" }] }] };
      }
      return undefined;
    }) as (call: unknown) => unknown;
    await deliver("payment.succeeded", {
      ...renewal, id: "pay_TRIAL0", billing_reason: "subscription_create", amount_after_fees: 0,
      metadata: { medpruef_user_id: MEZOO, tier: "notes_pro_trial" },
    });
    expect(allCalls().some((c) => c.table === "subscriptions" && c.op === "update")).toBe(false);
  });
});

describe("POST /api/webhooks/whop: auth", () => {
  it("rejects an unsigned delivery with 401", async () => {
    const res = await POST(
      new NextRequest("https://medpruf.com/api/webhooks/whop", { method: "POST", body: "{}" })
    );
    expect(res.status).toBe(401);
  });
});

describe("POST /api/webhooks/whop: review fixes", () => {
  it("never revokes the payer-email account for a membership event resolved by email only", async () => {
    process.env.WHOP_API_KEY = "k";
    vi.stubGlobal("fetch", vi.fn(async () => new Response("{}", { status: 403 })));
    const res = await deliver("membership.deactivated", { id: "mem_UNKNOWN", user: { email: "payer@example.com" } });
    const body = await res.json();
    expect(body.error).toBe("revoke matched no subscription");
    expect(allCalls().some((c) => c.table === "users" && c.op === "update")).toBe(false);
    expect(allCalls().some((c) => c.table === "subscriptions" && c.op === "update")).toBe(false);
  });

  it("does not guess on a notes_pro_trial payment with no readable amount", async () => {
    const res = await deliver("payment.succeeded", {
      id: "pay_NOAMT",
      membership: { id: "mem_redacted24a53b8f" },
      checkout_configuration_id: "ch_S0bPNhu0eGZIBvL",
      metadata: { tier: "notes_pro_trial" },
    });
    const body = await res.json();
    expect(body.ok).toBe(false);
    expect(allCalls().some((c) => c.table === "subscriptions" && (c.op === "insert" || c.op === "update"))).toBe(false);
  });
});


describe("atomic revoke routing", () => {
  const sub = { id: "sub_atomic", user_id: MEZOO, tier: "first_month_19", status: "active",
    expires_at: "2030-01-01T00:00:00Z", amount_cents: 1900, started_at: "2029-12-01T00:00:00Z",
    provider_payment_id: "pay_atomic", granted_payment_ids: [], whop_membership_id: "mem_ATOMIC" };
  it.each([true,false])("uses one transaction without legacy writes, success=%s", async (success) => {
    process.env.WHOP_ATOMIC_GRANTS_ENABLED = "true";
    h.handler = baseHandler(c => {
      if (c.table === "subscriptions" && c.op === "select" && eqVal(c,"whop_membership_id") === "mem_ATOMIC") return { data:[sub] };
      if (c.table === "rpc:commit_whop_revoke") return success ? { data:[{ kept_active_ids:[],flipped_ids:[sub.id],pro_revoked:true,had_other_active:false,dunning_deferred:false,replayed:false }] } : { error:{ code:"40001",message:"changed" } };
      return undefined;
    }) as (call:unknown)=>unknown;
    const res = await deliver("membership.deactivated", { id:"mem_ATOMIC" });
    expect(res.status).toBe(success ? 200 : 503);
    const calls=allCalls();
    expect(calls.filter(c=>c.table==="rpc:commit_whop_revoke")).toHaveLength(1);
    expect(calls.some(c=>["subscriptions","users"].includes(c.table)&&c.op==="update")).toBe(false);
    expect(calls.some(c=>c.table==="processed_webhook_events"&&c.op==="insert")).toBe(false);
  });
});


describe("ADM-Q04 unmapped payment warning", () => {
  it("includes payment references but omits the buyer email", async () => {
    vi.mocked(captureMessage).mockClear();
    h.handler = baseHandler((call) => call.table === "users" ? { data: null } : undefined) as (call: unknown) => unknown;
    const response = await deliver("payment.succeeded", {
      ...renewal, id: "pay_SYNTHETIC_UNMAPPED", membership: null,
      member: null, checkout_configuration_id: null,
      user: { email: "synthetic-unmapped@example.invalid" },
    });
    expect(response.status).toBe(200);
    const warning = vi.mocked(captureMessage).mock.calls.find(([message]) => typeof message === "string" && message.includes("Whop payment unmapped"));
    expect(warning).toBeDefined();
    expect(warning![0]).toContain("pay_SYNTHETIC_UNMAPPED");
    expect(warning![0]).not.toContain("synthetic-unmapped@example.invalid");
  });
});
