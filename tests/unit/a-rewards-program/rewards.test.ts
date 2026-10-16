import { describe, expect, it, vi } from "vitest";

vi.mock("@sentry/nextjs", () => ({ captureMessage: vi.fn(), captureException: vi.fn() }));

import {
  EXAM_REPORT_BLACKOUT,
  REWARD_ENV,
  examReportBlocked,
  examReportPromptSittings,
  openReportSittings,
  pastSittingByKey,
  readRewardConfig,
  reportableSittings,
  viennaDay,
} from "@/lib/rewards-program";
import { clawbackReward, grantReward, readFixCreditsThisMonth, rewardKey, rewardKindOfLot } from "@/lib/mentor/credits/rewards";
import { examReportContext, grantExamReportReward } from "@/lib/mentor/credits/exam-report";
import { clawbackAppliedFix, rewardAppliedFix } from "@/lib/mentor/credits/fix-reward";
import { REWARD_FLAG_ENVS, readFreeCreditConfig } from "@/lib/mentor/credits/free-credits";
import { houseCapApplies, houseCapConsidered } from "@/lib/mentor/credits/house-cap";
import { grantKind, summarizeFreeGrants } from "@/lib/mentor/credits/free-grants-admin";
import { fixRewardCredits, sanitizeReportContext } from "@/lib/reports/report-status";
import { examReportCopy, PUBLIC_REWARD_DISCLOSURE, sittingLine } from "@/lib/rewards-copy";
import { REPORTS_COPY } from "@/lib/i18n-reports";
import { OFFICIAL_SITTINGS } from "@/lib/exam-dates";
import { createFakeSupabase, type FakeCall } from "../helpers/fake-supabase";

const USER = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const ON = { REWARDS_EXAM_REPORT_ENABLED: "true", REWARDS_FIX_ENABLED: "true" };

describe("config: every reward flag defaults off", () => {
  it("off unless the literal true; amounts follow plan J10", () => {
    const off = readRewardConfig({});
    expect(off.examReportEnabled).toBe(false);
    expect(off.fixEnabled).toBe(false);
    expect(readRewardConfig({ REWARDS_FIX_ENABLED: "1" }).fixEnabled).toBe(false);
    const on = readRewardConfig(ON);
    expect(on).toMatchObject({ examReportEnabled: true, examReportCredits: 150, fixEnabled: true, fixCredits: 10, fixMonthlyCreditCap: 100 });
    expect(readRewardConfig({ ...ON, REWARDS_FIX_CREDITS: "0" }).fixCredits).toBe(10);
  });
  it("free-credits.ts repeats the reward flag names exactly", () => {
    expect([...REWARD_FLAG_ENVS].sort()).toEqual([REWARD_ENV.examReport, REWARD_ENV.fix].sort());
    expect(readFreeCreditConfig({}).rewardLotsEnabled).toBe(false);
    expect(readFreeCreditConfig({ REWARDS_FIX_ENABLED: "true" }).rewardLotsEnabled).toBe(true);
  });
});

describe("exam report timing", () => {
  const at = (iso: string) => new Date(iso);
  it("one reportable unit per exam and date, whatever the publisher", () => {
    const keys = reportableSittings().map((s) => s.key);
    expect(new Set(keys).size).toBe(keys.length);
    expect(keys).toContain("stichprobentest:2027-02-03");
    expect(OFFICIAL_SITTINGS.filter((s) => s.exam_key === "stichprobentest" && s.date === "2027-02-03").length).toBeGreaterThan(1);
  });
  it("never during the plan's November windows or on any official sitting day", () => {
    for (const [a, b] of EXAM_REPORT_BLACKOUT) { expect(examReportBlocked(a)).toBe(true); expect(examReportBlocked(b)).toBe(true); }
    expect(examReportBlocked("2026-11-19")).toBe(true);
    expect(examReportBlocked("2026-11-21")).toBe(false);
    expect(examReportBlocked("2027-02-03")).toBe(true);
    expect(examReportPromptSittings(at("2026-11-19T12:00:00Z"))).toEqual([]);
    expect(examReportPromptSittings(at("2026-11-25T12:00:00Z"))).toEqual([]);
  });
  it("only after the last day, for 30 days; a week counts from its last day", () => {
    expect(examReportPromptSittings(at("2026-11-21T12:00:00Z")).map((s) => s.key)).toEqual(["sip4a:2026-11-18", "sip5a:2026-11-17"]);
    // Exam week 23 to 27 Nov: open from the 28th, not on the 27th.
    expect(openReportSittings(at("2026-11-27T12:00:00Z")).some((s) => s.exam_key === "rezeptierkunde")).toBe(false);
    expect(examReportPromptSittings(at("2026-11-28T12:00:00Z")).map((s) => s.key)).toContain("rezeptierkunde:2026-11-23");
    expect(openReportSittings(at("2026-12-18T12:00:00Z")).map((s) => s.key)).toContain("sip4a:2026-11-18");
    expect(openReportSittings(at("2026-12-19T12:00:00Z")).map((s) => s.key)).not.toContain("sip4a:2026-11-18");
    expect(openReportSittings(at("2026-11-10T12:00:00Z"))).toEqual([]);
  });
  it("Vienna day boundary", () => {
    expect(viennaDay(at("2026-11-18T23:30:00Z"))).toBe("2026-11-19");
  });
  it("a grant needs a known sitting whose last day passed", () => {
    expect(pastSittingByKey("sip4a:2026-11-18", at("2026-11-19T12:00:00Z"))?.key).toBe("sip4a:2026-11-18");
    expect(pastSittingByKey("sip4a:2026-11-18", at("2026-11-18T12:00:00Z"))).toBeNull();
    expect(pastSittingByKey("sip4a:2026-11-19", at("2026-12-01T12:00:00Z"))).toBeNull();
    expect(pastSittingByKey("../x", at("2026-12-01T12:00:00Z"))).toBeNull();
    expect(pastSittingByKey(42, at("2026-12-01T12:00:00Z"))).toBeNull();
  });
  it("submission context: explicit consent and an open sitting; nothing else from the body", () => {
    const now = at("2026-11-22T10:00:00Z");
    expect(examReportContext({ sitting_key: "sip4a:2026-11-18", consent_public: "yes" }, now)).toBe("bad_consent");
    expect(examReportContext({ sitting_key: "sip4a:2027-02-19", consent_public: true }, now)).toBe("sitting_closed");
    expect(examReportContext({ sitting_key: "sip4a:2026-11-18", consent_public: true, lang: "de", rating: 1, passed: true }, now)).toEqual({
      kind: "exam_report", sitting_key: "sip4a:2026-11-18", lang: "de",
      exam_report: { submitted_at: now.toISOString(), sitting_key: "sip4a:2026-11-18", consent_public: true, consent_version: "2026-10-15" },
    });
  });
});

describe("reward keys", () => {
  it("testimonial keeps its source; new kinds use admin_gift with a reward: prefix", () => {
    expect(rewardKey({ kind: "testimonial", userId: USER })).toEqual({ source: "experience_reward", packageId: "experience_reward", sourceId: `testimonial:${USER}` });
    expect(rewardKey({ kind: "exam_report", userId: USER, sittingKey: "sip4a:2026-11-18" })).toEqual({ source: "admin_gift", packageId: "gift_admin", sourceId: `reward:exam_report:sip4a:2026-11-18:${USER}` });
    expect(rewardKey({ kind: "fix", userId: USER, suggestionId: 42 }).sourceId).toBe("reward:fix:42");
    expect(rewardKindOfLot("admin_gift", "reward:fix:42")).toBe("fix");
    expect(rewardKindOfLot("admin_gift", `sub-1:3`)).toBeNull();
    expect(rewardKindOfLot("pro_included", "reward:fix:1")).toBeNull();
    expect(grantKind("admin_gift", "reward:exam_report:x")).toBe("reward_exam_report");
    expect(grantKind("admin_gift", `${USER}:4`)).toBeNull();
  });
});

function ledgerDb(o: { banned?: boolean; missingUser?: boolean; existingLot?: boolean; dup?: boolean; grantOk?: boolean; fixMicro?: number[]; examCount?: number } = {}) {
  return createFakeSupabase((c: FakeCall) => {
    if (c.table === "users") return { data: o.missingUser ? null : { is_banned: o.banned ?? false } };
    if (c.table === "ai_credit_lot" && c.columns === "id" && c.filters.some((f) => f.column === "source_id" && f.kind === "eq")) return { data: o.existingLot ? [{ id: "l" }] : [] };
    if (c.table === "ai_credit_lot" && c.columns === "granted_micro") return { data: (o.fixMicro ?? []).map((m) => ({ granted_micro: m })) };
    if (c.table === "ai_credit_lot" && c.columns === "id") return { count: o.examCount ?? 0 };
    if (c.table === "rpc:mentor_grant_credits") return o.grantOk === false ? { data: { ok: false, reason: "db_error" } } : { data: { ok: true, duplicate: o.dup ?? false, lot_id: "lot-9", granted_micro: 50_000 } };
    if (c.table === "rpc:mentor_clawback") return { data: { ok: true, duplicate: false, user_id: USER, clawed_micro: 50_000, debt_added_micro: 0 } };
    return {};
  });
}

describe("grantReward", () => {
  const NOW = new Date("2026-11-21T10:00:00Z");
  it("grants under the key with explicit micro and expiry", async () => {
    const { sb, calls } = ledgerDb();
    const r = await grantReward(sb as never, { ref: { kind: "fix", userId: USER, suggestionId: 5 }, credits: 10, expiryDays: 60, now: NOW });
    expect(r).toMatchObject({ ok: true, duplicate: false, credits: 10, lotId: "lot-9" });
    expect(calls.find((c) => c.table === "rpc:mentor_grant_credits")!.payload).toMatchObject({ p_user: USER, p_package: "gift_admin", p_source: "admin_gift", p_source_id: "reward:fix:5", p_micro: 50_000, p_expires_at: "2027-01-20T10:00:00.000Z" });
  });
  it("banned or missing accounts never get a lot", async () => {
    for (const o of [{ banned: true }, { missingUser: true }]) {
      const { sb, calls } = ledgerDb(o);
      expect((await grantReward(sb as never, { ref: { kind: "fix", userId: USER, suggestionId: 5 }, credits: 10, expiryDays: 60, now: NOW })).ok).toBe(false);
      expect(calls.some((c) => c.table === "rpc:mentor_grant_credits")).toBe(false);
    }
  });
  it("the breaker refuses a new key but never blocks a retry of a granted key (idempotent repair)", async () => {
    const full = ledgerDb();
    expect(await grantReward(full.sb as never, { ref: { kind: "fix", userId: USER, suggestionId: 5 }, credits: 10, expiryDays: 60, now: NOW, breaker: async () => true })).toEqual({ ok: false, reason: "cap_reached" });
    expect(full.calls.some((c) => c.table === "rpc:mentor_grant_credits")).toBe(false);
    const retry = ledgerDb({ existingLot: true, dup: true });
    expect(await grantReward(retry.sb as never, { ref: { kind: "fix", userId: USER, suggestionId: 5 }, credits: 10, expiryDays: 60, now: NOW, breaker: async () => true })).toMatchObject({ ok: true, duplicate: true });
  });
  it("a failed RPC is grant_failed", async () => {
    const { sb } = ledgerDb({ grantOk: false });
    expect(await grantReward(sb as never, { ref: { kind: "fix", userId: USER, suggestionId: 5 }, credits: 10, expiryDays: 60, now: NOW })).toMatchObject({ ok: false, reason: "grant_failed" });
  });
  it("clawback: unspent part back, missing lot is nothing to do", async () => {
    const { sb, calls } = ledgerDb();
    expect(await clawbackReward(sb as never, { kind: "fix", userId: USER, suggestionId: 5 }, "edit reverted")).toEqual({ ok: true, clawed: true, credits: 10 });
    expect(calls[0].payload).toEqual({ p_source: "admin_gift", p_source_id: "reward:fix:5", p_reason: "edit reverted" });
    const none = createFakeSupabase(() => ({ data: { ok: false, reason: "not_found" } }));
    expect(await clawbackReward(none.sb as never, { kind: "fix", userId: USER, suggestionId: 5 }, "x")).toEqual({ ok: true, clawed: false, credits: 0 });
    const dup = createFakeSupabase(() => ({ data: { ok: true, duplicate: true, clawed_micro: 50_000 } }));
    expect(await clawbackReward(dup.sb as never, { kind: "fix", userId: USER, suggestionId: 5 }, "x")).toEqual({ ok: true, clawed: false, credits: 0 });
  });
});

describe("applied fix reward", () => {
  const NOW = new Date("2026-11-21T10:00:00Z");
  const rc = readRewardConfig(ON);
  it("10 credits per fixed report; anonymous reports earn nothing", async () => {
    const { sb } = ledgerDb();
    expect(await rewardAppliedFix(sb as never, { suggestionId: 5, userId: USER, now: NOW }, rc)).toMatchObject({ status: "granted", credits: 10 });
    const anon = ledgerDb();
    expect(await rewardAppliedFix(anon.sb as never, { suggestionId: 5, userId: null, now: NOW }, rc)).toEqual({ status: "skipped", reason: "anonymous" });
    expect(anon.calls).toHaveLength(0);
  });
  it("monthly cap per learner: 100 credits (clawed-back lots still count)", async () => {
    const at90 = ledgerDb({ fixMicro: Array(9).fill(50_000) });
    expect((await rewardAppliedFix(at90.sb as never, { suggestionId: 5, userId: USER, now: NOW }, rc)).status).toBe("granted");
    const at100 = ledgerDb({ fixMicro: Array(10).fill(50_000) });
    expect(await rewardAppliedFix(at100.sb as never, { suggestionId: 5, userId: USER, now: NOW }, rc)).toEqual({ status: "skipped", reason: "cap_reached" });
    const read = ledgerDb({ fixMicro: [50_000, 50_000] });
    expect(await readFixCreditsThisMonth(read.sb as never, USER, NOW)).toBe(20);
    expect(read.calls[0].filters).toEqual(expect.arrayContaining([{ kind: "eq", column: "user_id", value: USER }, { kind: "like", column: "source_id", value: "reward:fix:%" }, { kind: "gte", column: "created_at", value: "2026-10-31T23:00:00.000Z" }]));
  });
  it("a second grant on the same report is a duplicate, never new credits", async () => {
    const { sb } = ledgerDb({ dup: true, existingLot: true });
    expect(await rewardAppliedFix(sb as never, { suggestionId: 5, userId: USER, now: NOW }, rc)).toEqual({ status: "skipped", reason: "already_rewarded" });
  });
  it("a throwing read is failed, never thrown into the resolve route", async () => {
    const boom = createFakeSupabase(() => { throw new Error("db down"); });
    expect(await rewardAppliedFix(boom.sb as never, { suggestionId: 5, userId: USER, now: NOW }, rc)).toEqual({ status: "failed" });
    expect(await clawbackAppliedFix(boom.sb as never, { suggestionId: 5, userId: USER }, "x")).toEqual({ status: "failed" });
  });
  it("clawback on revert", async () => {
    const { sb } = ledgerDb();
    expect(await clawbackAppliedFix(sb as never, { suggestionId: 5, userId: USER }, "edit reverted")).toEqual({ status: "clawed_back", credits: 10 });
  });
  it("My reports: credits only from the server stamp, none after a clawback; learners cannot plant a stamp", () => {
    expect(fixRewardCredits({ fix_reward: { credits: 10, at: "x" } })).toBe(10);
    expect(fixRewardCredits({ fix_reward: { credits: 10, clawed_back_at: "y" } })).toBeNull();
    expect(fixRewardCredits({})).toBeNull();
    expect(sanitizeReportContext({ fix_reward: { credits: 999 }, url: "/quiz" })).toEqual({ url: "/quiz" });
  });
});

describe("exam report reward (admin path)", () => {
  const NOW = new Date("2026-11-22T10:00:00Z");
  const rc = readRewardConfig(ON);
  function feedbackDb(o: { sitting?: string; kind?: string; examCount?: number; dup?: boolean } = {}) {
    return createFakeSupabase((c) => {
      if (c.table === "answer_history") return { data: Array.from({ length: 20 }, (_, i) => ({ question_id: i, created_at: i < 10 ? "2026-11-01T08:00:00Z" : "2026-11-02T08:00:00Z" })) };
      if (c.table === "subscriptions") return { data: [] };
      if (c.table === "user_feedback" && c.op === "select") return { data: { id: 9, user_id: USER, context: { kind: o.kind ?? "exam_report", sitting_key: o.sitting ?? "sip4a:2026-11-18" } } };
      if (c.table === "user_feedback") return { data: null };
      if (c.table === "users") return { data: { is_banned: false } };
      if (c.table === "ai_credit_lot" && c.op === "select" && c.filters.some((f) => f.kind === "like")) return { count: o.examCount ?? 0 };
      if (c.table === "ai_credit_lot") return { data: [] };
      if (c.table === "rpc:mentor_grant_credits") return { data: { ok: true, duplicate: o.dup ?? false, lot_id: "lot-e", granted_micro: 750_000 } };
      return {};
    });
  }
  it("grants 150 credits once per sitting per person and stamps the row", async () => {
    const { sb, calls } = feedbackDb();
    expect(await grantExamReportReward(sb as never, 9, "admin-1", rc, NOW)).toMatchObject({ ok: true, credits: 150 });
    expect(calls.find((c) => c.table === "rpc:mentor_grant_credits")!.payload).toMatchObject({ p_source: "admin_gift", p_source_id: `reward:exam_report:sip4a:2026-11-18:${USER}`, p_micro: 750_000 });
    expect(calls.some((c) => c.table === "user_feedback" && c.op === "update")).toBe(true);
  });
  it("refuses another kind, an unknown sitting and a full month", async () => {
    expect(await grantExamReportReward(feedbackDb({ kind: "testimonial" }).sb as never, 9, "a", rc, NOW)).toEqual({ ok: false, reason: "not_exam_report" });
    expect(await grantExamReportReward(feedbackDb({ sitting: "sip4a:2027-02-19" }).sb as never, 9, "a", rc, NOW)).toEqual({ ok: false, reason: "sitting_unknown" });
    const full = feedbackDb({ examCount: 300 });
    expect(await grantExamReportReward(full.sb as never, 9, "a", rc, NOW)).toEqual({ ok: false, reason: "cap_reached" });
    expect(full.calls.some((c) => c.table === "rpc:mentor_grant_credits")).toBe(false);
    expect(await grantExamReportReward(feedbackDb({ dup: true }).sb as never, 9, "a", rc, NOW)).toEqual({ ok: false, reason: "already_rewarded" });
  });
});

describe("house cap and admin log", () => {
  const live = { remainingMicro: 1, startsAt: "2026-11-01T00:00:00Z", expiresAt: "2027-01-01T00:00:00Z" };
  const now = Date.parse("2026-11-21T00:00:00Z");
  it("reward lots count as free-hook lots only while a reward flag is on", () => {
    const off = readFreeCreditConfig({});
    const on = readFreeCreditConfig({ REWARDS_FIX_ENABLED: "true" });
    expect(houseCapConsidered(off)).toBe(false);
    expect(houseCapConsidered(on)).toBe(true);
    expect(houseCapApplies("scope", off, [{ source: "admin_gift", ...live }], now)).toBe(false);
    expect(houseCapApplies("scope", on, [{ source: "admin_gift", ...live }], now)).toBe(true);
    expect(houseCapApplies("allowlist" as never, on, [{ source: "admin_gift", ...live }], now)).toBe(false);
  });
  it("the grant log counts reward kinds and shows their caps", () => {
    const s = summarizeFreeGrants([
      { source: "admin_gift", source_id: "reward:fix:5", user_id: USER, granted_micro: 50_000, created_at: "2026-11-20T09:00:00Z", expires_at: "2027-01-19T09:00:00Z", status: "live" },
      { source: "admin_gift", source_id: `sub:3`, user_id: USER, granted_micro: 300_000, created_at: "2026-11-20T09:00:00Z", expires_at: "2026-12-19T09:00:00Z", status: "live" },
    ], readFreeCreditConfig({}), new Date("2026-10-31T23:00:00Z"), false, readRewardConfig(ON));
    expect(s.counts.reward_fix).toEqual({ lots: 1, credits: 10 });
    expect(s.recent).toHaveLength(1);
    expect(s.caps).toMatchObject({ exam_report: 300, fix_per_learner_credits: 100 });
    expect(s.flags.REWARDS_FIX_ENABLED).toBe(true);
  });
});

describe("copy", () => {
  it("Sie, no dashes, no prices, no pass claims, no review platforms; reward independent of content and result", () => {
    for (const lang of ["de", "en"]) {
      const c = examReportCopy(lang);
      const all = [c.title, c.lead(150, 60), c.textHelper, c.consent, c.consentHelper, c.sent, c.rewarded, c.sentFor("X"), c.rewardedFor("X"), c.alreadySent, c.closed, c.failed, c.sittingMissing, PUBLIC_REWARD_DISCLOSURE[lang as "de" | "en"], REPORTS_COPY[lang as "de" | "en"].fixReward].join(" ");
      expect(all).not.toMatch(/[–—]/);
      expect(all).not.toMatch(/€|EUR|\bunlimited\b|unbegrenzt|bestanden|pass rate|Google|Trustpilot|App Store|echte Prüfungsfragen|real exam questions/i);
      expect(all).not.toMatch(/\bdu\b|\bdein/i);
    }
    expect(examReportCopy("de").lead(150, 60)).toMatch(/unabhängig davon, wie Ihr Bericht ausfällt/);
    expect(examReportCopy("en").lead(150, 60)).toMatch(/however your report turns out/);
    expect(examReportCopy("ru").title).toBe(examReportCopy("en").title);
    expect(sittingLine({ de: "SIP4a Wien", en: "SIP4a Vienna" }, "2026-11-18", "de")).toBe("SIP4a Wien, 18. November 2026");
  });
});
