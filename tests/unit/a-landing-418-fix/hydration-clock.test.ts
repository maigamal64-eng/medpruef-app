/**
 * a-landing-418-fix: /landing and /pricing are prerendered at deploy, so the
 * server HTML can be days old when a learner opens it. React error #418 on
 * production came from UpcomingExams reading the wall clock during render
 * ("noch 3 Tage" in the HTML, "noch 1 Tag" in the client's first render).
 * The client's first render must equal the server render whatever the
 * clock says; only the mount effect may switch to the live clock.
 */
import { afterEach, describe, expect, it, vi } from "vitest";
import { readFileSync } from "node:fs";
import React, { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import UpcomingExams from "@/components/UpcomingExams";
import ExamTimingPicker from "@/app/pricing/_parts/ExamTimingPicker";
import { OFFICIAL_SITTINGS } from "@/lib/exam-dates";
import { formatClose } from "@/lib/i18n-dates";

(globalThis as { React?: typeof React }).React = React;

// Times come from the data: three days before the first SIP close whose
// window is open then (the 18 Oct production HTML was built that far ahead),
// one day before it (the day count changes) and two days after it (the card
// set changes).
const DAY = 86_400_000;
const SIP = OFFICIAL_SITTINGS.find((r) =>
  (r.exam_key === "sip4a" || r.exam_key === "sip5a") && r.registration_opens && r.registration_closes && !r.window_unconfirmed &&
  Date.parse(`${r.registration_closes}T10:00:00Z`) - 3 * DAY >= Date.parse(`${r.registration_opens}T12:00:00Z`));
if (!SIP) throw new Error("no SIP sitting with an open registration window in OFFICIAL_SITTINGS");
const CLOSE = Date.parse(`${SIP.registration_closes}T10:00:00Z`);
const BUILD = new Date(CLOSE - 3 * DAY).toISOString();
const VISIT_SAME_WINDOW = new Date(CLOSE - DAY).toISOString();
const VISIT_AFTER_CLOSE = new Date(CLOSE + 2 * DAY).toISOString();

function renderAt(clock: string, renderedAt: string, lang: "de" | "en", variant?: "full" | "compact") {
  vi.useFakeTimers();
  vi.setSystemTime(new Date(clock));
  try {
    return renderToStaticMarkup(createElement(UpcomingExams, { lang, renderedAt, variant }));
  } finally {
    vi.useRealTimers();
  }
}

afterEach(() => vi.useRealTimers());

describe("UpcomingExams renders from the server instant, never the wall clock", () => {
  for (const lang of ["de", "en"] as const) {
    for (const variant of ["full", "compact"] as const) {
      for (const visit of [VISIT_SAME_WINDOW, VISIT_AFTER_CLOSE]) {
        it(`${lang} ${variant}: first client render at ${visit.slice(0, 10)} equals the ${BUILD.slice(0, 10)} server HTML`, () => {
          const server = renderAt(BUILD, BUILD, lang, variant);
          const firstClientRender = renderAt(visit, BUILD, lang, variant);
          expect(firstClientRender).toBe(server);
        });
      }
    }
  }

  it("the check is sensitive: a different render instant gives different HTML", () => {
    expect(renderAt(BUILD, VISIT_AFTER_CLOSE, "de")).not.toBe(renderAt(BUILD, BUILD, "de"));
  });

  it("no relative day count in the server HTML (it waits for the client clock)", () => {
    const html = renderAt(BUILD, BUILD, "de");
    expect(html).toContain(formatClose(SIP, "de"));
    expect(html).not.toMatch(/noch \d+ Tag/);
    expect(renderAt(BUILD, BUILD, "en")).not.toMatch(/\d+ days? left/);
  });
});

describe("pricing v2 sitting picker renders from the server instant", () => {
  const pick = (clock: string) => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date(clock));
    try {
      return renderToStaticMarkup(createElement(ExamTimingPicker, { lang: "de", bank: "kenntnispruefung", onBankChange: () => {}, value: null, onChange: () => {}, renderedAt: BUILD }));
    } finally { vi.useRealTimers(); }
  };
  it("first client render after the sittings moved equals the server HTML", () => {
    const sittingStart = Date.parse(`${SIP.date}T10:00:00Z`) + 2 * DAY;
    expect(pick(new Date(sittingStart).toISOString())).toBe(pick(BUILD));
    expect(pick(BUILD)).toContain("exam-timing");
  });
});

describe("prerendered pages pass the render instant and read no storage in render", () => {
  const read = (p: string) => readFileSync(p, "utf8");
  it("the pricing v2 sitting picker lists sittings from the render instant", () => {
    const src = read("src/app/pricing/_parts/ExamTimingPicker.tsx");
    expect(src).toMatch(/getUpcomingOfficialFor\(\{ exams: OFFICIAL_KEYS_BY_BANK\[bank\], now: new Date\(nowMs\) \}\)/);
    expect(read("src/app/pricing/PricingClient.tsx")).toMatch(/<ExamTimingPicker\n\s+lang=\{lang\}\n\s+renderedAt=\{renderedAt\}/);
  });
  it("landing and pricing servers pass renderedAt", () => {
    expect(read("src/app/landing/page.tsx")).toMatch(/renderedAt=\{new Date\(\)\.toISOString\(\)\}/);
    expect(read("src/app/pricing/page.tsx")).toMatch(/renderedAt=\{new Date\(\)\.toISOString\(\)\}/);
  });
  it("LandingClient reads the stored exam only in its mount effect and has no render-time clock", () => {
    const src = read("src/app/landing/LandingClient.tsx");
    expect(src.match(/getStoredExamSource\(\)/g)).toHaveLength(1);
    expect(src).toContain("setExamSource(getStoredExamSource())");
    expect(src.match(/href=\{trialHref\}/g)).toHaveLength(2); // Hero and FinalCTA
    expect(src).not.toMatch(/new Date\(\)\.getFullYear\(\)/);
  });
  it("UpcomingExams has no wall-clock fallback before mount", () => {
    const src = read("src/components/UpcomingExams.tsx");
    expect(src).not.toMatch(/clientNow \?\? new Date\(\)/);
    expect(src).toMatch(/const live = mounted && badge;/);
  });
});
