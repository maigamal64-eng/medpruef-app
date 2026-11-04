import { firstRunConfirmEnabled } from "./flags";
import { emailConfirmEnabled } from "@/lib/email-confirm/flag";
import { readFreeCreditConfig } from "@/lib/mentor/credits/free-credits";
import type { MentorUiLang } from "@/lib/i18n-mentor";
import { dualLang } from "./lang";

type Env = Record<string, string | undefined>;

/**
 * a-first-five-1104: the Mentor first-run confirm line quotes the welcome rule
 * (src/lib/mentor/credits/free-credits.ts: 25 credits, 10 distinct answers
 * for an unverified account), never a typed number. Offered only while its
 * own switch, the welcome grant (MENTOR_WELCOME_ENABLED) AND the email
 * confirmation step (EMAIL_CONFIRM_ENABLED with its link secret, which owns the
 * resend route) are on, so the line never promises credits that are not granted
 * and never shows a resend that answers 404. Env only, no read.
 */
export function firstRunConfirmOffer(env: Env = process.env): { credits: number; questions: number } | null {
  if (!firstRunConfirmEnabled(env) || !emailConfirmEnabled(env)) return null;
  const fc = readFreeCreditConfig(env);
  if (!fc.welcomeEnabled) return null;
  return { credits: fc.welcomeCredits, questions: fc.welcomeMinQuestions };
}

/** One line, Sie in German; other languages show English. No dash, no exclamation mark. */
export function firstRunConfirmLine(offer: { credits: number; questions: number }, lang: MentorUiLang): string {
  const { questions, credits } = offer;
  return {
    de: `Bestätigen Sie Ihre E-Mail-Adresse oder beantworten Sie ${questions} Fragen, um ${credits} Gratis-Credits zu erhalten.`,
    en: `Confirm your email or answer ${questions} questions to get ${credits} free credits.`,
  }[dualLang(lang)];
}
