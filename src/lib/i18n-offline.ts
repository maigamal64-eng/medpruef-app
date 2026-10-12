/**
 * Offline pack and install strings (a28: LX-12, LX-14, LX-15, LX-16).
 * German in Sie, English for every unreviewed language (REVIEWED_LANGS = de, en).
 *
 * Honesty rules (pick-offline A): downloaded questions work in an app that is
 * already open; starting the app without a connection shows a notice page.
 * Nothing here promises a cold offline start, a storage guarantee or that a
 * particular platform deletes data. No em dashes.
 *
 * to(key, lang, vars?) never returns a raw key.
 */
import { formatDate, formatNumberText, formatTime } from './master-locale/format';

const STRINGS = {
  // Pack card (ACC-50 title shape)
  card_label: { de: 'Offline lernen', en: 'Study offline' },
  title: { de: 'Fragen für {exam} herunterladen', en: 'Download questions for {exam}' },
  intro: {
    de: 'Die Fragen werden auf diesem Gerät gespeichert. Ist die App bereits geöffnet, üben Sie damit auch ohne Verbindung weiter. Ihre Antworten werden gesendet, sobald Sie wieder online sind. Ohne Verbindung neu starten lässt sich die App noch nicht.',
    en: 'The questions are saved on this device. If the app is already open, you can keep practising without a connection. Your answers are sent once you are back online. The app cannot be restarted without a connection yet.',
  },
  stored: { de: '{n} Fragen gespeichert', en: '{n} questions saved' },
  last_sync: { de: 'Zuletzt aktualisiert: {date}', en: 'Last updated: {date}' },
  never_synced: { de: 'Noch nichts heruntergeladen.', en: 'Nothing downloaded yet.' },
  scope_label: { de: 'Was möchten Sie herunterladen?', en: 'What would you like to download?' },
  scope_bank: { de: 'Ganze Fragenbank', en: 'Whole question bank' },
  scope_topic: { de: 'Ein Fachgebiet', en: 'One subject' },
  topic_label: { de: 'Fachgebiet', en: 'Subject' },
  topic_placeholder: { de: 'Fachgebiet wählen', en: 'Choose a subject' },
  summary: { de: '{n} Fragen, ca. {mb} MB Text', en: '{n} questions, about {mb} MB of text' },
  summary_loading: { de: 'Größe wird geladen…', en: 'Loading size…' },
  summary_failed: { de: 'Die Größe konnte nicht geladen werden. Sie können trotzdem herunterladen.', en: 'The size could not be loaded. You can still download.' },
  limited: {
    de: 'Mit dem kostenlosen Zugang laden Sie die Fragen, die Ihr kostenloser Zugang enthält.',
    en: 'With free access you download the questions your free access includes.',
  },
  images_toggle: { de: 'Bilder mitladen ({n} Fragen mit Bild, ca. {mb} MB)', en: 'Include images ({n} questions with images, about {mb} MB)' },
  images_note: {
    de: 'Höchstens {max} Bilder pro Download. Bilder von externen Websites werden nicht gespeichert.',
    en: 'At most {max} images per download. Images from external websites are not saved.',
  },
  download: { de: 'Herunterladen', en: 'Download' },
  resume: { de: 'Fortsetzen', en: 'Resume' },
  cancel: { de: 'Abbrechen', en: 'Cancel' },
  downloading: { de: 'Wird heruntergeladen…', en: 'Downloading…' },
  progress: { de: '{done} von {total} Fragen gespeichert', en: '{done} of {total} questions saved' },
  progress_open: { de: '{done} Fragen gespeichert', en: '{done} questions saved' },
  done: { de: '{n} Fragen gespeichert, {mb} MB.', en: '{n} questions saved, {mb} MB.' },
  done_images: { de: '{n} Bilder gespeichert.', en: '{n} images saved.' },
  empty_pack: { de: 'Für diese Auswahl gibt es keine Fragen zum Herunterladen.', en: 'There are no questions to download for this choice.' },
  err_offline: {
    de: 'Keine Verbindung. Der Download wurde angehalten. Tippen Sie auf Fortsetzen, sobald Sie wieder online sind.',
    en: 'No connection. The download was paused. Tap Resume once you are back online.',
  },
  err_auth: { de: 'Ihre Anmeldung ist abgelaufen. Bitte melden Sie sich erneut an.', en: 'Your sign-in has expired. Please sign in again.' },
  err_quota: {
    de: 'Der Speicher auf diesem Gerät ist voll. Löschen Sie Offline-Daten, wählen Sie ein einzelnes Fachgebiet oder laden Sie ohne Bilder.',
    en: 'The storage on this device is full. Clear offline data, choose a single subject or download without images.',
  },
  err_rate: {
    de: 'Sie haben in kurzer Zeit sehr viel heruntergeladen. Bitte versuchen Sie es in einer Stunde erneut. Gespeicherte Fragen bleiben erhalten.',
    en: 'You have downloaded a lot in a short time. Please try again in an hour. Saved questions are kept.',
  },
  images_missed: { de: '{n} Bilder konnten nicht gespeichert werden.', en: '{n} images could not be saved.' },
  err_server: { de: 'Der Download hat nicht geklappt. Bitte versuchen Sie es erneut.', en: 'The download did not work. Please try again.' },
  aborted: { de: 'Download abgebrochen. Gespeicherte Fragen bleiben erhalten.', en: 'Download cancelled. Saved questions are kept.' },
  clear: { de: 'Offline-Daten löschen', en: 'Clear offline data' },
  clear_title: { de: 'Offline-Daten löschen?', en: 'Clear offline data?' },
  clear_body: {
    de: 'Die heruntergeladenen Fragen und Bilder werden von diesem Gerät entfernt. Antworten, die noch nicht gesendet wurden, bleiben erhalten.',
    en: 'The downloaded questions and images are removed from this device. Answers that were not sent yet are kept.',
  },
  clear_confirm: { de: 'Löschen', en: 'Clear' },

  // LX-14 storage protection
  persist_label: { de: 'Speicher geschützt', en: 'Storage protected' },
  persist_granted: { de: 'Ja. Der Browser hat zugesagt, die heruntergeladenen Fragen nicht automatisch zu löschen.', en: 'Yes. The browser has agreed not to delete the downloaded questions automatically.' },
  persist_denied: { de: 'Nein. Der Browser darf die heruntergeladenen Fragen löschen, zum Beispiel wenn der Speicher knapp wird.', en: 'No. The browser may delete the downloaded questions, for example when storage runs low.' },
  persist_unknown: { de: 'Nicht bekannt. Dieser Browser sagt nicht, ob er die Daten behält.', en: 'Unknown. This browser does not say whether it keeps the data.' },
  persist_pending: { de: 'Wird nach dem ersten Download geprüft.', en: 'Checked after the first download.' },
  missing_title: { de: 'Was tun, wenn Daten fehlen?', en: 'What if data is missing?' },
  missing_body: {
    de: 'Fehlen Ihre heruntergeladenen Fragen oder sind Sie abgemeldet, melden Sie sich wieder an und laden Sie die Fragen hier erneut herunter. Ihr Lernstand liegt in Ihrem Konto. Antworten, die noch nicht gesendet wurden, können in diesem Fall fehlen.',
    en: 'If your downloaded questions are missing or you were signed out, sign in again and download the questions here again. Your progress is kept in your account. Answers that were not sent yet may be missing in that case.',
  },

  // Entries on Home and in the quiz (LX-16)
  entry_title: { de: 'Für offline laden', en: 'Download for offline' },
  entry_none: { de: 'Noch keine Fragen auf diesem Gerät.', en: 'No questions on this device yet.' },
  entry_some: { de: '{n} Fragen auf diesem Gerät, aktualisiert {date}', en: '{n} questions on this device, updated {date}' },
  entry_some_nodate: { de: '{n} Fragen auf diesem Gerät', en: '{n} questions on this device' },

  // Install row in Settings (LX-12 ACC-46)
  install_label: { de: 'App installieren', en: 'Install the app' },
  install_android: { de: 'Legen Sie MedPrüf als App auf diesem Gerät ab.', en: 'Add MedPrüf to this device as an app.' },
  install_button: { de: 'Installieren', en: 'Install' },
  install_installed: { de: 'MedPrüf ist auf diesem Gerät installiert.', en: 'MedPrüf is installed on this device.' },

  // Quiz offline branch
  quiz_banner_title: { de: 'Sie sind offline', en: 'You are offline' },
  quiz_banner_body: {
    de: 'Ohne Verbindung üben Sie nur mit heruntergeladenen Fragen. Antworten zählen erst, wenn das Speichern bestätigt ist.',
    en: 'Without a connection you can only practise downloaded questions. Answers count only once saving is confirmed.',
  },
  quiz_history_needed: {
    de: 'Falsche und fällige Fragen brauchen Ihre Online-Lernhistorie. Verbinden Sie sich erneut, um diesen Modus zu nutzen.',
    en: 'Wrong-answer and due-review queues need your online study history. Reconnect to use this mode.',
  },
  quiz_no_choices: {
    de: 'Die gespeicherten Fragen haben keine offline nutzbaren Antwortoptionen. Laden Sie Fragen unter Einstellungen, Offline lernen herunter.',
    en: 'The saved questions have no answer options that work offline. Download questions under Settings, Study offline.',
  },
  quiz_pack_expired: {
    de: 'Ihr Zugang für die heruntergeladenen Fragen muss bestätigt werden. Öffnen Sie MedPrüf einmal mit Verbindung, danach können Sie wieder offline üben.',
    en: 'Your access for the downloaded questions needs to be confirmed. Open MedPrüf once with a connection, then you can practise offline again.',
  },
  quiz_none_saved: {
    de: 'Keine gespeicherten Fragen gefunden. Laden Sie zuerst Fragen unter Einstellungen, Offline lernen herunter.',
    en: 'No saved questions found. Download questions under Settings, Study offline first.',
  },
} as const satisfies Record<string, { de: string; en: string }>;

export type OfflineKey = keyof typeof STRINGS;

export function to(key: OfflineKey, lang: string | null | undefined, vars: Record<string, string | number> = {}): string {
  const entry = STRINGS[key];
  let text: string = lang === 'de' ? entry.de : entry.en;
  for (const [name, value] of Object.entries(vars)) {
    const rendered = typeof value === 'number' ? formatNumberText(value, lang === 'de' ? 'de' : 'en') : value;
    text = text.split(`{${name}}`).join(rendered);
  }
  return text;
}

export const OFFLINE_STRINGS = STRINGS;

/** "12. Okt., 21:40" / "12 Oct, 21:40" (Vienna time), or null for an unreadable stamp. */
export function syncStamp(iso: string | null, lang: string | null | undefined): string | null {
  if (!iso) return null;
  const l = lang === 'de' ? 'de' : 'en';
  const date = formatDate(iso, l, 'short');
  const time = formatTime(iso, l);
  return date && time ? `${date}, ${time}` : null;
}
