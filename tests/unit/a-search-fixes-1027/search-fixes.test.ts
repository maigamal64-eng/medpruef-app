import { afterEach, describe, expect, it, vi } from "vitest";
import * as React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { Option } from "@/components/ui/Option";
import { ANSWER_PAGES } from "@/lib/answer-pages/registry";
import { SEO_COPY } from "@/lib/seo/gsc-copy";

// Same pattern as tests/unit/a-seo-articles-en/shell-toggle.test.ts: components compile to classic JSX here.
(globalThis as { React?: unknown }).React = React;

afterEach(() => vi.unstubAllEnvs());

describe("a-search-fixes-1027: titles match the query", () => {
  it("the Fristen page leads its search title with Prüfungsausschreibung and the MedUni Wien calendar", async () => {
    vi.stubEnv("ANSWER_PAGES_ENABLED", "true");
    const page = ANSWER_PAGES.find((p) => p.slug === "pruefungsausschreibung-pruefungskalender-wo")!;
    expect(page.seo_title?.de).toMatch(/^Prüfungsausschreibung MUW: Prüfungskalender der MedUni Wien$/);
    expect(page.title.de.endsWith("?")).toBe(true); // the h1 stays question-shaped
    const mod = await import("@/app/blog/[slug]/page");
    const meta = await mod.generateMetadata({ params: Promise.resolve({ slug: page.slug }), searchParams: Promise.resolve({}) });
    expect(meta.title).toBe(`${page.seo_title!.de} | MedPrüf`);
    expect(meta.openGraph?.title).toBe(meta.title);
    expect(page.description.de).toMatch(/^Offizielle Links: Prüfungskalender der MedUni Wien/);
  });

  it("/kenntnispruefung-wien names the bank label, scoped to SIP4a/SIP5a and apart from the ÖÄK exam", () => {
    const { title, description } = SEO_COPY.pages.kenntnispruefung;
    expect(title).toMatch(/^Kenntnisprüfung Wien: .*SIP4a und SIP5a/);
    expect(description).toMatch(/Nicht für die postgraduale ÖÄK-Arztprüfung/);
    expect(description).toMatch(/kostenlose Probe/);
    for (const text of [title, description]) expect(text).not.toMatch(/[–—]|€|\bEUR\b|\b20\d{2}\b/);
  });
});

describe("a-search-fixes-1027: junk variants stay out of the index", () => {
  it("an unknown blog slug keeps noindex", async () => {
    const mod = await import("@/app/blog/[slug]/page");
    const meta = await mod.generateMetadata({ params: Promise.resolve({ slug: "does-not-exist" }), searchParams: Promise.resolve({}) });
    expect(meta.robots).toEqual({ index: false, follow: false });
  });
});

describe("a-search-fixes-1027: answered option rows respond to a tap", () => {
  const render = (props: Record<string, unknown>) => renderToStaticMarkup(React.createElement(Option, { letter: "A", ...props }, "Text"));

  it("a graded row with a handler looks tappable and stays aria-disabled", () => {
    const html = render({ state: "correct", disabled: true, onGradedClick: () => {} });
    expect(html).toContain("cursor-pointer");
    expect(html).toContain('aria-disabled="true"');
  });

  it("without a handler (exam review, explanation hidden) the graded row is not marked tappable", () => {
    expect(render({ state: "wrong", disabled: true })).not.toContain("cursor-pointer");
    expect(render({ state: "idle" })).not.toContain("cursor-pointer");
  });
});

describe("a-search-fixes-1027: app routes Search Console listed stay noindex, landing pages stay listed", () => {
  // INSIGHTS 26 Oct: /quiz (and ?exam=, ?topic=, ?setup= variants), /login?intent=trial, /settings, /stats and
  // other app surfaces drew impressions. Live check 27 Oct: all serve noindex. This pins it.
  const APP_ROUTES = ["quiz", "login", "settings", "stats", "progress", "exam", "library", "curriculum", "study-plan", "flashcards", "profile"];

  it.each(APP_ROUTES)("/%s layout metadata sets robots index false", async (route) => {
    const mod = (await import(`@/app/${route}/layout.tsx`)) as { metadata?: { robots?: { index?: boolean } } };
    expect(mod.metadata?.robots?.index).toBe(false);
  });

  it("the sitemap lists no app route and keeps every real landing page", async () => {
    vi.stubEnv("ANSWER_PAGES_ENABLED", "true");
    const { default: sitemap } = await import("@/app/sitemap");
    const paths = sitemap().map((e) => e.url.replace("https://medpruf.com", "") || "/");
    for (const route of APP_ROUTES) expect(paths.some((p) => p === `/${route}` || p.startsWith(`/${route}?`)), route).toBe(false);
    expect(paths.some((p) => p.includes("?"))).toBe(false);
    for (const landing of ["/", "/kenntnispruefung-wien", "/stichprobentest", "/pharmakologie-pruefung-wien", "/pricing", "/blog/pruefungsausschreibung-pruefungskalender-wo"]) {
      expect(paths, landing).toContain(landing);
    }
  });
});
