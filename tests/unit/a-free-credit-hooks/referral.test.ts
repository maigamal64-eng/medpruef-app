import { describe, expect, it, vi } from "vitest";

vi.mock("@sentry/nextjs", () => ({ captureMessage: vi.fn(), captureException: vi.fn() }));

import {
  REFERRAL_MENTOR_EVENT,
  clawbackReferralMentorCredit,
  decisionKind,
  referralMentorCreditsOffered,
  referralMentorTermsOffered,
  rewardReferrerOnFirstCharge,
  rewardReferrerOnTrialStart,
  type RefereeSub,
} from "@/lib/referral-mentor-credits";
import { referralInviteMessage, referralMentorCreditsCopy } from "@/lib/referral-copy";
import { createFakeSupabase, type FakeCall } from "../helpers/fake-supabase";

const REFERRER = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const REFEREE = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";
const REF_ID = "cccccccc-cccc-4ccc-8ccc-cccccccccccc";
const NOW = new Date("2026-10-20T10:00:00Z");
const ON = { REFERRAL_MENTOR_CREDITS_ENABLED: "true" };
const TRIAL_ON = { ...ON, REFERRAL_TRIAL_START_CREDITS_ENABLED: "true" };
const RAISED = { ...ON, REFERRAL_MENTOR_RAISE_ENABLED: "true" };

const val = (c: FakeCall, col: string, kind = "eq") => c.filters.find((f) => f.kind === kind && f.column === col)?.value;

interface World {
  subs: RefereeSub[];
  refereeCreatedAt: string;
  lots: Map<string, { id: string; user_id: string; created_at: string; status: string }>;
  events: Array<{ user_id: string; event_type: string; event_data: Record<string, unknown> }>;
}
function world(over: Partial<World> = {}): World {
  return {
    subs: [{ id: "s1", created_at: "2026-10-18T09:05:00Z", status: "active", amount_cents: 0, provider_payment_id: "pay_trial", granted_payment_ids: [{ payment_id: "pay_trial", amount_cents: 0 }] }],
    refereeCreatedAt: "2026-10-18T08:30:00Z",
    lots: new Map(),
    events: [],
    ...over,
  };
}
function db(w: World) {
  return createFakeSupabase((c) => {
    if (c.table === "referrals") return { data: [{ id: REF_ID, referrer_user_id: REFERRER, referee_user_id: REFEREE, created_at: "2026-10-18T09:00:00Z" }] };
    if (c.table === "payment_events") return { data: [{ user_id: REFEREE }] };
    if (c.table === "users") {
      if (val(c, "id") === REFEREE) return { data: { created_at: w.refereeCreatedAt } };
      return { data: { is_banned: false, referrals_enabled: true } };
    }
    if (c.table === "subscriptions") {
      if (c.filters.some((f) => f.kind === "in")) return { data: [{ user_id: REFEREE }] };
      return { data: w.subs };
    }
    if (c.table === "ai_credit_lot") {
      const sid = val(c, "source_id") as string | undefined;
      if (sid) return { data: w.lots.has(sid) ? [{ id: w.lots.get(sid)!.id }] : [] };
      const prefix = String(val(c, "source_id", "like") ?? "").replace("%", "");
      const since = val(c, "created_at", "gte") as string;
      return { data: [...w.lots.entries()].filter(([k, l]) => k.startsWith(prefix) && l.user_id === val(c, "user_id") && l.created_at >= since).map(([, l]) => ({ id: l.id })) };
    }
    if (c.table === "user_events") {
      if (c.op === "insert") { w.events.push(c.payload as World["events"][number]); return {}; }
      return { data: w.events.filter((e) => e.user_id === val(c, "user_id") && e.event_type === val(c, "event_type")) };
    }
    if (c.table === "rpc:mentor_grant_credits") {
      const a = c.payload as Record<string, string>;
      const existing = w.lots.get(a.p_source_id);
      if (existing) return { data: { ok: true, duplicate: true, lot_id: existing.id } };
      const lot = { id: `lot-${w.lots.size + 1}`, user_id: a.p_user, created_at: NOW.toISOString(), status: "live" };
      w.lots.set(a.p_source_id, lot);
      return { data: { ok: true, duplicate: false, lot_id: lot.id } };
    }
    if (c.table === "rpc:mentor_clawback") {
      const a = c.payload as Record<string, string>;
      const lot = w.lots.get(a.p_source_id);
      if (!lot) return { data: { ok: false, reason: "not_found" } };
      lot.status = "clawed_back";
      return { data: { ok: true, duplicate: false, user_id: lot.user_id, clawed_micro: 1, debt_added_micro: 0 } };
    }
    return {};
  });
}
const trial = (sb: unknown, env: Record<string, string> = TRIAL_ON) => rewardReferrerOnTrialStart(sb as never, { refereeId: REFEREE, via: "webhook_trial", now: NOW, env, referrerAdmitted: async () => true });

describe("referral trial-start reward (REFERRAL_TRIAL_START_CREDITS_ENABLED)", () => {
  it("off (either flag): returns off before any read", async () => {
    const { sb, calls } = db(world());
    expect(await trial(sb, ON)).toEqual({ status: "off" });
    expect(await trial(sb, { REFERRAL_TRIAL_START_CREDITS_ENABLED: "true" })).toEqual({ status: "off" });
    expect(calls).toHaveLength(0);
  });
  it("grants 25 credits for 30 days, keyed trial_start:<referral>, audit kind trial_start", async () => {
    const w = world();
    const { sb, calls } = db(w);
    expect(await trial(sb)).toMatchObject({ status: "granted", duplicate: false });
    const grant = calls.find((c) => c.table === "rpc:mentor_grant_credits")!.payload as Record<string, unknown>;
    expect(grant).toMatchObject({ p_user: REFERRER, p_source: "referral_reward", p_source_id: `trial_start:${REF_ID}`, p_micro: 125_000, p_whop_payment_id: null });
    expect(Date.parse(String(grant.p_expires_at)) - NOW.getTime()).toBe(30 * 86_400_000);
    expect(w.events).toHaveLength(1);
    expect(w.events[0]).toMatchObject({ event_type: REFERRAL_MENTOR_EVENT, event_data: { kind: "trial_start", outcome: "granted", credits: 25 } });
    // A second trial signal (verify after webhook) decides nothing new.
    expect(await trial(sb)).toEqual({ status: "decided_before" });
    expect(w.lots.size).toBe(1);
  });
  it("same new-account and prior-subscription rules", async () => {
    expect(await trial(db(world({ refereeCreatedAt: "2026-09-01T00:00:00Z" })).sb)).toEqual({ status: "skipped", reason: "old_account" });
    const prior = world();
    prior.subs.push({ id: "s0", created_at: "2026-10-01T00:00:00Z", status: "expired", amount_cents: 0, provider_payment_id: null, granted_payment_ids: [] });
    expect(await trial(db(prior).sb)).toEqual({ status: "skipped", reason: "prior_subscription" });
  });
  it("its own cap: the 6th trial-start reward in a Vienna month is refused; first-charge lots do not count", async () => {
    const w = world();
    for (let i = 0; i < 5; i++) w.lots.set(`trial_start:other-${i}`, { id: `t${i}`, user_id: REFERRER, created_at: "2026-10-05T00:00:00Z", status: "live" });
    expect(await trial(db(w).sb)).toEqual({ status: "skipped", reason: "monthly_cap" });
    const w2 = world();
    for (let i = 0; i < 5; i++) w2.lots.set(`first_charge:other-${i}`, { id: `f${i}`, user_id: REFERRER, created_at: "2026-10-05T00:00:00Z", status: "live" });
    expect(await trial(db(w2).sb)).toMatchObject({ status: "granted" });
  });
  it("a trial-start decision never blocks the later first-charge reward; refunds never claw the trial-start lot", async () => {
    const w = world();
    const { sb } = db(w);
    await trial(sb);
    // The referee converts: first paid charge.
    w.subs[0].granted_payment_ids!.push({ payment_id: "pay_conv", amount_cents: 1900 });
    w.subs[0].provider_payment_id = "pay_conv";
    w.subs[0].amount_cents = 1900;
    const r = await rewardReferrerOnFirstCharge(sb as never, { refereeId: REFEREE, paymentId: "pay_conv", amountCents: 1900, via: "webhook", now: NOW, env: RAISED, referrerAdmitted: async () => true });
    expect(r).toMatchObject({ status: "granted" });
    expect(w.lots.has(`first_charge:${REF_ID}`)).toBe(true);
    const first = w.events.find((e) => decisionKind(e.event_data) === "first_charge" && e.event_data.outcome === "granted");
    expect(first?.event_data).toMatchObject({ kind: "first_charge", credits: 200 });
    // Refund of the conversion: only the first-charge lot goes.
    await clawbackReferralMentorCredit(sb as never, ["pay_conv"], "payment.refunded");
    expect(w.lots.get(`first_charge:${REF_ID}`)!.status).toBe("clawed_back");
    expect(w.lots.get(`trial_start:${REF_ID}`)!.status).toBe("live");
  });
  it("old audit rows without a kind are first-charge decisions", () => {
    expect(decisionKind({ referral_id: "x", outcome: "granted" })).toBe("first_charge");
    expect(decisionKind({ kind: "trial_start" })).toBe("trial_start");
    expect(decisionKind(null)).toBe("first_charge");
  });
});

describe("raised first-charge reward (REFERRAL_MENTOR_RAISE_ENABLED)", () => {
  const paid = () => {
    const w = world();
    w.subs[0] = { id: "s1", created_at: "2026-10-18T09:05:00Z", status: "active", amount_cents: 1900, provider_payment_id: "pay_conv", granted_payment_ids: [{ payment_id: "pay_trial", amount_cents: 0 }, { payment_id: "pay_conv", amount_cents: 1900 }] };
    return w;
  };
  const first = (sb: unknown, env: Record<string, string>) => rewardReferrerOnFirstCharge(sb as never, { refereeId: REFEREE, paymentId: "pay_conv", amountCents: 1900, via: "webhook", now: NOW, env, referrerAdmitted: async () => true });
  it("off: 50 credits; on: 200 credits", async () => {
    const a = db(paid());
    await first(a.sb, ON);
    expect((a.calls.find((c) => c.table === "rpc:mentor_grant_credits")!.payload as Record<string, unknown>).p_micro).toBe(250_000);
    const b = db(paid());
    await first(b.sb, RAISED);
    expect((b.calls.find((c) => c.table === "rpc:mentor_grant_credits")!.payload as Record<string, unknown>).p_micro).toBe(1_000_000);
  });
  it("cap 3 while off, 5 while on", async () => {
    const fill = (n: number) => { const w = paid(); for (let i = 0; i < n; i++) w.lots.set(`first_charge:o-${i}`, { id: `o${i}`, user_id: REFERRER, created_at: "2026-10-03T00:00:00Z", status: "live" }); return w; };
    expect(await first(db(fill(3)).sb, ON)).toEqual({ status: "skipped", reason: "monthly_cap" });
    expect(await first(db(fill(3)).sb, RAISED)).toMatchObject({ status: "granted" });
    expect(await first(db(fill(5)).sb, RAISED)).toEqual({ status: "skipped", reason: "monthly_cap" });
  });
  it("offered amount and terms follow the flags", () => {
    const open = { ...ON, AI_FEATURES_ENABLED: "true", MENTOR_ENABLED: "true", MENTOR_ACCESS_SCOPE: "signed_in" };
    expect(referralMentorCreditsOffered(open)).toBe(50);
    expect(referralMentorTermsOffered(open)).toEqual({ monthlyCap: 3, trialStartCredits: null, trialStartMonthlyCap: null });
    const all = { ...open, REFERRAL_MENTOR_RAISE_ENABLED: "true", REFERRAL_TRIAL_START_CREDITS_ENABLED: "true" };
    expect(referralMentorCreditsOffered(all)).toBe(200);
    expect(referralMentorTermsOffered(all)).toEqual({ monthlyCap: 5, trialStartCredits: 25, trialStartMonthlyCap: 5 });
    expect(referralMentorTermsOffered({ ...all, MENTOR_ACCESS_SCOPE: "beta" })).toBeNull();
  });
});

describe("referral copy with terms", () => {
  it("without terms: today's text (cap 3, the trial start alone does not count)", () => {
    const c = referralMentorCreditsCopy("de", 50)!;
    expect(c.line).toContain("50 Credits");
    expect(c.line).toContain("allein zählt noch nicht");
    expect(c.terms).toContain("höchstens 3 solche Belohnungen");
  });
  it("with the raise: the cap from the server", () => {
    expect(referralMentorCreditsCopy("en", 200, { monthlyCap: 5, trialStartCredits: null })!.terms).toContain("at most 5 such rewards");
  });
  it("the trial-start part is retired (a-lektor-copy-1b, activity-only rule): the copy names only the first payment", () => {
    const c = referralMentorCreditsCopy("de", 200, { monthlyCap: 5, trialStartCredits: 25, trialStartMonthlyCap: 5 })!;
    expect(c.line).toContain("200 Credits");
    expect(c.line).not.toContain("25 Credits");
    expect(c.terms).toContain("höchstens 5 solche Belohnungen");
    const invite = referralInviteMessage("de", "https://medpruf.com/r/X", 200, { monthlyCap: 5, trialStartCredits: 25 });
    expect(invite).not.toContain("25, wenn Sie");
    expect(invite).toContain("200 Credits");
    expect(invite.endsWith("https://medpruf.com/r/X")).toBe(true);
    for (const text of [c.line, c.terms, invite]) expect(text).not.toMatch(/[–—]/);
  });

});
