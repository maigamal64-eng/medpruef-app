import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@sentry/nextjs", () => ({ captureMessage: vi.fn(), captureException: vi.fn() }));

import {
  REFERRAL_MENTOR_CREDIT_MICRO,
  REFERRAL_MENTOR_EVENT,
  clawbackReferralMentorCredit,
  decideReferralMentorCredit,
  hasEarlierPaidCharge,
  referralMentorCreditsOffered,
  rewardReferrerOnFirstCharge,
  viennaMonthStart,
  type RefereeSub,
} from "@/lib/referral-mentor-credits";
import { createFakeSupabase, type FakeCall } from "../helpers/fake-supabase";

const REFERRER = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const REFEREE = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";
const REF_ID = "cccccccc-cccc-4ccc-8ccc-cccccccccccc";
const NOW = new Date("2026-10-20T10:00:00Z");
const ON = { REFERRAL_MENTOR_CREDITS_ENABLED: "true" };

const val = (c: FakeCall, col: string, kind = "eq") => c.filters.find((f) => f.kind === kind && f.column === col)?.value;

interface World {
  referral: { id: string; referrer_user_id: string; referee_user_id: string; created_at: string } | null;
  refereeCreatedAt: string;
  subs: RefereeSub[];
  referrerBanned: boolean;
  /** source_id -> lot */
  lots: Map<string, { id: string; user_id: string; created_at: string; status: string }>;
  events: Array<{ user_id: string; event_type: string; event_data: Record<string, unknown> }>;
  failGrant?: boolean;
}

function world(over: Partial<World> = {}): World {
  return {
    referral: { id: REF_ID, referrer_user_id: REFERRER, referee_user_id: REFEREE, created_at: "2026-10-18T09:00:00Z" },
    refereeCreatedAt: "2026-10-18T08:30:00Z",
    subs: [
      { id: "s1", created_at: "2026-10-18T09:05:00Z", status: "active", amount_cents: 1900, provider_payment_id: "pay_conv",
        granted_payment_ids: [{ payment_id: "pay_trial", amount_cents: 0 }, { payment_id: "pay_conv", amount_cents: 1900 }] },
    ],
    referrerBanned: false,
    lots: new Map(),
    events: [],
    ...over,
  };
}

function db(w: World) {
  return createFakeSupabase((c) => {
    if (c.table === "referrals") return { data: w.referral && val(c, "referee_user_id") === w.referral.referee_user_id ? [w.referral] : [] };
    if (c.table === "users") {
      if (val(c, "id") === REFEREE) return { data: { created_at: w.refereeCreatedAt } };
      if (val(c, "id") === REFERRER) return { data: { is_banned: w.referrerBanned } };
      return { data: null };
    }
    if (c.table === "subscriptions") return { data: w.subs };
    if (c.table === "ai_credit_lot") {
      const sid = val(c, "source_id") as string | undefined;
      if (sid) return { data: w.lots.has(sid) ? [{ id: w.lots.get(sid)!.id }] : [] };
      const since = val(c, "created_at", "gte") as string;
      return { data: [...w.lots.entries()].filter(([k, l]) => k.startsWith("first_charge:") && l.user_id === val(c, "user_id") && l.created_at >= since).map(([, l]) => ({ id: l.id })) };
    }
    if (c.table === "user_events") {
      if (c.op === "insert") { w.events.push(c.payload as World["events"][number]); return {}; }
      const rid = val(c, "event_data->>referral_id");
      if (rid) return { data: w.events.filter((e) => e.event_data.referral_id === rid && e.user_id === val(c, "user_id")).map(() => ({ id: 1 })) };
      const pays = c.filters.find((f) => f.kind === "in" && f.column === "event_data->>payment_id")?.value as string[];
      return { data: w.events.filter((e) => e.event_type === REFERRAL_MENTOR_EVENT && e.event_data.outcome === "granted" && pays.includes(String(e.event_data.payment_id))) };
    }
    if (c.table === "rpc:mentor_grant_credits") {
      if (w.failGrant) return { error: { code: "57014" } };
      const a = c.payload as Record<string, string>;
      const existing = w.lots.get(a.p_source_id);
      if (existing) return { data: { ok: true, duplicate: true, lot_id: existing.id, granted_micro: a.p_micro } };
      const lot = { id: `lot-${w.lots.size + 1}`, user_id: a.p_user, created_at: NOW.toISOString(), status: "live" };
      w.lots.set(a.p_source_id, lot);
      return { data: { ok: true, duplicate: false, lot_id: lot.id, granted_micro: a.p_micro } };
    }
    if (c.table === "rpc:mentor_clawback") {
      const a = c.payload as Record<string, string>;
      const lot = w.lots.get(a.p_source_id);
      if (!lot) return { data: { ok: false, reason: "not_found" } };
      if (lot.status === "clawed_back") return { data: { ok: true, duplicate: true, user_id: lot.user_id, clawed_micro: 1 } };
      lot.status = "clawed_back";
      return { data: { ok: true, duplicate: false, user_id: lot.user_id, clawed_micro: REFERRAL_MENTOR_CREDIT_MICRO, debt_added_micro: 0 } };
    }
    return {};
  });
}

const reward = (sb: unknown, over: Record<string, unknown> = {}) => rewardReferrerOnFirstCharge(sb as never, {
  refereeId: REFEREE, paymentId: "pay_conv", amountCents: 1900, via: "webhook", now: NOW, env: ON, referrerAdmitted: async () => true, ...over,
});

describe("flag off: nothing is read or written (identical to main)", () => {
  it("returns off before any query", async () => {
    const w = world();
    const { sb, calls } = db(w);
    expect(await reward(sb, { env: {} })).toEqual({ status: "off" });
    expect(await reward(sb, { env: { REFERRAL_MENTOR_CREDITS_ENABLED: "1" } })).toEqual({ status: "off" });
    expect(calls).toHaveLength(0);
    expect(referralMentorCreditsOffered({})).toBeNull();
    expect(referralMentorCreditsOffered(ON)).toBe(50);
  });
});

describe("referral mentor credits: grant rules", () => {
  let w: World;
  beforeEach(() => { w = world(); });

  it("the first paid charge (trial conversion) grants one 50-credit lot for 30 days, keyed first_charge:<referral>", async () => {
    const { sb, calls } = db(w);
    const r = await reward(sb);
    expect(r).toMatchObject({ status: "granted", duplicate: false, referrerAdmitted: true });
    const grant = calls.find((c) => c.table === "rpc:mentor_grant_credits")!.payload as Record<string, unknown>;
    expect(grant).toMatchObject({ p_user: REFERRER, p_package: "referral_reward", p_source: "referral_reward", p_source_id: `first_charge:${REF_ID}`, p_micro: 250_000, p_whop_payment_id: null });
    expect(Date.parse(String(grant.p_expires_at)) - NOW.getTime()).toBe(30 * 86_400_000);
    expect(w.events).toHaveLength(1);
    expect(w.events[0]).toMatchObject({ user_id: REFERRER, event_type: REFERRAL_MENTOR_EVENT, event_data: { outcome: "granted", payment_id: "pay_conv", referral_id: REF_ID, credits: 50 } });
    expect(w.events[0].event_data).not.toHaveProperty("reason");
  });

  it("the EUR 0 trial start never grants and never reads", async () => {
    const { sb, calls } = db(w);
    expect(await reward(sb, { paymentId: "pay_trial", amountCents: 0 })).toEqual({ status: "not_paid" });
    expect(await reward(sb, { amountCents: null })).toEqual({ status: "not_paid" });
    expect(calls).toHaveLength(0);
  });

  it("a second paid charge grants nothing", async () => {
    w.subs[0].granted_payment_ids!.push({ payment_id: "pay_renew", amount_cents: 1900 });
    const { sb } = db(w);
    expect(await reward(sb, { paymentId: "pay_renew" })).toEqual({ status: "skipped", reason: "not_first_charge" });
    expect(w.lots.size).toBe(0);
    expect(w.events[0].event_data).toMatchObject({ outcome: "skipped", reason: "not_first_charge" });
  });

  it("an old account, or one with a subscription before the claim, grants nothing", async () => {
    const old = world({ refereeCreatedAt: "2026-09-01T00:00:00Z" });
    expect(await reward(db(old).sb)).toEqual({ status: "skipped", reason: "old_account" });
    const prior = world();
    prior.subs.push({ id: "s0", created_at: "2026-10-18T08:45:00Z", status: "expired", amount_cents: 0, provider_payment_id: null, granted_payment_ids: [] });
    expect(await reward(db(prior).sb)).toEqual({ status: "skipped", reason: "prior_subscription" });
    expect(old.lots.size + prior.lots.size).toBe(0);
  });

  it("the 4th reward in one Vienna month is refused; a new month opens again", async () => {
    for (let i = 0; i < 3; i++) w.lots.set(`first_charge:other-${i}`, { id: `l${i}`, user_id: REFERRER, created_at: "2026-10-02T08:00:00Z", status: "live" });
    expect(await reward(db(w).sb)).toEqual({ status: "skipped", reason: "monthly_cap" });
    const fresh = world();
    for (let i = 0; i < 3; i++) fresh.lots.set(`first_charge:other-${i}`, { id: `l${i}`, user_id: REFERRER, created_at: "2026-09-30T21:00:00Z", status: "live" });
    // 30 Sep 21:00 UTC is 30 Sep 23:00 in Vienna: last month.
    expect(await reward(db(fresh).sb)).toMatchObject({ status: "granted" });
  });

  it("a retry (webhook redelivery or the verify path) yields one lot and one audit row", async () => {
    const { sb } = db(w);
    await reward(sb);
    expect(await reward(sb, { via: "checkout_verify" })).toEqual({ status: "decided_before" });
    expect(w.lots.size).toBe(1);
    expect(w.events).toHaveLength(1);
    // A concurrent caller that passed the decision read still gets the same lot (UNIQUE source, source_id).
    w.events.length = 0;
    expect(await reward(sb)).toEqual({ status: "decided_before" });
  });

  it("a skip is written once; later charges for the same referral write nothing", async () => {
    const old = world({ refereeCreatedAt: "2026-09-01T00:00:00Z" });
    const { sb } = db(old);
    await reward(sb);
    old.subs[0].granted_payment_ids!.push({ payment_id: "pay_renew", amount_cents: 1900 });
    expect(await reward(sb, { paymentId: "pay_renew" })).toEqual({ status: "decided_before" });
    expect(old.events).toHaveLength(1);
  });

  it("a referrer the scope does not admit still gets the lot, marked referrer_not_admitted", async () => {
    const { sb } = db(w);
    expect(await reward(sb, { referrerAdmitted: async () => false })).toMatchObject({ status: "granted", referrerAdmitted: false });
    expect(w.events[0].event_data).toMatchObject({ outcome: "granted", reason: "referrer_not_admitted" });
    const w2 = world();
    expect(await reward(db(w2).sb, { referrerAdmitted: async () => { throw new Error("db"); } })).toMatchObject({ status: "granted", referrerAdmitted: false });
  });

  it("banned referrer, self-referral, no referral and a refunded payment grant nothing", async () => {
    expect(await reward(db(world({ referrerBanned: true })).sb)).toEqual({ status: "skipped", reason: "referrer_banned" });
    expect(await reward(db(world({ referral: { id: REF_ID, referrer_user_id: REFEREE, referee_user_id: REFEREE, created_at: "2026-10-18T09:00:00Z" } })).sb)).toEqual({ status: "skipped", reason: "self_referral" });
    expect(await reward(db(world({ referral: null })).sb)).toEqual({ status: "no_referral" });
    const refunded = world();
    refunded.subs[0].status = "refunded";
    expect(await reward(db(refunded).sb)).toEqual({ status: "skipped", reason: "payment_refunded" });
  });

  it("a ledger failure writes no decision, so a later call can still grant", async () => {
    const failing = world({ failGrant: true });
    const { sb } = db(failing);
    expect(await reward(sb)).toMatchObject({ status: "error" });
    expect(failing.events).toHaveLength(0);
    failing.failGrant = false;
    expect(await reward(sb)).toMatchObject({ status: "granted" });
  });
});

describe("clawback on refund or dispute", () => {
  it("claws the lot back once and writes one row; unrelated payments only read", async () => {
    const w = world();
    const { sb, calls } = db(w);
    await reward(sb);
    expect(await clawbackReferralMentorCredit(sb as never, ["pay_conv"], "refund.created")).toEqual({ clawed: 1 });
    expect(await clawbackReferralMentorCredit(sb as never, ["pay_conv"], "dispute.created")).toEqual({ clawed: 0 });
    expect(w.lots.get(`first_charge:${REF_ID}`)!.status).toBe("clawed_back");
    expect(w.events.filter((e) => e.event_data.outcome === "clawed_back")).toHaveLength(1);
    const before = calls.length;
    expect(await clawbackReferralMentorCredit(sb as never, ["pay_other"], "refund.created")).toEqual({ clawed: 0 });
    expect(calls.slice(before).every((c) => c.op === "select")).toBe(true);
    expect(await clawbackReferralMentorCredit(sb as never, [], "refund.created")).toEqual({ clawed: 0 });
  });
});

describe("pure helpers", () => {
  it("hasEarlierPaidCharge ignores the current payment and EUR 0 entries", () => {
    const s: RefereeSub = { id: "s", created_at: null, status: "active", amount_cents: 1900, provider_payment_id: "p2", granted_payment_ids: [{ payment_id: "p1", amount_cents: 0 }, { payment_id: "p2", amount_cents: 1900 }] };
    expect(hasEarlierPaidCharge([s], "p2")).toBe(false);
    expect(hasEarlierPaidCharge([s], "p3")).toBe(true);
    expect(hasEarlierPaidCharge([{ ...s, granted_payment_ids: [], provider_payment_id: "old" }], "p2")).toBe(true);
  });
  it("viennaMonthStart resolves local midnight on day 1 (summer and winter time)", () => {
    expect(viennaMonthStart(new Date("2026-10-20T10:00:00Z")).toISOString()).toBe("2026-09-30T22:00:00.000Z");
    expect(viennaMonthStart(new Date("2026-11-01T00:30:00Z")).toISOString()).toBe("2026-10-31T23:00:00.000Z");
    expect(viennaMonthStart(new Date("2026-10-31T23:30:00Z")).toISOString()).toBe("2026-10-31T23:00:00.000Z");
  });
  it("the decision allows a claim right after sign-up and refuses one 25 hours later", () => {
    const base = { paymentId: "p", referral: { id: "r", referrer_user_id: "a", referee_user_id: "b", created_at: "2026-10-18T09:00:00Z" }, refereeSubs: [], referrer: { is_banned: false }, monthCount: 0 };
    expect(decideReferralMentorCredit({ ...base, refereeCreatedAt: "2026-10-17T09:30:00Z" })).toEqual({ grant: true });
    expect(decideReferralMentorCredit({ ...base, refereeCreatedAt: "2026-10-17T08:00:00Z" })).toEqual({ grant: false, reason: "old_account" });
  });
});
