import { describe, expect, it, vi } from "vitest";

vi.mock("@sentry/nextjs", () => ({ captureMessage: vi.fn(), captureException: vi.fn() }));
vi.mock("@/lib/supabase", () => ({
  getServiceClient: () => {
    throw new Error("tests inject db");
  },
}));

import { createFakeSupabase, type FakeCall, type FakeResult } from "../../helpers/fake-supabase";
import { createMentorWhopRouter, classifyMentorEvent, mentorCommerceConfigured } from "@/lib/mentor/credits/whop-branch";
import { WHOP_CANCEL_EVENTS, WHOP_REFUND_EVENTS } from "@/lib/whop";
import { MENTOR_WHOP_EVENTS } from "@/lib/mentor/contract";
import { resetPackageCache } from "@/lib/mentor/credits/packages";

const BUYER = "22222222-2222-4222-8222-222222222222";
const PIN_USER = "33333333-3333-4333-8333-333333333333";
const ENV = { WHOP_PLAN_MENTOR_BASIS: "plan_mbasis", WHOP_PLAN_MENTOR_PLUS: "plan_mplus", WHOP_PLAN_FIRST_MONTH_19: "plan_pro19" };

type Handler = (c: FakeCall) => FakeResult | undefined;

const PKG_ROWS = [
  { package_id: "mentor_basis", kind: "subscription", grant_micro: 750000, period_days: 30, expiry_days: 33, price_eur_cents: 490, active: true, provisional: true, sort: 10, note: null },
  { package_id: "mentor_plus", kind: "subscription", grant_micro: 2000000, period_days: 30, expiry_days: 33, price_eur_cents: 990, active: true, provisional: true, sort: 20, note: null },
];
const PAID = { amount_after_fees: 4.13, currency: "eur" };

function setup(handler: Handler, env: Record<string, string | undefined> = ENV) {
  resetPackageCache();
  const { sb, calls } = createFakeSupabase(handler);
  const log = vi.fn(async () => {});
  const route = createMentorWhopRouter({ db: () => sb as never, env, log });
  return { route, calls, log };
}

/** A ledger with one mentor lot (pay_M1 on mem_M) pinned to PIN_USER, plus users. */
function ledgerHandler(over: Handler = () => undefined): Handler {
  return (c) => {
    const o = over(c);
    if (o) return o;
    if (c.table === "rpc:mentor_whop_lookup") {
      const a = c.payload as { p_payment_id: string | null; p_membership_id: string | null };
      if (a.p_payment_id === "pay_M1") return { data: { mentor: true, via: "payment", user_id: PIN_USER, package_id: "mentor_basis" } };
      if (a.p_membership_id === "mem_M") return { data: { mentor: true, via: "membership", user_id: PIN_USER, package_id: "mentor_basis" } };
      return { data: { mentor: false } };
    }
    if (c.table === "rpc:mentor_grant_credits") return { data: { ok: true, duplicate: false, lot_id: "lot-1", granted_micro: 750000 } };
    if (c.table === "ai_credit_package") return { data: PKG_ROWS };
    if (c.table === "rpc:mentor_revoke_payment") return { data: { ok: true, duplicate: false } };
    if (c.table === "rpc:mentor_clawback") return { data: { ok: true, duplicate: false, lot_id: "lot-1", user_id: PIN_USER, clawed_micro: 500000 } };
    if (c.table === "rpc:mentor_membership_status") return { data: { ok: true, user_id: PIN_USER } };
    if (c.table === "users" && c.op === "select") return { data: { id: c.filters[0]?.value } };
    return {};
  };
}

const firstPayment = {
  id: "pay_NEW",
  plan: { id: "plan_mbasis" },
  membership: { id: "mem_NEW" },
  metadata: { kind: "mentor_credits", package: "mentor_basis", medpruef_user_id: BUYER },
  amount_after_fees: 4.13,
  currency: "eur",
};

const proWrites = (calls: FakeCall[]) =>
  calls.filter((c) => c.table === "subscriptions" || (c.table === "users" && c.op !== "select") || c.table === "rpc:commit_whop_revoke");

describe("classifyMentorEvent", () => {
  it("covers every Pro revoke name plus the frozen mentor lists", () => {
    for (const e of WHOP_REFUND_EVENTS) expect(classifyMentorEvent(e)).toBe("clawback");
    for (const e of WHOP_CANCEL_EVENTS) expect(classifyMentorEvent(e)).toBe("deactivate");
    for (const e of MENTOR_WHOP_EVENTS.grant) expect(classifyMentorEvent(e)).toBe("grant");
    for (const e of MENTOR_WHOP_EVENTS.record_only) expect(classifyMentorEvent(e)).toBe("record_only");
    expect(classifyMentorEvent("membership.trial_ending_soon")).toBe("other");
  });
});

describe("routeMentorWhopEvent: unconfigured (no mentor plan env) is a no-op", () => {
  it("makes zero DB calls for Pro events and returns handled:false", async () => {
    expect(mentorCommerceConfigured({})).toBe(false);
    const { route, calls } = setup(ledgerHandler(), {});
    const events: Array<[string, unknown]> = [
      ["payment.succeeded", { id: "pay_PRO", plan: { id: "plan_pro19" }, membership: { id: "mem_PRO" }, metadata: null }],
      ["refund.created", { id: "rfnd_1", payment_id: "pay_PRO" }],
      ["membership.deactivated", { id: "mem_PRO" }],
      ["payment.failed", { id: "pay_PRO" }],
    ];
    for (const [e, d] of events) expect(await route(e, d)).toEqual({ handled: false });
    expect(calls).toHaveLength(0);
  });

  it("still recognises a first payment by metadata (and grants) even when unconfigured", async () => {
    const { route, calls } = setup(ledgerHandler(), {});
    const d = await route("payment.succeeded", firstPayment);
    expect(d).toMatchObject({ handled: true, status: 200, body: { action: "granted", recognised_by: "metadata" } });
    expect(calls.filter((c) => c.table === "rpc:mentor_grant_credits")).toHaveLength(1);
  });
});

describe("routeMentorWhopEvent: grants", () => {
  it("first payment: grants by metadata with the exact frozen RPC args, never a Pro write", async () => {
    const { route, calls, log } = setup(ledgerHandler());
    const d = await route("payment.succeeded", firstPayment);
    expect(d).toMatchObject({ handled: true, status: 200, body: { ok: true, mentor: true, action: "granted", recognised_by: "metadata", payment_id: "pay_NEW" } });
    const grant = calls.find((c) => c.table === "rpc:mentor_grant_credits")!;
    expect(grant.payload).toEqual({
      p_user: BUYER,
      p_package: "mentor_basis",
      p_source: "whop_payment",
      p_source_id: "pay_NEW",
      p_micro: null,
      p_starts_at: null,
      p_expires_at: null,
      p_whop_payment_id: "pay_NEW",
      p_whop_membership_id: "mem_NEW",
    });
    expect(proWrites(calls)).toHaveLength(0);
    expect(log).toHaveBeenCalledWith(expect.anything(), expect.objectContaining({ event: "grant_succeeded", userId: BUYER }));
  });

  it("renewal with metadata null is recognised by the mentor plan and credited to the pinned user", async () => {
    const { route, calls } = setup(ledgerHandler());
    const d = await route("payment.succeeded", { id: "pay_R2", plan: { id: "plan_mbasis" }, membership: { id: "mem_M" }, metadata: null, ...PAID });
    expect(d).toMatchObject({ handled: true, status: 200, body: { action: "granted", recognised_by: "plan_id" } });
    const grant = calls.find((c) => c.table === "rpc:mentor_grant_credits")!;
    expect(grant.payload).toMatchObject({ p_user: PIN_USER, p_package: "mentor_basis", p_source_id: "pay_R2", p_whop_membership_id: "mem_M" });
  });

  it("renewal with no plan id on the payload is recognised by the membership pin", async () => {
    const { route, calls } = setup(ledgerHandler());
    const d = await route("payment.succeeded", { id: "pay_R3", membership: { id: "mem_M" }, metadata: null, ...PAID });
    expect(d).toMatchObject({ handled: true, status: 200, body: { action: "granted", recognised_by: "membership_pin" } });
    expect(calls.find((c) => c.table === "rpc:mentor_grant_credits")!.payload).toMatchObject({ p_user: PIN_USER, p_package: "mentor_basis" });
  });

  it("a duplicate delivery is idempotent (duplicate, 200)", async () => {
    const { route } = setup(ledgerHandler((c) => (c.table === "rpc:mentor_grant_credits" ? { data: { ok: true, duplicate: true, lot_id: "lot-1" } } : undefined)));
    expect(await route("payment.succeeded", firstPayment)).toMatchObject({ status: 200, body: { action: "duplicate" } });
  });

  it("H1: a grant for a payment refunded earlier is 200 unmapped (revoked), never credits", async () => {
    const { route, log } = setup(ledgerHandler((c) => (c.table === "rpc:mentor_grant_credits" ? { data: { ok: false, reason: "revoked" } } : undefined)));
    expect(await route("payment.succeeded", firstPayment)).toMatchObject({ handled: true, status: 200, body: { ok: false, action: "unmapped" } });
    expect(log).toHaveBeenCalledWith(expect.anything(), expect.objectContaining({ event: "grant_failed", metadata: expect.objectContaining({ cause: "revoked" }) }));
  });

  it("H3: a EUR 0 payment (trial phase or 100 percent coupon) never grants", async () => {
    for (const free of [{ amount_after_fees: 0 }, { amount_after_fees: 0, final_amount: 0, amount: 4.9 }, { amount: 0 }]) {
      const { route, calls } = setup(ledgerHandler());
      const d = await route("payment.succeeded", { ...firstPayment, ...free });
      expect(d, JSON.stringify(free)).toMatchObject({ handled: true, status: 200, body: { ok: false, action: "unmapped" } });
      expect(calls.filter((c) => c.table === "rpc:mentor_grant_credits")).toHaveLength(0);
    }
  });

  it("H3: no amount at all, a wrong currency, or far below the package price never grants", async () => {
    const noAmount = { ...firstPayment } as Record<string, unknown>;
    delete noAmount.amount_after_fees;
    delete noAmount.currency;
    const cheap = { ...firstPayment, amount_after_fees: 1.5 };
    const usd = { ...firstPayment, currency: "usd" };
    for (const p of [noAmount, cheap, usd]) {
      const { route, calls } = setup(ledgerHandler());
      expect(await route("payment.succeeded", p)).toMatchObject({ handled: true, status: 200, body: { action: "unmapped" } });
      expect(calls.filter((c) => c.table === "rpc:mentor_grant_credits")).toHaveLength(0);
    }
  });

  it("H3: a package row without a price fails closed (unmapped), a catalogue read error is a 503", async () => {
    const noPrice = setup(ledgerHandler((c) => (c.table === "ai_credit_package" ? { data: [{ ...PKG_ROWS[0], price_eur_cents: null }] } : undefined)));
    expect(await noPrice.route("payment.succeeded", firstPayment)).toMatchObject({ status: 200, body: { action: "unmapped" } });
    const err = setup(ledgerHandler((c) => (c.table === "ai_credit_package" ? { error: { code: "57014", message: "timeout" } } : undefined)));
    expect(await err.route("payment.succeeded", firstPayment)).toMatchObject({ status: 503, body: { action: "retry" } });
  });

  it("DB error on grant -> 503 retry; missing ledger function on a recognised grant -> 503 retry", async () => {
    const a = setup(ledgerHandler((c) => (c.table === "rpc:mentor_grant_credits" ? { data: { ok: false, reason: "db_error" } } : undefined)));
    expect(await a.route("payment.succeeded", firstPayment)).toMatchObject({ handled: true, status: 503, body: { action: "retry" } });
    const b = setup(ledgerHandler((c) => (c.table === "rpc:mentor_grant_credits" ? { error: { code: "PGRST202", message: "not found" } } : undefined)));
    expect(await b.route("payment.succeeded", firstPayment)).toMatchObject({ handled: true, status: 503 });
  });

  it("source_conflict, a non-uuid user or an unknown user are 200 unmapped (no retry loop), never handed to Pro", async () => {
    const a = setup(ledgerHandler((c) => (c.table === "rpc:mentor_grant_credits" ? { data: { ok: false, reason: "source_conflict", lot_id: "x" } } : undefined)));
    expect(await a.route("payment.succeeded", firstPayment)).toMatchObject({ handled: true, status: 200, body: { action: "unmapped" } });

    const b = setup(ledgerHandler());
    const bad = { ...firstPayment, metadata: { ...firstPayment.metadata, medpruef_user_id: "not-a-uuid" } };
    expect(await b.route("payment.succeeded", bad)).toMatchObject({ handled: true, status: 200, body: { action: "unmapped" } });
    expect(b.calls.filter((c) => c.table === "rpc:mentor_grant_credits")).toHaveLength(0);

    const c = setup(ledgerHandler((x) => (x.table === "users" ? { data: null } : undefined)));
    expect(await c.route("payment.succeeded", firstPayment)).toMatchObject({ handled: true, status: 200, body: { action: "unmapped" } });
  });

  it("lookup DB error -> 503 (never falls through to Pro); missing lookup function -> not mentor", async () => {
    const proRenewal = { id: "pay_PRO2", membership: { id: "mem_PRO" }, metadata: null };
    const a = setup(ledgerHandler((c) => (c.table === "rpc:mentor_whop_lookup" ? { error: { code: "57014", message: "timeout" } } : undefined)));
    expect(await a.route("payment.succeeded", proRenewal)).toMatchObject({ handled: true, status: 503 });
    const b = setup(ledgerHandler((c) => (c.table === "rpc:mentor_whop_lookup" ? { error: { code: "PGRST202", message: "missing" } } : undefined)));
    expect(await b.route("payment.succeeded", proRenewal)).toEqual({ handled: false });
  });

  it("positive Pro evidence (Pro plan id) skips the ledger lookup entirely", async () => {
    // whopPlanToTier reads process.env (the Pro plan map), like the Pro webhook does
    process.env.WHOP_PLAN_FIRST_MONTH_19 = "plan_pro19";
    const { route, calls } = setup(ledgerHandler());
    expect(await route("payment.succeeded", { id: "pay_P", plan: { id: "plan_pro19" }, membership: { id: "mem_P" }, metadata: null })).toEqual({ handled: false });
    expect(calls).toHaveLength(0);
    delete process.env.WHOP_PLAN_FIRST_MONTH_19;
  });

  it("record_only on a mentor membership is recorded (no Pro dunning email); on Pro it is not handled", async () => {
    const { route } = setup(ledgerHandler());
    expect(await route("payment.failed", { id: "pay_F", membership: { id: "mem_M" } })).toMatchObject({ status: 200, body: { action: "recorded" } });
    expect(await route("payment.failed", { id: "pay_F", membership: { id: "mem_PRO" } })).toEqual({ handled: false });
  });

  it("an unknown event kind carrying mentor metadata is recorded, never handed to Pro", async () => {
    const { route, calls } = setup(ledgerHandler());
    expect(await route("membership.trial_ending_soon", { id: "mem_NEW", metadata: { kind: "mentor_credits" } })).toMatchObject({ handled: true, status: 200, body: { action: "recorded" } });
    expect(await route("membership.trial_ending_soon", { id: "mem_PRO" })).toEqual({ handled: false });
    expect(calls).toHaveLength(0);
  });
});

describe("routeMentorWhopEvent: refunds, disputes, deactivations", () => {
  it("every revoke-class event on a mentor payment or membership is handled and makes no Pro write", async () => {
    const names = new Set<string>([...WHOP_REFUND_EVENTS, ...WHOP_CANCEL_EVENTS, ...MENTOR_WHOP_EVENTS.clawback, ...MENTOR_WHOP_EVENTS.deactivate]);
    for (const e of names) {
      for (const payload of [
        { id: "rfnd_X", payment_id: "pay_M1" },
        { id: "mem_M" },
        { id: "dspt_X", payment: { id: "pay_M1" }, membership_id: "mem_M" },
      ]) {
        const { route, calls } = setup(ledgerHandler());
        const d = await route(e, payload);
        expect(d.handled, `${e} ${JSON.stringify(payload)}`).toBe(true);
        expect(proWrites(calls)).toHaveLength(0);
      }
    }
  });

  it("refund on a matched payment claws back unspent credit from that lot (ids from extractWhopRevoke, not data.id)", async () => {
    const { route, calls } = setup(ledgerHandler());
    const d = await route("refund.created", { id: "rfnd_1", payment_id: "pay_M1" });
    expect(d).toMatchObject({ status: 200, body: { action: "clawed_back", recognised_by: "ledger_payment", payment_id: "pay_M1" } });
    expect(calls.find((c) => c.table === "rpc:mentor_clawback")!.payload).toMatchObject({ p_source: "whop_payment", p_source_id: "pay_M1" });
    // the refund's own id was never looked up as a payment id
    expect(calls.some((c) => c.table === "rpc:mentor_whop_lookup" && (c.payload as { p_payment_id: string }).p_payment_id === "rfnd_1")).toBe(false);
  });

  it("dispute with the payment under data.payment and a repeat delivery is a duplicate", async () => {
    const { route } = setup(ledgerHandler((c) => (c.table === "rpc:mentor_clawback" ? { data: { ok: true, duplicate: true, lot_id: "lot-1", user_id: PIN_USER, clawed_micro: 0 } } : undefined)));
    expect(await route("dispute.created", { id: "dspt_1", payment: { id: "pay_M1" } })).toMatchObject({ status: 200, body: { action: "duplicate" } });
  });

  it("refund that matches only the membership pin: recognised, tombstoned, 200 recorded, nothing clawed back (H1)", async () => {
    const { route, calls } = setup(ledgerHandler());
    const d = await route("refund.created", { id: "rfnd_2", payment_id: "pay_UNKNOWN", membership_id: "mem_M" });
    expect(d).toMatchObject({ handled: true, status: 200, body: { ok: true, action: "recorded", recognised_by: "membership_pin", payment_id: "pay_UNKNOWN" } });
    expect(calls.filter((c) => c.table === "rpc:mentor_clawback")).toHaveLength(0);
    expect(calls.find((c) => c.table === "rpc:mentor_revoke_payment")!.payload).toEqual({ p_payment_id: "pay_UNKNOWN", p_event: "refund.created" });
  });

  it("H1: a refund tombstones the payment BEFORE it claws back the lot", async () => {
    const { route, calls } = setup(ledgerHandler());
    await route("refund.created", { id: "rfnd_1", payment_id: "pay_M1" });
    const order = calls.map((c) => c.table).filter((t) => t === "rpc:mentor_revoke_payment" || t === "rpc:mentor_clawback");
    expect(order).toEqual(["rpc:mentor_revoke_payment", "rpc:mentor_clawback"]);
  });

  it("H1: a tombstone failure is a 503 so Whop redelivers (the clawback is not attempted)", async () => {
    const { route, calls } = setup(ledgerHandler((c) => (c.table === "rpc:mentor_revoke_payment" ? { data: { ok: false, reason: "db_error" } } : undefined)));
    expect(await route("refund.created", { id: "rfnd_1", payment_id: "pay_M1" })).toMatchObject({ handled: true, status: 503, body: { action: "retry" } });
    expect(calls.filter((c) => c.table === "rpc:mentor_clawback")).toHaveLength(0);
  });

  it("H1: a refund recognised by mentor metadata with no lot yet is tombstoned (grant arrives later and is refused)", async () => {
    const { route, calls } = setup(ledgerHandler());
    const d = await route("refund.created", { id: "rfnd_9", payment: { id: "pay_LATE", metadata: { kind: "mentor_credits" } } });
    expect(d).toMatchObject({ handled: true, status: 200, body: { action: "recorded", recognised_by: "metadata" } });
    expect(calls.find((c) => c.table === "rpc:mentor_revoke_payment")!.payload).toMatchObject({ p_payment_id: "pay_LATE" });
  });

  it("refund of a Pro payment is not mentor (handled:false -> Pro revoke path continues)", async () => {
    const { route } = setup(ledgerHandler());
    expect(await route("refund.created", { id: "rfnd_3", payment_id: "pay_PRO", membership_id: "mem_PRO" })).toEqual({ handled: false });
  });

  it("clawback DB error -> 503", async () => {
    const { route } = setup(ledgerHandler((c) => (c.table === "rpc:mentor_clawback" ? { data: { ok: false, reason: "db_error" } } : undefined)));
    expect(await route("refund.created", { id: "rfnd_1", payment_id: "pay_M1" })).toMatchObject({ handled: true, status: 503 });
  });

  it("membership.deactivated on a pinned mentor membership marks it inactive (no clawback, no Pro write)", async () => {
    const { route, calls } = setup(ledgerHandler());
    const d = await route("membership.deactivated", { id: "mem_M" });
    expect(d).toMatchObject({ status: 200, body: { action: "deactivated", recognised_by: "membership_pin" } });
    expect(calls.find((c) => c.table === "rpc:mentor_membership_status")!.payload).toEqual({ p_membership_id: "mem_M", p_status: "inactive" });
    expect(calls.filter((c) => c.table === "rpc:mentor_clawback")).toHaveLength(0);
  });

  it("membership.deactivated on a Pro membership is not mentor", async () => {
    const { route } = setup(ledgerHandler());
    expect(await route("membership.deactivated", { id: "mem_PRO" })).toEqual({ handled: false });
  });
});
