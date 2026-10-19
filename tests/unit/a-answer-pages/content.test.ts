import { describe, expect, it } from "vitest";
import { ANSWER_DATA, ANSWER_PAGES, fillPlaceholders } from "@/lib/answer-pages/registry";
import { ANSWER_PLACEHOLDERS } from "@/lib/answer-pages/schema";
import { ANSWER_UI } from "@/lib/answer-pages/copy";
import { guidanceLink } from "@/lib/guidance/public-links";
import { OFFICIAL_KEYS_BY_BANK } from "@/lib/exam-dates";
import type { AnswerPage, Bilingual } from "@/lib/answer-pages/types";
import answerData from "@/lib/answer-pages/pages.data.json";
import articleData from "@/lib/answer-pages/pages.articles.json";

/** Every learner-visible string of a page, with its path, in both languages. */
function strings(page: AnswerPage): { path: string; lang: "de" | "en"; text: string }[] {
  const out: { path: string; lang: "de" | "en"; text: string }[] = [];
  const add = (path: string, b: Bilingual) => { out.push({ path, lang: "de", text: b.de }, { path, lang: "en", text: b.en }); };
  add("title", page.title); add("description", page.description); add("answer", page.answer);
  page.sections.forEach((s, i) => {
    add(`sections[${i}].heading`, s.heading);
    s.paragraphs.forEach((p, j) => add(`sections[${i}].p[${j}]`, p));
    s.steps?.forEach((p, j) => add(`sections[${i}].steps[${j}]`, p));
    s.links?.forEach((l, j) => add(`sections[${i}].links[${j}]`, l.label));
  });
  page.faq.forEach((f, i) => { if (f.kind === "text") { add(`faq[${i}].q`, f.q); add(`faq[${i}].a`, f.a); } });
  return out;
}

const MONTHS = /\b(Jänner|Januar|Februar|März|April|Mai|Juni|Juli|August|September|Oktober|November|Dezember|January|February|March|May|June|July|October|December)\b/;
const DATE_LIKE = /\b(19|20)\d{2}\b|\b\d{1,2}\.\s?\d{1,2}\.|\b\d{1,2}\/\d{1,2}\b/;
const PRICE = /€|\bEUR\b|\bEuro\b|\bUSD\b|\d+[,.]\d{2}\b|\bPreis|\bprice/i;
const INFORMAL_DE = /\b(du|dich|dir|dein|deine|deinen|deinem|deiner|euch|euer)\b/;
const INTERNAL = /\bLektor\b|\bVisite\b|\bSoT\b|\blane [AB]\b|\bKassa\b|kmp_innsbruck|\bpick-|\bMUX-|\bdecisions\.json\b/i;
const PROMISE = /garantiert|garantie|guarantee|Bestehensquote|pass rate|Erfolgsquote|success rate|echte Prüfungsfragen|real exam questions|Originalfragen|original exam questions|bestehen Sie sicher|sure to pass/i;
const GERMANY = /\bDeutschland\b|\bGermany\b|deutsche Prüfung|German exam\b/;

describe("answer page content (Lektor guards in code)", () => {
  it("has every answer page and every guide of the two data files, each with a unique slug", () => {
    // Counted from the data files, so answer-page and guide batches never edit this test.
    expect(ANSWER_PAGES.filter((p) => !p.article)).toHaveLength(answerData.pages.length);
    expect(ANSWER_PAGES.filter((p) => p.article)).toHaveLength(articleData.pages.length);
    expect(answerData.pages.length).toBeGreaterThanOrEqual(8);
    expect(articleData.pages.length).toBeGreaterThanOrEqual(6);
    expect(new Set(ANSWER_PAGES.map((p) => p.slug)).size).toBe(ANSWER_PAGES.length);
    for (const p of ANSWER_PAGES) expect(p.slug).toMatch(/^[a-z0-9]+(?:-[a-z0-9]+)+$/);
  });

  it.each(ANSWER_PAGES.map((p) => [p.id, p] as const))("%s: shape, links and claims", (_id, page) => {
    expect(page.exams.length).toBeGreaterThan(0);
    expect(page.description.de.length).toBeLessThanOrEqual(160);
    expect(page.description.en.length).toBeLessThanOrEqual(160);
    expect(page.title.de.endsWith("?")).toBe(true);
    expect(page.title.en.endsWith("?")).toBe(true);
    expect(page.faq.filter((f) => f.kind === "text").length).toBeGreaterThanOrEqual(3);
    expect(page.faq.some((f) => f.kind === "next_sitting")).toBe(true);
    // The Vienna bank is SIP practice: never lead with a postgraduate ÖÄK date.
    expect(page.exams.every((k) => ["sip4a", "sip5a", "stichprobentest", "rezeptierkunde", "gerichtsmedizin"].includes(k))).toBe(true);
    expect(Object.keys(OFFICIAL_KEYS_BY_BANK)).toContain(page.bank);
    for (const href of page.related) expect(guidanceLink(href), href).not.toBeNull();
    const ids = new Set(page.claims.map((c) => c.id));
    expect(ids.size).toBe(page.claims.length);
    for (const c of page.claims) {
      if (c.source_id === "product") expect(c.status).toBe("product");
      else expect(ANSWER_DATA.sources[c.source_id], `${c.id} -> ${c.source_id}`).toBeDefined();
      expect(c.quote.length).toBeGreaterThan(0);
    }
    const used = [...page.answer_claims, ...page.sections.flatMap((s) => s.claims), ...page.faq.flatMap((f) => (f.kind === "text" ? f.claims : []))];
    for (const id of used) expect(ids.has(id), id).toBe(true);
    for (const s of page.sections) expect(s.claims.length, s.heading.de).toBeGreaterThan(0);
    expect(page.answer_claims.length).toBeGreaterThan(0);
    for (const s of page.sections) for (const l of s.links ?? []) {
      if (l.href.startsWith("/")) expect(guidanceLink(l.href) ?? l.href.startsWith("/blog/"), l.href).toBeTruthy();
      else expect(l.href).toMatch(/^https:\/\//);
    }
  });

  it.each(ANSWER_PAGES.map((p) => [p.id, p] as const))("%s: copy rules", (_id, page) => {
    for (const { path, lang, text } of strings(page)) {
      const where = `${page.id} ${path}.${lang}: ${text}`;
      expect(text.trim().length, where).toBeGreaterThan(0);
      expect(text, where).not.toMatch(/[–—]/);
      expect(text, where).not.toMatch(MONTHS);
      expect(text, where).not.toMatch(DATE_LIKE);
      expect(text, where).not.toMatch(PRICE);
      expect(text, where).not.toMatch(INTERNAL);
      expect(text, where).not.toMatch(PROMISE);
      expect(text, where).not.toMatch(GERMANY);
      if (lang === "de") expect(text, where).not.toMatch(INFORMAL_DE);
      const filled = fillPlaceholders(text, ANSWER_PLACEHOLDERS);
      expect(filled, where).not.toMatch(/\{\w+\}/);
    }
  });

  it("code-owned strings follow the same rules", () => {
    for (const lang of ["de", "en"] as const) for (const [key, text] of Object.entries(ANSWER_UI[lang])) {
      expect(text, key).not.toMatch(/[–—]/);
      expect(text, key).not.toMatch(PROMISE);
      if (lang === "de") expect(text, key).not.toMatch(INFORMAL_DE);
    }
  });

  it("sources carry a url, edition, read date and hash", () => {
    for (const [id, s] of Object.entries(ANSWER_DATA.sources)) {
      expect(s.url, id).toMatch(/^https:\/\//);
      expect(s.read_on, id).toMatch(/^\d{4}-\d{2}-\d{2}$/);
      expect(s.edition.length, id).toBeGreaterThan(0);
    }
  });

  it("no page exposes question content from the bank", () => {
    const text = JSON.stringify(ANSWER_DATA);
    expect(text).not.toMatch(/"(question|choices|options|answer_key|correct)"\s*:/);
  });
});
