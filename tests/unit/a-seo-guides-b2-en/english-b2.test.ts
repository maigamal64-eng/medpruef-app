import { describe, expect, it } from "vitest";
import articleData from "@/lib/answer-pages/pages.articles.json";

// a-seo-guides-b2-en-1019: the six batch-2 guides are written for English readers,
// with English-only glossary and FAQ items that cite claims on the same page.
type Page = (typeof articleData.pages)[number];
const B2 = [
  "artikel-sip4a-sip5a", "artikel-innsbruck-ergaenzung", "artikel-dauer-kosten",
  "artikel-aerzteliste", "artikel-facharzt-anrechnung", "artikel-lernen-neben-beruf",
];
const pages = B2.map((id) => articleData.pages.find((p) => p.id === id) as Page);

describe("batch-2 guides in English", () => {
  it("all six are present with an English URL", () => {
    for (const [i, p] of pages.entries()) {
      expect(p, B2[i]).toBeTruthy();
      expect(p.en_slug).toMatch(/^[a-z0-9]+(?:-[a-z0-9]+)+$/);
      expect(p.title.en).not.toBe(p.title.de);
    }
  });

  it("each guide carries at least one English-only item, and every English-only item cites claims of its page", () => {
    for (const p of pages) {
      const ids = new Set(p.claims.map((c) => c.id));
      const sections = p.sections.filter((s) => (s as { only?: string }).only === "en");
      const faq = p.faq.filter((f) => (f as { only?: string }).only === "en");
      expect(sections.length + faq.length, p.id).toBeGreaterThan(0);
      for (const item of [...sections, ...faq]) {
        const claims = (item as { claims: string[] }).claims;
        expect(claims.length, p.id).toBeGreaterThan(0);
        for (const c of claims) expect(ids.has(c), `${p.id} ${c}`).toBe(true);
      }
      // English-only items have no German text, so the German page renders nothing for them.
      for (const s of sections) {
        expect(s.heading.de).toBe("");
        for (const para of s.paragraphs) expect(para.de).toBe("");
      }
      for (const f of faq) if (f.kind === "text") { expect(f.q.de).toBe(""); expect(f.a.de).toBe(""); }
    }
  });

  it("German terms are glossed on the English page", () => {
    const en = (p: Page): string => [
      p.answer.en, ...p.sections.flatMap((s) => [s.heading.en, ...s.paragraphs.map((x) => x.en), ...((s as { steps?: { en: string }[] }).steps ?? []).map((x) => x.en)]),
    ].join("\n");
    const text = (id: string) => en(pages.find((p) => p.id === id)!);
    expect(text("artikel-sip4a-sip5a")).toMatch(/Bescheid: the written decision/);
    expect(text("artikel-innsbruck-ergaenzung")).toMatch(/Fachbereich: a field of the Stichprobentest/);
    expect(text("artikel-aerzteliste")).toMatch(/Ärzteliste: the list of physicians/);
    expect(text("artikel-facharzt-anrechnung")).toMatch(/Anrechnung: credit for training/);
    expect(text("artikel-dauer-kosten")).toMatch(/nostrification fee \(Nostrifizierungstaxe\)/);
  });
});
