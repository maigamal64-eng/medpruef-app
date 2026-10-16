import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { confirmLines, type PaidTier } from "@/app/pricing/_parts/plans";
import { BANK_TRANSFER_NOTE, CONFIRM_METHOD_LINE, METHOD_SENTENCE } from "@/lib/checkout-confirm-copy";
import { isAllowedEvent, sanitizeEventData } from "@/lib/analytics-events";

const now = new Date("2026-10-20T10:00:00Z");

describe("confirm lines per v2 plan", () => {
  it("monthly: today, next charge in 30 days, cancel rule", () => {
    const l = confirmLines("flex_month", "de", now);
    expect(l.join(" ")).toMatch(/Heute: 24/);
    expect(l.join(" ")).toMatch(/Nächste Abbuchung am 19\. November 2026/);
  });
  it("sitting pass: end is the chosen sitting's last day (day after, capped)", () => {
    expect(confirmLines("sitting_pass", "de", now, null, "2026-12-10").join(" ")).toMatch(/Einmalzahlung, keine Verlängerung\. Zugang bis 12\. Dezember 2026/);
    expect(confirmLines("sitting_pass", "en", now, null, "2026-12-10").join(" ")).toMatch(/Access until 12 December 2026/);
  });
  it("6 months: stops after the exam date (approved wording)", () => {
    expect(confirmLines("half_year", "de", now).join(" ")).toMatch(/Prüfungstermin vorbei, verlängert sich der Tarif nicht mehr/);
    expect(confirmLines("half_year", "en", now, null, "2026-12-10").join(" ")).toMatch(/stops renewing/);
  });
  it("guarantee ticket: one-time, 12 months", () => {
    expect(confirmLines("guarantee_ticket", "en", now).join(" ")).toMatch(/One-time payment, no renewal\. Access until 20 October 2027/);
  });
  it("no line uses an em dash", () => {
    for (const t of ["flex_month", "sitting_pass", "half_year", "guarantee_ticket"] as PaidTier[]) for (const lang of ["de", "en"] as const) {
      expect(confirmLines(t, lang, now, null, "2026-12-10").join(" ")).not.toMatch(/—|–/);
    }
  });
});

describe("Lektor-final strings", () => {
  it("C1 lists no method and keeps the Back sentence", () => {
    for (const lang of ["de", "en"] as const) {
      expect(CONFIRM_METHOD_LINE[lang]).not.toMatch(/Visa|Mastercard|Apple Pay|card|Karte/i);
      expect(CONFIRM_METHOD_LINE[lang].startsWith(METHOD_SENTENCE[lang])).toBe(true);
    }
    expect(CONFIRM_METHOD_LINE.de).toContain("Mit „Zurück“ kommen Sie auf diese Seite zurück.");
  });
  it("C2 is the EDIT version (no settlement promise, do not pay again)", () => {
    expect(BANK_TRANSFER_NOTE.de).toBe("Eine Banküberweisung wird erst bestätigt, wenn sie eingegangen ist. Das kann dauern. Danach schalten wir Ihren Zugang frei. Bitte bezahlen Sie in dieser Zeit nicht noch einmal.");
    expect(BANK_TRANSFER_NOTE.en).toMatch(/Please do not pay again in the meantime\.$/);
    expect(BANK_TRANSFER_NOTE.de).not.toMatch(/von selbst/);
  });
  it("no dash characters or exclamation marks", () => {
    for (const s of [...Object.values(CONFIRM_METHOD_LINE), ...Object.values(BANK_TRANSFER_NOTE)]) expect(s).not.toMatch(/—|–|!/);
  });
});

describe("events", () => {
  it("allowlists the three events, counts only", () => {
    for (const e of ["checkout_confirm_shown", "checkout_confirm_continue", "checkout_confirm_back"]) {
      expect(isAllowedEvent(e)).toBe(true);
      expect(sanitizeEventData(e, { tier: "sitting_pass", source: "pricing", email: "user-12c2d785@example.com", extra: "x" })).toEqual({ tier: "sitting_pass", source: "pricing" });
    }
  });
});

describe("flag off keeps the sheet's old line and sends no events", () => {
  it("method line, bank note and events all sit behind the confirm flag", () => {
    const src = readFileSync("src/app/pricing/_parts/CheckoutConfirmSheet.tsx", "utf8");
    expect(src).toContain("Karte oder Apple Pay");
    expect(src.match(/CHECKOUT_CONFIRM_ENABLED &&/g)?.length).toBeGreaterThanOrEqual(2);
    expect(src).toContain("if (CHECKOUT_CONFIRM_ENABLED) trackEvent(\"checkout_confirm_back\"");
    expect(src).toContain("if (CHECKOUT_CONFIRM_ENABLED) trackEvent(\"checkout_confirm_continue\"");
  });
});

describe("flags default off in code", () => {
  it("both flags compare to the literal true", () => {
    expect(readFileSync("src/app/pricing/_parts/CheckoutConfirmSheet.tsx", "utf8")).toContain('NEXT_PUBLIC_CHECKOUT_CONFIRM_ENABLED === "true"');
    expect(readFileSync("src/lib/checkout-confirm-copy.ts", "utf8")).toContain('NEXT_PUBLIC_CHECKOUT_BANK_TRANSFER_NOTE === "true"');
  });
});
