import type { OfficialSitting } from "@/lib/exam-dates";
import { formatDate } from "@/lib/master-locale/format";
import { escapeHtml as e, SITE } from "@/lib/reminders/common";

// G04 deadline reminder (b19, a30 copy pass): Sie, MedPrüf in the subject,
// lang on the HTML, Vienna dates written out, the official source linked.
// Saved signup locales other than de get English (REVIEWED_LANGS).
const COPY = {
  de: {
    subject: (label: string, n: number) => `MedPrüf: ${label}, Anmeldung endet in ${n} ${n === 1 ? "Tag" : "Tagen"}`,
    closes: (deadline: string) => `Die Anmeldung endet am ${deadline} (Wiener Zeit).`,
    sitting: (date: string) => `Prüfung: ${date}.`,
    check: "Bitte prüfen Sie die offiziellen Voraussetzungen vor der Anmeldung.",
    registered: "Schon angemeldet? Tragen Sie Ihren Termin in MedPrüf ein, dann planen wir Ihre Wochen bis dahin.",
    plan: "Lernplan öffnen",
    source: "Quelle",
    checked: "geprüft am",
    at: "um",
    to: "bis",
    unsub: "Fristerinnerungen abbestellen",
  },
  en: {
    subject: (label: string, n: number) => `MedPrüf: ${label}, registration closes in ${n} ${n === 1 ? "day" : "days"}`,
    closes: (deadline: string) => `Registration closes on ${deadline} (Vienna time).`,
    sitting: (date: string) => `Exam: ${date}.`,
    check: "Please check the official requirements before you register.",
    registered: "Already registered? Add your sitting in MedPrüf and we plan your weeks up to it.",
    plan: "Open the study plan",
    source: "Source",
    checked: "checked on",
    at: "at",
    to: "to",
    unsub: "Unsubscribe from deadline reminders",
  },
} as const;

export function renderExamReminder(s: OfficialSitting, offset: number, locale: string, unsub: string) {
  const lang = locale === "de" ? "de" : "en";
  const t = COPY[lang];
  const day = (iso: string) => formatDate(iso, lang, "long", { withYear: true }) ?? iso;
  const label = s.learner_label[lang];
  const deadline = `${day(s.registration_closes!)}${s.closes_at_time ? ` ${t.at} ${s.closes_at_time}` : ""}`;
  const sitting = `${day(s.date)}${s.date_end ? ` ${t.to} ${day(s.date_end)}` : ""}`;
  return {
    subject: t.subject(label, offset),
    htmlBody: `<!DOCTYPE html><html lang="${lang}"><body style="font-family:-apple-system,system-ui,Segoe UI,Roboto,sans-serif;color:#1a2b3c;line-height:1.55;max-width:560px;margin:0 auto;padding:24px;"><h1 style="font-size:20px;">${e(label)}</h1><p>${e(t.closes(deadline))} ${e(t.sitting(sitting))}</p><p>${e(t.check)}</p><p>${e(t.registered)} <a href="${e(`${SITE}/study-plan`)}">${e(t.plan)}</a></p><p style="font-size:13px;color:#4a5568;">${e(t.source)}: <a href="${e(s.source_url)}">${e(s.publisher)}</a>, ${e(t.checked)} ${e(day(s.read_on))}.</p><p style="font-size:13px;"><a href="${e(unsub)}">${e(t.unsub)}</a></p></body></html>`,
  };
}
