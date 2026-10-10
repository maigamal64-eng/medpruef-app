import { describe, it, expect } from "vitest";
import {
  extractValues,
  normalizeDigits,
  numberCandidates,
  replaceSentences,
  validateAnswer,
} from "@/lib/mentor/validator";
import { sittingToFact } from "@/lib/mentor/facts-loader";
import { refusalLink } from "@/lib/mentor/prompt/refusals";
import { FACTS, SITTINGS, fact } from "./helpers";

const FEE = FACTS[0]; // 777 EUR
const FORMAT = FACTS[1]; // 123 questions, 4 hours
const PASS = FACTS[2]; // 63 %
const DATES = FACTS[3]; // 2099-03-18 12:00
const SIT = sittingToFact(SITTINGS[0]); // 2099-04-20, opens 2099-02-01, closes 2099-03-18
const ALL = [FEE, FORMAT, PASS, DATES, SIT];

const block = (ids: string[], text: string) => `@@BLOCK facts=${ids.join(",")}\n${text}`;
const answer = (...blocks: string[]) => `@@LANG de\n${blocks.join("\n")}`;
const FALLBACK = "nicht offiziell bestätigt";

describe("normalisation and extraction", () => {
  it("folds Arabic-Indic, extended and fullwidth digits", () => {
    expect(normalizeDigits("٢٠٩٩-٠٣-١٨ ۱۲۳ ７７７")).toBe("2099-03-18 123 777");
  });

  it("reads both forms of an ambiguous number", () => {
    expect(numberCandidates("1.500").sort()).toEqual(["1.5", "1500"].sort());
    expect(numberCandidates("1,500").sort()).toEqual(["1.5", "1500"].sort());
    expect(numberCandidates("4,90")).toEqual(["4.9"]);
    expect(numberCandidates("1.500,50")).toEqual(["1500.5"]);
    expect(numberCandidates("1 500")).toEqual(["1500"]);
  });

  it("does not see numbers inside names or inside longer numbers", () => {
    const v = extractValues("SIP4a und SIP5a, Niveau C1 und B2, im Jahr 2014 und 1.400 Fragen");
    expect(v.map((x) => x.raw)).toEqual(["2014", "1.400"]);
    expect(v.find((x) => x.raw === "1.400")!.keys).not.toContain("n:14");
  });

  it("recognises dates in many formats as the same ISO value", () => {
    const forms = [
      "2099-03-18",
      "18.03.2099",
      "18.3.2099",
      "18/03/2099",
      "18. März 2099",
      "18 March 2099",
      "March 18, 2099",
      "18 mars 2099",
      "18 марта 2099",
      "18 березня 2099",
      "18 Mart 2099",
    ];
    for (const f of forms) {
      const v = extractValues(f);
      expect(v.length, f).toBe(1);
      expect(v[0].keys, f).toEqual(["d:2099-03-18"]);
    }
  });

  it("recognises EUR, percent and time forms", () => {
    for (const f of ["€ 777", "777 €", "777,00 EUR", "EUR 777", "777 Euro", "777,- €"]) {
      expect(extractValues(f)[0].keys, f).toContain("e:777");
    }
    for (const f of ["63 %", "63%", "63 Prozent", "63 percent", "%63"]) {
      expect(extractValues(f)[0].keys, f).toContain("p:63");
    }
    expect(extractValues("bis 12:00")[0].keys).toEqual(["t:12:00"]);
    expect(extractValues("bis 12.00 Uhr")[0].keys).toEqual(["t:12:00"]);
  });

  it("splits a named-month range into two dates", () => {
    const v = extractValues("vom 4. bis 18. März 2099");
    expect(v.flatMap((x) => x.keys)).toEqual(["d:2099-03-04", "d:2099-03-18"]);
  });
});

describe("validateAnswer: supported values pass", () => {
  it("keeps cited dates, fees, percentages, numbers and times in any format", () => {
    const r = validateAnswer(
      answer(
        block([DATES.id], "Die Anmeldung endet am 18. März 2099 um 12:00."),
        block([FEE.id, PASS.id], "Die Gebühr beträgt € 777 und bestanden ist ab 63 Prozent."),
        block([FORMAT.id], "Es gibt 123 Fragen in vier Stunden.")
      ),
      ALL
    );
    expect(r.replaced).toBe(false);
    expect(r.rejected).toEqual([]);
    expect(r.blocks.map((b) => b.fact_ids)).toEqual([[DATES.id], [FEE.id, PASS.id], [FORMAT.id]]);
    expect(r.citations.map((c) => c.fact_id)).toEqual([DATES.id, FEE.id, PASS.id, FORMAT.id]);
  });

  it("accepts a sitting fact's dates, day-month and month-year parts", () => {
    const r = validateAnswer(answer(block([SIT.id], "Die Prüfung ist am 20. April, Anmeldung ab 1.2.2099 bis März 2099.")), ALL);
    expect(r.rejected).toEqual([]);
    expect(r.citations[0].source_url).toBe(SITTINGS[0].source_url);
  });

  it("a block without numbers needs no citation", () => {
    const r = validateAnswer(answer(block([], "Viel Erfolg beim Lernen!")), ALL);
    expect(r.replaced).toBe(false);
    expect(r.blocks[0].text).toBe("Viel Erfolg beim Lernen!");
  });
});

describe("validateAnswer: unsupported values are replaced (acceptance)", () => {
  it("a wrong date is replaced by the fallback", () => {
    const r = validateAnswer(answer(block([DATES.id], "Die Anmeldung endet am 19. März 2099. Viel Erfolg!")), ALL);
    expect(r.replaced).toBe(true);
    expect(r.blocks[0].text).toContain(FALLBACK);
    expect(r.blocks[0].text).not.toContain("19. März");
    expect(r.blocks[0].text).toContain("Viel Erfolg!");
    expect(r.blocks[0].text).toContain(DATES.source_url);
    expect(r.rejected).toEqual([{ value: "19. März 2099", reason: "not_in_cited_facts" }]);
  });

  it("a wrong fee is replaced by the fallback", () => {
    const r = validateAnswer(answer(block([FEE.id], "Die Gebühr beträgt 778 €.")), ALL);
    expect(r.replaced).toBe(true);
    expect(r.blocks[0].text).toContain(FALLBACK);
    expect(r.rejected[0]).toEqual({ value: "778 €", reason: "not_in_cited_facts" });
  });

  it("an uncited number is replaced by the fallback", () => {
    const r = validateAnswer(answer(block([], "Du hast 3 Versuche.")), ALL);
    expect(r.replaced).toBe(true);
    expect(r.blocks[0].text).toContain(FALLBACK);
    expect(r.rejected[0].reason).toBe("uncited_number");
  });

  it("a value backed only by ANOTHER block's fact is still rejected (per-block citations)", () => {
    const r = validateAnswer(answer(block([FEE.id], "Gebühr: 777 EUR."), block([], "Also 777 EUR.")), ALL);
    expect(r.blocks[0].text).toBe("Gebühr: 777 EUR.");
    expect(r.blocks[1].text).toContain(FALLBACK);
  });

  it("right numbers with the wrong month are caught, also in Cyrillic", () => {
    const r = validateAnswer(answer(block([DATES.id], "Регистрация до 18 апреля 2099.")), ALL);
    expect(r.replaced).toBe(true);
  });

  it("Arabic-Indic digits cannot bypass the check", () => {
    const r = validateAnswer(answer(block([FEE.id], "الرسوم ٩٩٩ يورو")), ALL);
    expect(r.replaced).toBe(true);
    const ok = validateAnswer(answer(block([FEE.id], "الرسوم ٧٧٧ يورو")), ALL);
    expect(ok.replaced).toBe(false);
  });

  it("a bare wrong month is a claim too", () => {
    const r = validateAnswer(answer(block([DATES.id], "Die Anmeldung endet im Juni.")), ALL);
    expect(r.replaced).toBe(true);
  });

  it("an unknown or non-assertable cited id is rejected and its values fail", () => {
    const partly = FACTS[4];
    const r = validateAnswer(answer(block(["made.up", partly.id], "Es gibt 9 Antritte.")), [...ALL, partly]);
    expect(r.rejected.map((x) => x.reason)).toEqual(["unknown_fact_id", "unknown_fact_id", "uncited_number"]);
    expect(r.blocks[0].fact_ids).toEqual([]);
  });

  it("malformed markup is one uncited block and is validated strictly", () => {
    const r = validateAnswer("Die Gebühr beträgt 777 EUR.", ALL);
    expect(r.replaced).toBe(true);
    expect(r.blocks).toHaveLength(1);
  });

  it("a link not from the facts or the official list is replaced; official links pass", () => {
    const bad = validateAnswer(answer(block([FEE.id], "Mehr unter https://evil.example/x.")), ALL);
    expect(bad.replaced).toBe(true);
    const good = validateAnswer(answer(block([FEE.id], `Mehr unter ${FEE.source_url}`)), ALL);
    expect(good.replaced).toBe(false);
  });

  it("keeps list markers and other lines when one bullet is replaced", () => {
    const r = validateAnswer(answer(block([FEE.id], "- Gebühr: 777 EUR\n- Dauer: 5 Stunden\n- Viel Erfolg")), ALL);
    expect(r.blocks[0].text.split("\n")).toEqual(["- Gebühr: 777 EUR", expect.stringMatching(/^- .*nicht offiziell bestätigt/), "- Viel Erfolg"]);
  });

  it("removes em dashes from model text", () => {
    const r = validateAnswer(answer(block([], "Kurz — klar")), ALL);
    expect(r.blocks[0].text).toBe("Kurz, klar");
  });
});

describe("validateAnswer: refusals and internal facts", () => {
  it("parses a refusal and attaches the official link from the code table", () => {
    const r = validateAnswer("@@LANG en\n@@REFUSE reason=no_verified_source exam=stichprobentest\n@@BLOCK\nI have no confirmed source for this.", ALL);
    expect(r.refused).toBe("no_verified_source");
    expect(r.refusalLink).toBe(refusalLink("no_verified_source", "stichprobentest"));
    expect(r.refusalLink).toMatch(/^https:\/\//);
  });

  it("an empty refusal gets the default line; an unknown reason is ignored", () => {
    const r = validateAnswer("@@LANG de\n@@REFUSE reason=patient_advice", ALL);
    expect(r.blocks[0].text).toMatch(/Patient/);
    expect(validateAnswer("@@REFUSE reason=whatever\n@@BLOCK\nHallo", ALL).refused).toBeUndefined();
  });

  it("uses the resolver for ids not passed in, and hides internal ids from citations", () => {
    const q = fact({ id: "question.42", text_de: "Dosis 2,5 mg", text_en: "Dosis 2,5 mg" });
    const r = validateAnswer(answer(block(["question.42"], "Die Dosis ist 2,5 mg.")), [], {
      resolve: (id) => (id === "question.42" ? q : null),
    });
    expect(r.replaced).toBe(false);
    expect(r.blocks[0].fact_ids).toEqual([]);
    expect(r.citations).toEqual([]);
  });

  it("replaceSentences does not split on a date's dot", () => {
    const text = "Termin am 18. März. Danach 5 Tage.";
    const vals = extractValues(text).filter((v) => v.raw === "5");
    expect(replaceSentences(text, vals, "X")).toBe("Termin am 18. März. X");
  });
});
