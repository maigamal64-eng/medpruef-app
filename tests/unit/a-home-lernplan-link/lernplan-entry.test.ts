/**
 * a-home-lernplan-link-1018: /landing (where medpruf.com/ sends visitors)
 * links to the public /lernplan page under the exam calendar, only while
 * STUDY_PLAN_PUBLIC_ENABLED is on. The founder note of 22 Oct sends readers
 * to "Lernplan" on the site; track-A's C1 probe greps the server HTML.
 */
import { describe, expect, it, vi } from "vitest";
import React, { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import LernplanEntry, { LERNPLAN_ENTRY_COPY, lernplanEntryHref } from "@/components/landing/LernplanEntry";

(globalThis as { React?: typeof React }).React = React;
// Imported after the global React is set: some landing children build JSX at module load.
const { default: LandingClient } = await import("@/app/landing/LandingClient");

vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: () => {}, replace: () => {}, prefetch: () => {} }),
  usePathname: () => "/landing",
  useSearchParams: () => new URLSearchParams(),
}));

// The C1 probe from reports/backlog-out/a-founder-post-sp3-1018/tgctl-commands.md.
const C1 = /href="(https:\/\/medpruf\.com)?\/lernplan[^"]*"[^>]*>[^<]*Lernplan/;
const RENDERED_AT = "2026-10-18T10:00:00.000Z";

describe("LernplanEntry", () => {
  it("German markup carries a /lernplan link labelled Lernplan (C1)", () => {
    const html = renderToStaticMarkup(createElement(LernplanEntry, { lang: "de" }));
    expect(html).toMatch(C1);
    expect(html).toContain('href="/lernplan"');
  });

  it("English keeps the Lernplan label and opens the English page", () => {
    const html = renderToStaticMarkup(createElement(LernplanEntry, { lang: "en" }));
    expect(html).toMatch(C1);
    expect(lernplanEntryHref("en")).toBe("/lernplan?lang=en");
  });

  it("copy has no price, trial, bare free or em dash", () => {
    const all = Object.values(LERNPLAN_ENTRY_COPY).flatMap((v) => [v.de, v.en]).join(" ");
    expect(all).not.toMatch(/€|EUR|\bfree\b|kostenlos|gratis|trial|testen|Probe|—|–|!/i);
    expect(all).not.toMatch(/Deutschland|German/);
  });
});

describe("LandingClient lernplan entry", () => {
  it("renders the entry under the calendar when the flag is on", () => {
    const html = renderToStaticMarkup(createElement(LandingClient, { renderedAt: RENDERED_AT, lernplanLink: true }));
    expect(html).toMatch(C1);
    const termine = html.indexOf('id="termine"');
    const entry = html.indexOf('data-testid="landing-lernplan-entry"');
    const pricing = html.indexOf('id="pricing"');
    expect(termine).toBeGreaterThan(-1);
    expect(entry).toBeGreaterThan(termine);
    expect(pricing).toBeGreaterThan(entry);
  });

  it("renders no /lernplan link when the flag is off (the page would 404)", () => {
    const html = renderToStaticMarkup(createElement(LandingClient, { renderedAt: RENDERED_AT }));
    expect(html).not.toContain('href="/lernplan');
    expect(html).not.toContain("landing-lernplan-entry");
  });
});
