import { describe, it, expect } from "vitest";
import {
  evaluateRenewalPrompt,
  RENEWAL_LEAD_DAYS,
  RENEWAL_LAPSED_DAYS,
  RENEWAL_TIER,
} from "@/lib/renewal-prompt";

/**
 * The load-bearing case is the first test: the production Pro account
 * whose access ends 2026-09-08 must be prompted on 2026-09-07. Everything
 * else guards the two window edges so the banner cannot creep into
 * nagging users whose access ended months ago, or start pitching a user
 * three weeks early.
 */

// Real production row (user aa962f16…, language_code 'uk'), the heaviest
// user, lapsing 2026-09-08. Read read-only from the users table.
const LAPSING_SOON = "2026-09-08T14:04:16.502+00:00";
const TODAY = new Date("2026-09-07T09:00:00.000Z");

describe("evaluateRenewalPrompt", () => {
  it("prompts the Pro user whose access ends 2026-09-08, seen on 2026-09-07", () => {
    const d = evaluateRenewalPrompt({
      tier: "pro",
      tierExpiresAt: LAPSING_SOON,
      now: TODAY,
    });
    expect(d).not.toBeNull();
    expect(d?.lapsed).toBe(false);
    expect(d?.endsOn).toBe("2026-09-08");
    expect(d?.daysLeft).toBe(2);
  });

  it("prompts the second lapsing account (2026-09-12) on 2026-09-07", () => {
    const d = evaluateRenewalPrompt({
      tier: "pro",
      tierExpiresAt: "2026-09-12T19:57:03.991+00:00",
      now: TODAY,
    });
    expect(d).not.toBeNull();
    expect(d?.lapsed).toBe(false);
  });

  it("shows on the last day of the lead window", () => {
    const now = new Date("2026-09-07T09:00:00.000Z");
    const expires = new Date(
      now.getTime() + RENEWAL_LEAD_DAYS * 24 * 60 * 60 * 1000 - 1000
    ).toISOString();
    expect(evaluateRenewalPrompt({ tier: "pro", tierExpiresAt: expires, now })).not.toBeNull();
  });

  it("stays silent one day beyond the lead window", () => {
    const now = new Date("2026-09-07T09:00:00.000Z");
    const expires = new Date(
      now.getTime() + (RENEWAL_LEAD_DAYS + 1) * 24 * 60 * 60 * 1000 + 1000
    ).toISOString();
    expect(evaluateRenewalPrompt({ tier: "pro", tierExpiresAt: expires, now })).toBeNull();
  });

  it("prompts a recently lapsed account and marks it lapsed", () => {
    const d = evaluateRenewalPrompt({
      tier: "pro",
      tierExpiresAt: "2026-09-01T10:00:00.000Z",
      now: TODAY,
    });
    expect(d?.lapsed).toBe(true);
    expect(d?.endsOn).toBe("2026-09-01");
    expect((d?.daysLeft ?? 0) <= 0).toBe(true);
  });

  it("still prompts on the last day of the lapsed window", () => {
    const now = new Date("2026-09-07T09:00:00.000Z");
    const expires = new Date(
      now.getTime() - RENEWAL_LAPSED_DAYS * 24 * 60 * 60 * 1000 + 1000
    ).toISOString();
    expect(evaluateRenewalPrompt({ tier: "pro", tierExpiresAt: expires, now })).not.toBeNull();
  });

  it("goes quiet once the lapsed window is over", () => {
    const now = new Date("2026-09-07T09:00:00.000Z");
    const expires = new Date(
      now.getTime() - (RENEWAL_LAPSED_DAYS + 1) * 24 * 60 * 60 * 1000 - 1000
    ).toISOString();
    expect(evaluateRenewalPrompt({ tier: "pro", tierExpiresAt: expires, now })).toBeNull();
  });

  it("never prompts the long-lapsed production row (expired 2026-05-25)", () => {
    expect(
      evaluateRenewalPrompt({
        tier: "pro",
        tierExpiresAt: "2026-05-25T04:47:31.413+00:00",
        now: TODAY,
      })
    ).toBeNull();
  });

  it("never prompts a free user", () => {
    expect(
      evaluateRenewalPrompt({ tier: "free", tierExpiresAt: LAPSING_SOON, now: TODAY })
    ).toBeNull();
  });

  it("never prompts a non-expiring Pro grant", () => {
    expect(
      evaluateRenewalPrompt({ tier: "pro", tierExpiresAt: null, now: TODAY })
    ).toBeNull();
  });

  it("never prompts a staff account", () => {
    expect(
      evaluateRenewalPrompt({
        tier: "pro",
        tierExpiresAt: LAPSING_SOON,
        role: "admin",
        now: TODAY,
      })
    ).toBeNull();
  });

  it("ignores an unparseable expiry rather than throwing", () => {
    expect(
      evaluateRenewalPrompt({ tier: "pro", tierExpiresAt: "not-a-date", now: TODAY })
    ).toBeNull();
  });

  it("buys the legacy 3-month tier key, never a renamed one", () => {
    expect(RENEWAL_TIER).toBe("first_3mo_27");
  });
});
