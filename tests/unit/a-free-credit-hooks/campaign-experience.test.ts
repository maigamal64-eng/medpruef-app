import { describe, expect, it, vi } from "vitest";

vi.mock("@sentry/nextjs", () => ({ captureMessage: vi.fn(), captureException: vi.fn() }));

import { accountYoungEnough, campaignLive, parseCampaignInput, readLiveCampaign, redeemCampaignCode, summarizeCampaigns, viennaDayStart, type CampaignRow } from "@/lib/mentor/credits/campaign";
import { grantExperienceReward, readExperienceEligibility, testimonialContext } from "@/lib/mentor/credits/experience";
import { grantKind, summarizeFreeGrants } from "@/lib/mentor/credits/free-grants-admin";
import { readFreeCreditConfig } from "@/lib/mentor/credits/free-credits";
import { freeCreditsCopy, redeemMessageKey } from "@/lib/free-credits-copy";
import { safeNext } from "@/lib/auth-entry";
import { createFakeSupabase } from "../helpers/fake-supabase";

const USER = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const NOW = new Date("2026-10-20T10:00:00Z");

const row = (over: Partial<CampaignRow> = {}): CampaignRow => ({
  code: "TG-SPT", label: "Telegram SPT", credits: 100, expiry_days: 60, total_cap: 200, daily_cap: 50,
  starts_at: "2026-10-01T00:00:00Z", ends_at: "2026-12-31T00:00:00Z", active: true, note: null, created_at: "2026-10-01T00:00:00Z", ...over,
});

describe("campaign codes", () => {
  it("live = active, started and not ended", () => {
    expect(campaignLive(row(), NOW)).toBe(true);
    expect(campaignLive(row({ active: false }), NOW)).toBe(false);
    expect(campaignLive(row({ starts_at: "2026-10-21T00:00:00Z" }), NOW)).toBe(false);
    expect(campaignLive(row({ ends_at: "2026-10-20T10:00:00Z" }), NOW)).toBe(false);
  });
  it("the landing reads only live codes; every other case is the same null", async () => {
    const fake = (data: unknown, error: unknown = null) => createFakeSupabase(() => ({ data, error: error as never })).sb;
    expect(await readLiveCampaign(fake(row()), "tg-spt", NOW)).toEqual({ code: "TG-SPT", credits: 100, expiry_days: 60, ends_at: "2026-12-31T00:00:00Z" });
    expect(await readLiveCampaign(fake(row({ active: false })), "TG-SPT", NOW)).toBeNull();
    expect(await readLiveCampaign(fake(null), "TG-SPT", NOW)).toBeNull();
    expect(await readLiveCampaign(fake(null, { code: "PGRST205" }), "TG-SPT", NOW)).toBeNull();
    const { sb, calls } = createFakeSupabase(() => ({ data: row() }));
    expect(await readLiveCampaign(sb, "../etc", NOW)).toBeNull();
    expect(await readLiveCampaign(sb, "%E0%A4", NOW)).toBeNull();
    expect(calls).toHaveLength(0);
  });
  it("redeem maps the RPC reply; junk never reaches SQL", async () => {
    const ok = createFakeSupabase(() => ({ data: { ok: true, duplicate: false, credits: 100, expires_at: "2026-12-19T10:00:00Z", code: "TG-SPT" } }));
    expect(await redeemCampaignCode(ok.sb as never, USER, " tg-spt ", "landing", 7)).toEqual({ ok: true, duplicate: false, credits: 100, expiresAt: "2026-12-19T10:00:00Z", code: "TG-SPT" });
    expect(ok.calls[0].payload).toEqual({ p_user: USER, p_code: "TG-SPT", p_via: "landing", p_max_account_age_days: 7 });
    const refused = createFakeSupabase(() => ({ data: { ok: false, reason: "daily_cap" } }));
    expect(await redeemCampaignCode(refused.sb as never, USER, "TG-SPT", "settings", 7)).toEqual({ ok: false, reason: "daily_cap" });
    const odd = createFakeSupabase(() => ({ data: { ok: false, reason: "weird" } }));
    expect(await redeemCampaignCode(odd.sb as never, USER, "TG-SPT", "settings", 7)).toEqual({ ok: false, reason: "db_error" });
    const missing = createFakeSupabase(() => ({ error: { code: "PGRST202" } }));
    expect(await redeemCampaignCode(missing.sb as never, USER, "TG-SPT", "settings", 7)).toEqual({ ok: false, reason: "missing_function" });
    const none = createFakeSupabase(() => ({ data: {} }));
    expect(await redeemCampaignCode(none.sb as never, "not-a-uuid", "TG-SPT", "landing", 7)).toEqual({ ok: false, reason: "invalid_args" });
    expect(await redeemCampaignCode(none.sb as never, USER, "x", "landing", 7)).toEqual({ ok: false, reason: "invalid_args" });
    expect(none.calls).toHaveLength(0);
  });
  it("account age window", () => {
    expect(accountYoungEnough("2026-10-14T10:00:00Z", NOW, 7)).toBe(true);
    expect(accountYoungEnough("2026-10-13T09:59:00Z", NOW, 7)).toBe(false);
    expect(accountYoungEnough(null, NOW, 7)).toBe(false);
  });
  it("admin input mirrors the table checks", () => {
    const good = { code: "wnwmed", label: "WNWmed-NOST", credits: 100, expiry_days: 60, total_cap: 60, daily_cap: 60, ends_at: "2027-01-31T23:59:00Z" };
    expect(parseCampaignInput(good, NOW)).toMatchObject({ ok: true, value: { code: "WNWMED", credits: 100 } });
    for (const bad of [{ code: "x" }, { label: "" }, { credits: 0 }, { credits: 1001 }, { expiry_days: 181 }, { daily_cap: 61 }, { ends_at: "2026-10-19T00:00:00Z" }, { ends_at: "2028-01-01T00:00:00Z" }]) {
      expect(parseCampaignInput({ ...good, ...bad }, NOW).ok).toBe(false);
    }
  });
  it("stats: today is the Vienna day; new accounts and payers after redeeming", () => {
    expect(viennaDayStart(NOW).toISOString()).toBe("2026-10-19T22:00:00.000Z");
    const red = [
      { code: "TG-SPT", user_id: "u1", credits: 100, via: "landing", account_created_at: "2026-10-20T09:00:00Z", redeemed_at: "2026-10-20T09:30:00Z" },
      { code: "TG-SPT", user_id: "u2", credits: 100, via: "settings", account_created_at: "2026-09-01T00:00:00Z", redeemed_at: "2026-10-19T21:00:00Z" },
      { code: "TG-SIP", user_id: "u3", credits: 100, via: "landing", account_created_at: "2026-10-18T00:00:00Z", redeemed_at: "2026-10-18T01:00:00Z" },
    ];
    const payers = new Map([["u1", [Date.parse("2026-10-20T09:45:00Z")]], ["u2", [Date.parse("2026-10-01T00:00:00Z")]]]);
    const [spt, sip] = summarizeCampaigns([row(), row({ code: "TG-SIP" })], red, payers, NOW);
    expect(spt).toMatchObject({ redeemed_total: 2, redeemed_today: 1, new_accounts: 1, payers: 1, live: true });
    expect(sip).toMatchObject({ redeemed_total: 1, redeemed_today: 0, new_accounts: 1, payers: 0 });
  });
  it("/gratis is a safe return path after sign-in; other paths are not", () => {
    expect(safeNext("/gratis/TG-SPT?redeem=1&lang=de")).toBe("/gratis/TG-SPT?redeem=1&lang=de");
    expect(safeNext("//evil.example/gratis")).toBe("/");
    expect(safeNext("/gratisx")).toBe("/");
  });
  it("redeem messages: unknown reasons read as unavailable; copy has no dashes and no prices", () => {
    expect(redeemMessageKey("daily_cap")).toBe("daily_cap");
    expect(redeemMessageKey("db_error")).toBe("unavailable");
    for (const lang of ["de", "en"]) {
      const c = freeCreditsCopy(lang);
      const all = [c.landingLead(100), c.landingWhat, c.landingExpiry(60), c.landingRule(7), c.landingFreeStart(150), c.expLead(100, 30), c.expConsent, c.expConsentHelper, c.codeLead(7), c.redeem.account_too_old(7), ...Object.values(c.redeem).filter((x) => typeof x === "string")].join(" ");
      expect(all).not.toMatch(/[–—]/);
      expect(all).not.toMatch(/€|EUR|\bunlimited\b|unbegrenzt|kostenlose KI|free AI/i);
    }
    expect(freeCreditsCopy("de").landingLead(100)).toMatch(/Nostrifizierung in Österreich/);
    expect(freeCreditsCopy("ru").landingTitle(5)).toBe(freeCreditsCopy("en").landingTitle(5));
  });
});

describe("experience reward (testimonial)", () => {
  it("context needs an explicit consent boolean; it stores no sentiment or rating", () => {
    expect(testimonialContext({ consent_public: "yes" }, NOW)).toBeNull();
    expect(testimonialContext({}, NOW)).toBeNull();
    const t = testimonialContext({ consent_public: false, lang: "de", rating: 5 }, NOW)!;
    expect(t).toEqual({ kind: "testimonial", testimonial: { submitted_at: NOW.toISOString(), consent_public: false, consent_version: "2026-10-14" }, lang: "de" });
  });
  it("eligibility facts: distinct questions, Vienna days, ever paid", async () => {
    const { sb } = createFakeSupabase((c) => c.table === "answer_history"
      ? { data: Array.from({ length: 25 }, (_, i) => ({ question_id: i % 21, created_at: i < 10 ? "2026-10-19T21:30:00Z" : "2026-10-20T08:00:00Z" })) }
      : { data: [] });
    expect(await readExperienceEligibility(sb, USER)).toEqual({ distinctQuestions: 21, activeDays: 2, everPaid: false, meetsBar: true });
  });
  function rewardDb(o: { kind?: string; user?: string | null; rewarded?: boolean; banned?: boolean; dup?: boolean; below?: boolean } = {}) {
    return createFakeSupabase((c) => {
      if (c.table === "answer_history") return { data: o.below ? [] : Array.from({ length: 20 }, (_, i) => ({ question_id: i, created_at: i < 10 ? "2026-10-18T08:00:00Z" : "2026-10-19T08:00:00Z" })) };
      if (c.table === "subscriptions") return { data: [] };
      if (c.table === "user_feedback" && c.op === "select") return { data: { id: 7, user_id: o.user === undefined ? USER : o.user, context: { kind: o.kind ?? "testimonial", ...(o.rewarded ? { reward_granted_at: "x" } : {}) } } };
      if (c.table === "user_feedback") return { data: null };
      if (c.table === "users") return { data: { is_banned: o.banned ?? false } };
      if (c.table === "rpc:mentor_grant_credits") return { data: { ok: true, duplicate: o.dup ?? false, lot_id: "lot-1" } };
      return {};
    });
  }
  const fc = readFreeCreditConfig({ MENTOR_EXPERIENCE_REWARD_ENABLED: "true" });
  it("grants 100 credits once per person, keyed testimonial:<user>, then stamps the row", async () => {
    const { sb, calls } = rewardDb();
    expect(await grantExperienceReward(sb as never, 7, "admin-1", fc, NOW)).toMatchObject({ ok: true, credits: 100 });
    expect(calls.find((c) => c.table === "rpc:mentor_grant_credits")!.payload).toMatchObject({ p_package: "experience_reward", p_source: "experience_reward", p_source_id: `testimonial:${USER}`, p_micro: 500_000 });
    const stamp = calls.find((c) => c.table === "user_feedback" && c.op === "update")!;
    expect(stamp.filters).toEqual(expect.arrayContaining([{ kind: "is", column: "context->>reward_granted_at", value: null }]));
  });
  it("refuses non-testimonials, anonymous rows, banned accounts and a second reward", async () => {
    expect(await grantExperienceReward(rewardDb({ kind: "bug" }).sb as never, 7, "a", fc, NOW)).toEqual({ ok: false, reason: "not_testimonial" });
    expect(await grantExperienceReward(rewardDb({ user: null }).sb as never, 7, "a", fc, NOW)).toEqual({ ok: false, reason: "anonymous" });
    expect(await grantExperienceReward(rewardDb({ banned: true }).sb as never, 7, "a", fc, NOW)).toEqual({ ok: false, reason: "banned" });
    const below = rewardDb({ below: true });
    expect(await grantExperienceReward(below.sb as never, 7, "a", fc, NOW)).toEqual({ ok: false, reason: "below_bar" });
    expect(below.calls.some((c) => c.table === "rpc:mentor_grant_credits")).toBe(false);
    expect(await grantExperienceReward(rewardDb({ rewarded: true }).sb as never, 7, "a", fc, NOW)).toEqual({ ok: false, reason: "already_rewarded" });
    expect(await grantExperienceReward(rewardDb({ dup: true }).sb as never, 7, "a", fc, NOW)).toEqual({ ok: false, reason: "already_rewarded" });
  });
});

describe("admin grant log", () => {
  it("classifies sources and counts per kind with 8-character account ids", () => {
    expect(grantKind("referral_reward", "trial_start:r")).toBe("referral_trial_start");
    expect(grantKind("referral_reward", "first_charge:r")).toBe("referral_first_charge");
    expect(grantKind("referral_reward", "r")).toBe("referral_exam");
    expect(grantKind("whop_payment", "pay")).toBeNull();
    const s = summarizeFreeGrants([
      { source: "welcome_taste", source_id: USER, user_id: USER, granted_micro: 125_000, created_at: "2026-10-20T09:00:00Z", expires_at: "2026-11-19T09:00:00Z", status: "live" },
      { source: "campaign_code", source_id: `campaign:${USER}`, user_id: USER, granted_micro: 500_000, created_at: "2026-10-19T09:00:00Z", expires_at: "2026-12-18T09:00:00Z", status: "live" },
    ], readFreeCreditConfig({}), new Date("2026-09-30T22:00:00Z"), false);
    expect(s.counts.welcome).toEqual({ lots: 1, credits: 25 });
    expect(s.counts.campaign).toEqual({ lots: 1, credits: 100 });
    expect(s.recent[0].account).toBe("aaaaaaaa");
    expect(s.caps.welcome).toBe(200);
    expect(s.flags.MENTOR_HOUSE_GRANTS_SCOPE).toBe("allowlist");
  });
});
