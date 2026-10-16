import { describe, it, expect, afterEach, vi } from "vitest";
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";

// The Next compiler injects the automatic JSX runtime; vitest here uses the classic one.
(globalThis as { React?: typeof React }).React = React;

vi.mock("next/navigation", () => ({
  notFound: () => { throw new Error("NEXT_NOT_FOUND"); },
  redirect: (to: string) => { throw new Error(`NEXT_REDIRECT:${to}`); },
  usePathname: () => "/", useRouter: () => ({ push() {}, replace() {} }), useSearchParams: () => new URLSearchParams(),
}));

afterEach(() => { vi.unstubAllEnvs(); vi.useRealTimers(); });

async function render(slug: string, lang?: string) {
  const { default: Page } = await import("@/app/pruefungskalender/[slug]/page");
  const el = await Page({ params: Promise.resolve({ slug }), searchParams: Promise.resolve(lang ? { lang } : {}) });
  return renderToStaticMarkup(el);
}

describe("sitting page render", () => {
  it("is a 404 while the flag is off", async () => {
    await expect(render("sip4a-2027-02-19")).rejects.toThrow("NEXT_NOT_FOUND");
  });
  it("renders the sitting, both Stichprobentest publishers, the official links and the JSON-LD", async () => {
    vi.stubEnv("SITTING_PAGES_ENABLED", "true");
    vi.useFakeTimers({ now: new Date("2026-12-20T10:00:00Z"), toFake: ["Date"] });
    const html = await render("stichprobentest-innsbruck-2027-02-03", "en");
    expect(html).toContain("3 February 2027");
    expect(html.match(/data-window-row/g)).toHaveLength(2);
    expect(html).toContain("MedUni Wien");
    expect(html).toContain("Medizinische Universität Innsbruck");
    expect(html).toContain("Termine-Stichprobentest-2027-1.pdf");
    expect(html).toContain('"@type":"EducationEvent"');
    expect(html).not.toMatch(/€|price/i);
  });
  it("shows no date, window or JSON-LD while the date-watch freeze is on, only the official link", async () => {
    vi.stubEnv("SITTING_PAGES_ENABLED", "true");
    vi.stubEnv("DATE_WATCH_FREEZE", "true");
    vi.useFakeTimers({ now: new Date("2026-12-20T10:00:00Z"), toFake: ["Date"] });
    for (const lang of ["de", "en"]) {
      const html = await render("sip4a-2027-02-19", lang);
      expect(html).toContain("data-date-freeze");
      // The URL slug still carries the date (documented); no visible text or meta may.
      expect(html.replace(/<[^>]*>/g, " ")).not.toMatch(/2027|\b\d{1,2}\.\s?(Januar|Februar|März|April|Mai|Juni|Juli|August|September|Oktober|November|Dezember)/);
      expect(html).not.toContain("data-window-row");
      expect(html).not.toContain("EducationEvent");
      expect(html).toMatch(/href="https:\/\/www\.meduniwien\.ac\.at/);
    }
  });
  it("redirects a past sitting and 404s an unconfirmed one", async () => {
    vi.stubEnv("SITTING_PAGES_ENABLED", "true");
    vi.useFakeTimers({ now: new Date("2027-02-20T10:00:00Z"), toFake: ["Date"] });
    await expect(render("sip4a-2027-02-19")).rejects.toThrow("NEXT_REDIRECT:/pruefungskalender/sip4a-2027-04-27");
    await expect(render("sip4a-2027-03-10")).rejects.toThrow("NEXT_NOT_FOUND");
  });
});
