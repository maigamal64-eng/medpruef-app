import { escapeHtml as e, SITE } from "@/lib/reminders/common";

export function renderStudyNudge(due: number, locale: string, unsub: string) {
  const en = locale === "en";
  return {
    subject: en ? "Your MedPrüf review is ready" : "Deine MedPrüf Wiederholung ist bereit",
    htmlBody: `<h1>${en ? "A short review today?" : "Heute kurz wiederholen?"}</h1><p>${en ? `${due} questions in your selected exam bank are due for review.` : `${due} Fragen in deiner gewählten Prüfungsbank sind zur Wiederholung fällig.`}</p><p><a href="${SITE}/flashcards">${en ? "Open review" : "Wiederholung öffnen"}</a></p><p><a href="${e(unsub)}">${en ? "Unsubscribe from study nudges" : "Lernerinnerungen abbestellen"}</a></p>`,
  };
}
