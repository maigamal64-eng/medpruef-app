import { describe, expect, it } from "vitest";
import {
  dayOfMonth,
  expiredUnusedMicro,
  formatAge,
  formatCount,
  formatCredits,
  formatPct,
  formatTokens,
  formatUsd,
  PACKAGE_LABEL,
  shortId,
} from "@/app/admin/mentor/format";
import { MENTOR_PACKAGE_IDS } from "@/lib/mentor/contract";

describe("admin cost view formatting", () => {
  it("formats micro-USD with 4 decimals under a dollar and 2 above", () => {
    expect(formatUsd(2_300)).toBe("$0.0023");
    expect(formatUsd(0)).toBe("$0.0000");
    expect(formatUsd(12_400_000)).toBe("$12.40");
    expect(formatUsd(50_000_000)).toBe("$50.00");
    expect(formatUsd(Number.NaN)).toBe("$0.0000");
  });

  it("formats credits at 1 credit = 5,000 micro-USD", () => {
    expect(formatCredits(5_000)).toBe("1");
    expect(formatCredits(750_000)).toBe("150");
    expect(formatCredits(7_500)).toBe("1.5");
    expect(formatCredits(0)).toBe("0");
    expect(formatCredits(-1)).toBe("0");
  });

  it("formats counts, tokens, percentages and ids", () => {
    expect(formatCount(1234567)).toBe("1,234,567");
    expect(formatTokens(950)).toBe("950");
    expect(formatTokens(12_345)).toBe("12.3k");
    expect(formatTokens(1_200_000)).toBe("1.2M");
    expect(formatTokens(0)).toBe("0");
    expect(formatPct(12.34)).toBe("12.3%");
    expect(formatPct(Number.NaN)).toBe("0.0%");
    expect(shortId("11111111-1111-4111-8111-111111111111")).toBe("11111111");
    expect(dayOfMonth("2026-10-07")).toBe("07");
  });

  it("formats the age of a stuck hold", () => {
    expect(formatAge(42)).toBe("42 m");
    expect(formatAge(200)).toBe("3 h 20 m");
    expect(formatAge(3_000)).toBe("2 d");
    expect(formatAge(-5)).toBe("0 m");
  });

  it("derives expired-unused credit and never goes negative", () => {
    expect(expiredUnusedMicro({ granted_micro: 1_000, spent_micro: 300, clawed_back_micro: 100, live_remaining_micro: 200 })).toBe(400);
    expect(expiredUnusedMicro({ granted_micro: 100, spent_micro: 300, clawed_back_micro: 0, live_remaining_micro: 0 })).toBe(0);
  });

  it("has a label for every known package id", () => {
    for (const id of MENTOR_PACKAGE_IDS) expect(PACKAGE_LABEL[id], id).toBeTruthy();
  });

  it("uses no em dashes in any admin copy label", () => {
    expect(Object.values(PACKAGE_LABEL).join(" ")).not.toMatch(/—/);
  });
});
