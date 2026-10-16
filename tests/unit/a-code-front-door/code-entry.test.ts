import { describe, expect, it, vi, beforeEach } from "vitest";
import { normalizeTypedCode, codeAtSignupServerEnabled, codeAtSignupSurfaceEnabled, typedCodeAttribution } from "@/lib/code-entry";
import { codeEntryCopy } from "@/lib/code-entry/copy";
import { foldCodeCounts } from "@/lib/code-entry/counts";
import { sanitizeEventData, FUNNEL_EVENTS } from "@/lib/analytics-events";
import { CODE_FAILURES } from "@/lib/code-entry";

describe("normalizeTypedCode", () => {
  it("folds case, spaces, dashes and look-alikes", () => {
    expect(normalizeTypedCode(" tg-spt ")).toBe("TG-SPT");
    expect(normalizeTypedCode("tg – spt")).toBe("TG-SPT");
    expect(normalizeTypedCode("TG--SPT")).toBe("TG-SPT");
    expect(normalizeTypedCode("-TG-SPT-")).toBe("TG-SPT");
    expect(normalizeTypedCode("tg spt")).toBe("TG-SPT");
    expect(normalizeTypedCode("ab_12.cd")).toBe("AB-12-CD");
    expect(normalizeTypedCode("ＴＧ－ＳＰＴ")).toBe("TG-SPT");
  });
  it("refuses what is not code-shaped", () => {
    for (const v of [null, undefined, 5, "", "ab", "a".repeat(25), "AB%CD", "AB_%", "x;drop", "TG SPT?"]) expect(normalizeTypedCode(v)).toBeNull();
  });
  it("keeps a bare referral code as is", () => {
    expect(normalizeTypedCode("k4m9x7qa")).toBe("K4M9X7QA");
  });
});

describe("flags", () => {
  it("are on only for the literal true", () => {
    expect(codeAtSignupServerEnabled({})).toBe(false);
    expect(codeAtSignupServerEnabled({ CODE_AT_SIGNUP_ENABLED: "1" })).toBe(false);
    expect(codeAtSignupServerEnabled({ CODE_AT_SIGNUP_ENABLED: "true" })).toBe(true);
    expect(codeAtSignupSurfaceEnabled(undefined)).toBe(false);
    expect(codeAtSignupSurfaceEnabled("true")).toBe(true);
  });
});

describe("attribution and events", () => {
  it("first touch is the typed code", () => {
    expect(typedCodeAttribution("TG-SPT")).toEqual({ utm_source: "code", utm_medium: "typed", utm_campaign: "tg-spt" });
  });
  it("the anonymous entry event keeps the code, drops nothing else", () => {
    expect(FUNNEL_EVENTS).toContain("code_entered_pre_signup");
    expect(sanitizeEventData("code_entered_pre_signup", { code: "tg-spt", surface: "landing", email: "user-12c2d785@example.com" })).toEqual({ code: "tg-spt", surface: "landing" });
    expect(sanitizeEventData("code_redeemed", { kind: "referral", code: "k4m9x7qa", source: "home", text: "x" })).toEqual({ kind: "referral", code: "k4m9x7qa", source: "home" });
  });
});

describe("copy", () => {
  it("covers every failure in both languages, no em dash, Sie in German", () => {
    for (const lang of ["de", "en"] as const) {
      const c = codeEntryCopy(lang);
      for (const f of CODE_FAILURES) expect(c.failures[f]?.length).toBeGreaterThan(5);
      const all = JSON.stringify([c, c.successCampaign(10, "1. Dezember 2026")]);
      expect(all).not.toMatch(/—|–/);
    }
    const de = JSON.stringify(codeEntryCopy("de"));
    expect(de).toMatch(/Haben Sie einen Code\?/);
    expect(de).not.toMatch(/\b(du|dein|deine|dir)\b/i);
    expect(codeEntryCopy("fr").entryOpen).toBe("Redeem code");
  });
  it("the unknown, paused and ended reply is one line", () => {
    expect(codeEntryCopy("de").failures.not_active).toBe("Dieser Code ist nicht gültig oder nicht mehr aktiv.");
  });
});

describe("foldCodeCounts", () => {
  it("counts entered, signups, redeemed by kind and payers after", () => {
    const t0 = Date.parse("2026-11-10T10:00:00Z");
    const rows = foldCodeCounts(
      [{ code: "TG-SPT" }, { code: "tg-spt" }, { code: "tg-spt", automation: true }, { code: "K4M9X7QA" }],
      [{ code: "tg-spt" }],
      [
        { code: "tg-spt", kind: "campaign", user_id: "u1", at: "2026-11-10T10:00:00Z" },
        { code: "tg-spt", kind: "campaign", user_id: "u1", at: "2026-11-10T10:05:00Z" },
        { code: "k4m9x7qa", kind: "referral", user_id: "u2", at: "2026-11-10T11:00:00Z" },
      ],
      new Map([["u1", [t0 + 86_400_000]], ["u2", [t0 - 1000]]]),
    );
    const tg = rows.find((r) => r.code === "tg-spt")!;
    expect(tg).toEqual({ code: "tg-spt", entered: 2, signups: 1, redeemed: 1, by_kind: { campaign: 1 }, payers: 1 });
    expect(rows.find((r) => r.code === "k4m9x7qa")).toMatchObject({ entered: 1, redeemed: 1, by_kind: { referral: 1 }, payers: 0 });
  });
});
