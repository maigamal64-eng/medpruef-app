import * as React from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { answerPagesEnabled } from "@/lib/answer-pages/flag";
import { ANSWER_PAGES, answerPath, conditionHolds, findVisibleAnswerPage, visibleAnswerPages, visibleFaq } from "@/lib/answer-pages/registry";
import { faqEntries, faqPageSchema, jsonLdText } from "@/lib/answer-pages/schema";

(globalThis as { React?: unknown }).React = React;

const ON = { ANSWER_PAGES_ENABLED: "true" };
// a-flip-copy-fixes-1018: the mentor page states included credits, so it needs both Mentor copy flags.
const MENTOR = { ...ON, NEXT_PUBLIC_MENTOR_PUBLIC_COPY: "true", NEXT_PUBLIC_MENTOR_INCLUDED_COPY: "true" };
const mentorPages = ANSWER_PAGES.filter((p) => (p.requires ?? []).includes("mentor_public_copy"));

afterEach(() => { vi.unstubAllEnvs(); });

describe("ANSWER_PAGES_ENABLED", () => {
  it("only the literal true turns the pages on", () => {
    for (const v of [undefined, "", "1", "TRUE", "yes", "false"]) expect(answerPagesEnabled(v)).toBe(false);
    expect(answerPagesEnabled("true")).toBe(true);
    expect(visibleAnswerPages({})).toEqual([]);
    expect(visibleAnswerPages({ ANSWER_PAGES_ENABLED: "1" })).toEqual([]);
  });

  it("the mentor page also needs the public mentor copy", () => {
    expect(mentorPages).toHaveLength(1);
    expect(mentorPages[0].llms).toBe(false);
    expect(visibleAnswerPages(ON).map((p) => p.id)).not.toContain(mentorPages[0].id);
    expect(visibleAnswerPages(MENTOR)).toHaveLength(ANSWER_PAGES.length);
    expect(findVisibleAnswerPage(mentorPages[0].slug, ON)).toBeNull();
    expect(findVisibleAnswerPage(mentorPages[0].slug, MENTOR)?.id).toBe(mentorPages[0].id);
  });

  it("FAQ items tied to the referral credits show only while that programme is offered", () => {
    expect(conditionHolds("referral_mentor_credits", MENTOR)).toBe(false);
    const offered = { ...MENTOR, REFERRAL_MENTOR_CREDITS_ENABLED: "true", AI_FEATURES_ENABLED: "true", MENTOR_ENABLED: "true", MENTOR_ACCESS_SCOPE: "signed_in" };
    expect(conditionHolds("referral_mentor_credits", offered)).toBe(true);
    for (const page of ANSWER_PAGES) {
      const conditional = page.faq.filter((f) => f.kind === "text" && f.when);
      expect(visibleFaq(page, MENTOR).length).toBe(page.faq.length - conditional.length);
      const withTrial = { ...offered, NEXT_PUBLIC_REVERSE_TRIAL: "true" };
      expect(visibleFaq(page, withTrial).length).toBe(page.faq.length);
    }
  });
});

describe("route, sitemap and FAQ schema", () => {
  it("blog/[slug] answers 404 for an answer slug while the flag is off", async () => {
    vi.stubEnv("ANSWER_PAGES_ENABLED", "");
    const mod = await import("@/app/blog/[slug]/page");
    const slug = ANSWER_PAGES[0].slug;
    await expect(mod.default({ params: Promise.resolve({ slug }), searchParams: Promise.resolve({}) })).rejects.toThrow(/NEXT_HTTP_ERROR_FALLBACK;404|NEXT_NOT_FOUND/);
    const meta = await mod.generateMetadata({ params: Promise.resolve({ slug }), searchParams: Promise.resolve({}) });
    expect(meta.robots).toEqual({ index: false, follow: false });
  });

  it("blog/[slug] renders the page with metadata and hreflang while on", async () => {
    vi.stubEnv("ANSWER_PAGES_ENABLED", "true");
    const mod = await import("@/app/blog/[slug]/page");
    const page = ANSWER_PAGES.find((p) => !p.requires)!;
    const el = await mod.default({ params: Promise.resolve({ slug: page.slug }), searchParams: Promise.resolve({ lang: "en" }) });
    expect(el).toBeTruthy();
    const meta = await mod.generateMetadata({ params: Promise.resolve({ slug: page.slug }), searchParams: Promise.resolve({ lang: "en" }) });
    expect(meta.title).toBe(`${page.title.en} | MedPrüf`);
    expect(meta.alternates?.canonical).toBe(`https://medpruf.com${answerPath(page, "en")}`);
    expect(meta.alternates?.languages).toMatchObject({ "de-AT": `https://medpruf.com/blog/${page.slug}` });
  });

  it("the sitemap lists answer pages only while on", async () => {
    const { default: sitemap } = await import("@/app/sitemap");
    vi.stubEnv("ANSWER_PAGES_ENABLED", "");
    const off = sitemap().map((e) => e.url);
    for (const p of ANSWER_PAGES) expect(off.some((u) => u.includes(p.slug))).toBe(false);
    vi.stubEnv("ANSWER_PAGES_ENABLED", "true");
    const on = sitemap().map((e) => e.url);
    for (const p of visibleAnswerPages(ON)) expect(on).toContain(`https://medpruf.com/blog/${p.slug}`);
    for (const p of mentorPages) expect(on.some((u) => u.includes(p.slug))).toBe(false);
  });

  it("FAQPage markup equals the visible FAQ, dates from code, script-safe", () => {
    const now = new Date("2026-10-14T10:00:00Z");
    for (const page of ANSWER_PAGES) for (const lang of ["de", "en"] as const) {
      const entries = faqEntries(page, lang, now, MENTOR);
      const schema = faqPageSchema(page, lang, "https://medpruf.com/x", entries);
      expect(schema["@type"]).toBe("FAQPage");
      expect(schema.mainEntity).toHaveLength(visibleFaq(page, MENTOR).length);
      expect(schema.mainEntity.every((q) => q.name.length > 0 && q.acceptedAnswer.text.length > 0)).toBe(true);
      expect(jsonLdText(schema)).not.toContain("<");
    }
  });
});

describe("edge gate (middleware)", () => {
  it("the slug list equals the content file", async () => {
    const { ANSWER_SLUG_GATES } = await import("@/lib/answer-pages/slugs");
    expect(Object.fromEntries(ANSWER_PAGES.map((p) => [p.slug, p.requires ?? []]))).toEqual(ANSWER_SLUG_GATES);
  });

  it("blocks answer slugs while off, passes other blog URLs", async () => {
    const { answerPathBlocked } = await import("@/lib/answer-pages/slugs");
    const free = ANSWER_PAGES.find((p) => !p.requires)!;
    expect(answerPathBlocked(`/blog/${free.slug}`, {})).toBe(true);
    expect(answerPathBlocked(`/blog/${free.slug}/`, {})).toBe(true);
    expect(answerPathBlocked(`/blog/${free.slug}`, ON)).toBe(false);
    expect(answerPathBlocked(`/blog/${mentorPages[0].slug}`, ON)).toBe(true);
    expect(answerPathBlocked(`/blog/${mentorPages[0].slug}`, MENTOR)).toBe(false);
    expect(answerPathBlocked("/blog/kenntnispruefung-zweiter-versuch", {})).toBe(false);
    expect(answerPathBlocked("/blog", {})).toBe(false);
  });

  it("middleware rewrites a blocked answer page to the 404 route", async () => {
    vi.stubEnv("ANSWER_PAGES_ENABLED", "");
    const { middleware } = await import("@/middleware");
    const { NextRequest } = await import("next/server");
    const res = middleware(new NextRequest(`https://medpruf.com/blog/${ANSWER_PAGES[0].slug}`));
    expect(res.headers.get("x-middleware-rewrite")).toContain("/__answer-page-off");
    const pass = middleware(new NextRequest("https://medpruf.com/blog/kenntnispruefung-zweiter-versuch"));
    expect(pass.headers.get("x-middleware-rewrite")).toBeNull();
    expect(pass.headers.get("x-middleware-next")).toBe("1");
  });
});
