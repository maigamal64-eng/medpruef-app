// FAQPage structured data for an answer page. Built from the same entries the
// page shows, in the rendered language, so markup and visible text agree.
import { FREE_TIER } from "@/lib/content-truth";
import { MENTOR_GRACE_DAYS } from "@/lib/mentor-public/ladder";
import { REFERRAL_MENTOR_CREDITS, REFERRAL_MENTOR_EXPIRY_DAYS, REFERRAL_MENTOR_MONTHLY_CAP } from "@/lib/referral-mentor-credits";
import { REVERSE_TRIAL_DAYS } from "@/lib/pricing-v2/constants";
import { answerLead } from "./lead";
import { ANSWER_UI, nextSittingAnswer, nextSittingQuestion } from "./copy";
import { fillPlaceholders, visibleFaq } from "./registry";
import type { AnswerLang, AnswerPage } from "./types";

/** Values copy may name only through a placeholder, so the number has one owner. */
export const ANSWER_PLACEHOLDERS: Record<string, string | number> = {
  freeQuestions: FREE_TIER.questions_per_exam_type,
  mentorGraceDays: MENTOR_GRACE_DAYS,
  referralCredits: REFERRAL_MENTOR_CREDITS,
  referralCreditDays: REFERRAL_MENTOR_EXPIRY_DAYS,
  referralMonthlyCap: REFERRAL_MENTOR_MONTHLY_CAP,
  DAYS: REVERSE_TRIAL_DAYS,
};
export const fill = (text: string) => fillPlaceholders(text, ANSWER_PLACEHOLDERS);

export interface FaqEntry { q: string; a: string }

export function faqEntries(page: AnswerPage, lang: AnswerLang, now: Date, env: Record<string, string | undefined> = process.env): FaqEntry[] {
  return visibleFaq(page, env).map((item) => {
    if (item.kind === "next_sitting") {
      const [entry] = answerLead([item.exam], now);
      return { q: nextSittingQuestion(item.exam, lang), a: nextSittingAnswer(entry, lang, now) };
    }
    return { q: fill(item.q[lang]), a: fill(item.a[lang]) };
  });
}

export function faqPageSchema(page: AnswerPage, lang: AnswerLang, url: string, entries: FaqEntry[]) {
  return {
    "@context": "https://schema.org",
    "@type": "FAQPage",
    "@id": `${url}#faqpage`,
    inLanguage: ANSWER_UI[lang].inLanguage,
    name: page.title[lang],
    mainEntity: entries.map(({ q, a }) => ({
      "@type": "Question",
      name: q,
      acceptedAnswer: { "@type": "Answer", text: a },
    })),
  };
}

/** JSON for a <script type="application/ld+json">: `<` escaped so text can never close the tag. */
export function jsonLdText(value: unknown): string {
  return JSON.stringify(value).replace(/</g, "\\u003c");
}
