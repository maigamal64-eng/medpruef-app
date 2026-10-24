import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";
import { createFakeSupabase, eqVal, type FakeCall } from "../helpers/fake-supabase";

// a-card-trial-build-1024 (decision whop-card-trial-1024): the 3-day Whop card
// trial. Helper rules, build gate, plan mapping, price parity, copy, the
// pre-charge window and the trial route's eligibility matrix (PLAN 3e).

const USER = "44444444-4444-4444-8444-444444444444";
const h = vi.hoisted(() => ({
  user: { id: "", tier: "free", email: "learner@example.com" } as Record<string, unknown>,
  subs: [] as unknown[],
  trialsByUser: [] as unknown[],
  trialsByEmail: [] as unknown[],
  calls: [] as unknown[],
}));
vi.mock("@sentry/nextjs", () => ({ captureMessage: vi.fn(), captureException: vi.fn() }));
vi.mock("@/lib/paymentEvents", () => ({ logPaymentEvent: vi.fn() }));
vi.mock("@/lib/auth-guard", () => ({ requireUser: vi.fn(async () => ({ userId: "44444444-4444-4444-8444-444444444444" })) }));
vi.mock("@/lib/supabase", () => ({
  getServiceClient: () => {
    const { sb, calls } = createFakeSupabase((c: FakeCall) => {
      if (c.table === "users" && c.op === "select") return { data: h.user };
      if (c.table === "subscriptions" && c.op === "select") return { data: h.subs };
      if (c.table === "trials" && c.op === "select") return { data: eqVal(c, "user_id") ? h.trialsByUser : h.trialsByEmail };
      if (c.table === "payment_events" && c.op === "select") return { data: [] };
      return {};
    });
    h.calls = calls;
    return sb;
  },
}));

import {
  activeCardTrialTier, cardTrialDays, cardTrialEnabled, cardTrialRefusal, cardTrialWindowMs, isCardTrialTier,
  notesTrialEnabled, verifiableCardTrialTiers,
} from "@/lib/card-trial";
import { cardTrialBuildGateError, cardTrialBuildMirror } from "@/lib/card-trial-gate";
import { TIERS as PAY_TIERS } from "@/lib/nowpayments";
import { TIERS } from "@/lib/content-truth";
import { cardTrialCopy } from "@/lib/billing-copy";
import { eligiblePrechargeReminder } from "@/lib/precharge-trial-reminder";
import { trialEmailKey } from "@/lib/pricing-v2/reverse-trial";

const ON = { CARD_TRIAL_ENABLED: "true", WHOP_PLAN_FLEX_TRIAL: "plan_flex" };
const REVERSE = { REVERSE_TRIAL_ENABLED: "true", REVERSE_TRIAL_SINCE: "2026-10-21T10:35:00Z" };
const DAY = 86_400_000;

describe("card-trial helper", () => {
  it("knows both card trial tiers and their days and windows", () => {
    expect(isCardTrialTier("flex_month_trial") && isCardTrialTier("notes_pro_trial")).toBe(true);
    expect(isCardTrialTier("flex_month") || isCardTrialTier("reverse_trial") || isCardTrialTier(null)).toBe(false);
    expect(cardTrialDays("flex_month_trial")).toBe(3);
    expect(cardTrialDays("notes_pro_trial")).toBe(7);
    expect(cardTrialDays("flex_month")).toBe(0);
    expect(cardTrialWindowMs("flex_month_trial")).toBe(4 * DAY);
    expect(cardTrialWindowMs("notes_pro_trial")).toBe(8 * DAY);
    expect(PAY_TIERS.flex_month_trial.trialDays).toBe(3);
    expect(PAY_TIERS.notes_pro_trial.trialDays).toBe(7);
  });

  it("is on only with the literal true, the plan configured and the reverse trial off", () => {
    expect(cardTrialEnabled({})).toBe(false);
    expect(cardTrialEnabled(ON)).toBe(true);
    expect(cardTrialEnabled({ ...ON, CARD_TRIAL_ENABLED: "TRUE" })).toBe(false);
    expect(cardTrialEnabled({ ...ON, WHOP_PLAN_FLEX_TRIAL: "  " })).toBe(false);
    expect(cardTrialEnabled({ ...ON, ...REVERSE })).toBe(false);
    expect(activeCardTrialTier(ON)).toBe("flex_month_trial");
    expect(activeCardTrialTier({ NOTES_TRIAL_ENABLED: "true" })).toBe("notes_pro_trial");
    expect(activeCardTrialTier({ NOTES_TRIAL_ENABLED: "true", ...REVERSE })).toBeNull();
    expect(notesTrialEnabled({ NOTES_TRIAL_ENABLED: "false" })).toBe(false);
    expect(activeCardTrialTier({})).toBeNull();
  });

  it("the runtime switch needs the build copy too (switching on needs a redeploy)", () => {
    vi.stubEnv("CARD_TRIAL_ENABLED", "true");
    vi.stubEnv("WHOP_PLAN_FLEX_TRIAL", "plan_flex");
    vi.stubEnv("NEXT_PUBLIC_CARD_TRIAL", "");
    expect(cardTrialEnabled()).toBe(false);
    vi.stubEnv("NEXT_PUBLIC_CARD_TRIAL", "true");
    expect(cardTrialEnabled()).toBe(true);
    vi.stubEnv("CARD_TRIAL_ENABLED", "false");
    expect(cardTrialEnabled()).toBe(false);
    vi.unstubAllEnvs();
  });

  it("verify still finishes a started 3-day trial after a rollback", () => {
    expect(verifiableCardTrialTiers(ON)).toEqual(["flex_month_trial"]);
    expect(verifiableCardTrialTiers({ WHOP_PLAN_FLEX_TRIAL: "plan_flex" })).toEqual(["flex_month_trial"]);
    expect(verifiableCardTrialTiers({ NOTES_TRIAL_ENABLED: "true", WHOP_PLAN_FLEX_TRIAL: "plan_flex" })).toEqual(["notes_pro_trial", "flex_month_trial"]);
    expect(verifiableCardTrialTiers({})).toEqual([]);
  });

  it("abuse limits: one card trial per account, none after the reverse trial, none for earlier payers or a used email", () => {
    const base = { isPro: false, subscriptions: [], trialRowForUser: false, trialRowForEmail: false };
    const row = (tier: string, over: Record<string, unknown> = {}) => ({ tier, status: "expired", payment_provider: "whop", amount_cents: 0, granted_payment_ids: [], ...over });
    expect(cardTrialRefusal(base)).toBeNull();
    expect(cardTrialRefusal({ ...base, isPro: true })).toBe("pro");
    expect(cardTrialRefusal({ ...base, subscriptions: [row("notes_pro_trial")] })).toBe("card_trial_used");
    expect(cardTrialRefusal({ ...base, subscriptions: [row("flex_month_trial", { status: "cancelled" })] })).toBe("card_trial_used");
    expect(cardTrialRefusal({ ...base, subscriptions: [row("reverse_trial", { payment_provider: "trial" })] })).toBe("reverse_trial_used");
    expect(cardTrialRefusal({ ...base, trialRowForUser: true })).toBe("reverse_trial_used");
    expect(cardTrialRefusal({ ...base, subscriptions: [row("flex_month", { amount_cents: 2400 })] })).toBe("paid_before");
    expect(cardTrialRefusal({ ...base, subscriptions: [row("first_month_19", { amount_cents: 0, granted_payment_ids: [{ amount_cents: 1900 }] })] })).toBe("paid_before");
    // A refunded or charged-back payment is no "paid before"; a manual grant never is.
    expect(cardTrialRefusal({ ...base, subscriptions: [row("flex_month", { amount_cents: 2400, status: "refunded" })] })).toBeNull();
    expect(cardTrialRefusal({ ...base, subscriptions: [row("first_month_19", { amount_cents: 1900, payment_provider: "manual" })] })).toBeNull();
    expect(cardTrialRefusal({ ...base, trialRowForEmail: true })).toBe("email_used");
  });
});

describe("build gate (next.config.ts)", () => {
  it("fails with the card trial next to the reverse or the 7-day trial, or without its plan", () => {
    expect(cardTrialBuildGateError({})).toBeNull();
    expect(cardTrialBuildGateError({ REVERSE_TRIAL_ENABLED: "true" })).toBeNull();
    expect(cardTrialBuildGateError(ON)).toBeNull();
    expect(cardTrialBuildGateError({ ...ON, REVERSE_TRIAL_ENABLED: "true" })).toMatch(/REVERSE_TRIAL_ENABLED/);
    expect(cardTrialBuildGateError({ ...ON, NOTES_TRIAL_ENABLED: "TRUE" })).toMatch(/NOTES_TRIAL_ENABLED/);
    expect(cardTrialBuildGateError({ CARD_TRIAL_ENABLED: "true" })).toMatch(/WHOP_PLAN_FLEX_TRIAL/);
    expect(cardTrialBuildMirror(ON)).toBe("true");
    expect(cardTrialBuildMirror({ ...ON, CARD_TRIAL_ENABLED: "yes" })).toBe("");
  });

  it("next.config.ts runs the gate and mirrors NEXT_PUBLIC_CARD_TRIAL", async () => {
    const { readFileSync } = await import("node:fs");
    const config = readFileSync("next.config.ts", "utf8");
    expect(config).toMatch(/cardTrialBuildGateError\(process\.env\)/);
    expect(config).toMatch(/NEXT_PUBLIC_CARD_TRIAL: cardTrialBuildMirror\(process\.env\)/);
  });
});

describe("plan mapping and price", () => {
  beforeEach(() => vi.stubEnv("WHOP_PLAN_FLEX_TRIAL", " plan_flex "));
  afterEach(() => vi.unstubAllEnvs());
  it("maps WHOP_PLAN_FLEX_TRIAL both ways (renewals carry no metadata)", async () => {
    const { whopPlanToTier, tierToWhopPlan } = await import("@/lib/whop");
    expect(whopPlanToTier("plan_flex")).toBe("flex_month_trial");
    expect(tierToWhopPlan("flex_month_trial")).toBe("plan_flex");
  });
  it("renews at the v2 monthly price, is never sold on another rail and pays no referral cash", () => {
    expect(PAY_TIERS.flex_month_trial.priceCents).toBe(TIERS.flex_month.price_cents);
    expect(PAY_TIERS.flex_month_trial.durationMonths).toBe(1);
    expect(PAY_TIERS.flex_month_trial.available).toBe(false);
    expect(PAY_TIERS.flex_month_trial.referralPayoutCents).toBe(0);
  });
});

describe("copy (Lektor 24 Oct)", () => {
  it.each(["de", "en"] as const)("%s states card, 0 € today, 3 days, 24 € every 30 days, cancel inside: no dashes, no gratis", (lang) => {
    const c = cardTrialCopy(lang);
    const all = Object.values(c).join(" ");
    expect(all).not.toMatch(/[–—]/);
    expect(all.toLowerCase()).not.toMatch(/gratis|free trial|pro monat|per month|monatlich/);
    expect(c.terms).toContain("0 €");
    expect(c.terms).toContain("24 €");
    expect(c.terms).toMatch(lang === "de" ? /alle 30 Tage/ : /every 30 days/);
    expect(c.summary).toMatch(lang === "de" ? /Einmal pro Konto/ : /Once per account/);
    expect(c.button).toBe(lang === "de" ? "Pro 3 Tage testen" : "Try Pro for 3 days");
  });
});

describe("pre-charge reminder fits a 3-day trial", () => {
  const snap = (chargeInMs: number) => ({
    plan_id: "plan_flex", billing_cadence: "auto_renews" as const, provider_status: "trialing", is_trial: true, cancel_at_period_end: false,
    next_charge_at: new Date(Date.now() + chargeInMs).toISOString(), next_charge_amount_cents: 2400, billing_interval_days: 30,
    manage_url: "https://whop.com/@me/settings/memberships", provider_state_verified: true,
  });
  it("is due between 1 and 2 days before the charge, so day 1 to day 2 of the trial", () => {
    expect(eligiblePrechargeReminder(snap(1.5 * DAY), Date.now())).toBe(true);
    expect(eligiblePrechargeReminder(snap(2.5 * DAY), Date.now())).toBe(false);
    expect(eligiblePrechargeReminder(snap(0.5 * DAY), Date.now())).toBe(false);
  });
});

describe("GET /api/whop/trial eligibility matrix (3-day trial on)", () => {
  async function load(env: Record<string, string> = {}) {
    vi.stubEnv("CARD_TRIAL_ENABLED", "true");
    vi.stubEnv("NEXT_PUBLIC_CARD_TRIAL", "true");
    vi.stubEnv("WHOP_PLAN_FLEX_TRIAL", "plan_flex");
    vi.stubEnv("NOTES_TRIAL_ENABLED", "false");
    vi.stubEnv("REVERSE_TRIAL_ENABLED", "false");
    vi.stubEnv("NEXT_PUBLIC_REVERSE_TRIAL", "");
    for (const [k, v] of Object.entries(env)) vi.stubEnv(k, v);
    vi.resetModules();
    return (await import("@/app/api/whop/trial/route")).GET;
  }
  const get = async (env?: Record<string, string>) =>
    (await (await load(env))(new NextRequest("https://x/api/whop/trial", { headers: { "x-session-token": "t" } }))).json();
  beforeEach(() => {
    h.user = { id: USER, tier: "free", email: "Learner+tag@Example.com" };
    h.subs = []; h.trialsByUser = []; h.trialsByEmail = [];
  });
  afterEach(() => vi.unstubAllEnvs());

  it("offers a new account the 3-day trial at 24 EUR with the charge date 3 days out", async () => {
    const d = await get();
    expect(d).toMatchObject({ eligible: true, trial_enabled: true, tier: "flex_month_trial", trial_days: 3, price_after_cents: 2400, refusal: null });
    expect(Math.abs(Date.parse(d.charge_at) - (Date.now() + 3 * DAY))).toBeLessThan(10_000);
  });
  it("reads the email wall with the reverse trial's normalised key", async () => {
    await get();
    const byEmail = (h.calls as FakeCall[]).find((c) => c.table === "trials" && eqVal(c, "email_key"));
    expect(eqVal(byEmail!, "email_key")).toBe(trialEmailKey("learner@example.com"));
  });
  it.each([
    ["switched off", { CARD_TRIAL_ENABLED: "false" }, () => {}, { eligible: false, trial_enabled: false }],
    ["reverse trial on", { REVERSE_TRIAL_ENABLED: "true", NEXT_PUBLIC_REVERSE_TRIAL: "true", REVERSE_TRIAL_SINCE: "2026-10-21T10:35:00Z" }, () => {}, { eligible: false, trial_enabled: false }],
    ["Pro", {}, () => { h.user = { ...h.user, tier: "pro" }; }, { eligible: false, is_pro: true, refusal: "pro" }],
    ["used 7-day trial", {}, () => { h.subs = [{ tier: "notes_pro_trial", status: "expired", payment_provider: "whop", amount_cents: 0 }]; }, { eligible: false, already_trialed: true, refusal: "card_trial_used" }],
    ["used reverse trial", {}, () => { h.trialsByUser = [{ id: 1 }]; }, { eligible: false, refusal: "reverse_trial_used" }],
    ["paid before", {}, () => { h.subs = [{ tier: "flex_month", status: "expired", payment_provider: "whop", amount_cents: 2400 }]; }, { eligible: false, refusal: "paid_before" }],
    ["email used", {}, () => { h.trialsByEmail = [{ id: 2 }]; }, { eligible: false, refusal: "email_used" }],
  ] as const)("%s", async (_label, env, arrange, expected) => {
    arrange();
    expect(await get(env as Record<string, string>)).toMatchObject(expected);
  });

  it("POST refuses a used trial with its reason and never opens a checkout", async () => {
    h.subs = [{ tier: "flex_month_trial", status: "cancelled", payment_provider: "whop", amount_cents: 0 }];
    const POST = (await (async () => { await load(); return (await import("@/app/api/whop/trial/route")).POST; })());
    const fetchSpy = vi.fn();
    vi.stubGlobal("fetch", fetchSpy);
    const res = await POST(new NextRequest("https://x/api/whop/trial", { method: "POST", headers: { "x-session-token": "t" } }));
    expect(res.status).toBe(409);
    expect(await res.json()).toMatchObject({ code: "ALREADY_TRIALED", refusal: "card_trial_used" });
    expect(fetchSpy).not.toHaveBeenCalled();
    vi.unstubAllGlobals();
  });
});
