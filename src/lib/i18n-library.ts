/**
 * /library strings (a25 study library: UX-STU-48, 51..56). German in Sie,
 * English fallback for every unreviewed language (REVIEWED_LANGS = de, en).
 *
 * Nouns follow the shared glossary (src/lib/master-locale/glossary.ts,
 * UX-GLOBAL-05): the AI-made Library object is the "Lernnotiz" / "study note"
 * ("Lernkarte" is retired there), /flashcards is "Karteikarten", a starred
 * question is a "Gemerkte Frage" (never "Lesezeichen"), the learner's own text
 * on a question is a "Notiz zur Frage", a collection is a "Liste".
 *
 * tl(key, lang, vars?) never returns a raw key: an unknown language renders
 * English, a missing English string renders German. No em dashes.
 */
import { renderLang, type UiLanguage } from './language-model';
import { formatCount } from './master-locale/format';

type PluralForms = Partial<Record<Intl.LDMLPluralRule, string>> & { other: string };

const STRINGS = {
  // Page chrome
  title: { de: 'Bibliothek', en: 'Library' },
  subtitle: { de: 'Ihre Lernnotizen und Listen.', en: 'Your study notes and lists.' },
  signin_title: { de: 'Ihre Bibliothek', en: 'Your library' },
  signin_body: { de: 'Loggen Sie sich ein, um Ihre Lernnotizen auf allen Geräten zu speichern.', en: 'Log in to keep your study notes on all your devices.' },
  signin_action: { de: 'Einloggen', en: 'Log in' },
  tab_mine: { de: 'Meine Lernnotizen', en: 'My study notes' },
  tab_explore: { de: 'Entdecken', en: 'Explore' },
  tab_lists: { de: 'Listen', en: 'Lists' },
  tabs_label: { de: 'Bereiche der Bibliothek', en: 'Library sections' },
  load_error: { de: 'Bibliothek konnte nicht geladen werden', en: 'Could not load your library' },
  load_error_body: { de: 'Das hat gerade nicht geklappt. Ihre bisherigen Antworten sind nicht betroffen.', en: 'That did not work just now. Your earlier answers are not affected.' },
  weak_connection: { de: 'Die Verbindung scheint schwach.', en: 'The connection seems weak.' },

  // Free allowance meter (UX-STU-51)
  meter: { de: '{used} von {limit} Lernnotizen', en: '{used} of {limit} study notes' },
  meter_label: { de: 'Kostenlose Lernnotizen', en: 'Free study notes' },
  meter_full: { de: 'Alle {limit} kostenlosen Lernnotizen sind verwendet. Gelöschte Lernnotizen geben keinen Platz frei.', en: 'All {limit} free study notes are used. Deleted study notes do not free a slot.' },
  meter_plans: { de: 'Tarife ansehen', en: 'See plans' },

  // Entry cards (UX-STU-54, 55)
  new_title: { de: 'Neue Lernnotiz', en: 'New study note' },
  new_sub: { de: 'Kurz aufschreiben, die KI macht eine Lernnotiz daraus.', en: 'Jot it down, and the AI makes a study note.' },
  new_draft_sub: { de: 'Entwurf gespeichert. Tippen Sie, um weiterzuschreiben.', en: 'Draft kept. Tap to keep writing.' },
  new_field: { de: 'Ihr Text für die Lernnotiz', en: 'Your text for the study note' },
  new_placeholder: { de: 'z. B. Merkmale des Marfan-Syndroms, wichtige Differenzialdiagnosen', en: 'e.g. features of Marfan syndrome, key differentials' },
  new_create: { de: 'Lernnotiz erstellen', en: 'Create study note' },
  new_close: { de: 'Schließen', en: 'Close' },
  new_draft_kept: { de: 'Entwurf behalten', en: 'Draft kept' },
  new_draft_reopen: { de: 'Wieder öffnen', en: 'Reopen' },
  new_created: { de: 'Lernnotiz erstellt', en: 'Study note created' },
  new_open: { de: 'Öffnen', en: 'Open' },
  flashcards_title: { de: 'Karteikarten üben', en: 'Practice flashcards' },
  flashcards_sub: { de: 'Heute fällige Fragen', en: 'Questions due today' },

  // Legacy browser notes
  legacy_title: { de: 'Alte Notizen in diesem Browser', en: 'Older notes in this browser' },
  legacy_body: { de: '{n} sind keinem Konto zugeordnet. Auf einem gemeinsam genutzten Gerät können sie einer anderen Person gehören.', en: '{n} are not linked to an account. On a shared device, they may belong to someone else.' },
  legacy_import: { de: 'Als meine Notizen importieren…', en: 'Import as my notes…' },
  legacy_importing: { de: 'Import läuft…', en: 'Importing…' },

  // Due entry and review (UX-STU-48, 50)
  due_entry: { de: 'Heute fällige Lernnotizen', en: 'Study notes due today' },
  due_round: { de: 'Bis zu 20 in dieser Runde', en: 'Up to 20 this round' },
  no_due: { de: 'Heute sind keine Lernnotizen fällig.', en: 'No study notes are due today.' },
  due_error: { de: 'Fällige Lernnotizen konnten nicht geladen werden', en: 'Could not load the study notes due today' },
  review_title: { de: 'Lernnotizen wiederholen', en: 'Review study notes' },
  review_position: { de: '{i} von {n}', en: '{i} of {n}' },
  review_content: { de: 'Inhalt', en: 'Content' },
  review_next_date: { de: 'Nächste Wiederholung: {date}', en: 'Next review: {date}' },
  migration_hint: { de: 'Zum Wiederholen wählen Sie Üben. Fällige Lernnotizen öffnen direkt die Wiederholung.', en: 'Choose Practice to review. Due study notes open review directly.' },
  list_practice: { de: 'Diese Liste üben', en: 'Practice this list' },

  // Controls (UX-STU-54)
  search_placeholder: { de: 'Lernnotizen durchsuchen…', en: 'Search study notes…' },
  search_label: { de: 'Lernnotizen durchsuchen', en: 'Search study notes' },
  filter_label: { de: 'Quelle', en: 'Source' },
  filter_all: { de: 'Alle', en: 'All' },
  filter_questions: { de: 'Aus Fragen', en: 'From questions' },
  filter_own: { de: 'Eigene', en: 'Own' },
  filter_ai: { de: 'KI', en: 'AI' },
  sort_label: { de: 'Sortieren:', en: 'Sort:' },
  sort_recent: { de: 'Neueste', en: 'Newest' },
  sort_updated: { de: 'Zuletzt bearbeitet', en: 'Recently edited' },
  sort_source: { de: 'Quelle', en: 'Source' },
  sort_exam: { de: 'Prüfung', en: 'Exam' },

  // Empty states
  empty_title: { de: 'Noch keine Lernnotizen', en: 'No study notes yet' },
  empty_body: { de: 'Speichern Sie beim Üben eine Frage oder eine Erklärung als Lernnotiz.', en: 'While practicing, save a question or an explanation as a study note.' },
  empty_action: { de: 'Üben starten', en: 'Start practicing' },
  empty_step_1: { de: 'Beantworten Sie eine Übungsfrage.', en: 'Answer a practice question.' },
  empty_step_2: { de: '„Als Lernnotiz speichern“ tippen: Die KI macht daraus eine Lernnotiz.', en: 'Tap "Save as study note": the AI turns it into a study note.' },
  empty_step_3: { de: 'Lernnotizen hier mit Wiederholungsplan üben.', en: 'Review your study notes here on a schedule.' },
  no_match_title: { de: 'Nichts gefunden', en: 'Nothing found' },
  no_match_body: { de: 'Passen Sie Suche oder Filter an.', en: 'Try a different search or filter.' },

  // Note card (UX-STU-53)
  untitled: { de: 'Ohne Titel', en: 'Untitled' },
  source_question: { de: 'Aus Frage', en: 'From question' },
  source_own: { de: 'Eigene', en: 'Own' },
  source_ai: { de: 'KI', en: 'AI' },
  new_badge: { de: 'Neu', en: 'New' },

  // Note menu (UX-STU-51)
  menu_label: { de: 'Aktionen für {title}', en: 'Actions for {title}' },
  menu_edit: { de: 'Bearbeiten', en: 'Edit' },
  menu_delete: { de: 'Löschen', en: 'Delete' },
  menu_report: { de: 'Fehlerhafte Lernnotiz melden', en: 'Report a wrong study note' },
  report_hint: { de: 'Beschreiben Sie im Feedback, was an der Lernnotiz „{title}“ nicht stimmt.', en: 'In the feedback form, describe what is wrong in the study note "{title}".' },
  delete_title: { de: 'Lernnotiz löschen?', en: 'Delete study note?' },
  delete_body: { de: 'Die Lernnotiz wird mit ihrem Wiederholungsplan entfernt, auch aus Ihren Listen. Das lässt sich nicht rückgängig machen.', en: 'The study note and its review schedule are removed, also from your lists. This cannot be undone.' },
  delete_body_free: { de: 'Gelöschte Lernnotizen geben keinen Platz frei: Ihr kostenloses Konto umfasst insgesamt {limit} Lernnotizen.', en: 'Deleted study notes do not free a slot: your free account includes {limit} study notes in total.' },
  delete_confirm: { de: 'Löschen', en: 'Delete' },
  delete_pending: { de: 'Wird gelöscht…', en: 'Deleting…' },
  cancel: { de: 'Abbrechen', en: 'Cancel' },
  deleted: { de: 'Lernnotiz gelöscht', en: 'Study note deleted' },
  delete_error: { de: 'Die Lernnotiz konnte nicht gelöscht werden. Bitte versuchen Sie es noch einmal.', en: 'The study note could not be deleted. Please try again.' },
  delete_unavailable: { de: 'Löschen ist für kostenlose Konten noch nicht verfügbar.', en: 'Deleting is not available for free accounts yet.' },
  edit_title: { de: 'Lernnotiz bearbeiten', en: 'Edit study note' },
  edit_field_title: { de: 'Titel', en: 'Title' },
  edit_front: { de: 'Vorderseite', en: 'Front' },
  edit_back: { de: 'Rückseite', en: 'Back' },
  edit_save: { de: 'Speichern', en: 'Save' },
  edit_pending: { de: 'Wird gespeichert…', en: 'Saving…' },
  edit_saved: { de: 'Änderungen gespeichert', en: 'Changes saved' },
  edit_error: { de: 'Die Änderungen konnten nicht gespeichert werden. Bitte versuchen Sie es noch einmal.', en: 'Your changes could not be saved. Please try again.' },
  edit_empty: { de: 'Die Lernnotiz braucht einen Titel oder einen Inhalt.', en: 'The study note needs a title or some content.' },

  // Block labels
  block_keyfact: { de: 'Merksatz', en: 'Key fact' },
  block_pitfall: { de: 'Falle', en: 'Pitfall' },
  block_mnemonic: { de: 'Eselsbrücke', en: 'Mnemonic' },

  // Lists (UX-STU-56)
  lists_all: { de: 'Alle Listen', en: 'All lists' },
  lists_new_placeholder: { de: 'Neue Liste erstellen…', en: 'Create a new list…' },
  lists_new_label: { de: 'Name der neuen Liste', en: 'Name of the new list' },
  lists_create: { de: 'Erstellen', en: 'Create' },
  lists_created: { de: 'Liste erstellt', en: 'List created' },
  lists_empty_title: { de: 'Noch keine Listen', en: 'No lists yet' },
  lists_empty_body: { de: 'Legen Sie Listen an, zum Beispiel „Kardiologie“ oder „Vor der Prüfung“, um Ihre Lernnotizen zu ordnen.', en: 'Create lists such as "Cardiology" or "Before the exam" to organize your study notes.' },
  lists_empty_explore: { de: 'Lernnotizen, die Sie in Entdecken speichern, landen in „Gespeichert“.', en: 'Study notes you save in Explore land in "Saved".' },
  list_empty_title: { de: 'Diese Liste ist leer', en: 'This list is empty' },
  list_empty_body: { de: 'Öffnen Sie eine Lernnotiz und wählen Sie „Liste“, um sie hier hinzuzufügen.', en: 'Open a study note and choose "List" to add it here.' },
  list_empty_explore: { de: 'Auch Lernnotizen aus Entdecken lassen sich so speichern.', en: 'Study notes from Explore can be saved the same way.' },
  list_rename: { de: 'Liste umbenennen', en: 'Rename list' },
  list_delete: { de: 'Liste löschen', en: 'Delete list' },
  list_open: { de: 'Liste öffnen', en: 'Open list' },
  list_save_name: { de: 'Namen speichern', en: 'Save name' },
  list_delete_title: { de: 'Liste „{name}“ löschen?', en: 'Delete list "{name}"?' },
  list_delete_body: { de: 'Die Lernnotizen bleiben in Ihrer Bibliothek. Die Liste lässt sich nicht wiederherstellen.', en: 'The study notes stay in your Library. The list cannot be restored.' },
  list_deleted: { de: 'Liste gelöscht', en: 'List deleted' },
  list_renamed: { de: 'Liste umbenannt', en: 'List renamed' },
  list_saved_ref: { de: 'gespeichert', en: 'saved' },
  lists_load_error: { de: 'Listen konnten nicht geladen werden.', en: 'Lists could not be loaded.' },
  list_load_error: { de: 'Diese Liste konnte nicht geladen werden.', en: 'This list could not be loaded.' },
  retry: { de: 'Erneut versuchen', en: 'Try again' },

  // List failures (UX-GLOBAL-16): what failed, why, and the next step.
  fail_create: { de: 'Liste konnte nicht erstellt werden.', en: 'The list could not be created.' },
  fail_rename: { de: 'Liste konnte nicht umbenannt werden.', en: 'The list could not be renamed.' },
  fail_delete: { de: 'Liste konnte nicht gelöscht werden.', en: 'The list could not be deleted.' },
  fail_add: { de: 'Lernnotiz konnte nicht zur Liste hinzugefügt werden.', en: 'The study note could not be added to the list.' },
  fail_remove: { de: 'Lernnotiz konnte nicht aus der Liste entfernt werden.', en: 'The study note could not be removed from the list.' },
  why_network: { de: 'Keine Verbindung. Prüfen Sie Ihre Verbindung und versuchen Sie es noch einmal.', en: 'No connection. Check your connection and try again.' },
  why_auth: { de: 'Ihre Sitzung ist abgelaufen. Bitte loggen Sie sich erneut ein.', en: 'Your session has ended. Please log in again.' },
  why_permission: { de: 'Diese Liste gehört nicht zu Ihrem Konto.', en: 'This list does not belong to your account.' },
  why_gone: { de: 'Diese Liste gibt es nicht mehr.', en: 'This list no longer exists.' },
  why_invalid: { de: 'Bitte prüfen Sie den Namen (höchstens 80 Zeichen).', en: 'Please check the name (80 characters at most).' },
  why_pro: { de: 'Community-Lernnotizen zu speichern ist Teil von Pro.', en: 'Saving community study notes is part of Pro.' },
  why_server: { de: 'Bitte versuchen Sie es noch einmal.', en: 'Please try again.' },
  add_list_error: { de: 'Ihre Listen konnten nicht geladen werden.', en: 'Your lists could not be loaded.' },

  // NoteReader (own notes)
  reader_own: { de: 'Ihre Lernnotiz', en: 'Your study note' },
  reader_empty: { de: 'Diese Lernnotiz hat keinen Inhalt.', en: 'This study note has no content.' },
  reader_saved: { de: 'Gespeichert', en: 'Saved' },
  reader_saved_body: { de: 'In Ihrer Bibliothek.', en: 'In your Library.' },
  reader_pro: { de: 'Pro-Funktion', en: 'Pro feature' },

  // TurnIntoNoteButton
  turn_cap: { de: 'Alle kostenlosen Lernnotizen sind verwendet: Tarife ansehen', en: 'All free study notes are used: see plans' },
  turn_working: { de: 'Wird erstellt…', en: 'Creating…' },
  turn_customize: { de: 'Anpassen', en: 'Customize' },
  turn_lang: { de: 'Sprache der Lernnotiz', en: 'Study note language' },
  turn_focus: { de: 'Schwerpunkt (optional)', en: 'Focus (optional)' },
  turn_focus_placeholder: { de: 'z. B. Nebenwirkungen betonen', en: 'e.g. emphasize side effects' },
  turn_answer_hint: { de: 'Ihre Antwort wird einbezogen, damit die Lernnotiz genau Ihre Lücken trifft.', en: 'Your answer is included so the study note targets your gaps.' },
  turn_error: { de: 'Das hat nicht geklappt. Bitte versuchen Sie es noch einmal.', en: 'That did not work. Please try again.' },
} as const;

export type LibraryKey = keyof typeof STRINGS;
export type LibraryVars = Record<string, string | number>;

/** Every catalogue entry (tests read it). */
export const LIBRARY_STRINGS: Record<LibraryKey, { de: string; en: string }> = STRINGS;

function isUi(value: unknown): value is UiLanguage {
  return value === 'de' || value === 'en' || value === 'ru' || value === 'uk' || value === 'tr' || value === 'ar';
}

/** The rendered chrome language for a stored preference: de or en. */
export function libraryLang(lang: string | null | undefined): 'de' | 'en' {
  return isUi(lang) ? renderLang(lang) : 'en';
}

export function tl(key: LibraryKey, lang: string | null | undefined, vars?: LibraryVars): string {
  const entry = STRINGS[key] as { de: string; en: string } | undefined;
  if (!entry) return '';
  let text: string = entry[libraryLang(lang)] || entry.en || entry.de;
  if (vars) {
    for (const [name, value] of Object.entries(vars)) text = text.split(`{${name}}`).join(String(value));
  }
  return text;
}

const SECTION_FORMS: Record<'de' | 'en', PluralForms> = {
  de: { one: '{n} Abschnitt', other: '{n} Abschnitte' },
  en: { one: '{n} section', other: '{n} sections' },
};
const REMAINING_FORMS: Record<'de' | 'en', PluralForms> = {
  de: { one: 'Noch {n} kostenlose Lernnotiz. Gelöschte Lernnotizen geben keinen Platz frei.', other: 'Noch {n} kostenlose Lernnotizen. Gelöschte Lernnotizen geben keinen Platz frei.' },
  en: { one: '{n} free study note left. Deleted study notes do not free a slot.', other: '{n} free study notes left. Deleted study notes do not free a slot.' },
};
const LEGACY_FORMS: Record<'de' | 'en', PluralForms> = {
  de: { one: '{n} Notiz zur Frage', other: '{n} Notizen zur Frage' },
  en: { one: '{n} note on a question', other: '{n} notes on questions' },
};

/** "1 Abschnitt" / "3 Abschnitte" (UX-STU-53). */
export function sectionCount(n: number, lang: string | null | undefined): string {
  const l = libraryLang(lang);
  return formatCount(n, SECTION_FORMS[l], l);
}

/** "3 Lernnotizen" with the shared plural rules. */
export function noteCount(n: number, lang: string | null | undefined): string {
  return formatCount(n, 'note', libraryLang(lang));
}

/** "{n} Notizen zur Frage" for the legacy browser-notes banner. */
export function legacyNoteCount(n: number, lang: string | null | undefined): string {
  const l = libraryLang(lang);
  return formatCount(n, LEGACY_FORMS[l], l);
}

/** Quiet warning line under the meter, from 8 of 10 (UX-STU-51). */
export function remainingLine(remaining: number, lang: string | null | undefined): string {
  const l = libraryLang(lang);
  return formatCount(remaining, REMAINING_FORMS[l], l);
}

/** The meter warns quietly from 8 used (of 10), and says "full" at the limit. */
export function meterState(used: number, limit: number): 'calm' | 'warn' | 'full' {
  if (used >= limit) return 'full';
  if (used >= limit - 2) return 'warn';
  return 'calm';
}

export type ListAction = 'create' | 'rename' | 'delete' | 'add' | 'remove';

/**
 * A specific list failure (UX-GLOBAL-16): what failed plus why. `status` is
 * the HTTP status, or null when the request never reached the server.
 */
export function listFailure(action: ListAction, status: number | null, lang: string | null | undefined): { title: string; body: string } {
  const title = tl(`fail_${action}` as LibraryKey, lang);
  const why: LibraryKey =
    status === null ? 'why_network'
      : status === 401 ? 'why_auth'
        : status === 402 ? 'why_pro'
          : status === 403 ? 'why_permission'
            : status === 404 ? 'why_gone'
              : status === 400 || status === 422 ? 'why_invalid'
                : 'why_server';
  return { title, body: tl(why, lang) };
}
