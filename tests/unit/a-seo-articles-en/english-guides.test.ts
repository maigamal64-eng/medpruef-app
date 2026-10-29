import * as React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, describe, expect, it, vi } from "vitest";
import articleData from "@/lib/answer-pages/pages.articles.json";
import { ANSWER_PAGES, answerPath, answerSeoTitle, findVisibleAnswerPage, isAnswerSlug, localAnswerHref } from "@/lib/answer-pages/registry";
import { resolveAnswerLang } from "@/lib/answer-pages/lang";
import { answerPathBlocked } from "@/lib/answer-pages/slugs";
import { articleSchema, faqEntries } from "@/lib/answer-pages/schema";
import { renderLlmsTxt } from "@/lib/agent-docs/render-llms";
import { LLMS_TXT_BASE } from "@/lib/agent-docs/llms-txt";

(globalThis as { React?: unknown }).React = React;

vi.mock("next/navigation", () => ({
  notFound: () => { throw new Error("NEXT_NOT_FOUND"); },
  permanentRedirect: (to: string) => { throw new Error(`NEXT_REDIRECT_308:${to}`); },
  usePathname: () => "/blog", useRouter: () => ({ push() {}, replace() {} }), useSearchParams: () => new URLSearchParams(),
}));

// a-seo-articles-en-1019: the six guides get their own English URLs and English copy.
const ON = { ANSWER_PAGES_ENABLED: "true" };
const GUIDES = ANSWER_PAGES.filter((p) => p.article);
const NOW = new Date("2026-10-19T10:00:00Z");

afterEach(() => { vi.unstubAllEnvs(); });

async function render(slug: string, query: Record<string, string> = {}) {
  vi.stubEnv("ANSWER_PAGES_ENABLED", "true");
  vi.stubEnv("STUDY_PLAN_PUBLIC_ENABLED", "true");
  const mod = await import("@/app/blog/[slug]/page");
  const el = await mod.default({ params: Promise.resolve({ slug }), searchParams: Promise.resolve(query) });
  return renderToStaticMarkup(el);
}

describe("English URLs", () => {
  it("every guide has an English slug, and only the guides do", () => {
    // Counted from the data file so guide batches never edit this test (a-seo-guides-b2-de-1019).
    expect(GUIDES).toHaveLength(articleData.pages.length);
    for (const page of GUIDES) {
      expect(page.en_slug, page.slug).toBeTruthy();
      expect(answerPath(page, "en")).toBe(`/blog/${page.en_slug}`);
      expect(answerPath(page, "de")).toBe(`/blog/${page.slug}`);
      expect(isAnswerSlug(page.en_slug!)).toBe(true);
      expect(findVisibleAnswerPage(page.en_slug!, ON)?.id).toBe(page.id);
      expect(findVisibleAnswerPage(page.en_slug!, {})).toBeNull();
    }
    for (const page of ANSWER_PAGES.filter((p) => !p.article)) {
      expect(page.en_slug).toBeUndefined();
      expect(answerPath(page, "en")).toBe(`/blog/${page.slug}?lang=en`);
    }
  });

  it("the edge gate blocks an English slug while the pages are off", () => {
    for (const page of GUIDES) {
      expect(answerPathBlocked(`/blog/${page.en_slug}`, {})).toBe(true);
      expect(answerPathBlocked(`/blog/${page.en_slug}`, ON)).toBe(false);
    }
  });

  it("each URL has one language; ?lang= on the other URL redirects and keeps utm parameters", () => {
    const page = GUIDES[0];
    expect(resolveAnswerLang(page, page.en_slug!, {})).toEqual({ lang: "en", redirectTo: null });
    expect(resolveAnswerLang(page, page.slug, {})).toEqual({ lang: "de", redirectTo: null });
    expect(resolveAnswerLang(page, page.en_slug!, { lang: "en" })).toEqual({ lang: "en", redirectTo: null });
    expect(resolveAnswerLang(page, page.en_slug!, { lang: "fr" })).toEqual({ lang: "en", redirectTo: null });
    expect(resolveAnswerLang(page, page.slug, { lang: "en", utm_source: "telegram", utm_campaign: "x" }).redirectTo)
      .toBe(`/blog/${page.en_slug}?utm_source=telegram&utm_campaign=x`);
    expect(resolveAnswerLang(page, page.en_slug!, { lang: "de" }).redirectTo).toBe(`/blog/${page.slug}`);
    const answer = ANSWER_PAGES.find((p) => !p.article)!;
    expect(resolveAnswerLang(answer, answer.slug, { lang: "en" })).toEqual({ lang: "en", redirectTo: null });
  });

  it("copy links to a guide point at the guide's URL in the page language", () => {
    const page = GUIDES[1];
    expect(localAnswerHref(`/blog/${page.slug}`, "en")).toBe(`/blog/${page.en_slug}`);
    expect(localAnswerHref(`/blog/${page.slug}`, "de")).toBe(`/blog/${page.slug}`);
    const answer = ANSWER_PAGES.find((p) => !p.article)!;
    expect(localAnswerHref(`/blog/${answer.slug}`, "en")).toBe(`/blog/${answer.slug}?lang=en`);
    expect(localAnswerHref("/wien-route", "en")).toBe("/wien-route");
  });
});

describe("route", () => {
  it("serves the English slug in English with a self canonical and the German pair", async () => {
    vi.stubEnv("ANSWER_PAGES_ENABLED", "true");
    const mod = await import("@/app/blog/[slug]/page");
    for (const page of GUIDES) {
      const meta = await mod.generateMetadata({ params: Promise.resolve({ slug: page.en_slug! }), searchParams: Promise.resolve({}) });
      // a-guides-examweek-1029: exam-week guides carry a search title with the next sitting month.
      expect(meta.title).toBe(`${answerSeoTitle(page, "en")} | MedPrüf`);
      expect(meta.alternates?.canonical).toBe(`https://medpruf.com/blog/${page.en_slug}`);
      expect(meta.alternates?.languages).toEqual({ "de-AT": `https://medpruf.com/blog/${page.slug}`, en: `https://medpruf.com/blog/${page.en_slug}`, "x-default": `https://medpruf.com/blog/${page.slug}` });
      const de = await mod.generateMetadata({ params: Promise.resolve({ slug: page.slug }), searchParams: Promise.resolve({}) });
      expect(de.alternates?.canonical).toBe(`https://medpruf.com/blog/${page.slug}`);
    }
  });

  it("redirects the German slug with ?lang=en to the English slug (308)", async () => {
    const page = GUIDES[0];
    await expect(render(page.slug, { lang: "en" })).rejects.toThrow(`NEXT_REDIRECT_308:/blog/${page.en_slug}`);
    await expect(render(page.en_slug!, { lang: "de" })).rejects.toThrow(`NEXT_REDIRECT_308:/blog/${page.slug}`);
  });

  it("the English page links English guides, shows English-only notes, and the German page does not", async () => {
    vi.useFakeTimers({ now: NOW, toFake: ["Date"] });
    try {
      for (const page of GUIDES) {
        const en = await render(page.en_slug!);
        const de = await render(page.slug);
        expect(en).toContain(`data-answer-page="${page.id}"`);
        expect(en).toContain('"inLanguage":"en"');
        expect(en).toContain(`"translationOfWork":{"@id":"https://medpruf.com/blog/${page.slug}#article"}`);
        expect(de).toContain(`"workTranslation":{"@id":"https://medpruf.com/blog/${page.en_slug}#article"}`);
        // Guide links on the English page never send a reader to a German URL.
        for (const other of GUIDES) expect(en, `${page.slug} -> ${other.slug}`).not.toContain(`href="/blog/${other.slug}"`);
        for (const other of GUIDES.filter((g) => g.id !== page.id)) expect(en).toContain(`href="/blog/${other.en_slug}"`);
        const enOnly = page.sections.filter((s) => s.only === "en");
        for (const s of enOnly) { expect(en).toContain(s.heading.en); expect(de).not.toContain(s.heading.en); }
        expect(en.includes('data-answer-only="en"')).toBe(enOnly.length > 0);
        expect(de).not.toContain('data-answer-only');
        // Next step to the study plan in English, the bank of the guide.
        expect(en).toContain(`/lernplan?bank=${page.bank}&amp;lang=en`);
      }
    } finally { vi.useRealTimers(); }
  });
});

describe("FAQ and structured data", () => {
  it("English-only FAQ items appear in the English FAQ markup only", () => {
    for (const page of GUIDES) {
      const only = page.faq.filter((f) => f.kind === "text" && f.only === "en");
      const en = faqEntries(page, "en", NOW, ON).map((e) => e.q);
      const de = faqEntries(page, "de", NOW, ON).map((e) => e.q);
      for (const f of only) if (f.kind === "text") { expect(en).toContain(f.q.en); expect(de).not.toContain(f.q.en); }
      expect(en.length - de.length).toBe(only.length);
    }
  });

  it("the Article schema names the other language only for guides with an English URL", () => {
    const page = GUIDES[0];
    expect(articleSchema(page, "en", "https://medpruf.com/x")).toMatchObject({ translationOfWork: { "@id": `https://medpruf.com/blog/${page.slug}#article` } });
    expect(articleSchema(page, "de", "https://medpruf.com/x")).toMatchObject({ workTranslation: { "@id": `https://medpruf.com/blog/${page.en_slug}#article` } });
  });
});

describe("sitemap and llms.txt", () => {
  it("the sitemap lists each English URL as its own entry with the language pair", async () => {
    vi.stubEnv("ANSWER_PAGES_ENABLED", "true");
    const { default: sitemap } = await import("@/app/sitemap");
    const entries = sitemap();
    for (const page of GUIDES) {
      const en = entries.find((e) => e.url === `https://medpruf.com/blog/${page.en_slug}`);
      const de = entries.find((e) => e.url === `https://medpruf.com/blog/${page.slug}`);
      expect(en?.alternates?.languages).toEqual(de?.alternates?.languages);
      expect(en?.alternates?.languages).toMatchObject({ en: `https://medpruf.com/blog/${page.en_slug}`, "de-AT": `https://medpruf.com/blog/${page.slug}` });
    }
    expect(entries.filter((e) => e.url.includes("?lang=en"))).toEqual([]);
  });

  it("llms.txt lists the English guides in their own block, only while the pages are on", () => {
    const on = renderLlmsTxt(ON, false);
    expect(on).toContain("\n## Guides in English (nostrification in Austria)\n\n");
    for (const page of GUIDES) expect(on).toContain(`- [/blog/${page.en_slug}](https://medpruf.com/blog/${page.en_slug}): ${page.title.en}`);
    expect(on.indexOf("## Guides in English")).toBeLessThan(on.indexOf("## Pricing"));
    expect(renderLlmsTxt({}, false)).toBe(LLMS_TXT_BASE);
  });
});

describe("English copy for English readers", () => {
  const english = (page: (typeof GUIDES)[number]) => [
    page.title.en, page.description.en, page.answer.en,
    ...page.sections.flatMap((s) => [s.heading.en, ...s.paragraphs.map((p) => p.en), ...(s.steps ?? []).map((p) => p.en), ...(s.links ?? []).map((l) => l.label.en)]),
    ...page.faq.flatMap((f) => (f.kind === "text" ? [f.q.en, f.a.en] : [])),
  ].filter((t) => t.length > 0);

  it("is not the German text, and German source links say they are in German", () => {
    for (const page of GUIDES) {
      for (const s of page.sections) if (!s.only) expect(s.heading.en).not.toBe(s.heading.de);
      for (const s of page.sections) for (const l of s.links ?? []) if (/^https:\/\//.test(l.href)) expect(l.label.en, l.href).toMatch(/\(.*in German\)$/);
    }
  });

  it("frames the exams as Austrian and never as an exam of Germany", () => {
    for (const page of GUIDES) {
      const text = english(page).join("\n");
      expect(text, page.slug).toMatch(/Austria|Vienna|Innsbruck/);
      expect(text, page.slug).not.toMatch(/\bGermany\b|German exam\b|German licen[cs]e/);
      expect(text, page.slug).not.toMatch(/\bwe\b|\bour\b|\bAI\b|\bfree\b(?!-text)|[–—]/i);
    }
  });
});

describe("reviewer fixes (P1/P2)", () => {
  it("the middleware slug map equals the data", async () => {
    const { ANSWER_EN_SLUGS } = await import("@/lib/answer-pages/slugs");
    expect(ANSWER_EN_SLUGS).toEqual(Object.fromEntries(GUIDES.map((p) => [p.slug, p.en_slug])));
  });

  it("middleware answers the other-language guide URL with a real 308 and keeps utm parameters", async () => {
    vi.stubEnv("ANSWER_PAGES_ENABLED", "true");
    const { middleware } = await import("@/middleware");
    const { NextRequest } = await import("next/server");
    const page = GUIDES[2];
    const toEn = middleware(new NextRequest(`https://medpruf.com/blog/${page.slug}?lang=EN&utm_source=telegram`));
    expect(toEn.status).toBe(308);
    expect(toEn.headers.get("location")).toBe(`https://medpruf.com/blog/${page.en_slug}?utm_source=telegram`);
    const toDe = middleware(new NextRequest(`https://medpruf.com/blog/${page.en_slug}?lang=de`));
    expect(toDe.status).toBe(308);
    expect(toDe.headers.get("location")).toBe(`https://medpruf.com/blog/${page.slug}`);
    for (const url of [`/blog/${page.en_slug}`, `/blog/${page.en_slug}?lang=en`, `/blog/${page.slug}?lang=de`, `/blog/${ANSWER_PAGES.find((p) => !p.article)!.slug}?lang=en`]) {
      expect(middleware(new NextRequest(`https://medpruf.com${url}`)).headers.get("x-middleware-next"), url).toBe("1");
    }
    vi.stubEnv("ANSWER_PAGES_ENABLED", "");
    expect(middleware(new NextRequest(`https://medpruf.com/blog/${page.slug}?lang=en`)).headers.get("x-middleware-rewrite")).toContain("/__answer-page-off");
  });

  it("the per-bank link hub links a guide's English URL in English", async () => {
    const { seoLinkHub } = await import("@/lib/seo/gsc");
    const { SeoLinkHub } = await import("@/components/seo/GscSeo");
    const env = { ...ON, SEO_GSC_COPY_ENABLED: "true" };
    const page = GUIDES.find((p) => p.bank === "pharma")!;
    const hub = seoLinkHub("pharma", NOW, env);
    expect(hub.answers.find((a) => a.href === `/blog/${page.slug}`)?.hrefEn).toBe(`/blog/${page.en_slug}`);
    const i18n = await import("@/lib/i18n");
    const spy = vi.spyOn(i18n, "useLang").mockReturnValue("en");
    try {
      const html = renderToStaticMarkup(React.createElement(SeoLinkHub, hub));
      expect(html).toContain(`href="/blog/${page.en_slug}"`);
      expect(html).not.toContain(`href="/blog/${page.slug}?lang=en"`);
    } finally { spy.mockRestore(); }
  });
});
