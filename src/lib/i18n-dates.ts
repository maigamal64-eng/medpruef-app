/**
 * Strings and formatters for the official exam-date surfaces (C9 i18n split).
 *
 * Every NEW learner-facing string about official sittings and deadlines
 * (registration closes, closes at 12:00, the two Stichprobentest publishers,
 * days left) lives here, not in i18n.ts / i18n-extra.ts. DE and EN are
 * authored; every other language falls back to EN. Arabic keys ship EMPTY on
 * purpose (English fallback) until [name] signs the wording off.
 *
 * The data itself comes only from the C7 export in exam-dates.ts. Nothing in
 * this file states a date. No em dashes in any string (house rule).
 */

import {
  daysUntilViennaDate,
  type OfficialDeadlineGroup,
  type OfficialExamKey,
  type OfficialSitting,
} from "./exam-dates";

const DE = {
  registration_closes: "Anmeldeschluss",
  filing_cutoff_merkblatt: "Einreichungsfrist laut MedUni Wien Merkblatt",
  registration_imed: "Anmeldefrist laut i-med (MedUni Innsbruck)",
  stp_where: "Laut i-med meldest du dich an der Universität an, an der du deinen Nostrifizierungsantrag gestellt hast.",
  closes_time: "{time} Uhr",
  days_left_one: "noch 1 Tag",
  days_left_many: "noch {n} Tage",
  last_day: "heute letzter Tag",
  closes_today: "Anmeldeschluss heute",
  window: "Anmeldung {opens} bis {closes}",
  window_closed: "Anmeldung geschlossen",
  week: "Woche {start} bis {end}",
  and: "und",
  meduni_wien_suffix: "(MedUni Wien)",
  banner_line: "{exams} ({dates}): {label} {close}, {left}.",
  banner_line_upcoming: "{exams} ({dates}): {window}.",
  stp_line: "{exam} ({date}): {deadlines}.",
  banner_link: "Offizieller Kalender",
  dismiss: "Hinweis schließen",
  source_read: "Quelle: {publisher}, gelesen am {read}",
  binding: "Verbindlich ist immer die Seite deiner Universität.",
  calendar_vienna_note:
    "SIP4a und SIP5a: Termine und Anmeldeschluss aus dem offiziellen Prüfungskalender der MedUni Wien. Die Wiener Fragenbank ist keine Simulation der postgradualen ÖÄK-Arztprüfung.",
  calendar_rig_note:
    "Rezeptierkunde und Gerichtsmedizin haben feste Prüfungswochen. Die Anmeldung schließt jeweils an einem Dienstag um 12:00 Uhr.",
  picker_official_hint:
    "Die Termine stammen aus den offiziellen Kalendern der Universitäten. Wähle einen Termin als Lernziel; anmelden musst du dich selbst bei deiner Universität.",
  picker_no_official: "Noch kein offizieller Termin veröffentlicht",
  picker_no_official_body:
    "Setze dein Wunschdatum unten, um einen Lernplan zu erhalten.",
  official_dates: "Offizielle Termine",
  fyp_kp_notice:
    "Termine und Anmeldeschluss für SIP4a und SIP5a stammen aus dem offiziellen Prüfungskalender der MedUni Wien. Anforderungen und Anmeldung prüfst du immer direkt bei deiner Universität. Ein selbst eingegebenes Datum dient nur deiner Lernplanung.",
  fyp_next_deadline: "Nächster offizieller Anmeldeschluss",
  stp_table_title: "Termine und Fristen",
  stp_table_sub:
    "Für jeden Termin gibt es zwei veröffentlichte Fristen von zwei Stellen. Vergangene Termine fallen automatisch heraus.",
  col_date: "Termin",
  col_venue: "Standort",
  col_deadline: "Frist",
  col_source: "Quelle",
  stp_faq_answer_intro: "Die nächsten offiziellen Termine (der Standort wechselt je Termin):",
  stp_faq_none:
    "Aktuell ist kein kommender Termin veröffentlicht. Die offiziellen Termine stehen auf i-med.ac.at und auf der Seite deiner Nostrifizierungs-Universität.",
} as const;

type DateKey = keyof typeof DE;

const EN: Record<DateKey, string> = {
  registration_closes: "Registration closes",
  filing_cutoff_merkblatt: "Filing cutoff in the MedUni Wien Merkblatt",
  registration_imed: "Registration deadline in the i-med calendar (MedUni Innsbruck)",
  stp_where: "Per i-med, you register at the university where you filed your nostrification application.",
  closes_time: "{time} Vienna time",
  days_left_one: "1 day left",
  days_left_many: "{n} days left",
  last_day: "today is the last day",
  closes_today: "Registration closes today",
  window: "Registration {opens} to {closes}",
  window_closed: "Registration closed",
  week: "Week of {start} to {end}",
  and: "and",
  meduni_wien_suffix: "(MedUni Vienna)",
  banner_line: "{exams} ({dates}): {label} {close}, {left}.",
  banner_line_upcoming: "{exams} ({dates}): {window}.",
  stp_line: "{exam} ({date}): {deadlines}.",
  banner_link: "Official calendar",
  dismiss: "Dismiss",
  source_read: "Source: {publisher}, read on {read}",
  binding: "Your university's page is always the binding reference.",
  calendar_vienna_note:
    "SIP4a and SIP5a: dates and registration close from MedUni Vienna's official exam calendar. The Vienna question bank is not a simulation of the postgraduate ÖÄK exam.",
  calendar_rig_note:
    "Rezeptierkunde and Gerichtsmedizin have fixed exam weeks. Registration closes on a Tuesday at 12:00 Vienna time.",
  picker_official_hint:
    "These dates come from the universities' official calendars. Pick one as your study target; you register yourself with your university.",
  picker_no_official: "No official date published yet",
  picker_no_official_body: "Set your target date below to get a study plan.",
  official_dates: "Official dates",
  fyp_kp_notice:
    "SIP4a and SIP5a dates and registration close come from MedUni Vienna's official exam calendar. Always check requirements and registration directly with your university. A date you enter is only a study-planning target.",
  fyp_next_deadline: "Next official registration close",
  stp_table_title: "Dates and deadlines",
  stp_table_sub:
    "Each sitting has two published deadlines from two publishers. Past dates drop off automatically.",
  col_date: "Date",
  col_venue: "Venue",
  col_deadline: "Deadline",
  col_source: "Source",
  stp_faq_answer_intro: "The next official sittings (the venue rotates with every sitting):",
  stp_faq_none:
    "No upcoming sitting is published right now. Official dates are on i-med.ac.at and on your nostrification university's page.",
};

/** Arabic ships empty (English fallback) until [name] signs off (C9). */
const AR: Partial<Record<DateKey, string>> = {};

const OVERLAYS: Record<string, Partial<Record<DateKey, string>>> = { ar: AR };

/** Translate one date-surface key. DE and EN authored; others fall back to EN. */
export function td(
  key: DateKey,
  lang: string = "de",
  vars: Record<string, string | number> = {}
): string {
  const raw =
    lang === "de" ? DE[key] : lang === "en" ? EN[key] : OVERLAYS[lang]?.[key] || EN[key];
  return raw.replace(/\{(\w+)\}/g, (_, k: string) => String(vars[k] ?? `{${k}}`));
}

/** Date locale: German for DE, English for every other language (EN fallback). */
function dateLocale(lang: string): string {
  return lang === "de" ? "de-AT" : "en-GB";
}

/** "19. Oktober 2026" / "19 October 2026"; with weekday when asked. */
export function formatOfficialDate(
  iso: string,
  lang: string,
  opts: { weekday?: boolean; year?: boolean } = {}
): string {
  const { weekday = false, year = true } = opts;
  return new Date(`${iso.slice(0, 10)}T12:00:00Z`).toLocaleDateString(dateLocale(lang), {
    timeZone: "UTC",
    ...(weekday ? { weekday: "long" as const } : {}),
    day: "numeric",
    month: "long",
    ...(year ? { year: "numeric" as const } : {}),
  });
}

/** Sitting date, or "Woche 23. bis 27. November 2026" for an exam week. */
export function formatSittingWhen(s: Pick<OfficialSitting, "date" | "date_end">, lang: string): string {
  if (!s.date_end) return formatOfficialDate(s.date, lang);
  return td("week", lang, {
    start: formatOfficialDate(s.date, lang, { year: false }),
    end: formatOfficialDate(s.date_end, lang),
  });
}

/** Short exam name: SIP4a, Rezeptierkunde, Stichprobentest Graz, ... */
export function shortExamName(s: OfficialSitting, lang: string): string {
  const k: OfficialExamKey = s.exam_key;
  if (k === "sip4a") return "SIP4a";
  if (k === "sip5a") return "SIP5a";
  if (k === "rezeptierkunde") return "Rezeptierkunde";
  if (k === "gerichtsmedizin") return "Gerichtsmedizin";
  return lang === "de" ? s.learner_label.de : s.learner_label.en;
}

/** "A und B" / "A, B and C" without duplicates. */
export function joinList(items: string[], lang: string): string {
  const uniq = [...new Set(items)];
  if (uniq.length <= 1) return uniq[0] ?? "";
  return `${uniq.slice(0, -1).join(", ")} ${td("and", lang)} ${uniq[uniq.length - 1]}`;
}

/**
 * Label for a row's deadline. Stichprobentest rows always name their
 * publisher (Merkblatt filing cutoff vs i-med Anmeldefrist); never a
 * "file by" / "register by" instruction.
 */
export function deadlineLabel(s: OfficialSitting, lang: string): string {
  if (s.deadline_type === "filing_cutoff") return td("filing_cutoff_merkblatt", lang);
  if (s.exam_key === "stichprobentest") return td("registration_imed", lang);
  return td("registration_closes", lang);
}

/** "Montag, 19. Oktober 2026" plus ", 12:00 Uhr" when the source gives a time. */
export function formatClose(
  s: Pick<OfficialSitting, "registration_closes" | "closes_at_time">,
  lang: string
): string {
  if (!s.registration_closes) return "";
  const day = formatOfficialDate(s.registration_closes, lang, { weekday: true });
  return s.closes_at_time ? `${day}, ${td("closes_time", lang, { time: s.closes_at_time })}` : day;
}

/** "noch 9 Tage" / "9 days left" / "heute letzter Tag" to a Vienna date. */
export function daysLeftText(iso: string, lang: string, now: Date = new Date()): string {
  const n = daysUntilViennaDate(iso, now);
  if (n <= 0) return td("last_day", lang);
  return n === 1 ? td("days_left_one", lang) : td("days_left_many", lang, { n });
}

/** "Anmeldung <opens> bis <closes>" for a window that opens later. */
export function formatWindow(s: OfficialSitting, lang: string): string {
  if (!s.registration_closes || !s.registration_opens) return "";
  return td("window", lang, {
    opens: formatOfficialDate(s.registration_opens, lang, { year: false }),
    closes: formatOfficialDate(s.registration_closes, lang),
  });
}

/**
 * One-line banner text for a deadline group, e.g.
 * "SIP5a und SIP4a (17. November 2026 und 18. November 2026): Anmeldeschluss
 * Montag, 19. Oktober 2026, noch 9 Tage."
 */
export function describeDeadlineGroup(
  g: OfficialDeadlineGroup,
  lang: string,
  now: Date = new Date()
): string {
  const first = g.rows[0];
  return td("banner_line", lang, {
    exams: joinList(g.rows.map((r) => shortExamName(r, lang)), lang),
    dates: joinList(g.rows.map((r) => formatSittingWhen(r, lang)), lang),
    label: deadlineLabel(first, lang),
    close: formatClose(first, lang),
    left: daysLeftText(g.registration_closes, lang, now),
  });
}

/**
 * One Stichprobentest sitting with every published deadline, each labelled by
 * its publisher, e.g. "Stichprobentest Innsbruck (3. Februar 2027):
 * Einreichungsfrist laut MedUni Wien Merkblatt 14. Dezember 2026;
 * Anmeldefrist laut i-med (MedUni Innsbruck) 7. Jänner 2027."
 */
export function describeStpSitting(rows: OfficialSitting[], lang: string): string {
  const first = rows[0];
  if (!first) return "";
  const sorted = [...rows].sort((a, b) =>
    (a.registration_closes ?? "").localeCompare(b.registration_closes ?? "")
  );
  return td("stp_line", lang, {
    exam: lang === "de" ? first.learner_label.de : first.learner_label.en,
    date: formatOfficialDate(first.date, lang),
    deadlines: sorted
      .filter((r) => r.registration_closes)
      .map((r) => `${deadlineLabel(r, lang)} ${formatOfficialDate(r.registration_closes!, lang)}`)
      .join("; "),
  });
}

/** Banner text for a deadline group whose window has not opened yet. */
export function describeUpcomingGroup(g: OfficialDeadlineGroup, lang: string): string {
  return td("banner_line_upcoming", lang, {
    exams: joinList(g.rows.map((r) => shortExamName(r, lang)), lang),
    dates: joinList(g.rows.map((r) => formatSittingWhen(r, lang)), lang),
    window: formatWindow(g.rows[0], lang) || `${deadlineLabel(g.rows[0], lang)} ${formatClose(g.rows[0], lang)}`,
  });
}
