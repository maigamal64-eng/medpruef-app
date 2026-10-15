import { describe, expect, it, vi } from "vitest";

vi.mock("@sentry/nextjs", () => ({ captureMessage: vi.fn(), captureException: vi.fn() }));

import replies from "../mentor/core/fixtures/rpc-replies.json";
import {
  FREE_CREDIT_DEFAULTS,
  includedAmountOverrides,
  normalizeCampaignCode,
  parseHouseGrantsScope,
  readFreeCreditConfig,
} from "@/lib/mentor/credits/free-credits";
import { houseGrantsAllowed, type MentorScopeReads } from "@/lib/mentor/access";
import { planIncludedGrantsDetailed, type EntitlementSnapshot, type IncludedPackageRow } from "@/lib/mentor/credits/included";
import { decideWelcome, welcomeEligible, createWallet } from "@/lib/mentor/credits/wallet";
import { fundedOnlyByFreeLots, houseCapApplies, houseCapConsidered, houseCapDecision, readHouseCostThisMonth, utcMonthStart } from "@/lib/mentor/credits/house-cap";
import { MENTOR_CONFIG_DEFAULTS, type MentorConfig } from "@/lib/mentor/config";
import type { MentorPackageId, MentorUsageResponse } from "@/lib/mentor/contract";
import { handleMentorUsage, type UsageHandlerDeps } from "@/app/api/mentor/usage/handler";
import { handleMentorChat, type ChatHandlerDeps } from "@/app/api/mentor/chat/handler";
import { createRunMentorTurn } from "@/lib/mentor/turn";
import { USER, makeDeps } from "../mentor/core/helpers";
import { createFakeSupabase } from "../helpers/fake-supabase";

const R = replies as Record<string, unknown>;
const NOW = new Date("2026-10-20T10:00:00Z");
const DAY = 86_400_000;

// ─── Config ─────────────────────────────────────────────────────────────

describe("free credit config: every flag defaults OFF, amounts apply only while their flag is on", () => {
  it("defaults", () => {
    const c = readFreeCreditConfig({});
    expect(c).toMatchObject({
      houseGrantsScope: "allowlist", includedRaise: false, welcomeEnabled: false, referralRaise: false,
      referralTrialStartEnabled: false, experienceEnabled: false, campaignEnabled: false,
      // Flag off: today's referral reward and cap, byte for byte.
      referralFirstChargeCredits: 50, referralFirstChargeMonthlyCap: 3,
      welcomeCredits: 25, welcomeExpiryDays: 30, welcomeMonthlyCap: 200, welcomeMinQuestions: 10,
      experienceCredits: 100, houseCostCapMicro: 250_000, houseCostCapTasteMicro: 100_000,
    });
    expect(includedAmountOverrides(c)).toEqual({});
  });
  it("flags are strict literals; the scope widens only on the exact literal", () => {
    for (const v of ["TRUE", "1", "yes", " on"]) {
      expect(readFreeCreditConfig({ MENTOR_WELCOME_ENABLED: v }).welcomeEnabled).toBe(false);
      expect(readFreeCreditConfig({ MENTOR_INCLUDED_RAISE_ENABLED: v }).includedRaise).toBe(false);
    }
    expect(readFreeCreditConfig({ MENTOR_WELCOME_ENABLED: " true " }).welcomeEnabled).toBe(true);
    for (const v of [undefined, "", "all", "SIGNED_IN", "paid", "allowlist"]) expect(parseHouseGrantsScope(v)).toBe("allowlist");
    expect(parseHouseGrantsScope(" signed_in ")).toBe("signed_in");
  });
  it("raise flags switch the decided amounts on; env tunes them within bounds", () => {
    const on = readFreeCreditConfig({ MENTOR_INCLUDED_RAISE_ENABLED: "true", REFERRAL_MENTOR_RAISE_ENABLED: "true" });
    expect(includedAmountOverrides(on)).toEqual({ included_pro_monthly: 1_000_000, included_pro_quarterly: 1_000_000, included_cohort: 2_000_000, trial_taste: 500_000 });
    expect(on.referralFirstChargeCredits).toBe(200);
    expect(on.referralFirstChargeMonthlyCap).toBe(5);
    expect(readFreeCreditConfig({ REFERRAL_MENTOR_RAISE_ENABLED: "true", REFERRAL_MENTOR_CREDITS_AMOUNT: "120", REFERRAL_MENTOR_MONTHLY_CAP: "4" })).toMatchObject({ referralFirstChargeCredits: 120, referralFirstChargeMonthlyCap: 4 });
    // Amount env without the flag changes nothing.
    expect(readFreeCreditConfig({ REFERRAL_MENTOR_CREDITS_AMOUNT: "120" }).referralFirstChargeCredits).toBe(50);
    // Out of range or junk falls back to the default.
    expect(readFreeCreditConfig({ MENTOR_WELCOME_CREDITS: "-5" }).welcomeCredits).toBe(25);
    expect(readFreeCreditConfig({ MENTOR_WELCOME_CREDITS: "2.5" }).welcomeCredits).toBe(25);
    expect(readFreeCreditConfig({ MENTOR_INCLUDED_PRO_CREDITS: "99999" }).proIncludedCredits).toBe(FREE_CREDIT_DEFAULTS.proIncludedCredits);
  });
  it("campaign codes normalise to upper case and refuse junk", () => {
    expect(normalizeCampaignCode(" tg-spt ")).toBe("TG-SPT");
    expect(normalizeCampaignCode("FRISTEN")).toBe("FRISTEN");
    for (const bad of ["", "AB", "TG--SPT", "-TGS", "TGS-", "TG SPT", "Ä123", "A".repeat(25), 7, null]) expect(normalizeCampaignCode(bad)).toBeNull();
  });
});

// ─── Spine gate ─────────────────────────────────────────────────────────

describe("house-funded grants: allowlist always, scope only with MENTOR_HOUSE_GRANTS_SCOPE=signed_in", () => {
  it.each([
    ["allowlist", "allowlist", true], ["allowlist", "scope", false], ["allowlist", null, false],
    ["signed_in", "allowlist", true], ["signed_in", "scope", true], ["signed_in", null, false],
  ] as const)("scope %s, via %s -> %s", (scope, via, want) => {
    expect(houseGrantsAllowed(scope, via)).toBe(want);
  });
  it("an absent config keeps today's rule", () => {
    expect(houseGrantsAllowed(undefined, "scope")).toBe(false);
    expect(houseGrantsAllowed(undefined, "allowlist")).toBe(true);
  });
});

// ─── Planner ────────────────────────────────────────────────────────────

const row = (package_id: MentorPackageId, grant_micro: number, expiry_days = 30): IncludedPackageRow => ({ package_id, grant_micro, expiry_days, active: true });
const PACKAGES = new Map<MentorPackageId, IncludedPackageRow>([
  ["included_pro_monthly", row("included_pro_monthly", 250_000, 33)],
  ["included_pro_quarterly", row("included_pro_quarterly", 250_000, 33)],
  ["included_cohort", row("included_cohort", 750_000, 33)],
  ["trial_taste", row("trial_taste", 100_000, 7)],
  ["free_taste", row("free_taste", 25_000)],
  ["welcome_taste", row("welcome_taste", 125_000)],
  ["gift_admin", row("gift_admin", 250_000)],
]);
const free = { id: USER, role: "user", tier: "free", tier_expires_at: null, email_verified_at: null, telegram_id: null, is_banned: false };
function snap(over: Partial<EntitlementSnapshot> = {}): EntitlementSnapshot {
  return { user: free, subs: [], referrals: [], packages: PACKAGES, freeEnabled: false, ...over };
}
const sub = (tier: string, over: Record<string, unknown> = {}) => ({
  id: `sub-${tier}`, tier, status: "active", payment_provider: "whop", amount_cents: 1900,
  started_at: new Date(NOW.getTime() - 5 * DAY).toISOString(), expires_at: new Date(NOW.getTime() + 25 * DAY).toISOString(), ...over,
});

describe("planIncludedGrantsDetailed", () => {
  it("flag off: Pro gets the row amount (micro null), exactly as before", () => {
    const { grants, branch } = planIncludedGrantsDetailed(snap({ subs: [sub("first_month_19")] }), NOW);
    expect(branch).toBe("paid");
    expect(grants).toHaveLength(1);
    expect(grants[0]).toMatchObject({ packageId: "included_pro_monthly", source: "pro_included", micro: null });
  });
  it("raise on: Pro 200, Cohort 400, card trial 100; the larger amount still wins", () => {
    const amounts = includedAmountOverrides(readFreeCreditConfig({ MENTOR_INCLUDED_RAISE_ENABLED: "true" }));
    expect(planIncludedGrantsDetailed(snap({ subs: [sub("first_3mo_27")], amounts }), NOW).grants[0]).toMatchObject({ packageId: "included_pro_quarterly", micro: 1_000_000 });
    const both = planIncludedGrantsDetailed(snap({ subs: [sub("first_month_19"), sub("premium_pass_guaranteed", { id: "c" })], amounts }), NOW).grants;
    expect(both).toHaveLength(1);
    expect(both[0]).toMatchObject({ packageId: "included_cohort", micro: 2_000_000 });
    const trial = planIncludedGrantsDetailed(snap({ subs: [sub("notes_pro_trial", { amount_cents: 0, expires_at: new Date(NOW.getTime() + 7 * DAY).toISOString() })], amounts }), NOW);
    expect(trial.branch).toBe("trial");
    expect(trial.grants[0]).toMatchObject({ packageId: "trial_taste", source: "trial_taste", sourceId: USER, micro: 500_000 });
    // An admin gift keeps its row amount.
    expect(planIncludedGrantsDetailed(snap({ subs: [sub("first_month_19", { payment_provider: "manual" })], amounts }), NOW).grants[0]).toMatchObject({ packageId: "gift_admin", micro: null });
  });
  it("a banned account gets nothing at all", () => {
    const r = planIncludedGrantsDetailed(snap({ user: { ...free, is_banned: true }, subs: [sub("first_month_19")], freeEnabled: true }), NOW);
    expect(r).toEqual({ grants: [], branch: "banned" });
  });
  it("free branch: the welcome lot (every mode) when the wallet cleared it, keyed by the account", () => {
    const r = planIncludedGrantsDetailed(snap({ welcome: { micro: 125_000, expiryDays: 30 } }), NOW);
    expect(r.branch).toBe("free");
    expect(r.grants[0]).toMatchObject({ packageId: "welcome_taste", source: "welcome_taste", sourceId: USER, micro: 125_000 });
    expect(r.grants[0].expiresAt!.getTime() - NOW.getTime()).toBe(30 * DAY);
  });
  it("free branch without the welcome lot: the legacy facts-only taste only while MENTOR_FREE_ENABLED and verified", () => {
    expect(planIncludedGrantsDetailed(snap(), NOW)).toEqual({ grants: [], branch: "free" });
    expect(planIncludedGrantsDetailed(snap({ freeEnabled: true }), NOW).grants).toEqual([]);
    const v = planIncludedGrantsDetailed(snap({ freeEnabled: true, user: { ...free, telegram_id: 42 } }), NOW).grants;
    expect(v[0]).toMatchObject({ source: "free_taste" });
  });
  it("no welcome package row (changeset not applied) = no welcome grant", () => {
    const packages = new Map(PACKAGES);
    packages.delete("welcome_taste");
    expect(planIncludedGrantsDetailed(snap({ packages, welcome: { micro: 125_000, expiryDays: 30 } }), NOW).grants).toEqual([]);
  });
  it("Pro learners never get the welcome lot", () => {
    const r = planIncludedGrantsDetailed(snap({ subs: [sub("first_month_19")], welcome: { micro: 125_000, expiryDays: 30 } }), NOW);
    expect(r.grants[0].source).toBe("pro_included");
  });
});

// ─── Welcome decision ───────────────────────────────────────────────────

function welcomeDb(o: { existing?: boolean; answers?: number[]; month?: number; fail?: string } = {}) {
  return createFakeSupabase((c) => {
    if (o.fail && c.table === o.fail) return { error: { code: "57014" } };
    if (c.table === "ai_credit_lot") {
      const sid = c.filters.find((f) => f.column === "source_id");
      if (sid) return { data: o.existing ? [{ id: "w" }] : [] };
      return { data: Array.from({ length: o.month ?? 0 }, (_, i) => ({ id: `m${i}` })) };
    }
    if (c.table === "answer_history") return { data: (o.answers ?? []).map((q) => ({ question_id: q })) };
    return { data: [] };
  });
}
const WELCOME_ON = readFreeCreditConfig({ MENTOR_WELCOME_ENABLED: "true" });

describe("welcome lot eligibility and breaker", () => {
  it("eligible: not banned AND (verified OR 10+ distinct questions)", () => {
    expect(welcomeEligible({ ...free, email_verified_at: "2026-10-01T00:00:00Z" }, null, 10)).toBe(true);
    expect(welcomeEligible({ ...free, telegram_id: 7 }, null, 10)).toBe(true);
    expect(welcomeEligible(free, 9, 10)).toBe(false);
    expect(welcomeEligible(free, 10, 10)).toBe(true);
    expect(welcomeEligible({ ...free, is_banned: true, telegram_id: 7 }, 50, 10)).toBe(false);
  });
  it("flag off: no read at all", async () => {
    const { sb, calls } = welcomeDb();
    expect(await decideWelcome(sb as never, free, readFreeCreditConfig({}), NOW)).toBeNull();
    expect(calls).toHaveLength(0);
  });
  it("an existing welcome lot stops before any other read", async () => {
    const { sb, calls } = welcomeDb({ existing: true, answers: Array.from({ length: 20 }, (_, i) => i) });
    expect(await decideWelcome(sb as never, free, WELCOME_ON, NOW)).toBeNull();
    expect(calls).toHaveLength(1);
  });
  it("unverified: counts distinct answered questions (repeats do not count)", async () => {
    const nine = welcomeDb({ answers: [1, 2, 3, 4, 5, 6, 7, 8, 9, 9, 9, 9] });
    expect(await decideWelcome(nine.sb as never, free, WELCOME_ON, NOW)).toBeNull();
    const ten = welcomeDb({ answers: [1, 2, 3, 4, 5, 6, 7, 8, 9, 10] });
    expect(await decideWelcome(ten.sb as never, free, WELCOME_ON, NOW)).toEqual({ micro: 125_000, expiryDays: 30 });
  });
  it("verified accounts skip the activity read", async () => {
    const { sb, calls } = welcomeDb();
    expect(await decideWelcome(sb as never, { ...free, telegram_id: 1 }, WELCOME_ON, NOW)).toEqual({ micro: 125_000, expiryDays: 30 });
    expect(calls.some((c) => c.table === "answer_history")).toBe(false);
    // The breaker counts this Vienna month's welcome lots.
    const breaker = calls.find((c) => c.table === "ai_credit_lot" && c.filters.some((f) => f.kind === "gte"));
    expect(breaker?.filters).toEqual(expect.arrayContaining([{ kind: "eq", column: "source", value: "welcome_taste" }, { kind: "gte", column: "created_at", value: "2026-09-30T22:00:00.000Z" }]));
  });
  it("the monthly breaker refuses at the cap; a read error throws (the wallet skips the bonus)", async () => {
    const full = welcomeDb({ month: 200 });
    expect(await decideWelcome(full.sb as never, { ...free, telegram_id: 1 }, WELCOME_ON, NOW)).toBeNull();
    const cap0 = readFreeCreditConfig({ MENTOR_WELCOME_ENABLED: "true", MENTOR_WELCOME_MONTHLY_CAP: "0" });
    expect(await decideWelcome(welcomeDb().sb as never, { ...free, telegram_id: 1 }, cap0, NOW)).toBeNull();
    await expect(decideWelcome(welcomeDb({ fail: "ai_credit_lot" }).sb as never, free, WELCOME_ON, NOW)).rejects.toThrow();
  });
});

describe("wallet.ensureIncludedGrants with the welcome lot", () => {
  function walletDb(o: { grantOk?: boolean; banned?: boolean } = {}) {
    return createFakeSupabase((c) => {
      if (c.table === "users") return { data: { ...free, telegram_id: 9, is_banned: o.banned ?? false } };
      if (c.table === "subscriptions") return { data: [] };
      if (c.table === "ai_credit_package") return { data: [...PACKAGES.values()].map((p) => ({ ...p, kind: "gift", period_days: null, price_eur_cents: null, provisional: false, sort: 1, note: null })) };
      if (c.table === "ai_credit_lot") return { data: [] };
      if (c.table === "rpc:mentor_grant_credits") return o.grantOk === false ? { data: { ok: false, reason: "db_error" } } : { data: { ok: true, duplicate: false, lot_id: "l1", granted_micro: 125000 } };
      return { data: [] };
    });
  }
  it("grants welcome_taste to an eligible free account; never the facts-only taste at the same time", async () => {
    const { sb, calls } = walletDb();
    await createWallet(sb as never, { freeEnabled: true, freeCredits: WELCOME_ON }).ensureIncludedGrants(USER, NOW);
    const grants = calls.filter((c) => c.table === "rpc:mentor_grant_credits").map((c) => c.payload as Record<string, unknown>);
    expect(grants).toHaveLength(1);
    expect(grants[0]).toMatchObject({ p_package: "welcome_taste", p_source: "welcome_taste", p_source_id: USER, p_micro: 125_000 });
  });
  it("a failed welcome grant never blocks the mentor", async () => {
    const { sb } = walletDb({ grantOk: false });
    await expect(createWallet(sb as never, { freeCredits: WELCOME_ON }).ensureIncludedGrants(USER, NOW)).resolves.toBeUndefined();
  });
  it("a banned account: no grant, no welcome reads", async () => {
    const { sb, calls } = walletDb({ banned: true });
    await createWallet(sb as never, { freeCredits: WELCOME_ON }).ensureIncludedGrants(USER, NOW);
    expect(calls.some((c) => c.table === "rpc:mentor_grant_credits" || c.table === "answer_history")).toBe(false);
  });
});

// ─── House cap ──────────────────────────────────────────────────────────

const lot = (source: string, remainingMicro = 50_000) => ({ source, remainingMicro, startsAt: "2026-10-01T00:00:00Z", expiresAt: "2026-11-30T00:00:00Z" });
const FC = readFreeCreditConfig({});

describe("G0 house cap", () => {
  it("considered only when a free credit hook is on", () => {
    expect(houseCapConsidered(FC)).toBe(false);
    expect(houseCapConsidered({ ...FC, houseGrantsScope: "signed_in" })).toBe(true);
    expect(houseCapConsidered({ ...FC, campaignEnabled: true })).toBe(true);
  });
  it("applies to scope admissions only, under the signed_in scope or with a hook lot", () => {
    const nowMs = NOW.getTime();
    expect(houseCapApplies("allowlist", { houseGrantsScope: "signed_in" }, [lot("welcome_taste")], nowMs)).toBe(false);
    expect(houseCapApplies("scope", { houseGrantsScope: "allowlist" }, [lot("whop_payment")], nowMs)).toBe(false);
    expect(houseCapApplies("scope", { houseGrantsScope: "allowlist" }, [lot("campaign_code")], nowMs)).toBe(true);
    expect(houseCapApplies("scope", { houseGrantsScope: "signed_in" }, [], nowMs)).toBe(true);
  });
  it("free-only accounts: cap USD 0.10 then blocked; others: USD 0.25 then half the daily limit", () => {
    const nowMs = NOW.getTime();
    expect(fundedOnlyByFreeLots([lot("welcome_taste"), lot("campaign_code")], nowMs)).toBe(true);
    expect(fundedOnlyByFreeLots([lot("welcome_taste"), lot("whop_payment")], nowMs)).toBe(false);
    expect(fundedOnlyByFreeLots([lot("whop_payment", 0), lot("welcome_taste")], nowMs)).toBe(true);
    expect(fundedOnlyByFreeLots([], nowMs)).toBe(false);
    const taste = [lot("welcome_taste")];
    expect(houseCapDecision({ lots: taste, nowMs, houseCostMicro: 99_999, ratePerDay: 60, fc: FC })).toEqual({ state: "under", ratePerDay: 60, capMicro: 100_000 });
    expect(houseCapDecision({ lots: taste, nowMs, houseCostMicro: 100_000, ratePerDay: 60, fc: FC })).toEqual({ state: "blocked", ratePerDay: 0, capMicro: 100_000 });
    const paid = [lot("whop_payment")];
    expect(houseCapDecision({ lots: paid, nowMs, houseCostMicro: 200_000, ratePerDay: 60, fc: FC }).state).toBe("under");
    expect(houseCapDecision({ lots: paid, nowMs, houseCostMicro: 250_000, ratePerDay: 60, fc: FC })).toEqual({ state: "halved", ratePerDay: 30, capMicro: 250_000 });
  });
  it("reads this UTC month's house_cost rows and sums them; a read error throws", async () => {
    expect(utcMonthStart(new Date("2026-10-31T23:30:00Z")).toISOString()).toBe("2026-10-01T00:00:00.000Z");
    const { sb, calls } = createFakeSupabase(() => ({ data: [{ cost_micro: 1800 }, { cost_micro: "700" }, { cost_micro: null }] }));
    expect(await readHouseCostThisMonth(sb, USER, NOW)).toBe(2500);
    expect(calls[0].filters).toEqual(expect.arrayContaining([{ kind: "eq", column: "kind", value: "house_cost" }, { kind: "gte", column: "created_at", value: "2026-10-01T00:00:00.000Z" }]));
    await expect(readHouseCostThisMonth(createFakeSupabase(() => ({ error: { code: "57014" } })).sb, USER, NOW)).rejects.toThrow();
  });
});

// ─── Handlers ───────────────────────────────────────────────────────────

const OTHER = "99999999-9999-4999-8999-999999999999";
function cfg(over: Partial<MentorConfig> = {}): MentorConfig {
  return { ...MENTOR_CONFIG_DEFAULTS, aiFeaturesEnabled: true, enabled: true, packagesEnabled: true, betaUserIds: [OTHER], accessScope: "signed_in", ...over };
}
const freeReads: MentorScopeReads = { paidAccess: async () => false, holdsLiveLot: async () => false, accountOk: async () => true };
function rpc(rec: Array<Record<string, unknown>> = []) {
  return {
    rpc(fn: string, args: Record<string, unknown>) {
      if (fn === "mentor_reserved_attempt") {
        rec.push(args);
        return Promise.resolve({ data: Number(args.p_per_day) <= 0 ? R.attempt_day : R.attempt_ok, error: null });
      }
      const map: Record<string, unknown> = { ai_spend_month: R.spend_month, ai_spend_cap: R.spend_cap };
      if (!(fn in map)) return Promise.resolve({ data: null, error: { code: "PGRST202", message: `missing ${fn}` } });
      return Promise.resolve({ data: map[fn], error: null });
    },
  };
}

describe("usage handler follows the house-grant decision", () => {
  function usage(over: Partial<UsageHandlerDeps>, grantMicro = 0) {
    const env = makeDeps([], { grantMicro });
    const ensure = vi.spyOn(env.deps.wallet, "ensureIncludedGrants");
    const deps: UsageHandlerDeps = {
      config: cfg(), env: { WHOP_PLAN_MENTOR_BASIS: "plan_b" },
      authenticate: async () => ({ ok: true, userId: USER, paidAccess: false }),
      flag: async () => true, betaAllowed: async () => false, scopeReads: () => freeReads,
      rpc: rpc(), services: () => ({ brain: env.deps.brain, facts: env.deps.facts, wallet: env.deps.wallet }),
      clock: env.deps.clock, subscriptions: async () => [], activePackageIds: async () => new Set(["mentor_basis"]),
      trialProIncludedCredits: async () => 200, alert: () => {}, ...over,
    };
    return { deps, ensure, env };
  }
  const get = () => new Request("http://localhost/api/mentor/usage");
  it("scope unset: unchanged (no grant, credits_only)", async () => {
    const { deps, ensure } = usage({});
    const body = (await (await handleMentorUsage(get(), deps)).json()) as MentorUsageResponse;
    expect(ensure).not.toHaveBeenCalled();
    expect(body.credits_only).toBe(true);
  });
  it("scope signed_in: the scope-admitted account gets its grants and no credits_only flag", async () => {
    const { deps, ensure } = usage({ houseGrantsScope: "signed_in" });
    const body = (await (await handleMentorUsage(get(), deps)).json()) as MentorUsageResponse;
    expect(ensure).toHaveBeenCalledTimes(1);
    expect(body).not.toHaveProperty("credits_only");
  });
  it("free_credits_only appears when every live lot is a free lot", async () => {
    const { deps, env } = usage({ houseGrantsScope: "signed_in", freeCreditHooksOn: true }, 125_000);
    vi.spyOn(env.deps.wallet, "balance").mockResolvedValue({
      availableMicro: 125_000, lotsMicro: 125_000, reservedMicro: 0, debtMicro: 0, nextExpiry: "2026-11-30T00:00:00Z", everGranted: true,
      lots: [{ lotId: "l", packageId: "welcome_taste", kind: "gift", source: "welcome_taste", remainingMicro: 125_000, grantedMicro: 125_000, startsAt: "2026-10-01T00:00:00Z", expiresAt: "2026-11-30T00:00:00Z" }],
    });
    const body = (await (await handleMentorUsage(get(), deps)).json()) as MentorUsageResponse;
    expect(body.free_credits_only).toBe(true);
    expect(body.state).toBe("ok");
    // Every hook off: the field never appears (a deploy changes nothing for beta and trial holders).
    const off = usage({}, 125_000);
    vi.spyOn(off.env.deps.wallet, "balance").mockResolvedValue(await env.deps.wallet.balance(USER));
    expect(((await (await handleMentorUsage(get(), off.deps)).json()) as MentorUsageResponse).free_credits_only).toBeUndefined();
  });
});

describe("chat handler: house grants and the house cap", () => {
  function chat(over: Partial<ChatHandlerDeps>, lots: Array<{ source: string }>, houseCost: number) {
    const env = makeDeps([], { grantMicro: 500_000 });
    const ensure = vi.spyOn(env.deps.wallet, "ensureIncludedGrants");
    const realBalance = env.deps.wallet.balance.bind(env.deps.wallet);
    vi.spyOn(env.deps.wallet, "balance").mockImplementation(async (u) => {
      const b = await realBalance(u);
      return { ...b, lots: b.lots.map((l, i) => ({ ...l, source: (lots[i]?.source ?? l.source) as never })) };
    });
    const attempts: Array<Record<string, unknown>> = [];
    const houseCostThisMonth = vi.fn(async () => houseCost);
    const deps: ChatHandlerDeps = {
      config: { ...env.deps.config, ...cfg() },
      requests: { async claim(_u, _r, id) { return { claimed: true, requestId: id }; }, async finish() {}, async result() { return { status: "missing" }; } },
      recordTurn: async () => {},
      authenticate: async () => ({ ok: true, userId: USER, paidAccess: false }),
      flag: async () => true, betaAllowed: async () => false, scopeReads: () => freeReads,
      rpc: rpc(attempts),
      services: () => ({ brain: env.deps.brain, facts: env.deps.facts, wallet: env.deps.wallet }),
      meterFor: () => env.deps.meter, house: env.deps.house,
      conversations: { async resolve(_u, id) { return { conversationId: id ?? "33333333-3333-4333-8333-333333333333", history: [], isNew: true }; }, async append() { return true; } },
      canReadQuestion: async () => true, callClaude: env.deps.callClaude, clock: env.deps.clock,
      newRequestId: () => "44444444-4444-4444-8444-444444444444",
      runTurn: createRunMentorTurn({ alert: () => {} }), background: () => {}, alert: () => {},
      houseCostThisMonth,
      ...over,
    };
    return { deps, ensure, attempts, houseCostThisMonth };
  }
  const post = () => new Request("http://localhost/api/mentor/chat", { method: "POST", body: JSON.stringify({ client_request_id: "55555555-5555-4555-8555-555555555555", message: "Wie melde ich mich an?", lang: "de", mode: "explain" }) });

  it("every hook off: no grant, no house-cost read, today's daily limit", async () => {
    const { deps, ensure, attempts, houseCostThisMonth } = chat({ freeCredits: readFreeCreditConfig({}) }, [{ source: "whop_payment" }], 999_999);
    await handleMentorChat(post(), deps);
    expect(ensure).not.toHaveBeenCalled();
    expect(houseCostThisMonth).not.toHaveBeenCalled();
    expect(attempts[0]?.p_per_day).toBe(60);
  });
  it("signed_in scope: the grant runs; a free-only account over USD 0.10 is refused for the day", async () => {
    const { deps, ensure, attempts } = chat({ freeCredits: readFreeCreditConfig({ MENTOR_HOUSE_GRANTS_SCOPE: "signed_in" }) }, [{ source: "welcome_taste" }], 100_000);
    const res = await handleMentorChat(post(), deps);
    expect(ensure).toHaveBeenCalledTimes(1);
    // Refused before the rate counter, until the next UTC month.
    expect(attempts).toHaveLength(0);
    expect(res.status).toBe(429);
    const body = await res.json();
    expect(body).toMatchObject({ error: "rate_limited", limit: "month", credits_deducted: false });
    expect(body.retry_after_seconds).toBeGreaterThan(0);
  });
  it("an account with a paid lot over USD 0.25 gets half the daily limit", async () => {
    const { deps, attempts } = chat({ freeCredits: readFreeCreditConfig({ MENTOR_HOUSE_GRANTS_SCOPE: "signed_in" }) }, [{ source: "whop_payment" }], 300_000);
    await handleMentorChat(post(), deps);
    expect(attempts[0]?.p_per_day).toBe(30);
  });
  it("the facts-only free taste rule is unchanged; a welcome lot opens every mode", async () => {
    const welcome = chat({ freeCredits: readFreeCreditConfig({}) }, [{ source: "welcome_taste" }], 0);
    const res = await handleMentorChat(post(), welcome.deps);
    expect(res.status).not.toBe(402);
    const taste = chat({ freeCredits: readFreeCreditConfig({}) }, [{ source: "free_taste" }], 0);
    const blocked = await handleMentorChat(post(), taste.deps);
    expect(blocked.status).toBe(402);
    expect(await blocked.json()).toMatchObject({ error: "credits_required", reason: "facts_only" });
  });
});
