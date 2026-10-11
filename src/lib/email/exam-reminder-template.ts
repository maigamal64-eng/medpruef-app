import type { OfficialSitting } from "@/lib/exam-dates";
import { escapeHtml as e } from "@/lib/reminders/common";

export function renderExamReminder(s: OfficialSitting, offset: number, locale: string, unsub: string) {
  const en = locale === "en";
  const label = s.learner_label[en ? "en" : "de"];
  const deadline = `${s.registration_closes}${s.closes_at_time ? ` ${s.closes_at_time}` : ""}`;
  const subject = en ? `${label}: registration closes in ${offset} days` : `${label}: Anmeldung endet in ${offset} Tagen`;
  const message = en
    ? `Registration closes on ${deadline} (Vienna time). Sitting: ${s.date}${s.date_end ? ` to ${s.date_end}` : ""}. Please check the official requirements before registering.`
    : `Die Anmeldung endet am ${deadline} (Wiener Zeit). Prüfung: ${s.date}${s.date_end ? ` bis ${s.date_end}` : ""}. Bitte prüfe die offiziellen Voraussetzungen vor der Anmeldung.`;
  return { subject, htmlBody: `<h1>${e(label)}</h1><p>${e(message)}</p><p>${en ? "Source" : "Quelle"}: <a href="${e(s.source_url)}">${e(s.publisher)}</a>. ${en ? "Checked on" : "Geprüft am"} ${e(s.read_on)}.</p><p><a href="${e(unsub)}">${en ? "Unsubscribe from exam reminders" : "Prüfungserinnerungen abbestellen"}</a></p>` };
}
