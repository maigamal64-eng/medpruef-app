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

(globalThis as { React?: typeof React }).React = React;

const BUILD = "2026-10-16T10:00:00.000Z"; // the 18 Oct production HTML was built about then
const VISIT_SAME_WINDOW = "2026-10-18T10:00:00.000Z"; // day count changes (3 -> 1)
const VISIT_AFTER_CLOSE = "2026-10-21T10:00:00.000Z"; // SIP close 19 Oct and Rez/GM 20 Oct 12:00 passed: card set changes

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
    expect(html).toContain("19. Oktober 2026");
    expect(html).not.toMatch(/noch \d+ Tag/);
    expect(renderAt(BUILD, BUILD, "en")).not.toMatch(/\d+ days? left/);
  });
});

describe("prerendered pages pass the render instant and read no storage in render", () => {
  const read = (p: string) => readFileSync(p, "utf8");
  it("landing and pricing servers pass renderedAt", () => {
    expect(read("src/app/landing/page.tsx")).toMatch(/renderedAt=\{new Date\(\)\.toISOString\(\)\}/);
    expect(read("src/app/pricing/page.tsx")).toMatch(/renderedAt=\{new Date\(\)\.toISOString\(\)\}/);
  });
  it("LandingClient reads the stored exam only in its mount effect and has no render-time clock", () => {
    const src = read("src/app/landing/LandingClient.tsx");
    expect(src.match(/getStoredExamSource\(\)/g)).toHaveLength(1);
    expect(src).toMatch(/useEffect\(\(\) => \{\n\s+setLangState\(getLang\(\)\);\n\s+setExamSource\(getStoredExamSource\(\)\);/);
    expect(src).not.toMatch(/new Date\(\)\.getFullYear\(\)/);
  });
  it("UpcomingExams has no wall-clock fallback before mount", () => {
    const src = read("src/components/UpcomingExams.tsx");
    expect(src).not.toMatch(/clientNow \?\? new Date\(\)/);
    expect(src).toMatch(/const badge = mounted \? registrationDeadlineBadge/);
  });
});
