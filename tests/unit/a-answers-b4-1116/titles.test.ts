import { afterEach, describe, expect, it, vi } from "vitest";
import { guidanceMetadata } from "@/lib/seo/gsc";
import { GUIDANCE_SEO_COPY } from "@/lib/seo/gsc-copy";
import { ANSWER_PAGES } from "@/lib/answer-pages/registry";

afterEach(() => vi.unstubAllEnvs());

const ON = { SEO_GSC_COPY_ENABLED: "true" };
const BLOG = ["pruefungsausschreibung-pruefungskalender-wo", "sip-stichprobentest-kenntnispruefung-unterschied"];
const SUFFIX = " | MedPrüf";
// Same guard as gsc-copy.ts: no dates, prices, dashes, exclamation marks, and no "official" for our own copy.
const BANNED = /[–—!]|€|\bEUR\b|\b20\d{2}\b|\boffiziell|\bofficial\b/i;

describe("a-answers-b4-1116 deliverable 1: search titles and descriptions", () => {
  const entries = Object.entries(GUIDANCE_SEO_COPY).flatMap(([path, v]) => (["de", "en"] as const).map((lang) => ({ path, lang, ...v[lang] })));

  it("covers the five guidance routes in DE and EN", () => {
    expect(Object.keys(GUIDANCE_SEO_COPY).sort()).toEqual(["/exam-formats/sip4a", "/exam-formats/sip5a", "/pruefungskalender", "/wien-route", "/wien-route/sip-regeln"]);
  });

  it.each(entries)("$path $lang: title under 60 with the suffix, description under 155, no banned wording", ({ title, description }) => {
    expect(`${title}${SUFFIX}`.length).toBeLessThan(60);
    expect(description.length).toBeLessThan(155);
    for (const text of [title, description]) expect(text).not.toMatch(BANNED);
  });

  it("guidanceMetadata gives title and description with the flag on, neither with it off", () => {
    const m = guidanceMetadata("/exam-formats/sip4a", ON, "de");
    expect(m.title).toBe(`SIP4a MedUni Wien: Blöcke, Punkte, Bestehen${SUFFIX}`);
    expect(m.description).toBe(GUIDANCE_SEO_COPY["/exam-formats/sip4a"].de.description);
    const en = guidanceMetadata("/pruefungskalender", ON, "en");
    expect(en.title).toBe(`Prüfungskalender MedUni Wien: exam dates${SUFFIX}`);
    expect(guidanceMetadata("/exam-formats/sip4a", {}).title).toBeUndefined();
    expect(guidanceMetadata("/exam-formats/sip4a", {}).description).toBeUndefined();
  });

  it("a guidance route without own copy keeps its registry label and no description", () => {
    const m = guidanceMetadata("/wien-route/kosten", ON, "de");
    expect(m.title).toBe(`Kosten richtig einplanen${SUFFIX}`);
    expect(m.description).toBeUndefined();
  });

  it.each(BLOG.flatMap((slug) => (["de", "en"] as const).map((lang) => ({ slug, lang }))))("$slug $lang (answer page): seo_title and description fit and are clean", ({ slug, lang }) => {
    vi.stubEnv("ANSWER_PAGES_ENABLED", "true");
    const page = ANSWER_PAGES.find((p) => p.slug === slug)!;
    expect(`${page.seo_title![lang]}${SUFFIX}`.length).toBeLessThan(60);
    expect(page.description[lang].length).toBeLessThan(155);
    for (const text of [page.seo_title![lang], page.description[lang]]) expect(text).not.toMatch(BANNED);
  });
});
