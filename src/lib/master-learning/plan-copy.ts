/**
 * Learner copy for the plan-target and weekly-progress modules (b35), kept
 * apart from the pure logic so server routes can import the logic without
 * pulling the client i18n module (a25 split).
 */
import { t } from "../i18n";

/** Learner-facing label for a provisional target (DE and EN). */
export function provisionalLabel(lang: "de" | "en"): string {
  return t("a12_plan_provisional", lang);
}

/** Header subtitle: "Noch 34 Tage bis zum 13. November" (date text is passed in, never typed here). */
export function countdownCopy(daysLeft: number, dateLabel: string, lang: "de" | "en"): string {
  if (daysLeft < 0) return t("a12_countdown_past", lang);
  if (daysLeft === 0) return t("a12_countdown_today", lang).replace("{date}", dateLabel);
  return t(daysLeft === 1 ? "a12_countdown_one" : "a12_countdown_days", lang).replace("{n}", String(daysLeft)).replace("{date}", dateLabel);
}
