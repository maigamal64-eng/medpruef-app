/**
 * Live trust gate round 7 (a-mentor-gate7): a count of the answer's own
 * enumeration ("The first two are subscriptions", "separates the two") is not a
 * fact value. Every positive case has a negative twin where the same count is a
 * wrong or unsupported value and must still be deleted.
 */
import { describe, it, expect } from "vitest";
import { getMentorFactsLoader } from "@/lib/mentor/facts-loader";
import { validateAnswer } from "@/lib/mentor/validator";
import type { ValidatedAnswer } from "@/lib/mentor/seam";
import { fact } from "./helpers";

const L = getMentorFactsLoader();
const now = new Date("2026-10-12T08:00:00Z");
const all = (v: ValidatedAnswer) => v.blocks.map((b) => b.text).join("\n\n");
const NOT_CONFIRMED = /nicht offiziell bestätig|not officially confirmed|can't officially confirm/;

const plans = fact({ id: "fixture.plans", exam_key: "sip5a", topic: "format", text_de: "Es gibt Plan Alpha, Plan Beta und Plan Gamma.", text_en: "There are plan Alpha, plan Beta and plan Gamma." });
const check = (lang: string, body: string) => validateAnswer(`@@LANG ${lang}\n@@BLOCK facts=fixture.plans\n${body}`, [plans]);
const kept = (lang: string, body: string, sentence: string) => {
  const v = check(lang, body);
  expect(v.replaced, all(v)).toBe(false);
  expect(all(v)).toContain(sentence);
  expect(all(v)).not.toMatch(NOT_CONFIRMED);
};
const deleted = (lang: string, body: string, sentence: string) => {
  const v = check(lang, body);
  expect(v.replaced, all(v)).toBe(true);
  expect(all(v)).not.toContain(sentence);
};

describe("recorded live answers", () => {
  it("gate6 run 2 ap-prices-en: 'The first two are subscriptions' stays, no notice", async () => {
    const ids = ["app.billing.plans"];
    const facts = await L.byIds(ids, now);
    expect(facts.map((f) => f.id)).toEqual(ids);
    const raw = "@@LANG en\n@@BLOCK facts=app.billing.plans\nMedPrüf offers three plans: Single Month at 19 € per month, 3-Month at 49 € per quarter, and Exam Cohort at 129 € for 6 months. The first two are subscriptions that renew automatically until you cancel. The Exam Cohort is a one-time payment and does not renew.";
    const v = validateAnswer(raw, facts);
    expect(v.replaced, JSON.stringify(v.rejected)).toBe(false);
    expect(all(v)).toContain("The first two are subscriptions that renew automatically until you cancel.");
    // Mutation: a wrong price in the same answer is still caught.
    const bad = validateAnswer(raw.replace("49 €", "59 €"), facts);
    expect(bad.replaced).toBe(true);
    expect(bad.rejected.map((r) => r.value)).toContain("59 €");
    // Mutation: the count no longer matches the list (two plans named, "the first two" is not a subset).
    const mism = validateAnswer(raw.replace("three plans: Single Month at 19 € per month, 3-Month", "two plans: 3-Month"), facts);
    expect(all(mism)).not.toContain("The first two are subscriptions");
  });

  it("gate5 r2-trust-explain-shuffled-en: 'separates the two' stays", () => {
    const q = fact({ id: "question.9000030", exam_key: "sip5a", topic: "format", text_de: "ACE-Hemmer verursachen trockenen Reizhusten durch Bradykinin. Losartan ist ein AT1-Blocker.", text_en: "ACE inhibitors cause dry cough through bradykinin. Losartan is an AT1 blocker." });
    const raw = "@@LANG en\n@@BLOCK layer=grounded facts=question.9000030\nLosartan is plausible because it is also a blood-pressure drug, but it is not an ACE-Hemmer (ACE inhibitor). It is an angiotensin receptor blocker, and the explanation for this item names the mechanism that separates the two: ACE-Hemmer block the breakdown of Bradykinin (bradykinin), which accumulates and causes a trockener Reizhusten (dry irritating cough) in some patients.";
    const v = validateAnswer(raw, [q]);
    expect(v.replaced, JSON.stringify(v.rejected)).toBe(false);
    expect(all(v)).toContain("separates the two");
    // Mutation: "the three" counts nothing the answer wrote.
    const bad = validateAnswer(raw.replace("separates the two", "separates the three"), [q]);
    expect(bad.replaced).toBe(true);
  });
});

describe("english", () => {
  it("subset of a series", () => kept("en", "You can choose plan Alpha, plan Beta and plan Gamma. The first two renew automatically.", "The first two renew automatically."));
  it("whole list run with an item noun", () => kept("en", "Wrong answers:\n- plan Alpha\n- plan Beta\n- plan Gamma\nThese three options do not fit the stem.", "These three options do not fit the stem."));
  it("cataphoric colon", () => kept("en", "Compare the two: plan Alpha and plan Beta.", "Compare the two: plan Alpha and plan Beta."));
  it("digits count too", () => kept("en", "You can choose plan Alpha, plan Beta and plan Gamma. The last 2 renew automatically.", "The last 2 renew automatically."));

  it("count larger than the list is deleted", () => deleted("en", "You can choose plan Alpha, plan Beta and plan Gamma. The two renew automatically.", "The two renew"));
  it("subset count equal to the list is deleted", () => deleted("en", "You can choose plan Alpha, plan Beta and plan Gamma. The first three renew automatically.", "The first three renew"));
  it("no enumeration written: deleted", () => deleted("en", "The two renew automatically.", "The two renew"));
  it("no determiner: deleted", () => deleted("en", "You can choose plan Alpha, plan Beta and plan Gamma. Two renew automatically.", "Two renew"));
  it("attempts stay strict", () => deleted("en", "You can choose plan Alpha, plan Beta and plan Gamma. The first two attempts are free.", "attempts are free"));
  it("a value noun anywhere in the sentence keeps it strict", () => deleted("en", "You can choose plan Alpha, plan Beta and plan Gamma. The first two take place in the same week.", "same week"));
  it("question counts stay strict", () => deleted("en", "You can choose plan Alpha, plan Beta and plan Gamma. These three questions are new.", "questions are new"));
  it("exam counts stay strict", () => deleted("en", "SIP4a and SIP5a are separate. The two exams are held at MedUni Wien.", "The two exams"));
  it("an unknown noun after the count stays strict", () => deleted("en", "You can choose plan Alpha, plan Beta and plan Gamma. The first two universities accept it.", "universities"));
  it("a money sign in the sentence keeps it strict", () => deleted("en", "You can choose plan Alpha, plan Beta and plan Gamma. The first two cost the same in €.", "cost the same"));
});

describe("german", () => {
  it("die ersten zwei", () => kept("de", "Sie können Plan Alpha, Plan Beta oder Plan Gamma wählen. Die ersten zwei verlängern sich automatisch.", "Die ersten zwei verlängern sich automatisch."));
  it("die zwei ersten Optionen", () => kept("de", "Falsch sind:\n- Plan Alpha\n- Plan Beta\n- Plan Gamma\nDie zwei ersten Optionen passen nicht zum Fragenstamm.", "Die zwei ersten Optionen passen nicht"));
  it("diese drei Optionen", () => kept("de", "Plan Alpha, Plan Beta und Plan Gamma passen nicht. Diese drei Optionen sind Distraktoren.", "Diese drei Optionen sind Distraktoren."));

  it("capitalised non-item noun is strict", () => deleted("de", "Sie können Plan Alpha, Plan Beta oder Plan Gamma wählen. Die ersten zwei Wege sind elektronisch.", "Wege sind"));
  it("Antritte stay strict", () => deleted("de", "Sie können Plan Alpha, Plan Beta oder Plan Gamma wählen. Die ersten zwei Antritte sind normal.", "Antritte sind normal"));
  it("mismatch is deleted", () => deleted("de", "Plan Alpha, Plan Beta und Plan Gamma passen nicht. Diese vier Optionen sind Distraktoren.", "Diese vier Optionen"));
  it("monthly renewal keeps it strict", () => deleted("de", "Sie können Plan Alpha, Plan Beta oder Plan Gamma wählen. Die ersten zwei verlängern sich monatlich.", "monatlich"));
});

describe("french, russian, ukrainian, turkish (digits)", () => {
  it("fr: les 2 premiers", () => kept("fr", "Les choix sont plan Alpha, plan Beta et plan Gamma. Les 2 premiers sont des abonnements.", "Les 2 premiers sont des abonnements."));
  it("fr: mismatch deleted", () => deleted("fr", "Les choix sont plan Alpha, plan Beta et plan Gamma. Les 3 premiers sont des abonnements.", "Les 3 premiers"));
  it("fr: jours stay strict", () => deleted("fr", "Les choix sont plan Alpha, plan Beta et plan Gamma. Les 2 premiers durent quelques jours.", "jours"));
  it("ru: первые 2 варианта", () => kept("ru", "Варианты: plan Alpha, plan Beta и plan Gamma. Первые 2 варианта неверны.", "Первые 2 варианта неверны."));
  it("ru: попытки stay strict", () => deleted("ru", "Варианты: plan Alpha, plan Beta и plan Gamma. Первые 2 попытки бесплатны.", "попытки"));
  it("uk: перші 2 варіанти", () => kept("uk", "Варіанти: plan Alpha, plan Beta та plan Gamma. Перші 2 варіанти неправильні.", "Перші 2 варіанти неправильні."));
  it("uk: mismatch deleted", () => deleted("uk", "Варіанти: plan Alpha, plan Beta та plan Gamma. Перші 3 варіанти неправильні.", "Перші 3 варіанти"));
  it("tr: ilk 2 seçenek", () => kept("tr", "Seçenekler plan Alpha, plan Beta ve plan Gamma. İlk 2 seçenek yanlış.", "İlk 2 seçenek yanlış."));
  it("tr: sınav stays strict", () => deleted("tr", "Seçenekler plan Alpha, plan Beta ve plan Gamma. İlk 2 sınav ücretsiz.", "sınav"));
});
