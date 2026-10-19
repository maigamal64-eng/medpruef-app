/**
 * a-flip-copy-fixes-1018: Lektor's 18 Oct verdict on the included Mentor
 * credits (pick A) and the CEO call that the public FAQ names no Mentor
 * package price. A v2 buyer never sees a v1 price on these surfaces.
 */
import { afterEach, describe, expect, it } from "vitest";
import { MENTOR_FAQ_TITLE, mentorFaqAnswer, mentorIncludedLine, mentorLadderRows, mentorTermsParagraphs } from "@/lib/mentor-public/copy";
import { visibleAnswerPages } from "@/lib/answer-pages/registry";
import { answerPathBlocked } from "@/lib/answer-pages/slugs";
import { puypDefinition } from "@/lib/puyp-copy";
import { r3PackageCopy } from "@/components/mentor/r3-package-copy";
import pages from "@/lib/answer-pages/pages.data.json";
import { safetyNetLine } from "@/app/blog/medizin-lernen-in-deiner-sprache/safety-net";

const V2 = "NEXT_PUBLIC_PRICING_V2";
const before = process.env[V2];
afterEach(() => {
  if (before === undefined) delete process.env[V2];
  else process.env[V2] = before;
});

describe("in-app ladder Pro row (Lektor F2, blocking)", () => {
  it("prints the v2 Monthly plan at 24 EUR, never 19, when v2 is on", () => {
    const de = mentorLadderRows("de", null, true, true).find((r) => r.key === "pro")!;
    const en = mentorLadderRows("en", null, true, true).find((r) => r.key === "pro")!;
    expect(`${de.name} ${de.price}`).toBe("Monatsabo 24 € alle 30 Tage");
    expect(`${en.name} ${en.price}`).toMatch(/^Monthly plan 24(\.00)? € every 30 days$/);
    expect(de.detail).toBe("alle Fragen, 200 Credits für den KI-Mentor je 30 Tage inklusive");
    expect(en.detail).toBe("all questions, 200 AI Mentor credits per 30 days included");
    for (const row of [...mentorLadderRows("de", null, true, true), ...mentorLadderRows("en", null, false, true)]) {
      expect(`${row.price ?? ""}`).not.toMatch(/\b19\b/);
    }
  });

  it("reads the build flag by default", () => {
    process.env[V2] = "true";
    expect(mentorLadderRows("de").find((r) => r.key === "pro")!.price).toContain("24");
    delete process.env[V2];
    expect(mentorLadderRows("de").find((r) => r.key === "pro")!.price).toContain("19");
  });

  it("names the free row as a sample (journey §8: no bare free)", () => {
    expect(mentorLadderRows("de")[0].name).toBe("Kostenlose Probe");
    expect(mentorLadderRows("en")[0].name).toBe("Free sample");
  });
});

describe("public FAQ (CEO 18 Oct: no package price)", () => {
  it("names no package or price in either variant", () => {
    for (const lang of ["de", "en"] as const) {
      for (const included of [true, false]) {
        const text = mentorFaqAnswer(lang, included, true).join(" ");
        expect(text).not.toMatch(/€|4[.,]90|Mentor Basis|Mentor-Paket|mentor package|Kohorte|Cohort/);
        expect(mentorFaqAnswer(lang, included, false).join(" ")).not.toMatch(/€|4[.,]90|Mentor Basis|Mentor-Paket|mentor package/);
      }
    }
    expect(MENTOR_FAQ_TITLE.de).toBe("Was ist der KI-Mentor und was ist in Pro enthalten?");
  });

  it("keeps the included facts: 200 per 30 days on Pro, 400 on the Guarantee Ticket", () => {
    expect(mentorFaqAnswer("de", true, true)[1]).toContain("Jeder Pro-Tarif enthält 200 Credits für den KI-Mentor je 30 Tage, das Garantie-Ticket 400.");
    expect(mentorFaqAnswer("en", true, true)[1]).toContain("Every Pro plan includes 200 AI Mentor credits per 30 days, the Guarantee Ticket 400.");
    expect(mentorIncludedLine("pro", "de")).toBe("KI-Erklärungen und 200 Credits für den KI-Mentor je 30 Tage inklusive");
  });
});

describe("FAQ and terms before the v2 offer (reviewer P3)", () => {
  it("names the Exam Cohort, not the unsold Ticket, while v2 is off", () => {
    expect(mentorFaqAnswer("de", true, false)[1]).toContain("Jeder Pro-Tarif enthält 200 Credits für den KI-Mentor je 30 Tage, die Prüfungs-Kohorte 400.");
    expect(mentorFaqAnswer("en", true, false)[1]).toContain("Every Pro plan includes 200 AI Mentor credits per 30 days, the Exam Cohort 400.");
  });
  it("terms: the v2 included paragraph names the v2 plans and the Ticket; v1 does not", () => {
    const v2 = mentorTermsParagraphs("de", true, true).join(" ");
    expect(v2).toContain("Jeder Pro-Tarif (Monatsabo, Prüfungspass, 6 Monate) enthält 200 Credits für den KI-Mentor je 30 Tage, das Garantie-Ticket und die Prüfungs-Kohorte je 400.");
    const v1 = mentorTermsParagraphs("en", true, false).join(" ");
    expect(v1).toContain("Every Pro plan includes 200 AI Mentor credits per 30 days, the Exam Cohort 400.");
    expect(v1).not.toMatch(/Guarantee Ticket|Sitting Pass/);
    expect(mentorTermsParagraphs("de", false, true).join(" ")).not.toMatch(/enthält 200/);
  });
});

describe("answer page gate (reviewer P2): the included claim needs the included-copy flag", () => {
  const base = { ANSWER_PAGES_ENABLED: "true", NEXT_PUBLIC_MENTOR_PUBLIC_COPY: "true" };
  const slug = "ki-mentor-credits-wie-funktioniert";
  it("hides the page with the public flag alone, shows it with both", () => {
    expect(visibleAnswerPages(base).some((p) => p.slug === slug)).toBe(false);
    expect(answerPathBlocked(`/blog/${slug}`, base)).toBe(true);
    const both = { ...base, NEXT_PUBLIC_MENTOR_INCLUDED_COPY: "true" };
    expect(visibleAnswerPages(both).some((p) => p.slug === slug)).toBe(true);
    expect(answerPathBlocked(`/blog/${slug}`, both)).toBe(false);
  });
});

describe("answer page ki-mentor-credits-wie-funktioniert (Lektor F18, F19)", () => {
  it("advertises no package and no grace window", () => {
    const page = (pages as { pages?: unknown[] } | unknown[]);
    const list = (Array.isArray(page) ? page : (page as { pages: unknown[] }).pages) as Array<Record<string, unknown>>;
    const mentor = list.find((p) => JSON.stringify(p).includes("Wie funktionieren der KI-Mentor und seine Credits?"))!;
    const text = JSON.stringify({ s: mentor.sections, f: mentor.faq });
    expect(text).not.toMatch(/Mentor-Paket|mentor package|mentorGraceDays/);
    expect(text).toContain("Jeder Pro-Tarif enthält Credits für den KI-Mentor");
  });
});

describe("guarantee definition under v2", () => {
  it("does not print the retired Cohort price to a v2 buyer", () => {
    expect(puypDefinition("de", true)).not.toMatch(/129/);
    expect(puypDefinition("de", true)).toContain("Prüfungs-Kohorte (6 Monate)");
    expect(puypDefinition("de", false)).toMatch(/129/);
  });
});

describe("ru/uk/tr Mentor lines (Q1-Q9)", () => {
  it("say per 30 days, never per month", () => {
    for (const lang of ["ru", "uk", "tr"] as const) {
      for (const key of ["trialTomorrow", "trialForward"] as const) {
        const line = r3PackageCopy(key, lang, { credits: 200 });
        expect(line).toContain("200");
        expect(line).toContain("30");
        expect(line).not.toMatch(/месяц|місяць|ayda/);
      }
    }
  });
});

describe("blog safety-net paragraph", () => {
  it("prints the Guarantee Ticket and 24 EUR under v2, no 129 or 19; flag off keeps the page text", () => {
    process.env[V2] = "true";
    for (const lang of ["de", "en"] as const) {
      const line = safetyNetLine(lang)!;
      expect(line).toMatch(/Garantie-Ticket kostet 179|Guarantee Ticket costs 179/);
      expect(line).toMatch(/24(\.00)? €/);
      expect(line).not.toMatch(/129|\b19\b/);
    }
    delete process.env[V2];
    expect(safetyNetLine("de")).toBeNull();
  });
});
