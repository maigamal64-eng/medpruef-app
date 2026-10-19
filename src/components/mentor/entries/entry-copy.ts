/**
 * Copy for mentor entry points outside /mentor (a39). DE in Sie and EN only;
 * every other UI language reads the English line.
 */
const COPY = {
  question_cta: { de: "Mit dem Mentor besprechen", en: "Discuss with the mentor" },
  counts_one: { de: "zählt als eine Nachricht", en: "counts as one message" },
  // a-mentor-question-entry-v2 (Lektor 14 Oct: question_cta_wrong APPROVE, question_cta_right REVISE applied).
  question_cta_wrong: { de: "Warum ist meine Antwort falsch? Mentor fragen", en: "Why is my answer wrong? Ask the mentor" },
  question_cta_right: { de: "Noch unklar? Vom Mentor Schritt für Schritt erklären lassen", en: "Still unclear? Have the mentor explain it step by step" },
  home_plan: { de: "Plan mit dem Mentor besprechen", en: "Discuss your plan with the mentor" },
  home_plan_draft: { de: "Wie plane ich {topic}?", en: "How should I plan {topic}?" },
  deadline: { de: "Fristen mit dem Mentor prüfen", en: "Check deadlines with the mentor" },
  deadline_draft: { de: "Welche Anmeldefristen gelten für die nächste Prüfung?", en: "Which registration deadlines apply to the next exam?" },
  mistakes: { de: "Fehler mit dem Mentor durchgehen", en: "Go through mistakes with the mentor" },
  sitting: { de: "Termin und Anmeldung erklären", en: "Explain date and registration" },
  sitting_draft: { de: "Bitte erklären Sie Termin und Anmeldung für {sitting}.", en: "Please explain the date and registration for {sitting}." },
  settings_title: { de: "KI-Mentor", en: "AI mentor" },
  settings_credits: { de: "Verbleibende Credits", en: "Credits left" },
  settings_renewal: { de: "Nächste Verlängerung", en: "Next renewal" },
  settings_expiry: { de: "Credits gültig bis", en: "Credits valid until" },
  settings_package: { de: "Paket", en: "Package" },
  settings_included: { de: "Ihr Tarif enthält {n} Credits für den KI-Mentor je 30 Tage", en: "Your plan includes {n} AI Mentor credits per 30 days" },
  settings_manage: { de: "Abo verwalten", en: "Manage subscription" },
  settings_open: { de: "Mentor öffnen", en: "Open the mentor" },
  settings_delete: { de: "Mentor-Chatverlauf löschen", en: "Delete mentor chat history" },
  settings_delete_title: { de: "Mentor-Chatverlauf löschen?", en: "Delete mentor chat history?" },
  settings_delete_body: {
    de: "Löscht Ihre Mentor-Nachrichten, Ihre Meldungen zu Antworten und gespeicherte Antworten. Ihre Credits bleiben erhalten. Das kann nicht rückgängig gemacht werden.",
    en: "Deletes your mentor messages, your answer reports and saved answers. Your credits stay. This cannot be undone.",
  },
  settings_delete_confirm: { de: "Löschen", en: "Delete" },
  settings_delete_cancel: { de: "Abbrechen", en: "Cancel" },
  settings_delete_pending: { de: "Wird gelöscht…", en: "Deleting…" },
  settings_delete_done: { de: "Ihr Mentor-Chatverlauf wurde gelöscht.", en: "Your mentor chat history was deleted." },
  settings_delete_busy: { de: "Eine Antwort läuft noch. Bitte warten Sie, bis sie fertig ist, und versuchen Sie es dann erneut.", en: "An answer is still running. Please wait until it finishes, then try again." },
  settings_delete_failed: { de: "Löschen war nicht möglich. Bitte versuchen Sie es später erneut.", en: "Deleting was not possible. Please try again later." },
  settings_load_failed: { de: "Mentor-Daten konnten nicht geladen werden.", en: "Mentor details could not be loaded." },
  settings_retry: { de: "Erneut laden", en: "Load again" },
  settings_none: { de: "Keine", en: "None" },
} as const;

export type EntryCopyKey = keyof typeof COPY;

/** Only German has its own lines; every other UI language reads English. */
const OWN: Readonly<Record<string, "de" | "en">> = { de: "de", en: "en" };
export function entryLang(lang: string | null | undefined): "de" | "en" {
  return OWN[lang ?? ""] ?? "en";
}

export function entryT(key: EntryCopyKey, lang: string | null | undefined, vars?: Record<string, string | number>): string {
  let s: string = COPY[key][entryLang(lang)];
  if (vars) for (const [k, v] of Object.entries(vars)) s = s.split(`{${k}}`).join(String(v));
  return s;
}
