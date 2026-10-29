import * as React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, describe, expect, it, vi } from "vitest";
import { ANSWER_PAGES, answerPath, answerSeoTitle, nextSittingMonth } from "@/lib/answer-pages/registry";
import { ANSWER_EN_SLUGS, ANSWER_SLUG_GATES } from "@/lib/answer-pages/slugs";
import { seoLinkHub } from "@/lib/seo/gsc";
import { getUpcomingOfficialSittings } from "@/lib/exam-dates";
import AnswerPageView from "@/components/answer-pages/AnswerPageView";

(globalThis as { React?: unknown }).React = React;

vi.mock("next/navigation", () => ({
  usePathname: () => "/blog", useRouter: () => ({ push() {}, replace() {} }), useSearchParams: () => new URLSearchParams(),
}));

// a-guides-examweek-1029: exam-week guides for the SIP sittings and the Rezeptierkunde and Gerichtsmedizin week.
const WEEK = ANSWER_PAGES.filter((p) => p.exam_week);
const SIP = ANSWER_PAGES.find((p) => p.id === "guide-sip-exam-week")!;
const RIG = ANSWER_PAGES.find((p) => p.id === "guide-rig-exam-week")!;
const ON = { ANSWER_PAGES_ENABLED: "true", SEO_GSC_COPY_ENABLED: "true" };
const BEFORE = new Date("2026-10-30T10:00:00Z");

afterEach(() => { vi.unstubAllEnvs(); });

describe("exam-week guides", () => {
  it("are the two guides, each a long-form guide with a German and an English URL behind the slug gate", () => {
    expect(WEEK.map((p) => p.id)).toEqual(["guide-sip-exam-week", "guide-rig-exam-week"]);
    for (const page of WEEK) {
      expect(page.article).toBeTruthy();
      expect(page.en_slug).toBeTruthy();
      expect(page.slug in ANSWER_SLUG_GATES).toBe(true);
      expect(page.en_slug! in ANSWER_SLUG_GATES).toBe(true);
      expect(ANSWER_EN_SLUGS[page.slug]).toBe(page.en_slug);
      expect(page.seo_title?.de).toContain("{nextSittingMonth}");
      expect(page.seo_title?.en).toContain("{nextSittingMonth}");
    }
    expect(SIP.bank).toBe("kenntnispruefung");
    expect([...SIP.exams].sort()).toEqual(["sip4a", "sip5a"]);
    expect(RIG.bank).toBe("pharma");
    expect([...RIG.exams].sort()).toEqual(["gerichtsmedizin", "rezeptierkunde"]);
  });

  it("the search title names the month of the next official sitting, from OFFICIAL_SITTINGS", () => {
    const sip = getUpcomingOfficialSittings({ exam: "sip5a", now: BEFORE })[0];
    expect(sip.date.slice(0, 7)).toBe("2026-11");
    expect(nextSittingMonth(SIP, "de", BEFORE)).toBe("November 2026");
    expect(answerSeoTitle(SIP, "de", BEFORE)).toBe("SIP 4a und SIP 5a November 2026: Lernplan für 3 Wochen");
    expect(answerSeoTitle(SIP, "en", BEFORE)).toBe("SIP 4a and SIP 5a November 2026: 3-week study plan");
    expect(answerSeoTitle(RIG, "de", BEFORE)).toBe("Rezeptierkunde, Gerichtsmedizin November 2026: Lernplan");
    // After the November sittings the title moves on with the official calendar.
    const after = new Date("2026-12-01T10:00:00Z");
    expect(answerSeoTitle(SIP, "de", after)).toBe("SIP 4a und SIP 5a Februar 2027: Lernplan für 3 Wochen");
    expect(answerSeoTitle(RIG, "de", after)).toBe("Rezeptierkunde, Gerichtsmedizin Jänner 2027: Lernplan");
    for (const page of WEEK) for (const lang of ["de", "en"] as const) {
      expect(`${answerSeoTitle(page, lang, BEFORE)} | MedPrüf`.length).toBeLessThanOrEqual(70);
    }
  });

  it("falls back to the question-shaped title when no sitting is published", () => {
    const far = new Date("2030-01-01T10:00:00Z");
    expect(nextSittingMonth(SIP, "de", far)).toBeNull();
    expect(answerSeoTitle(SIP, "de", far)).toBe(SIP.title.de);
    expect(answerSeoTitle(SIP, "en", far)).toBe(SIP.title.en);
  });

  it("falls back to the question-shaped title when the exams' next sittings fall in different months", () => {
    // SIP 4a sits at the end of June 2027, SIP 5a early in July 2027 (OFFICIAL_SITTINGS).
    const june = new Date("2027-06-01T10:00:00Z");
    expect(nextSittingMonth(SIP, "de", june)).toBeNull();
    expect(answerSeoTitle(SIP, "de", june)).toBe(SIP.title.de);
    expect(nextSittingMonth({ exams: ["sip4a"] }, "de", june)).toBe("Juni 2027");
  });

  it("pages without the placeholder keep their seo_title unchanged", () => {
    for (const page of ANSWER_PAGES.filter((p) => !p.exam_week)) {
      expect(answerSeoTitle(page, "de", BEFORE)).toBe((page.seo_title ?? page.title).de);
    }
  });

  it("lead the Vienna bank page hub and their own bank hub, and stay off when the pages are off", () => {
    const kp = seoLinkHub("kenntnispruefung", BEFORE, ON).answers.map((a) => a.href);
    expect(kp.slice(0, 2)).toEqual([answerPath(SIP, "de"), answerPath(RIG, "de")]);
    const pharma = seoLinkHub("pharma", BEFORE, ON).answers.map((a) => a.href);
    expect(pharma[0]).toBe(answerPath(RIG, "de"));
    expect(pharma).not.toContain(answerPath(SIP, "de"));
    expect(seoLinkHub("kenntnispruefung", BEFORE, { SEO_GSC_COPY_ENABLED: "true" }).answers).toEqual([]);
    expect(seoLinkHub("kmp_innsbruck", BEFORE, ON).answers.map((a) => a.href)).not.toContain(answerPath(SIP, "de"));
  });

  it("render the free start right under the short answer, before the first section, with no price", () => {
    vi.stubEnv("ANSWER_PAGES_ENABLED", "true");
    for (const page of WEEK) for (const lang of ["de", "en"] as const) {
      const html = renderToStaticMarkup(React.createElement(AnswerPageView, { page, lang, now: BEFORE }));
      const sample = html.indexOf("data-answer-sample-block");
      expect(sample).toBeGreaterThan(html.indexOf('id="answer-short"'));
      expect(sample).toBeLessThan(html.indexOf(page.sections[0].heading[lang].replace(/&/g, "&amp;")));
      expect(html.match(/data-answer-sample-block/g)).toHaveLength(1);
      expect(html.slice(0, sample + 2000)).not.toMatch(/€|\bEUR\b|\/month|pro Monat/);
      // The lead names the official November sitting, rendered by code.
      expect(html).toContain("data-answer-sitting=\"2026-11-");
    }
    const other = ANSWER_PAGES.find((p) => p.article && !p.exam_week)!;
    const html = renderToStaticMarkup(React.createElement(AnswerPageView, { page: other, lang: "de", now: BEFORE }));
    expect(html.indexOf("data-answer-sample-block")).toBeGreaterThan(html.indexOf(other.sections[other.sections.length - 1].heading.de.replace(/&/g, "&amp;")));
  });

  it("topic shares are the snapshot figures and name no question content", () => {
    const text = JSON.stringify(SIP);
    for (const share of ["Neurologie: 22 Prozent", "Notfall- und Intensivmedizin: 16 Prozent", "Augenheilkunde: 15 Prozent", "87 Prozent", "13 Prozent"]) expect(text).toContain(share);
    expect(JSON.stringify(RIG)).toContain("248 kuratierte Übungsfragen");
    expect(JSON.stringify(RIG)).toContain("keine für die Gerichtsmedizin");
  });
});
