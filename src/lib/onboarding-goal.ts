/**
 * Daily goal rules (UX-ONB-31). Pure. Presets are the primary control; the
 * stepper keeps the API's 5..200 bounds. The pace line is an estimate from
 * the chosen bank's own question count and handles a date today or in the
 * past without dividing by zero.
 */
import { t, renderLang, type Lang } from "@/lib/i18n";

const DATE_LOCALE: Record<"de" | "en", string> = { de: "de-AT", en: "en-GB" };

export const GOAL_PRESETS = [10, 20, 30, 50] as const;
export const GOAL_MIN = 5;
export const GOAL_MAX = 200;
export const GOAL_STEP = 5;
export const GOAL_HIGHEST_PRESET = 50;

export type GoalTierKey = "a22_goal_tier_start" | "a22_goal_tier_steady" | "a22_goal_tier_short" | "a22_goal_tier_intense";

export function goalTierKey(goal: number): GoalTierKey {
  if (goal <= 10) return "a22_goal_tier_start";
  if (goal <= 30) return "a22_goal_tier_steady";
  if (goal < 60) return "a22_goal_tier_short";
  return "a22_goal_tier_intense";
}

const DAY_MS = 86_400_000;

export function daysUntilDate(iso: string, now: Date): number {
  const [y, m, d] = iso.split("-").map((n) => parseInt(n, 10));
  const target = Date.UTC(y, (m || 1) - 1, d || 1);
  const today = Date.UTC(now.getFullYear(), now.getMonth(), now.getDate());
  return Math.round((target - today) / DAY_MS);
}

export function goalPaceLine(input: { examDate: string | null; total: number | null; now: Date; lang: Lang }): string | null {
  const { examDate, total, now, lang } = input;
  if (!examDate || !/^\d{4}-\d{2}-\d{2}$/.test(examDate)) return t("a22_goal_pace_nodate", lang);
  const days = daysUntilDate(examDate, now);
  if (days <= 0) return t("a22_goal_pace_past", lang);
  if (!total || total <= 0) return null;
  const perDay = Math.ceil(total / days);
  const [y, m, d] = examDate.split("-").map((n) => parseInt(n, 10));
  const date = new Date(Date.UTC(y, m - 1, d)).toLocaleDateString(DATE_LOCALE[renderLang(lang)], { day: "numeric", month: "long", timeZone: "UTC" });
  const line = t("a22_goal_pace", lang).replace("{date}", date).replace("{n}", String(perDay));
  return perDay > GOAL_HIGHEST_PRESET ? `${line} ${t("a22_goal_pace_split", lang)}` : line;
}
