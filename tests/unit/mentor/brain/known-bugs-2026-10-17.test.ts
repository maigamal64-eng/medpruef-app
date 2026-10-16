/**
 * a-mentor-known-bugs (track-A, 17 Oct 2026). Each block failed on track-a/release-int-7 before its fix.
 *  (1) the v2 plan list survives trimUnaskedValues on a plan-list question
 *  (2) benign study sentences per language are not outcome predictions
 *  (3) refusal and SDK-refusal copy follow the learner language (fr, ru, uk, tr)
 * Synthetic test inputs, not shipped copy.
 */
import { describe, expect, it } from "vitest";
import { billingPlansSummaryV2 } from "@/lib/billing-copy";
import { trimUnaskedValues } from "@/lib/mentor/validator";
import { studySentenceViolation } from "@/lib/mentor/study-safety";
import { REFUSAL_COPY, refusalLine } from "@/lib/mentor/prompt/refusals";
import { MENTOR_REFUSAL_COPY } from "@/lib/mentor/turn";
import { MENTOR_LANGS, type MentorLang, type MentorRefusalReason } from "@/lib/mentor/contract";
import { detectAnswerLang as detectAnswerLanguage } from "@/lib/mentor/answer-language";
import type { ValidatedAnswer } from "@/lib/mentor/seam";
import { fact } from "./helpers";

describe("(1) Garantie trim keeps the v2 plan list", () => {
  const PLANS = fact({ id: "app.billing.plans", exam_key: "general", topic: "fee", text_de: billingPlansSummaryV2("de"), text_en: billingPlansSummaryV2("en") });
  const resolve = (id: string) => (id === PLANS.id ? PLANS : null);
  const wrap = (text: string): ValidatedAnswer => ({ blocks: [{ text, fact_ids: [PLANS.id] }], citations: [], replaced: false, rejected: [] });
  for (const [lang, q] of [["de", "Welche Tarife gibt es bei MedPrüf?"], ["en", "Which plans does MedPrüf offer?"]] as const) {
    it(`${lang}: both one-time plans stay in the plan list`, () => {
      const text = billingPlansSummaryV2(lang);
      const out = trimUnaskedValues(wrap(text), { question: q, lang, resolve, retrievedIds: [PLANS.id] });
      const kept = out.blocks.map((b) => b.text).join(" ");
      expect(kept).toContain(lang === "de" ? "Prüfungspass" : "Sitting Pass");
      expect(kept).toContain(lang === "de" ? "Garantie-Ticket" : "Guarantee Ticket");
    });
  }
  it("outcome-guarantee talk is still trimmed", () => {
    const de = trimUnaskedValues(wrap("Das Garantie-Ticket kostet 179 €. Eine Garantie zum Bestehen gibt es nicht."), { question: "Welche Tarife gibt es?", lang: "de", resolve, retrievedIds: [PLANS.id] });
    expect(de.blocks.map((b) => b.text).join(" ")).toContain("Garantie-Ticket");
    expect(de.blocks.map((b) => b.text).join(" ")).not.toContain("gibt es nicht");
    const en = trimUnaskedValues(wrap("The Guarantee Ticket is a one-time payment. This is not a guarantee of any result."), { question: "Which plans are there?", lang: "en", resolve, retrievedIds: [PLANS.id] });
    expect(en.blocks.map((b) => b.text).join(" ")).toContain("Guarantee Ticket");
    expect(en.blocks.map((b) => b.text).join(" ")).not.toContain("not a guarantee");
  });
});

/** 30 benign study sentences per language: 5 required phrases or neutral lines + templates x topics. */
const TOPICS: Record<MentorLang, string[]> = {
  de: ["Kardiologie", "Pharmakologie", "Chirurgie", "Notfallmedizin", "Innere Medizin"],
  en: ["cardiology", "pharmacology", "surgery", "emergency medicine", "internal medicine"],
  ru: ["кардиология", "фармакология", "хирургия", "неотложная помощь", "внутренние болезни"],
  uk: ["кардіологія", "фармакологія", "хірургія", "невідкладна допомога", "внутрішні хвороби"],
  tr: ["kardiyoloji", "farmakoloji", "cerrahi", "acil tıp", "dahiliye"],
  ar: ["القلب", "الأدوية", "الجراحة", "الطوارئ", "الباطنة"],
  fr: ["cardiologie", "pharmacologie", "chirurgie", "médecine d'urgence", "médecine interne"],
};
const TEMPLATES: Record<MentorLang, Array<(t: string) => string>> = {
  de: [(t) => `Heute: 20 Fragen zu ${t}.`, (t) => `Wiederholen Sie danach Ihre Fehler in ${t}.`, (t) => `Das passt gut zu Ihrem Plan für ${t}.`, (t) => `Planen Sie für ${t} zwei kurze Einheiten ein.`, (t) => `Im Bereich ${t} haben Sie bisher 12 Fragen beantwortet.`],
  en: [(t) => `Today: 20 questions on ${t}.`, (t) => `Then review your mistakes in ${t}.`, (t) => `A passive reading is not enough for ${t}, so add questions.`, (t) => `Plan two short sessions for ${t}.`, (t) => `You have answered 12 questions in ${t} so far.`],
  ru: [(t) => `Сегодня: 20 вопросов по теме «${t}».`, (t) => `Потом повторите свои ошибки по теме «${t}».`, (t) => `Запланируйте две короткие сессии по теме «${t}».`, (t) => `По теме «${t}» вы ответили на 12 вопросов.`, (t) => `Добавьте в план тему «${t}» на выходные.`],
  uk: [(t) => `Сьогодні: 20 запитань з теми «${t}».`, (t) => `Потім повторіть свої помилки з теми «${t}».`, (t) => `Заплануйте дві короткі сесії з теми «${t}».`, (t) => `З теми «${t}» ви відповіли на 12 запитань.`, (t) => `Додайте тему «${t}» до плану на вихідні.`],
  tr: [(t) => `Bugün: ${t} konusunda 20 soru.`, (t) => `Sonra ${t} konusundaki hatalarınızı tekrar edin.`, (t) => `${t} için iki kısa çalışma planlayın.`, (t) => `${t} konusunda şimdiye kadar 12 soru yanıtladınız.`, (t) => `Hafta sonu için ${t} konusunu plana ekleyin.`],
  ar: [(t) => `النهارده: ٢٠ سؤال في ${t}.`, (t) => `بعد كده راجع أخطاءك في ${t}.`, (t) => `خطط لجلستين قصيرتين في ${t}.`, (t) => `جاوبت لحد دلوقتي على ١٢ سؤال في ${t}.`, (t) => `ضيف ${t} لخطة آخر الأسبوع.`],
  fr: [(t) => `Aujourd'hui : 20 questions sur ${t}.`, (t) => `Revoyez ensuite vos erreurs en ${t}.`, (t) => `Prévoyez deux séances courtes pour ${t}.`, (t) => `En ${t}, vous avez répondu à 12 questions.`, (t) => `Ajoutez ${t} au plan du week-end.`],
};
const REQUIRED: Record<MentorLang, string[]> = {
  de: ["Die Prüfung besteht aus 250 Fragen.", "Die Fragenbank besteht aus mehreren Fachgebieten.", "Das Garantie-Ticket ist ein Tarif mit 12 Monaten Zugang.", "Das Passwort ändern Sie in den Einstellungen.", "Die Pre-Test-Probability ist ein Begriff aus der Diagnostik."],
  en: ["Passage of time is no reason to stop.", "Your passport scan is not needed for practice.", "The passing score is a rule of the exam, check the official page.", "Pre-test probability is a term from diagnostics.", "The Guarantee Ticket is a plan with 12 months of access.", "Review the pass mark rule on the official page."],
  ru: ["Чтобы сдать экзамен в ноябре, начните с плана на неделю.", "Если вы хотите сдать экзамен 18 ноября, регистрация закрывается раньше.", "Вы можете сдать экзамен в ноябре или в январе, выбор за вами.", "Тариф «Garantie-Ticket» даёт 12 месяцев доступа.", "Начните с темы с самой низкой точностью."],
  uk: ["Спочатку треба скласти план на тиждень.", "Допоможу скласти план підготовки на два тижні.", "Можна скласти розклад занять на вихідні.", "Тариф «Garantie-Ticket» дає 12 місяців доступу.", "Почніть із теми з найнижчою точністю."],
  tr: ["Sonraki konuya geçmek için önce hatalarınızı gözden geçirin.", "Üç hafta geçecek ve plan aynı kalacak.", "Plana geçmeden önce haftalık hedefi seçin.", "Garantie-Ticket 12 aylık erişim veren bir tarifedir.", "Önce en düşük doğruluktaki konudan başlayın."],
  ar: ["مضمون السؤال بيتكرر في كذا مجال.", "ركز على مضمون الخطة الأسبوعية.", "هتلاقي فرصة تراجع أخطاءك بعد كل جلسة.", "في احتمال تاني لازم تراجعه في الخطة.", "الـ Garantie-Ticket خطة بوصول ١٢ شهر."],
  fr: ["Le passage d'un sujet à l'autre se fait chaque jour.", "Votre passeport n'est pas nécessaire pour s'entraîner.", "La probabilité pré-test est une notion de diagnostic.", "Le Garantie-Ticket est une formule avec 12 mois d'accès.", "Revoyez vos erreurs demain avant la prochaine séance."],
};
function corpus(lang: MentorLang): string[] {
  return [...REQUIRED[lang], ...TEMPLATES[lang].flatMap((f) => TOPICS[lang].map(f))].slice(0, 30);
}

describe("(2) benign study sentences are not outcome predictions", () => {
  for (const lang of MENTOR_LANGS) {
    it(`${lang}: 30 benign sentences pass`, () => {
      const lines = corpus(lang);
      expect(lines.length).toBe(30);
      const hits = lines.filter((s) => studySentenceViolation(s, lang) !== null);
      expect(hits).toEqual([]); // prints the offending sentences
    });
  }
  const PREDICTIONS: Array<[MentorLang, string]> = [
    ["en", "You will pass the exam."], ["en", "Your chance is good."], ["en", "Learners who put in the time pass."], ["en", "This is a guarantee that you pass."], ["en", "The pass rate is high, so you will pass."],
    ["de", "Du wirst die Prüfung bestehen."], ["de", "Sie werden die Prüfung sicher bestehen."], ["de", "Die Erfolgschancen sind hoch."], ["de", "Das ist eine Garantie für Ihren Erfolg."], ["de", "Sie bestehen die Prüfung."],
    ["ru", "У тебя хороший шанс сдать экзамен."], ["ru", "Вы точно сможете сдать экзамен."], ["ru", "Ты сдашь экзамен."], ["ru", "Вы сдадите с первого раза."],
    ["uk", "Ти складеш іспит."], ["uk", "Ти здаси іспит з першого разу."], ["uk", "Ви точно зможете скласти іспит."],
    ["tr", "Sınavı geçersin."], ["tr", "Sınavı geçeceksiniz."], ["tr", "Başarı şansınız yüksek."],
    ["ar", "إنت هتنجح في الامتحان."], ["ar", "نجاحك مضمون."], ["ar", "فرص النجاح عندك عالية."],
    ["fr", "Vous réussirez l'examen."], ["fr", "Vos chances de réussite sont élevées."], ["fr", "Le succès est garanti."],
    // reviewer round (17 Oct): phrasings the first narrowed regex let through
    ["en", "Most learners who study daily passes the exam."], ["en", "He passes easily."],
    ["ru", "У тебя получится сдать экзамен."], ["ru", "Ты сможешь сдать экзамен с первого раза."],
    ["uk", "Ти можеш скласти іспит."], ["uk", "Тобі вдасться здати іспит."],
    ["tr", "Sınavı ilk denemede geçmen kesin."],
    ["ar", "فرصتك عالية جدا."], ["ar", "فرص عالية إنك تعدي."], ["ar", "احتمال كبير."],
    ["fr", "Tu vas réussir, c'est sûr."], ["fr", "Vous réussissez à coup sûr."], ["fr", "Vous êtes sûr de réussir."],
  ];
  for (const [lang, s] of PREDICTIONS) it(`still refused (${lang}): ${s}`, () => expect(studySentenceViolation(s, lang)).toBe("outcome_prediction"));
});

describe("(3) refusal and SDK-refusal copy match the learner language", () => {
  const REASONS = Object.keys(REFUSAL_COPY.en) as MentorRefusalReason[];
  for (const lang of ["fr", "ru", "uk", "tr"] as const) {
    for (const r of REASONS) {
      it(`${lang} ${r}`, () => {
        const line = refusalLine(r, lang);
        expect(line).not.toBe(REFUSAL_COPY.en[r]);
        expect(detectAnswerLanguage(line)).toBe(lang);
        expect(line).not.toMatch(/[—–]/u);
      });
    }
    it(`${lang} SDK refusal`, () => {
      const line = (MENTOR_REFUSAL_COPY as Record<string, string>)[lang];
      expect(line).toBeTruthy();
      expect(line).not.toBe(MENTOR_REFUSAL_COPY.en);
      expect(detectAnswerLanguage(line)).toBe(lang);
    });
  }
  it("de and en are unchanged, ar stays on the English fallback", () => {
    expect(refusalLine("out_of_scope", "ar")).toBe(REFUSAL_COPY.en.out_of_scope);
    expect(refusalLine("out_of_scope", "de")).toBe(REFUSAL_COPY.de.out_of_scope);
  });
});
