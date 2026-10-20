import * as React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, describe, expect, it, vi } from "vitest";
import articles from "@/lib/answer-pages/pages.articles.json";
import { ANSWER_DATA, ANSWER_PAGES, answerPath, visibleArticlePages } from "@/lib/answer-pages/registry";
import { articleSchema } from "@/lib/answer-pages/schema";
import { ANSWER_SLUG_GATES } from "@/lib/answer-pages/slugs";
import { renderLlmsTxt } from "@/lib/agent-docs/render-llms";
import { seoLinkHub } from "@/lib/seo/gsc";
import { GuideLinksProvider, LandingGuides } from "@/components/answer-pages/GuideLinks";
import type { AnswerPage, Bilingual } from "@/lib/answer-pages/types";

(globalThis as { React?: unknown }).React = React;

// a-seo-articles-1019: six long-form guides on the answer-page rails.
const ON = { ANSWER_PAGES_ENABLED: "true" };
const GUIDES = ANSWER_PAGES.filter((p) => p.article);

function copy(page: AnswerPage): string[] {
  const out: string[] = [];
  const add = (b: Bilingual) => out.push(b.de, b.en);
  add(page.title); add(page.description); add(page.answer);
  for (const s of page.sections) { add(s.heading); s.paragraphs.forEach(add); s.steps?.forEach(add); s.links?.forEach((l) => add(l.label)); }
  for (const f of page.faq) if (f.kind === "text") { add(f.q); add(f.a); }
  return out;
}

afterEach(() => { vi.unstubAllEnvs(); });

describe("guides data", () => {
  it("are the pages of pages.articles.json, each marked as an article", () => {
    expect(GUIDES.map((p) => p.slug)).toEqual(articles.pages.map((p) => p.slug));
    for (const page of GUIDES) {
      expect(page.article?.published_on).toMatch(/^\d{4}-\d{2}-\d{2}$/);
      expect(page.title.de.length, page.slug).toBeLessThanOrEqual(110);
      expect(page.title.en.length, page.slug).toBeLessThanOrEqual(110);
    }
  });

  it("both data files use the registry's schema version", async () => {
    const answers = (await import("@/lib/answer-pages/pages.data.json")).default;
    expect(answers.schemaVersion).toBe(1);
    expect(articles.schemaVersion).toBe(1);
  });

  it("guide sources do not shadow an answer-page source id", () => {
    for (const id of Object.keys(articles.sources)) expect(id.startsWith("art-"), id).toBe(true);
    for (const id of Object.keys(articles.sources)) expect(ANSWER_DATA.sources[id]).toEqual((articles.sources as Record<string, unknown>)[id]);
  });

  it("every /blog link points to an existing answer page or guide, and each guide links another guide", () => {
    const guideSlugs = new Set(GUIDES.map((p) => p.slug));
    for (const page of GUIDES) {
      const hrefs = page.sections.flatMap((s) => (s.links ?? []).map((l) => l.href)).filter((h) => h.startsWith("/blog/"));
      for (const href of hrefs) expect(href.slice("/blog/".length) in ANSWER_SLUG_GATES, href).toBe(true);
      expect(hrefs.some((h) => guideSlugs.has(h.slice("/blog/".length)) && h !== `/blog/${page.slug}`), page.slug).toBe(true);
    }
  });

  it("follow the voice rules beyond the shared copy guards", () => {
    for (const page of GUIDES) for (const text of copy(page)) {
      expect(text, `${page.slug}: ${text}`).not.toMatch(/kostenlos|gratis|\bfree\b(?!-text)|unbegrenzt|unlimited/i);
      expect(text, `${page.slug}: ${text}`).not.toMatch(/\bKI\b|\bAI\b|künstliche Intelligenz|artificial intelligence|automated|automatisiert|\bBot\b/i);
      expect(text, `${page.slug}: ${text}`).not.toMatch(/Altfragen|offizielle Prüfungsfragen sind|echte Fragen|leaked|recalled/i);
      expect(text, `${page.slug}: ${text}`).not.toMatch(/durchgefallen|nicht bestanden haben|failed the Stichprobentest/i);
    }
  });

  it("product claims stay honest: curated, not official", () => {
    const text = GUIDES.flatMap(copy).join("\n");
    expect(text).toContain("keine offiziellen Prüfungsfragen");
    expect(text).toContain("not official exam questions");
  });
});

describe("Article structured data", () => {
  it("is built for guides only, in the rendered language, with the quoted sources as citations", () => {
    for (const page of GUIDES) for (const lang of ["de", "en"] as const) {
      const url = `https://medpruf.com${answerPath(page, lang)}`;
      const schema = articleSchema(page, lang, url);
      expect(schema?.["@type"]).toBe("Article");
      expect(schema?.headline).toBe(page.title[lang]);
      expect(schema?.inLanguage).toBe(lang === "de" ? "de-AT" : "en");
      expect(schema?.datePublished).toBe(page.article?.published_on);
      expect(schema?.dateModified).toBe(page.checked_on);
      expect(schema?.mainEntityOfPage).toBe(url);
      expect(schema?.citation.length).toBeGreaterThan(0);
      for (const c of schema?.citation ?? []) expect(c).toMatch(/^https:\/\//);
    }
    for (const page of ANSWER_PAGES.filter((p) => !p.article)) expect(articleSchema(page, "de", "https://medpruf.com/x")).toBeNull();
  });
});

describe("guide lists", () => {
  it("visibleArticlePages follows ANSWER_PAGES_ENABLED", () => {
    expect(visibleArticlePages({})).toEqual([]);
    expect(visibleArticlePages(ON).map((p) => p.slug)).toEqual(GUIDES.map((p) => p.slug));
  });

  it("the SEO link hub leaves guides to the /landing block but keeps them on bank pages", () => {
    const env = { ...ON, SEO_GSC_COPY_ENABLED: "true" };
    const now = new Date("2026-10-19T10:00:00Z");
    const all = seoLinkHub("all", now, env).answers.map((a) => a.href);
    expect(all.length).toBeGreaterThan(0);
    for (const page of GUIDES) expect(all).not.toContain(answerPath(page, "de"));
    for (const page of GUIDES) expect(seoLinkHub(page.bank as "kenntnispruefung" | "kmp_innsbruck" | "pharma", now, env).answers.map((a) => a.href)).toContain(answerPath(page, "de"));
  });

  it("llms.txt lists every guide when the pages are on", () => {
    const on = renderLlmsTxt(ON, false);
    for (const page of GUIDES) expect(on).toContain(`https://medpruf.com${answerPath(page)}`);
    for (const page of GUIDES) expect(renderLlmsTxt({}, false)).not.toContain(page.slug);
  });

  it("the sitemap lists every guide when the pages are on", async () => {
    vi.stubEnv("ANSWER_PAGES_ENABLED", "true");
    const { default: sitemap } = await import("@/app/sitemap");
    const urls = (await sitemap()).map((e) => e.url);
    for (const page of GUIDES) expect(urls).toContain(`https://medpruf.com${answerPath(page, "de")}`);
  });

  it("the /landing guide list links each guide in the visitor's language, and renders nothing when empty", () => {
    const data = {
      heading: { de: "Ratgeber", en: "Guides" },
      intro: { de: "Intro", en: "Intro" },
      guides: GUIDES.map((p) => ({ slug: p.slug, href: { de: answerPath(p, "de"), en: answerPath(p, "en") }, title: p.title, description: p.description })),
    };
    const h = React.createElement;
    const render = (d: typeof data, lang: "de" | "en") => renderToStaticMarkup(h(GuideLinksProvider, { data: d }, h(LandingGuides, { lang })));
    const de = render(data, "de");
    const en = render(data, "en");
    for (const page of GUIDES) {
      expect(de).toContain(`href="/blog/${page.slug}"`);
      expect(en).toContain(`href="/blog/${page.en_slug}"`);
    }
    expect(render({ ...data, guides: [] }, "de")).toBe("");
    expect(renderToStaticMarkup(h(LandingGuides, { lang: "de" }))).toBe("");
  });
});
