/**
 * Learner copy for /dashboard/exam-result, the Pass-Until-You-Pass page where
 * a learner records the result of the real exam (a24: UX-EXM-44/46/47/48/55).
 * Own dictionary so the shared src/lib/i18n.ts stays untouched.
 *
 * de and en are authored. Every other account language reads English until a
 * native review exists (Arabic additionally needs [name]'s sign-off). German
 * uses formal Sie. No em or en dashes, no pass rates, only plans that exist
 * (the Prüfungs-Kohorte); tests/unit/a24-puyp/copy.test.ts enforces this.
 * Guarantee facts (threshold, extension rule, review time) come from
 * src/lib/puyp-copy.ts; this file only words the page around them.
 */

import type { Lang } from "@/lib/i18n";
import { pricingV2Enabled } from "@/lib/pricing-v2/flag";

type Entry = { de: string; en: string };

export const PUYP_COPY = {
  eyebrow: { de: "Pass-Until-You-Pass", en: "Pass-Until-You-Pass" },
  title: { de: "Wie lief Ihre echte Prüfung?", en: "How did your real exam go?" },
  intro: {
    de: "Tragen Sie hier das Ergebnis Ihrer offiziellen Prüfung ein, nicht einer Simulation.",
    en: "Record the result of your official exam here, not of a simulation.",
  },
  loading: { de: "Status wird geladen", en: "Loading your status" },

  loadErrorTitle: { de: "Ihr Status konnte nicht geladen werden", en: "Your status could not be loaded" },
  loadErrorBody: {
    de: "Bitte prüfen Sie Ihre Verbindung und laden Sie erneut. Ihre Angaben sind nicht verloren.",
    en: "Please check your connection and load again. Nothing you entered is lost.",
  },
  reload: { de: "Erneut laden", en: "Load again" },

  planIncludes: { de: "Ihr Tarif enthält Pass-Until-You-Pass", en: "Your plan includes Pass-Until-You-Pass" },
  remainingOne: { de: "Ihnen bleibt noch 1 Verlängerung.", en: "You have 1 extension left." },
  remainingMany: { de: "Ihnen bleiben noch {n} Verlängerungen.", en: "You have {n} extensions left." },
  bankProgress: { de: "Fragenbank-Fortschritt", en: "Question bank progress" },
  bankAnswered: { de: "{answered} von {total} Fragen bearbeitet", en: "{answered} of {total} questions worked" },
  extensionsUsed: { de: "Verlängerungen genutzt: {used} von {max}", en: "Extensions used: {used} of {max}" },
  noPlanNote: {
    de: "Ihr Ergebnis hilft uns, die Vorbereitung zu verbessern. Eine Verlängerung gibt es nur mit der Prüfungs-Kohorte.",
    en: "Your result helps us improve the preparation. An extension is only available with the Exam Cohort.",
  },
  noPlanLink: { de: "Prüfungs-Kohorte ansehen", en: "See the Exam Cohort" },

  examType: { de: "Prüfung", en: "Exam" },
  attemptDate: { de: "Prüfungsdatum", en: "Exam date" },
  attemptDateHelper: { de: "Das Datum Ihrer offiziellen Prüfung.", en: "The date of your official exam." },
  attemptDateMissing: { de: "Bitte geben Sie das Prüfungsdatum an.", en: "Please enter the exam date." },

  passButton: { de: "Bestanden", en: "I passed" },
  passHelper: {
    de: "Sie bestätigen im nächsten Schritt. Ein Bestehen tragen Sie einmal pro Prüfung ein.",
    en: "You confirm in the next step. A pass is recorded once per exam.",
  },
  passSaved: { de: "Herzlichen Glückwunsch!", en: "Congratulations!" },
  passSavedBody: { de: "Ihr Bestehen ist gespeichert.", en: "We have recorded your pass." },
  passError: {
    de: "Ihr Bestehen konnte nicht gespeichert werden. Bitte erneut versuchen.",
    en: "Your pass could not be saved. Please try again.",
  },

  failClaimButton: { de: "Nicht bestanden: Verlängerung beantragen", en: "I did not pass: claim extension" },
  failRecordButton: { de: "Nicht bestanden", en: "I did not pass" },
  failHelperClaim: {
    de: "Im nächsten Schritt laden Sie Ihr offizielles Ergebnis hoch, um die Verlängerung zu beantragen.",
    en: "In the next step you upload your official result to claim the extension.",
  },
  failHelperNoPlan: {
    de: "Wir speichern Ihr Ergebnis ohne Nachweis. Eine Verlängerung gibt es nur mit der Prüfungs-Kohorte.",
    en: "We save your result without proof. An extension is only available with the Exam Cohort.",
  },
  // a-v2-copy-surfaces-1021 (Lektor D, 21 Oct): Guarantee Ticket holders.
  ticketNote: {
    de: "Die Verlängerung Ihres Garantie-Tickets beantragen Sie auf Nachweis auf der Seite „Ticket verlängern“.",
    en: "You request the extension of your Guarantee Ticket on proof on the Renew ticket page.",
  },
  ticketLink: { de: "Ticket verlängern", en: "Renew ticket" },
  failHelperTicket: {
    de: "Wir speichern Ihr Ergebnis hier ohne Nachweis. Die Verlängerung Ihres Garantie-Tickets beantragen Sie unter „Ticket verlängern“.",
    en: "We save your result here without proof. You request your Guarantee Ticket extension on the Renew ticket page.",
  },
  failHelperCap: {
    de: "Sie haben beide Verlängerungen genutzt. Wir speichern Ihr Ergebnis ohne Nachweis, es löst keine Verlängerung aus.",
    en: "You have used both extensions. We save your result without proof; it does not start an extension.",
  },
  failHelperBelowGate: {
    de: "Für eine Verlängerung sind mindestens {pct} % der Fragenbank nötig (derzeit {current} %). Wir speichern Ihr Ergebnis ohne Nachweis.",
    en: "An extension needs at least {pct} % of the question bank (currently {current} %). We save your result without proof.",
  },
  failConfirmTitle: { de: "Nicht bestanden eintragen?", en: "Record that you did not pass?" },
  failConfirmBody: {
    de: "Sie tragen ein, dass Sie die Prüfung nicht bestanden haben. Das lässt sich hier nicht rückgängig machen.",
    en: "You record that you did not pass the exam. This cannot be undone here.",
  },
  failConfirmBodyDate: {
    de: "Sie tragen ein, dass Sie die Prüfung am {date} nicht bestanden haben. Das lässt sich hier nicht rückgängig machen.",
    en: "You record that you did not pass the exam on {date}. This cannot be undone here.",
  },
  failConfirmAction: { de: "Ergebnis eintragen", en: "Record result" },
  failRecordError: {
    de: "Ihr Ergebnis konnte nicht gespeichert werden. Bitte erneut versuchen.",
    en: "Your result could not be saved. Please try again.",
  },
  retry: { de: "Erneut versuchen", en: "Try again" },
  saving: { de: "Wird gespeichert", en: "Saving" },
  cancel: { de: "Abbrechen", en: "Cancel" },
  back: { de: "Zurück", en: "Back" },

  proofTitle: { de: "Nachweis hochladen", en: "Upload proof" },
  proofIntro: {
    de: "Laden Sie Ihr offizielles Prüfungsergebnis hoch, als Foto oder PDF.",
    en: "Upload your official exam result, as a photo or PDF.",
  },
  proofWhatCountsTitle: { de: "Was zählt als Nachweis?", en: "What counts as proof?" },
  proofWhatCounts: {
    de: "Ein offizielles Dokument mit Ihrem Namen, der Prüfung, dem Datum und dem Ergebnis. Ein Screenshot aus dem Prüfungsportal genügt.",
    en: "An official document showing your name, the exam, the date and the result. A screenshot of the exam portal is fine.",
  },
  proofFile: { de: "Nachweis", en: "Proof" },
  proofTakePhoto: { de: "Foto aufnehmen", en: "Take a photo" },
  proofChooseFile: { de: "Datei wählen", en: "Choose file" },
  proofReplace: { de: "Andere Datei", en: "Other file" },
  proofRemove: { de: "Datei entfernen", en: "Remove file" },
  proofNone: { de: "Noch keine Datei. Höchstens 10 MB, PDF, JPG, PNG oder WebP.", en: "No file yet. At most 10 MB, PDF, JPG, PNG or WebP." },
  proofPreparing: { de: "Foto wird vorbereitet", en: "Preparing photo" },
  proofCompressed: { de: "verkleinert", en: "reduced" },
  proofPrivate: {
    de: "Die Datei wird privat gespeichert. Nur das MedPrüf-Team sieht sie zur Prüfung.",
    en: "The file is stored privately. Only the MedPrüf team sees it for the review.",
  },
  proofSnapshot: {
    de: "Mit dem Antrag speichern wir Ihren aktuellen Fragenbank-Fortschritt ({pct} %).",
    en: "With the claim we save your current question bank progress ({pct} %).",
  },
  proofMissing: { de: "Bitte wählen Sie zuerst eine Datei.", en: "Please choose a file first." },
  proofTooLarge: {
    de: "Die Datei ist größer als 10 MB. Bitte wählen Sie eine kleinere Datei oder ein Foto.",
    en: "The file is larger than 10 MB. Please choose a smaller file or a photo.",
  },
  proofWrongType: {
    de: "Dieser Dateityp wird nicht unterstützt. Bitte PDF, JPG, PNG oder WebP wählen.",
    en: "This file type is not supported. Please choose PDF, JPG, PNG or WebP.",
  },
  proofSubmit: { de: "Zur Prüfung einreichen", en: "Submit for review" },
  proofUploading: { de: "Wird hochgeladen", en: "Uploading" },
  proofUploadingHint: {
    de: "Bitte lassen Sie diese Seite geöffnet, bis der Upload fertig ist.",
    en: "Please keep this page open until the upload has finished.",
  },
  uploadTooSlow: {
    de: "Upload zu langsam. Bitte mit besserer Verbindung erneut versuchen.",
    en: "Upload too slow. Please try again with a better connection.",
  },
  uploadOffline: {
    de: "Keine Verbindung. Ihre Datei bleibt hier, bitte erneut versuchen.",
    en: "No connection. Your file stays here, please try again.",
  },
  uploadNotEligible: {
    de: "Für Ihr Konto ist keine Verlängerung möglich. Sie können Ihr Ergebnis ohne Nachweis eintragen.",
    en: "No extension is possible for your account. You can record your result without proof.",
  },
  uploadBelowGate: {
    de: "Für eine Verlängerung sind mindestens {pct} % der Fragenbank nötig.",
    en: "An extension needs at least {pct} % of the question bank.",
  },
  uploadFailed: {
    de: "Der Upload ist fehlgeschlagen. Ihre Datei bleibt hier, bitte erneut versuchen.",
    en: "The upload failed. Your file stays here, please try again.",
  },
  uploadErrorTitle: { de: "Nicht eingereicht", en: "Not submitted" },

  submittedTitle: { de: "Eingereicht", en: "Submitted" },
  submittedBody: {
    de: "Wir prüfen Ihren Nachweis in der Regel innerhalb weniger Werktage und schreiben Ihnen per E-Mail. Bei Freigabe verlängern wir Ihren Zugang automatisch.",
    en: "We usually check your proof within a few working days and email you. If approved, we extend your access automatically.",
  },
  recordedTitle: { de: "Ergebnis gespeichert", en: "Result saved" },
  debrief: {
    de: "Schade. Wir helfen Ihnen, den nächsten Termin gut vorzubereiten.",
    en: "We are sorry. We will help you prepare well for the next sitting.",
  },
  debriefLink: { de: "Zum Lernplan", en: "Go to your study plan" },
} satisfies Record<string, Entry>;

export type PuypKey = keyof typeof PUYP_COPY;

/** Reviewed copy: German and English. Every other language reads English. */
/**
 * a-v2-copy-surfaces-1021 (copy audit item 7): under the v2 offer the
 * Prüfungs-Kohorte is not sold; a learner without a guarantee plan is pointed
 * at the Guarantee Ticket. The page eyebrow reads "Prüfungsergebnis" for
 * everyone (Lektor, 21 Oct); Cohort holders keep planIncludes and the other
 * PUYP lines above.
 */
const PUYP_COPY_V2: Partial<Record<PuypKey, Entry>> = {
  eyebrow: { de: "Prüfungsergebnis", en: "Exam result" },
  noPlanNote: {
    de: "Ihr Ergebnis hilft uns, die Vorbereitung zu verbessern. Eine Verlängerung auf Nachweis gibt es mit dem Garantie-Ticket.",
    en: "Your result helps us improve the preparation. An extension on proof is available with the Guarantee Ticket.",
  },
  noPlanLink: { de: "Garantie-Ticket ansehen", en: "See the Guarantee Ticket" },
  failHelperNoPlan: {
    de: "Wir speichern Ihr Ergebnis ohne Nachweis. Eine Verlängerung auf Nachweis gibt es mit dem Garantie-Ticket.",
    en: "We save your result without proof. An extension on proof is available with the Guarantee Ticket.",
  },
};

/** Where the no-plan link goes: the Ticket card under v2, else the pricing page. */
export function puypNoPlanHref(): string {
  return pricingV2Enabled() ? "/pricing#plan-guarantee-ticket" : "/pricing";
}

export function tp(key: PuypKey, lang: Lang | string, vars?: Record<string, string | number>): string {
  const entry = (pricingV2Enabled() ? PUYP_COPY_V2[key] : undefined) ?? PUYP_COPY[key];
  let text = lang === "de" ? entry.de : entry.en;
  if (vars) {
    for (const [name, value] of Object.entries(vars)) text = text.split(`{${name}}`).join(String(value));
  }
  return text;
}

/** The reviewed language this page renders: German, or English for every other account language. */
export function puypLang(lang: Lang | string): "de" | "en" {
  return lang === "de" ? "de" : "en";
}

/** Locale for dates and numbers on this page. */
export function puypLocale(lang: Lang | string): string {
  return lang === "de" ? "de-AT" : "en-GB";
}
