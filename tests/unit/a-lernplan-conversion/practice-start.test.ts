import { describe, expect, it } from "vitest";
import { arrivalBank, parsePublicPlanQuery, PRACTICE_ORDER, PUBLIC_PLAN_BANKS } from "@/lib/study-plan-public";
import { pc, PUBLIC_PLAN_COPY } from "@/lib/study-plan-public/copy";
import { authDestination, parseAuthEntry } from "@/lib/auth-entry";
import { practiceHref } from "@/app/lernplan/_parts/PracticeStart";
import { registerHref } from "@/app/lernplan/_parts/SavePlanCta";
import { firstTouchFromAttribution, leverOf } from "@/lib/first-touch";

describe("arrivalBank", () => {
  it("reads ?bank= keys first, then ?exam= keys and short names", () => {
    expect(arrivalBank({ bank: "pharma", exam: "spt" })).toBe("pharma");
    expect(arrivalBank({ exam: "kmp_innsbruck" })).toBe("kmp_innsbruck");
    expect(arrivalBank({ exam: "Stichprobentest" })).toBe("kmp_innsbruck");
    expect(arrivalBank({ exam: "sip5a" })).toBe("kenntnispruefung");
    expect(arrivalBank({ exam: "rezeptierkunde" })).toBe("pharma");
    expect(arrivalBank({ exam: ["spt", "pharma"] })).toBe("kmp_innsbruck");
  });
  it("is null for unknown or prototype names", () => {
    for (const exam of ["", "toString", "constructor", "__proto__", "kp", "STP x"]) expect(arrivalBank({ exam })).toBeNull();
    expect(arrivalBank({})).toBeNull();
  });
  it("feeds the plan form's bank without completing a plan query", () => {
    const { form, query } = parsePublicPlanQuery({ exam: "stichprobentest" }, new Date("2026-10-19T10:00:00Z"));
    expect(form.bank).toBe("kmp_innsbruck");
    expect(query).toBeNull();
  });
});

describe("practice start links", () => {
  it("covers every public bank once, Stichprobentest first", () => {
    expect([...PRACTICE_ORDER].sort()).toEqual([...PUBLIC_PLAN_BANKS].sort());
    expect(PRACTICE_ORDER[0]).toBe("kmp_innsbruck");
  });
  it("signed out: registration with intent free, then straight to the first question of that bank", () => {
    for (const bank of PUBLIC_PLAN_BANKS) {
      const url = new URL(practiceHref(bank, false), "https://medpruf.com");
      expect(url.pathname).toBe("/login");
      expect(url.searchParams.get("mode")).toBe("register");
      const entry = parseAuthEntry(url.searchParams);
      expect(entry).toEqual({ intent: "free", exam: bank, next: "/" });
      expect(authDestination(entry)).toBe(`/quiz?examSource=${bank}&practiceMode=unseen`);
      expect(url.searchParams.has("utm_source")).toBe(false);
    }
  });
  it("signed in: the quiz directly", () => {
    expect(practiceHref("pharma", true)).toBe("/quiz?examSource=pharma&practiceMode=unseen");
  });
  it("the plan save link carries no utm tag, so the lernplan arrival stays the first touch", () => {
    const url = new URL(registerHref({ exam: "kmp_innsbruck", examDate: "2027-02-03", dailyGoal: 46 }), "https://medpruf.com");
    expect([...url.searchParams.keys()].some((k) => k.startsWith("utm_"))).toBe(false);
    const touch = firstTouchFromAttribution({ utm_source: "arrival", utm_medium: "organic", utm_campaign: "lernplan" });
    expect(leverOf(touch?.key)).toBe("lernplan");
  });
});

describe("practice copy", () => {
  const keys = Object.keys(PUBLIC_PLAN_COPY).filter((k) => k.startsWith("practice_") || k === "plan_section_title");
  it("has a hint for the two banks whose name does not explain itself", () => {
    for (const bank of ["kmp_innsbruck", "kenntnispruefung"]) expect(keys).toContain(`practice_hint_${bank}`);
  });
  it("never says a bare free, unlimited or a number of questions", () => {
    for (const k of keys) for (const lang of ["de", "en"] as const) {
      const text = pc(k as keyof typeof PUBLIC_PLAN_COPY, lang);
      expect(text).not.toMatch(/unbegrenzt|unlimited|gratis|\b\d+\b|[–—]/i);
      if (/kostenlos|free/i.test(text) && !/konto|account/i.test(text)) expect(text).toMatch(/Auswahl|sample/);
    }
  });
});

import { englishHref } from "@/components/exam-calendar/CalendarLanguageSync";

describe("English switch for non-German readers", () => {
  it("keeps the exam, the plan and the campaign tags", () => {
    const href = englishHref("/lernplan", "?exam=spt&bank=kmp_innsbruck&sitting=2027-02-03&hours=8&utm_source=telegram");
    const url = new URL(href, "https://medpruf.com");
    expect(url.pathname).toBe("/lernplan");
    expect(Object.fromEntries(url.searchParams)).toEqual({ exam: "spt", bank: "kmp_innsbruck", sitting: "2027-02-03", hours: "8", utm_source: "telegram", lang: "en" });
  });
  it("adds only lang on a bare path and replaces a stale lang", () => {
    expect(englishHref("/pruefungskalender", "")).toBe("/pruefungskalender?lang=en");
    expect(englishHref("/lernplan", "?lang=de&exam=sip")).toBe("/lernplan?lang=en&exam=sip");
  });
});
