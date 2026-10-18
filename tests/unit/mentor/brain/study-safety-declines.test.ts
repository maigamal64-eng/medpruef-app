/**
 * meval-fix-study-safety-false-blocks (track-A, 16 Oct 2026). The four E3 baseline blocks (de, en, ru, tr) were
 * the mentor itself declining to predict. A declining first-person clause is exempt; any claim stays refused.
 * Synthetic test inputs, not shipped copy.
 */
import { describe, expect, it } from "vitest";
import { studySentenceViolation } from "@/lib/mentor/study-safety";
import type { MentorLang } from "@/lib/mentor/contract";

const DECLINES: ReadonlyArray<[MentorLang, string]> = [
  ["de", "Ein Bestehen kann ich nicht zusagen; der Plan dient nur der Vorbereitung."],
  ["de", "Ich kann Ihnen keine Garantie geben, aber ich kann die Reihenfolge der Themen vorschlagen."],
  ["de", "Ich kann nicht garantieren, dass es klappt."],
  ["en", "I can't estimate your chances of passing, but I can help you prepare in a focused way."],
  ["en", "I can't promise an outcome, but here is a plan."],
  ["en", "There are no guarantees here, so I will stick to the plan."],
  ["ru", "Прогноз результата я дать не могу: это зависит от многих факторов, и гарантий здесь нет."],
  ["ru", "Я не могу обещать результат, но могу помочь с планом."],
  ["uk", "Я не можу обіцяти результат, але можу допомогти з планом."],
  ["uk", "Гарантій тут немає, тому я лише складаю план."],
  ["tr", "Başarma olasılığınız hakkında bir tahmin yapamam ve bunu garanti edemem; ancak mevcut ilerlemenize göre net bir çalışma planı önerebilirim."],
  ["fr", "Je ne peux pas garantir de résultat, mais je peux proposer un plan."],
  ["ar", "مقدرش أضمن النتيجة، بس أقدر أساعدك في الخطة."],
];
const CLAIMS: ReadonlyArray<[MentorLang, string]> = [
  ["en", "I can't promise anything however you will pass."],
  ["en", "I don't hesitate to promise you will pass."],
  ["en", "I can't wait to guarantee you will pass."],
  ["de", "Ich kann das nicht zusagen dennoch werden Sie bestehen."],
  ["fr", "Je ne peux pas garantir cependant vous réussirez."],
  ["ru", "Я не могу обещать однако вы сдадите."],
  ["uk", "Я не можу обіцяти проте ти складеш."],
  ["tr", "Söz veremem lakin geçersin."],
  ["ar", "مقدرش أضمن مع ذلك هتنجح."],
  ["en", "I can't give you a guarantee and you will pass."],
  ["en", "I don't make promises so you will pass."],
  ["en", "I can't tell you how happy I am that you will pass."],
  ["en", "I can't tell you more than that your chances are high."],
  ["de", "Ich kann nicht zusagen und Sie bestehen mit Sicherheit."],
  ["fr", "Je ne peux pas garantir et vous réussirez."],
  ["ru", "Я не могу обещать и вы сдадите."],
  ["ru", "Гарантий нет и вы сдадите."],
  ["uk", "Гарантій немає і ти складеш."],
  ["tr", "Garanti veremem ve geçeceksin."],
  ["ar", "مقدرش اضمنلك وهتنجح"],
  ["ar", "مفيش ضمان وفرصتك عالية"],
  ["en", "I can't promise, but you will pass."],
  ["en", "I can help you prepare and you will pass the exam."],
  ["en", "Your chances of passing are high."],
  ["de", "Ich kann Ihnen nichts versprechen, aber Sie werden bestehen."],
  ["de", "Sie haben gute Chancen und werden bestehen."],
  ["de", "Die Wahrscheinlichkeit zu bestehen ist hoch."],
  ["ru", "Я не могу обещать, но вы сдадите экзамен."],
  ["ru", "Шансы сдать экзамен у вас высокие."],
  ["uk", "Я не можу гарантувати, але ти складеш іспит."],
  ["tr", "Garanti edemem ama geçeceksin."],
  ["tr", "Başarı şansınız yüksek."],
  ["fr", "Je ne peux pas promettre, mais vous allez réussir."],
  ["ar", "مقدرش أوعدك، بس هتنجح."],
];

describe("declining first-person clauses are not outcome predictions", () => {
  for (const [lang, text] of DECLINES) it(`${lang}: ${text.slice(0, 40)}`, () => expect(studySentenceViolation(text, lang)).toBeNull());
});
describe("a claim next to a disclaimer is still refused", () => {
  for (const [lang, text] of CLAIMS) it(`${lang}: ${text.slice(0, 40)}`, () => expect(studySentenceViolation(text, lang)).toBe("outcome_prediction"));
});
