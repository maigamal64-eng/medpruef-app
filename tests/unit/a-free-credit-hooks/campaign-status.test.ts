import { describe, expect, it, vi } from "vitest";

vi.mock("@sentry/nextjs", () => ({ captureMessage: vi.fn(), captureException: vi.fn() }));

import { readCampaignStatus } from "@/lib/mentor/credits/campaign";
import { readFreeCreditConfig } from "@/lib/mentor/credits/free-credits";
import { createFakeSupabase } from "../helpers/fake-supabase";

const USER = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const NOW = new Date("2026-10-20T10:00:00Z");
const YOUNG = "2026-10-18T10:00:00Z";
const OLD = "2026-10-01T10:00:00Z";

function db(user: Record<string, unknown> | null, opts: { redeemed?: boolean; answers?: number[] } = {}) {
  return createFakeSupabase((call) => {
    if (call.table === "users") return { data: user };
    if (call.table === "ai_credit_campaign_redemption") return { data: opts.redeemed ? { code: "TG-SPT", credits: 100, redeemed_at: YOUNG } : null };
    if (call.table === "answer_history") return { data: (opts.answers ?? []).map((q) => ({ question_id: q })) };
    return {};
  });
}

describe("campaign status mirrors the redeem function's account checks (reviewer P3-2)", () => {
  it("a young verified account is eligible without reading answers", async () => {
    const { sb, calls } = db({ created_at: YOUNG, email_verified_at: YOUNG, telegram_id: null });
    expect(await readCampaignStatus(sb, USER, NOW, 7, 10)).toEqual({ eligible: true, needs_verification: false, redeemed: null });
    expect(calls.some((c) => c.table === "answer_history")).toBe(false);
  });
  it("a Telegram account counts as verified", async () => {
    const { sb } = db({ created_at: YOUNG, email_verified_at: null, telegram_id: 12345 });
    expect((await readCampaignStatus(sb, USER, NOW, 7, 10)).eligible).toBe(true);
  });
  it("a young unverified account with fewer than 10 distinct answers needs verification", async () => {
    const { sb } = db({ created_at: YOUNG, email_verified_at: null, telegram_id: null }, { answers: [1, 1, 2, 3, 4, 5, 6, 7, 8, 8, 8] });
    expect(await readCampaignStatus(sb, USER, NOW, 7, 10)).toEqual({ eligible: false, needs_verification: true, redeemed: null });
  });
  it("10 distinct answers make an unverified account eligible", async () => {
    const { sb } = db({ created_at: YOUNG, email_verified_at: null, telegram_id: null }, { answers: [1, 2, 3, 4, 5, 6, 7, 8, 9, 10] });
    expect((await readCampaignStatus(sb, USER, NOW, 7, 10)).eligible).toBe(true);
  });
  it("an old or already-redeemed account is never eligible and never needs verification", async () => {
    const old = db({ created_at: OLD, email_verified_at: null, telegram_id: null });
    expect(await readCampaignStatus(old.sb, USER, NOW, 7, 10)).toEqual({ eligible: false, needs_verification: false, redeemed: null });
    expect(old.calls.some((c) => c.table === "answer_history")).toBe(false);
    const done = db({ created_at: YOUNG, email_verified_at: null, telegram_id: null }, { redeemed: true });
    expect(await readCampaignStatus(done.sb, USER, NOW, 7, 10)).toEqual({ eligible: false, needs_verification: false, redeemed: { code: "TG-SPT", credits: 100 } });
  });
  it("a failed answers read throws (the route answers 5xx, never a wrong eligible)", async () => {
    const { sb } = createFakeSupabase((call) => {
      if (call.table === "users") return { data: { created_at: YOUNG, email_verified_at: null, telegram_id: null } };
      if (call.table === "answer_history") return { error: { code: "57014" } };
      return { data: null };
    });
    await expect(readCampaignStatus(sb, USER, NOW, 7, 10)).rejects.toBeTruthy();
  });
});

describe("house cost caps never parse to 0 (reviewer note)", () => {
  it("a 0 env value falls back to the default", () => {
    const c = readFreeCreditConfig({ MENTOR_HOUSE_COST_CAP_MICRO: "0", MENTOR_HOUSE_COST_CAP_TASTE_MICRO: "0" });
    expect(c.houseCostCapMicro).toBe(250_000);
    expect(c.houseCostCapTasteMicro).toBe(100_000);
  });
});
