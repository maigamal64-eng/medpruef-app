/**
 * "Heute fällig" copy for the due summary (LX-06-R), kept apart from the pure
 * counter so server routes can import due-summary.ts without the client i18n
 * module. Text comes from i18n keys (English fallback for unreviewed languages).
 */
import { t } from "../i18n";
import type { DueSummary } from "./due-summary";

/** Text, not colour. Nothing for a non-entitled summary. */
export function dueCopy(summary: DueSummary, lang: "de" | "en"): string | null {
  if (!summary.entitled) return null;
  if (summary.dueToday > 0) {
    return t("a12_due_today", lang).replace("{n}", String(summary.dueToday));
  }
  const next = summary.next7.findIndex((n) => n > 0);
  if (next === -1) {
    return t("a12_due_none", lang);
  }
  const n = summary.next7[next];
  const when = next === 0 ? t("a12_due_next_tomorrow", lang) : t("a12_due_next_days", lang).replace("{n}", String(next + 1));
  const nextLabel = { de: "Nächste Wiederholung", en: "Next review" }[lang];
  return `${t("a12_due_none", lang)} ${nextLabel}: ${when} (${n}).`;
}
