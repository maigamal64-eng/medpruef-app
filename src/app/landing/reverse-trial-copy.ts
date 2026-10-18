import { FREE_TIER } from "@/lib/content-truth";
import { REVERSE_TRIAL_DAYS } from "@/lib/pricing-v2/constants";

/** F08 flag-off closing line: today's sentence with the free-sample wording. */
export const CTA_SUBTITLE_SAMPLE = {
  de: `Üben Sie mit der kostenlosen Probe: ${FREE_TIER.questions_per_exam_type} Fragen je Prüfung, ohne Karte. Oder testen Sie Pro 7 Tage.`,
  en: `Practise with the free sample: ${FREE_TIER.questions_per_exam_type} questions per exam, no card. Or try Pro for 7 days.`,
} as const;

/**
 * a-pricing-v2: while the no-card reverse trial is on (build copy), the
 * landing's trial button names it and links to registration; the dormant card
 * trial is not offered. Formal Sie, no em dashes.
 */
export const REVERSE_TRIAL_LANDING = {
  button: { de: `${REVERSE_TRIAL_DAYS} Tage alles testen`, en: `Try everything for ${REVERSE_TRIAL_DAYS} days` },
  terms: {
    de: "Ohne Karte und ohne Abo, einmal pro Person und Telegram-Konto. Startet, sobald Ihr Konto mit Telegram verknüpft ist.",
    en: "No card and no subscription, once per person and Telegram account. Starts once your account is linked to Telegram.",
  },
  // F08 (Lektor): the closing line and one hero line under the buttons.
  subtitle: {
    de: `Starten Sie mit der kostenlosen Probe: ${FREE_TIER.questions_per_exam_type} Fragen je Prüfung, ohne Karte. Neue Konten mit verknüpftem Telegram erhalten ${REVERSE_TRIAL_DAYS} Tage vollen Zugang, ohne Karte und ohne Abo.`,
    en: `Start with the free sample: ${FREE_TIER.questions_per_exam_type} questions per exam, no card. New accounts with a linked Telegram account get ${REVERSE_TRIAL_DAYS} days of full access, no card and no subscription.`,
  },
  heroLine: {
    de: `Neue Konten mit verknüpftem Telegram: ${REVERSE_TRIAL_DAYS} Tage voller Zugang, ohne Karte.`,
    en: `New accounts with a linked Telegram account: ${REVERSE_TRIAL_DAYS} days of full access, no card.`,
  },
} as const;
