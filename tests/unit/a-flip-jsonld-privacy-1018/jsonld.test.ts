import { describe, expect, it } from "vitest";
import { v2JsonLdOffers } from "@/lib/pricing-v2/structured";
import { v2PlanReady } from "@/lib/pricing-v2/readiness";
import { planName } from "@/lib/pricing-v2/price-facts";
import { CHANGELOG } from "@/lib/changelog";

// The root JSON-LD lists a v2 plan only while checkout can sell it
// (the same v2PlanReady rule that makes checkout answer PLAN_NOT_READY).
const READY_ALL: Record<string, string> = {
  HALF_YEAR_AUTO_STOP_ENABLED: "true",
  HALF_YEAR_AUTO_STOP_DRY_RUN: "false",
  HALF_YEAR_REMINDER_EMAILS_ENABLED: "true",
  TICKET_RENEWAL_ENABLED: "true",
  TICKET_REMINDER_EMAILS_ENABLED: "true",
  AI_FEATURES_ENABLED: "true",
  MENTOR_ENABLED: "true",
  MENTOR_ACCESS_SCOPE: "signed_in",
  MENTOR_INCLUDED_RAISE_ENABLED: "true",
};
const names = (env: Record<string, string>) => v2JsonLdOffers(env).map((o) => o.name);

describe("v2 JSON-LD offers follow checkout readiness", () => {
  it("lists all four plans when every plan is ready", () => {
    expect(v2PlanReady("guarantee_ticket", READY_ALL)).toBe(true);
    expect(names(READY_ALL)).toEqual([
      planName("flex_month", "en"), planName("sitting_pass", "en"), planName("half_year", "en"), planName("guarantee_ticket", "en"),
    ]);
  });

  it("omits the Guarantee Ticket while checkout would refuse it", () => {
    const env = { ...READY_ALL, TICKET_RENEWAL_ENABLED: "false" };
    expect(v2PlanReady("guarantee_ticket", env)).toBe(false);
    const list = names(env);
    expect(list).not.toContain(planName("guarantee_ticket", "en"));
    expect(list).toContain(planName("half_year", "en"));
  });

  it("omits the 6-month plan while its renewal stop is a dry run, keeps the ready plans", () => {
    const env = { ...READY_ALL, HALF_YEAR_AUTO_STOP_DRY_RUN: "true" };
    expect(names(env)).toEqual([planName("flex_month", "en"), planName("sitting_pass", "en"), planName("guarantee_ticket", "en")]);
  });

  it("every listed offer is InStock and no unready plan is listed at all", () => {
    for (const o of v2JsonLdOffers({})) expect(o.availability).toBe("https://schema.org/InStock");
    expect(v2JsonLdOffers({})).toHaveLength(2);
  });
});

describe("flip-commit changelog entries", () => {
  it("are learner-visible with the flip date and carry no switch names", () => {
    const flip = CHANGELOG.filter((e) => e.date === "2026-10-20" && /Telegram|nächster Schritt|Auftragsverarbeiter/.test(e.title.de));
    expect(flip).toHaveLength(3);
    for (const e of flip) {
      expect(e.tag).not.toBe("admin");
      expect(`${e.description.de} ${e.description.en}`).not.toMatch(/NEXT_PUBLIC_|_ENABLED/);
      expect(`${e.title.de}${e.description.de}${e.title.en}${e.description.en}`).not.toMatch(/—|–/);
    }
  });
});
