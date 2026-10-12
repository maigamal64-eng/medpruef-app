import { describe, expect, it } from "vitest";
import { runInNewContext } from "node:vm";
import { pharmaNextAnswer } from "@/lib/pharma-window";
import { rulesForExam } from "@/lib/exam-formats";
import { LANGUAGE_HEAD_SCRIPT } from "@/lib/language-model";
import { GUIDANCE_ROUTES } from "@/lib/guidance/routes";
import { guidanceLink, orientationLinks, withLang } from "@/lib/guidance/public-links";

describe("a26 pharma next-exam answer (GU-02)", () => {
  it("names the open window with its Vienna noon close", () => {
    const de = pharmaNextAnswer("de", new Date("2026-10-12T10:00:00Z"));
    expect(de).toContain("23. November 2026 bis 27. November 2026: Anmeldung bis 20. Oktober 2026, 12:00 Uhr (Wien)");
    expect(de).toContain("Anmeldung vom 2. Dezember 2026 bis 15. Dezember 2026");
  });
  it("says closed after the deadline and never shows a past week", () => {
    const en = pharmaNextAnswer("en", new Date("2026-10-20T10:00:00Z"));
    expect(en).toContain("registration closed on 20 October 2026");
    const later = pharmaNextAnswer("en", new Date("2026-11-30T12:00:00Z"));
    expect(later).not.toContain("23 November 2026");
  });
  it("falls back to the calendar when nothing is published", () => {
    expect(pharmaNextAnswer("de", new Date("2028-01-01T12:00:00Z"))).toContain("keine weitere Prüfungswoche");
  });
});

describe("a26 Rezeptierkunde format (pick-pharma-format-copy A)", () => {
  it("dates the late-arrival and aids rule to its Ausschreibung", () => {
    const late = rulesForExam("rezeptierkunde").find((r) => r.id === "rx.late")!;
    expect(late.sourceId).toBe("source-21");
    expect(late.text.de).toContain("Laut Ausschreibung für den Termin am 1. Oktober 2026");
  });
});

describe("a26 language default (pick-ux-pub-03 A)", () => {
  const run = (languages: string[], userAgent = "Mozilla/5.0") => {
    const el = { lang: "de", dir: "ltr" };
    runInNewContext(LANGUAGE_HEAD_SCRIPT, { document: { documentElement: el }, localStorage: { getItem: () => null }, navigator: { languages, language: languages[0], userAgent } });
    return el.lang;
  };
  it("renders English for non-German browsers and German for de and crawlers", () => {
    expect(run(["en-US"])).toBe("en");
    expect(run(["tr-TR"])).toBe("en");
    expect(run(["de-AT"])).toBe("de");
    expect(run(["en-US"], "Mozilla/5.0 (compatible; Googlebot/2.1)")).toBe("de");
  });
});

describe("a26 guidance links", () => {
  it("lists only live registry routes and adds ?lang only to guidance pages", () => {
    expect(GUIDANCE_ROUTES.every((r) => r.status === "live")).toBe(true);
    for (const l of orientationLinks()) expect(GUIDANCE_ROUTES.some((r) => r.path === l.href)).toBe(true);
    expect(withLang("/umfang", "en")).toBe("/umfang?lang=en");
    expect(withLang("/materials", "en")).toBe("/materials");
    expect(guidanceLink("/nope")).toBeNull();
  });
});
