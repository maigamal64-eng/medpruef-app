/**
 * Austrian medical-licensing exam calendar — SELF-AGING.
 *
 * This file is the CODE OWNER of exam-sitting dates (SoT §1 points
 * here with a SOT-REF rather than restating dates in prose, so they
 * cannot diverge). The whole point of the shape below is that copy,
 * countdowns and the on-site calendar stay correct with ZERO manual
 * edits as dates pass: each exam stores a SORTED LIST of known
 * sittings, and the selector returns the first FUTURE one at runtime.
 * Past sittings age out automatically; adding next year's dates is
 * append-only.
 *
 * Verified 2026-06-20 against official Austrian sources:
 *   - Kenntnisprüfung (Arztprüfung Allgemeinmedizin): arztakademie.at
 *   - Stichprobentest (DB key kmp_innsbruck; display "Stichprobentest (Innsbruck)"): i-med.ac.at 2026 PDF
 *   - Pharmakologie/Rezeptierkunde: meduniwien.ac.at Nostrifikation
 * Research dossier: research/exam-dates-2026-06-20.md.
 *
 * Amended 2026-09-27: the three 2027 Kenntnisprüfung sittings and
 * deadlines were added from arztakademie.at after publication. The 2027
 * Stichprobentest sittings remain sourced from the AST Infoblatt.
 *
 * Re-verify cadence (SoT §0/§1): start of every campaign + monthly.
 * The un-gameable check is "does the first FUTURE entry still match
 * the official source URL?" — a 30-second check, not a prose re-audit.
 *
 * EXAM_SITTINGS below is the older per-bank list. Its kenntnispruefung rows
 * are the postgraduate ÖÄK Arztprüfung, which the Vienna bank does not
 * practise, so no learner surface and no access maths read them any more
 * (a27). Learner dates, countdowns and access dates (PUYP extension, referral
 * reward) come from OFFICIAL_SITTINGS further down.
 *
 * Dates use ISO YYYY-MM-DD. When building a subscription's new
 * `expires_at`, add the cohort buffer (~2 weeks past the exam) at the
 * call site so the user can study until the day OF the exam.
 */

export type PuypExamType = "kenntnispruefung" | "kmp_innsbruck" | "pharma";

export interface ExamSitting {
  /** Which exam this sitting belongs to. */
  examType: PuypExamType;
  /** Short human label for the sitting (DE + EN). */
  label: { de: string; en: string };
  /** ISO date (YYYY-MM-DD) of the sitting. */
  date: string;
  /** ISO date (YYYY-MM-DD) of the registration deadline, or null if unknown/not-applicable. */
  registrationDeadline: string | null;
  /** Where the sitting is held (rotates for the Stichprobentest), or null. */
  location: string | null;
  /** Official source URL the date was taken from. */
  sourceUrl: string;
  /**
   * Human-readable name + version of the source document, when the
   * document itself is versioned and the URL alone does not identify
   * which edition the date came from (e.g. "AST Infoblatt, Stand
   * September 2026"). Rendered next to the source link where present.
   * Optional: older entries whose URL IS the identifier omit it.
   */
  sourceLabel?: string;
  /** "high" = confirmed on an official .at page; "estimated" = pattern-derived, not yet published. */
  confidence: "high" | "estimated";
  /** Optional human note shown in the calendar / admin (e.g. national-rotating model). */
  note?: { de: string; en: string };
}

/**
 * Sorted-ascending list of KNOWN sittings per exam type. Only add a
 * date here once it appears on the official source. Past dates may
 * stay (or be trimmed); the selector filters them out, so the list
 * "ages out" automatically. NEVER fabricate or estimate a customer-
 * facing date — leave the list short and let the UI say "next date
 * not yet published."
 */
export const EXAM_SITTINGS: Record<PuypExamType, ExamSitting[]> = {
  kenntnispruefung: [
    // 19 Jan 2026 + 18 May 2026 already passed — omitted.
    {
      examType: "kenntnispruefung",
      label: { de: "Kenntnisprüfung Wien", en: "Kenntnisprüfung Vienna" },
      date: "2026-09-28",
      registrationDeadline: "2026-07-28",
      location: "Wien",
      sourceUrl: "https://www.arztakademie.at/allgemeinmedizin",
      confidence: "high",
      note: {
        de: "Arztprüfung Allgemeinmedizin (Österr. Ärztekammer). Anmeldeschluss ausnahmslos 2 Monate vor dem Termin. Findet 3x pro Jahr statt.",
        en: "Arztprüfung Allgemeinmedizin (Austrian Medical Chamber). Registration closes exactly 2 months before the date. Held 3x per year.",
      },
    },
    // 2027 dates and registration deadlines verified 2026-09-27 against
    // the official calendar at arztakademie.at/allgemeinmedizin.
    {
      examType: "kenntnispruefung",
      label: { de: "Kenntnisprüfung Wien", en: "Kenntnisprüfung Vienna" },
      date: "2027-01-18",
      registrationDeadline: "2026-11-18",
      location: "Wien",
      sourceUrl: "https://www.arztakademie.at/allgemeinmedizin",
      confidence: "high",
    },
    {
      examType: "kenntnispruefung",
      label: { de: "Kenntnisprüfung Wien", en: "Kenntnisprüfung Vienna" },
      date: "2027-05-10",
      registrationDeadline: "2027-03-10",
      location: "Wien",
      sourceUrl: "https://www.arztakademie.at/allgemeinmedizin",
      confidence: "high",
    },
    {
      examType: "kenntnispruefung",
      label: { de: "Kenntnisprüfung Wien", en: "Kenntnisprüfung Vienna" },
      date: "2027-09-27",
      registrationDeadline: "2027-07-27",
      location: "Wien",
      sourceUrl: "https://www.arztakademie.at/allgemeinmedizin",
      confidence: "high",
    },
  ],
  kmp_innsbruck: [
    // National Stichprobentest — the location ROTATES; you register at
    // the university where you applied for Nostrifizierung. The 2026
    // sittings were Innsbruck (Feb, passed), Wien (May, passed) and
    // Graz (23 Sep, upcoming) — so the only remaining 2026 sitting is
    // in GRAZ, not Innsbruck. Display label was renamed "KMP Innsbruck"
    // to "Stichprobentest (Innsbruck)" app-wide (2026-06-21); "Innsbruck"
    // stays as the content-provenance/route anchor, the DB key
    // kmp_innsbruck is legacy and unchanged. This dated-sitting label is
    // plain "Stichprobentest" (it renders next to "in Graz").
    {
      examType: "kmp_innsbruck",
      label: { de: "Stichprobentest", en: "Stichprobentest" },
      date: "2026-09-23",
      registrationDeadline: "2026-08-26",
      location: "Graz",
      sourceUrl:
        "https://www.i-med.ac.at/studium/docs/termine-stichprobentest-2026.pdf",
      confidence: "high",
      note: {
        de: "Nationaler Stichprobentest (Nostrifizierung): Standort wechselt je Termin, der nächste ist in Graz. Du meldest dich an der Universität an, an der du den Nostrifizierungs-Antrag gestellt hast.",
        en: "National Stichprobentest (nostrification screening): the venue rotates each sitting, the next is in Graz. You register at the university where you filed your nostrification application.",
      },
    },
    // 2027 sittings — published in the AST Infoblatt ("Stand: September
    // 2026"), the first document to carry them. VERIFIED 2026-09-07 by
    // fetching the PDF itself (HTTP 200, Last-Modified 2026-09-04) and
    // reading it: "Für 2027 sind folgende Stichprobentesttermine geplant
    // ... 03.02.2027 an der Medizinischen Universität Innsbruck,
    // 04.05.2027 an der Medizinischen Universität Wien, 22.09.2027 an der
    // Medizinischen Universität Graz." The English edition of the same
    // document says the same. The venue keeps rotating Innsbruck → Wien →
    // Graz.
    //
    // Registration deadlines are deliberately null: the document states
    // none per sitting and says participation depends on the deadline
    // "vorgegeben durch die jeweilige Med Uni". Pattern-deriving one would
    // put a wrong date on a customer surface. Re-pull i-med.ac.at when its
    // 2027 Termine PDF appears and fill them in then. The document says
    // "geplant" (planned), so re-verify before any campaign that leads
    // with a 2027 date.
    {
      examType: "kmp_innsbruck",
      label: { de: "Stichprobentest", en: "Stichprobentest" },
      date: "2027-02-03",
      registrationDeadline: null,
      location: "Innsbruck",
      sourceUrl:
        "https://media.anlaufstelle-anerkennung.at/Infoblatt_Nostrifizierung_Humanmedizin.pdf",
      sourceLabel: "AST Infoblatt, Stand September 2026",
      confidence: "high",
      note: {
        de: "Nationaler Stichprobentest (Nostrifizierung): Standort wechselt je Termin. Die verbindliche Anmeldefrist erfährst du an der Universität, an der du den Nostrifizierungs-Antrag gestellt hast.",
        en: "National Stichprobentest (nostrification screening): the venue rotates each sitting. The binding registration deadline comes from the university where you filed your nostrification application.",
      },
    },
    {
      examType: "kmp_innsbruck",
      label: { de: "Stichprobentest", en: "Stichprobentest" },
      date: "2027-05-04",
      registrationDeadline: null,
      location: "Wien",
      sourceUrl:
        "https://media.anlaufstelle-anerkennung.at/Infoblatt_Nostrifizierung_Humanmedizin.pdf",
      sourceLabel: "AST Infoblatt, Stand September 2026",
      confidence: "high",
      note: {
        de: "Nationaler Stichprobentest (Nostrifizierung): Standort wechselt je Termin. Die verbindliche Anmeldefrist erfährst du an der Universität, an der du den Nostrifizierungs-Antrag gestellt hast.",
        en: "National Stichprobentest (nostrification screening): the venue rotates each sitting. The binding registration deadline comes from the university where you filed your nostrification application.",
      },
    },
    {
      examType: "kmp_innsbruck",
      label: { de: "Stichprobentest", en: "Stichprobentest" },
      date: "2027-09-22",
      registrationDeadline: null,
      location: "Graz",
      sourceUrl:
        "https://media.anlaufstelle-anerkennung.at/Infoblatt_Nostrifizierung_Humanmedizin.pdf",
      sourceLabel: "AST Infoblatt, Stand September 2026",
      confidence: "high",
      note: {
        de: "Nationaler Stichprobentest (Nostrifizierung): Standort wechselt je Termin. Die verbindliche Anmeldefrist erfährst du an der Universität, an der du den Nostrifizierungs-Antrag gestellt hast.",
        en: "National Stichprobentest (nostrification screening): the venue rotates each sitting. The binding registration deadline comes from the university where you filed your nostrification application.",
      },
    },
  ],
  pharma: [
    // Rezeptierkunde/Pharmakologie has NO fixed annual date: it follows
    // the regular MedUni Wien semester exam weeks (late Sept–Jan),
    // registered per-semester. Intentionally EMPTY — represent it as
    // rolling/term-based, never a fake countdown date.
  ],
};

/**
 * Source URL for the rolling Pharma scheduling info (no fixed date).
 */
export const PHARMA_INFO_URL =
  "https://www.meduniwien.ac.at/web/studium-weiterbildung/nostrifizierung/pruefungen/";

/**
 * Returns the next FUTURE sitting for an exam type (date >= today,
 * UTC-day granularity), or null if none is known/published. Pure,
 * deterministic per calendar day — safe to call during render.
 */
export function getNextExamSitting(
  examType: PuypExamType,
  now: Date = new Date()
): ExamSitting | null {
  // Compare on calendar day to avoid an exam "disappearing" on the
  // morning of the sitting; a sitting today still counts as upcoming.
  const todayIso = now.toISOString().slice(0, 10);
  const list = EXAM_SITTINGS[examType] ?? [];
  const future = list
    .filter((s) => s.date >= todayIso)
    .sort((a, b) => a.date.localeCompare(b.date));
  return future[0] ?? null;
}

/**
 * Returns the ISO date of the next future sitting, or null if none is
 * known. The self-aging replacement for the old hand-maintained
 * `NEXT_EXAM_DATE[type]` scalar.
 */
export function getNextExamDate(
  examType: PuypExamType,
  now: Date = new Date()
): string | null {
  return getNextExamSitting(examType, now)?.date ?? null;
}

/**
 * Every known FUTURE sitting for ONE exam type, sorted ascending.
 * Powers the per-exam venue-rotation table on the exam landing pages
 * (`/stichprobentest`), where the point is showing the ROTATION across
 * the next several sittings, not just the single next one.
 *
 * Future-only on purpose: re-listing passed sittings to make a rotation
 * look complete would put stale dates back on a customer surface and
 * break the self-aging invariant this whole file exists to hold.
 */
export function getFutureSittings(
  examType: PuypExamType,
  now: Date = new Date()
): ExamSitting[] {
  const todayIso = now.toISOString().slice(0, 10);
  return (EXAM_SITTINGS[examType] ?? [])
    .filter((s) => s.date >= todayIso)
    .sort((a, b) => a.date.localeCompare(b.date));
}

/**
 * All known FUTURE sittings across every exam type, sorted ascending
 * by date. Feeds the on-site `<UpcomingExams>` calendar. Pharma has no
 * fixed date so it never appears here (the calendar shows it as a
 * separate rolling/term-based note).
 */
export function getUpcomingSittings(now: Date = new Date()): ExamSitting[] {
  const todayIso = now.toISOString().slice(0, 10);
  return (Object.values(EXAM_SITTINGS).flat() as ExamSitting[])
    .filter((s) => s.date >= todayIso)
    .sort((a, b) => a.date.localeCompare(b.date));
}

/**
 * The nearest sitting with a published registration deadline that has
 * not passed yet. A sitting with an unknown deadline must not be shown
 * as if its exam date were its registration deadline.
 */
export function getNextRegistrationDeadlineSitting(
  now: Date = new Date()
): ExamSitting | null {
  const todayIso = now.toISOString().slice(0, 10);
  return (Object.values(EXAM_SITTINGS).flat() as ExamSitting[])
    .filter(
      (s) =>
        s.date >= todayIso &&
        s.registrationDeadline !== null &&
        s.registrationDeadline >= todayIso
    )
    .sort((a, b) => {
      const deadlineOrder = a.registrationDeadline!.localeCompare(
        b.registrationDeadline!
      );
      return deadlineOrder || a.date.localeCompare(b.date);
    })[0] ?? null;
}

/**
 * Suggested new `expires_at` for a PUYP extension or a referral exam reward
 * (a27, [name] 2026-10-11: pick-access-dates A, pick-access-buffer A,
 * pick-puyp-outcomes A). Future awards only: callers never shorten access
 * that is already later (admin_puyp_approve, grantExamReward).
 *
 * Rule: the access runs to the next OFFICIAL sitting of the learner's exam
 * whose registration is still open, plus `bufferDays` (14). The bank maps to
 * its official exams through OFFICIAL_KEYS_BY_BANK (Vienna bank: SIP4a and
 * SIP5a, never the postgraduate ÖÄK list in EXAM_SITTINGS). See
 * `nextOpenAccessAnchor` for the exact selection and the fallback.
 *
 * The admin approval dialog pre-fills this value and accepts an override
 * per claim.
 */
export function suggestNextExpiresAt(
  examType: PuypExamType,
  bufferDays: number = 14,
  now: Date = new Date()
): Date {
  const iso = nextOpenAccessAnchor(examType, now);
  if (!iso) {
    const fallback = new Date(now.getTime());
    fallback.setUTCMonth(fallback.getUTCMonth() + 3);
    return fallback;
  }
  const d = new Date(`${iso}T23:59:59Z`);
  d.setUTCDate(d.getUTCDate() + bufferDays);
  return d;
}

/**
 * Default expiry for a PUYP claim, or null when the admin must set the date
 * by hand (a27 review): no qualifying official sitting is published for the
 * claim's exam, or the claim was filed for the Stichprobentest itself. The
 * Stichprobentest is one attempt that decides the further exams, so a claim
 * extends to the next sitting of the prescribed exam the learner did not
 * pass, which only the admin can read from the uploaded result. One clock
 * for the check and the date.
 */
export function suggestPuypExtension(examType: unknown, now: Date = new Date()): Date | null {
  const bank = asPuypExamType(examType);
  if (!bank || bank === "kmp_innsbruck") return null;
  if (!nextOpenAccessAnchor(bank, now)) return null;
  return suggestNextExpiresAt(bank, 14, now);
}

// ---------------------------------------------------------------------------
// C7: official sittings (display only). Contract frozen by W0-C0A, 2026-10-10.
//
// One source for the in-app deadline banner, the Telegram packs and the AI
// mentor. Values are filled by W1-CAL ONLY from confirmed rows of the official
// research files (official-vienna.json, official-spt-pharma.json), with a unit
// test comparing every value to those files (C14).
//
// Since a27 ([name] 2026-10-11, pick-access-dates A) this list also feeds the
// PUYP and referral access maths through suggestNextExpiresAt above.
// EXAM_SITTINGS.kenntnispruefung stays unchanged as the held ÖÄK list and no
// longer drives any access date.
// ---------------------------------------------------------------------------

/** Exam keys shared with the mentor fact records (C6 `exam_key`). */
export type OfficialExamKey =
  | "sip4a"
  | "sip5a"
  | "stichprobentest"
  | "rezeptierkunde"
  | "gerichtsmedizin"
  | "c1"
  | "general"
  | "fsp";

/** University where the learner filed; deadlines can differ per publisher. */
export type FilingUniversity = "wien" | "graz" | "innsbruck" | "all";

/**
 * `filing_cutoff`: last day to FILE the application that places you in this
 * sitting (MedUni Wien Merkblatt). `registration`: last day to REGISTER for
 * the sitting itself (i-med PDF, SIP calendar).
 */
export type OfficialDeadlineType = "filing_cutoff" | "registration";

export interface OfficialSitting {
  exam_key: OfficialExamKey;
  /** Learner-facing name of the sitting (DE + EN; other languages fall back to EN). */
  learner_label: { de: string; en: string };
  /** ISO date (YYYY-MM-DD) of the sitting, or the first day of an exam week. */
  date: string;
  /** Optional last day when the sitting is a week (Rezeptierkunde, Gerichtsmedizin). Additive to C7. */
  date_end?: string;
  /** ISO date the registration window opens, or null if the source gives none. */
  registration_opens: string | null;
  /** ISO date the registration or filing window closes, or null if unpublished. */
  registration_closes: string | null;
  /** Local Vienna time the window closes on registration_closes, e.g. "12:00". */
  closes_at_time?: string;
  deadline_type: OfficialDeadlineType;
  /** Who published the date, e.g. "MedUni Wien" or "Medizinische Universitaet Innsbruck". */
  publisher: string;
  /**
   * Which filers this row applies to. Additive to C7: the Stichprobentest has
   * different cutoffs per publisher for the SAME sitting. Defaults to "all".
   */
  filing_university?: FilingUniversity;
  source_url: string;
  /** ISO date the official source was read. */
  read_on: string;
  /**
   * true = the sitting date is confirmed but the registration window is NOT
   * (the official page prints a typo in it). The mentor keeps the sitting date
   * and withholds the window (review M2); the site UI is unchanged, and the
   * access maths skip the row (nextOpenAccessAnchor). Remove the flag once the
   * page is re-read and the window is confirmed.
   */
  window_unconfirmed?: boolean;
}

// Official source documents (first read 2026-10-10 by the archive sweep; see
// reports/archive-sweep-2026-10-09/out/finish/official-vienna.json and
// official-spt-pharma.json). Re-read 2026-10-21 06:05 UTC by the date watch
// (reports/plan-2026-10-10/research/date-watch/reads/20261021T060550Z): all four
// documents HTTP 200, text identical to the 10 Oct baseline. Re-read the SIP calendar on the day of each
// deploy: it prints a wrong year in one cell of the 10 Mar 2027 row.
const SRC_SIP_CALENDAR =
  "https://www.meduniwien.ac.at/web/studierende/mein-studium/diplomstudium-humanmedizin/pruefungen-pruefungsergebnisse/pruefungskalender/";
const SRC_RIG_WS26 =
  "https://www.meduniwien.ac.at/web/fileadmin/content/serviceeinrichtungen/studienabteilung/studium/nostrifikation/WS26Pr%C3%BCf_modus_EW_03062026.pdf";
const SRC_MERKBLATT_SEP26 =
  "https://www.meduniwien.ac.at/web/fileadmin/content/serviceeinrichtungen/studienabteilung/studium/nostrifikation/pdf/Merkblatt_Nostri_Human_VS_1._9._2026-1.pdf";
const SRC_IMED_STP_2027 =
  "https://www.i-med.ac.at/studium-services/media/Termine-Stichprobentest-2027-1.pdf";
const READ_ON = "2026-10-21";
const MUW = "MedUni Wien";
const IMED = "Medizinische Universität Innsbruck";

const SIP4A_LABEL = { de: "SIP4a (MedUni Wien)", en: "SIP4a (MedUni Vienna)" };
const SIP5A_LABEL = { de: "SIP5a (MedUni Wien)", en: "SIP5a (MedUni Vienna)" };
const REZ_LABEL = {
  de: "Rezeptierkunde (Pharmakologie), MedUni Wien",
  en: "Rezeptierkunde (pharmacology), MedUni Vienna",
};
const GM_LABEL = {
  de: "Gerichtsmedizin, MedUni Wien",
  en: "Gerichtsmedizin (forensic medicine), MedUni Vienna",
};

function sip(
  exam_key: "sip4a" | "sip5a",
  date: string,
  registration_opens: string,
  registration_closes: string
): OfficialSitting {
  return {
    exam_key,
    learner_label: exam_key === "sip4a" ? SIP4A_LABEL : SIP5A_LABEL,
    date,
    registration_opens,
    registration_closes,
    deadline_type: "registration",
    publisher: MUW,
    filing_university: "wien",
    source_url: SRC_SIP_CALENDAR,
    read_on: READ_ON,
  };
}

function rigWeek(
  exam_key: "rezeptierkunde" | "gerichtsmedizin",
  date: string,
  date_end: string,
  registration_opens: string,
  registration_closes: string
): OfficialSitting {
  return {
    exam_key,
    learner_label: exam_key === "rezeptierkunde" ? REZ_LABEL : GM_LABEL,
    date,
    date_end,
    registration_opens,
    registration_closes,
    closes_at_time: "12:00",
    deadline_type: "registration",
    publisher: MUW,
    filing_university: "wien",
    source_url: SRC_RIG_WS26,
    read_on: READ_ON,
  };
}

/**
 * One Stichprobentest sitting has TWO published deadlines from two
 * publishers. The MedUni Wien Merkblatt (1 Sep 2026, p7) gives a filing
 * cutoff (Einreichungsfrist) for its own filers; the i-med 2027 Termine PDF
 * gives a registration deadline (Anmeldefrist) and says to register at the
 * university where you filed. Tagging the Merkblatt row "wien" follows from
 * it being MedUni Wien's own document; tagging the i-med row "innsbruck" is
 * an INFERENCE from the research (no sentence says it). Surfaces therefore
 * show both rows with their publisher labels and never pick one for the
 * learner.
 */
function stp(
  venue: "Innsbruck" | "Wien" | "Graz",
  date: string,
  merkblattCutoff: string,
  imedDeadline: string
): OfficialSitting[] {
  const learner_label = {
    de: `Stichprobentest ${venue}`,
    en: `Stichprobentest ${venue === "Wien" ? "Vienna" : venue}`,
  };
  return [
    {
      exam_key: "stichprobentest",
      learner_label,
      date,
      registration_opens: null,
      registration_closes: merkblattCutoff,
      deadline_type: "filing_cutoff",
      publisher: MUW,
      filing_university: "wien",
      source_url: SRC_MERKBLATT_SEP26,
      read_on: READ_ON,
    },
    {
      exam_key: "stichprobentest",
      learner_label,
      date,
      registration_opens: null,
      registration_closes: imedDeadline,
      deadline_type: "registration",
      publisher: IMED,
      filing_university: "innsbruck",
      source_url: SRC_IMED_STP_2027,
      read_on: READ_ON,
    },
  ];
}

/**
 * Confirmed official sittings, sorted ascending by date. Filled by W1-CAL on
 * 2026-10-10 from the next_dates rows of official-vienna.json and
 * official-spt-pharma.json; tests/unit/lib/exam-deadline-selection.test.ts
 * pairs every row with its official row (C14). Never add an estimated date.
 * Rezeptierkunde/Gerichtsmedizin SS 2027 weeks are not published yet and are
 * deliberately absent.
 */
export const OFFICIAL_SITTINGS: readonly OfficialSitting[] = [
  // Nov 2026: registration open 5 to 19 Oct 2026.
  sip("sip5a", "2026-11-17", "2026-10-05", "2026-10-19"),
  sip("sip4a", "2026-11-18", "2026-10-05", "2026-10-19"),
  // WS 2026/27 exam week 2: registration 7 to 20 Oct 2026, closes 12:00.
  rigWeek("rezeptierkunde", "2026-11-23", "2026-11-27", "2026-10-07", "2026-10-20"),
  rigWeek("gerichtsmedizin", "2026-11-23", "2026-11-27", "2026-10-07", "2026-10-20"),
  // WS 2026/27 exam week 3: registration 2 to 15 Dec 2026, closes 12:00.
  // The week starts on the same calendar day as an ÖÄK sitting; it is the
  // official MedUni Wien week, not the ÖÄK date (check-dates denylist).
  rigWeek("rezeptierkunde", "2027-01-18", "2027-01-22", "2026-12-02", "2026-12-15"), // date-ok: official MedUni Wien exam week (WS26 PDF), not the OeAEK sitting
  rigWeek("gerichtsmedizin", "2027-01-18", "2027-01-22", "2026-12-02", "2026-12-15"), // date-ok: official MedUni Wien exam week (WS26 PDF), not the OeAEK sitting
  ...stp("Innsbruck", "2027-02-03", "2026-12-14", "2027-01-07"),
  sip("sip5a", "2027-02-15", "2027-01-04", "2027-01-18"), // date-ok: official SIP registration close (SIP calendar), not the OeAEK sitting
  sip("sip4a", "2027-02-19", "2027-01-04", "2027-01-18"), // date-ok: official SIP registration close (SIP calendar), not the OeAEK sitting
  // The official page prints a typo year in one cell of this window;
  // 25 Jan to 8 Feb 2027 per the research. Re-read on deploy day. Until then
  // the mentor withholds this window (window_unconfirmed, review M2).
  { ...sip("sip4a", "2027-03-10", "2027-01-25", "2027-02-08"), window_unconfirmed: true },
  { ...sip("sip5a", "2027-03-10", "2027-01-25", "2027-02-08"), window_unconfirmed: true },
  sip("sip4a", "2027-04-27", "2027-03-15", "2027-03-29"),
  sip("sip5a", "2027-04-28", "2027-03-15", "2027-03-29"),
  ...stp("Wien", "2027-05-04", "2027-03-17", "2027-03-17"),
  sip("sip4a", "2027-06-30", "2027-05-17", "2027-05-31"),
  sip("sip5a", "2027-07-02", "2027-05-17", "2027-05-31"),
  sip("sip4a", "2027-09-01", "2027-07-19", "2027-08-02"),
  ...stp("Graz", "2027-09-22", "2027-06-30", "2027-08-25"),
  sip("sip5a", "2027-09-23", "2027-08-09", "2027-08-23"),
];

export interface UpcomingOfficialSittingsOptions {
  exam?: OfficialExamKey;
  filingUniversity?: FilingUniversity;
  now?: Date;
}

/**
 * Upcoming official sittings: the sitting (or the last day of its exam week)
 * is today or later, UTC-day granularity like the rest of this file.
 * `filingUniversity` keeps rows for that university plus rows marked "all"
 * (or unmarked). Sorted by date, then by the registration close.
 */
export function getUpcomingOfficialSittings(
  options: UpcomingOfficialSittingsOptions = {},
  sittings: readonly OfficialSitting[] = OFFICIAL_SITTINGS
): OfficialSitting[] {
  const { exam, filingUniversity, now = new Date() } = options;
  const todayIso = now.toISOString().slice(0, 10);
  return sittings
    .filter((s) => (s.date_end ?? s.date) >= todayIso)
    .filter((s) => !exam || s.exam_key === exam)
    .filter((s) => {
      if (!filingUniversity || filingUniversity === "all") return true;
      const u = s.filing_university ?? "all";
      return u === "all" || u === filingUniversity;
    })
    .slice()
    .sort(
      (a, b) =>
        a.date.localeCompare(b.date) ||
        (a.registration_closes ?? "9999-12-31").localeCompare(
          b.registration_closes ?? "9999-12-31"
        )
    );
}

// ---------------------------------------------------------------------------
// C7 read helpers (W1-CAL, additive). Every date surface that shows official
// sittings or deadlines goes through these, so the banner, the calendar, the
// picker and the agent endpoints can never disagree.
//
// Deadlines are compared in Vienna wall-clock time, not UTC days: the
// Rezeptierkunde/Gerichtsmedizin window closes at 12:00 Vienna time, and a
// whole-day window closes at the end of its day in Vienna. Comparing
// "YYYY-MM-DD HH:MM" strings avoids offset maths across the DST switch.
// ---------------------------------------------------------------------------

/** Which official exams belong to each question bank (users.active_exam). */
export const OFFICIAL_KEYS_BY_BANK: Record<PuypExamType, readonly OfficialExamKey[]> = {
  // The Vienna bank is SIP4a/SIP5a practice. It is NOT the postgraduate
  // ÖÄK exam, so no ÖÄK date is ever shown for it.
  kenntnispruefung: ["sip4a", "sip5a"],
  kmp_innsbruck: ["stichprobentest"],
  // Rezeptierkunde and Gerichtsmedizin share the same exam weeks and both
  // are always prescribed for Vienna Nostrifikanten.
  pharma: ["rezeptierkunde", "gerichtsmedizin"],
};

/** The question bank an official exam belongs to, or null (c1, fsp, general). */
export function bankForOfficialKey(key: OfficialExamKey): PuypExamType | null {
  for (const bank of Object.keys(OFFICIAL_KEYS_BY_BANK) as PuypExamType[]) {
    if (OFFICIAL_KEYS_BY_BANK[bank].includes(key)) return bank;
  }
  return null;
}

/** Coerce any stored exam id to a bank key, or null when unknown. */
export function asPuypExamType(value: unknown): PuypExamType | null {
  return value === "kenntnispruefung" || value === "kmp_innsbruck" || value === "pharma"
    ? value
    : null;
}

/**
 * The official sitting an access extension runs to (a27, pick-access-dates A):
 * for each official exam of the bank, the first upcoming sitting date whose
 * registration is still open (any publisher's window for that date not yet
 * closed, Vienna time; a window that has not opened yet counts as open). A
 * row whose window is unconfirmed (window_unconfirmed) never qualifies, so
 * the search moves on to the next confirmed sitting. An exam week counts to
 * its last day. The bank's anchor is the LATEST of its exams' picks, so a
 * learner covers whichever of SIP4a or SIP5a they sit. When one of the
 * bank's exams has no qualifying published sitting the result is null and
 * the caller uses its fallback (now plus 3 months); the admin overrides per
 * claim.
 */
export function nextOpenAccessAnchor(
  examType: PuypExamType,
  now: Date = new Date(),
  sittings: readonly OfficialSitting[] = OFFICIAL_SITTINGS
): string | null {
  const keys = OFFICIAL_KEYS_BY_BANK[examType];
  if (!keys || keys.length === 0) return null;
  let anchor: string | null = null;
  for (const key of keys) {
    const rows = getUpcomingOfficialFor({ exams: [key], now }, sittings).filter(
      (r) => !r.window_unconfirmed
    );
    const pick = groupOfficialByDate(rows).find((g) =>
      g.rows.some((r) => isOfficialWindowOpen(r, now))
    );
    if (!pick) return null;
    const end = pick.date_end ?? pick.date;
    if (!anchor || end > anchor) anchor = end;
  }
  return anchor;
}

/** "YYYY-MM-DD HH:MM" for `now` in Europe/Vienna. */
export function viennaStamp(now: Date = new Date()): string {
  const parts = new Intl.DateTimeFormat("en-GB", {
    timeZone: "Europe/Vienna",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
  }).formatToParts(now);
  const get = (type: string) => parts.find((p) => p.type === type)?.value ?? "00";
  return `${get("year")}-${get("month")}-${get("day")} ${get("hour")}:${get("minute")}`;
}

/** Today's ISO date in Europe/Vienna. */
export function viennaToday(now: Date = new Date()): string {
  return viennaStamp(now).slice(0, 10);
}

/** The moment a window closes, as a Vienna "YYYY-MM-DD HH:MM" stamp. */
function closeStamp(s: OfficialSitting): string | null {
  if (!s.registration_closes) return null;
  // A whole-day window is open for all of its last day: "24:00" sorts after
  // every real minute of that day.
  return `${s.registration_closes} ${s.closes_at_time ?? "24:00"}`;
}

/**
 * True while the row's registration or filing window has not closed yet
 * (Vienna time). A row with no published close is never "open".
 */
export function isOfficialWindowOpen(s: OfficialSitting, now: Date = new Date()): boolean {
  const close = closeStamp(s);
  return close !== null && viennaStamp(now) < close;
}

/** True once the row's window has opened (or the source gives no opening). */
export function hasOfficialWindowStarted(s: OfficialSitting, now: Date = new Date()): boolean {
  return s.registration_opens === null || viennaToday(now) >= s.registration_opens;
}

/** Whole days from Vienna today to an ISO date (negative once past). */
export function daysUntilViennaDate(iso: string, now: Date = new Date()): number {
  const a = Date.parse(`${viennaToday(now)}T00:00:00Z`);
  const b = Date.parse(`${iso.slice(0, 10)}T00:00:00Z`);
  return Math.round((b - a) / 86_400_000);
}

export interface OfficialQuery {
  /** Restrict to these exams (e.g. OFFICIAL_KEYS_BY_BANK.kenntnispruefung). */
  exams?: readonly OfficialExamKey[];
  filingUniversity?: FilingUniversity;
  now?: Date;
}

/** Upcoming official sittings for several exams (wraps the C7 selector). */
export function getUpcomingOfficialFor(
  query: OfficialQuery = {},
  sittings: readonly OfficialSitting[] = OFFICIAL_SITTINGS
): OfficialSitting[] {
  const { exams, filingUniversity, now = new Date() } = query;
  return getUpcomingOfficialSittings({ filingUniversity, now }, sittings).filter(
    (s) => !exams || exams.includes(s.exam_key)
  );
}

/** Rows whose window is still open, soonest close first. */
export function getOpenOfficialDeadlines(
  query: OfficialQuery = {},
  sittings: readonly OfficialSitting[] = OFFICIAL_SITTINGS
): OfficialSitting[] {
  const now = query.now ?? new Date();
  return getUpcomingOfficialFor(query, sittings)
    .filter((s) => isOfficialWindowOpen(s, now))
    .sort(
      (a, b) =>
        closeStamp(a)!.localeCompare(closeStamp(b)!) || a.date.localeCompare(b.date)
    );
}

/** One deadline shared by one or more sittings (SIP4a + SIP5a close together). */
export interface OfficialDeadlineGroup {
  registration_closes: string;
  closes_at_time?: string;
  deadline_type: OfficialDeadlineType;
  publisher: string;
  /** True when today (Vienna) is inside the window, false if it opens later. */
  started: boolean;
  rows: OfficialSitting[];
}

/**
 * Open deadlines grouped by (close moment, deadline type, publisher), soonest
 * first. Rows that close together are reported together, so a surface never
 * picks SIP4a or SIP5a at random.
 */
export function getOpenOfficialDeadlineGroups(
  query: OfficialQuery = {},
  sittings: readonly OfficialSitting[] = OFFICIAL_SITTINGS
): OfficialDeadlineGroup[] {
  const now = query.now ?? new Date();
  const groups: OfficialDeadlineGroup[] = [];
  for (const s of getOpenOfficialDeadlines(query, sittings)) {
    const last = groups[groups.length - 1];
    if (
      last &&
      last.registration_closes === s.registration_closes &&
      last.closes_at_time === s.closes_at_time &&
      last.deadline_type === s.deadline_type &&
      last.publisher === s.publisher
    ) {
      last.rows.push(s);
      last.started = last.started || hasOfficialWindowStarted(s, now);
      continue;
    }
    groups.push({
      registration_closes: s.registration_closes!,
      closes_at_time: s.closes_at_time,
      deadline_type: s.deadline_type,
      publisher: s.publisher,
      started: hasOfficialWindowStarted(s, now),
      rows: [s],
    });
  }
  return groups;
}

/** The soonest open deadline group, or null. */
export function getNextOfficialDeadlineGroup(
  query: OfficialQuery = {},
  sittings: readonly OfficialSitting[] = OFFICIAL_SITTINGS
): OfficialDeadlineGroup | null {
  return getOpenOfficialDeadlineGroups(query, sittings)[0] ?? null;
}

/**
 * U2 (Rez/GM pointer, 2026-10-14): Stichprobentest-track learners usually
 * also register for Rezeptierkunde and Gerichtsmedizin at MedUni Wien, but
 * their bank only shows the Stichprobentest. For the kmp_innsbruck bank this
 * returns the pharma deadline group while its registration window is open
 * (opened and not yet closed, Vienna time), else null. Every other bank gets
 * null. Self-aging: after the close the pointer disappears by itself.
 */
export function getPharmaPointerGroup(
  bank: PuypExamType,
  now: Date = new Date(),
  sittings: readonly OfficialSitting[] = OFFICIAL_SITTINGS
): OfficialDeadlineGroup | null {
  if (bank !== "kmp_innsbruck") return null;
  return (
    getOpenOfficialDeadlineGroups({ exams: OFFICIAL_KEYS_BY_BANK.pharma, now }, sittings).find(
      (g) => g.started
    ) ?? null
  );
}

/** Upcoming official sittings that share one date (one picker option, one card). */
export interface OfficialDateGroup {
  date: string;
  date_end?: string;
  rows: OfficialSitting[];
}

/** Upcoming sittings grouped by date (and exam week end), ascending. */
export function groupOfficialByDate(rows: readonly OfficialSitting[]): OfficialDateGroup[] {
  const groups: OfficialDateGroup[] = [];
  for (const s of rows) {
    const g = groups.find((x) => x.date === s.date && x.date_end === s.date_end);
    if (g) g.rows.push(s);
    else groups.push({ date: s.date, date_end: s.date_end, rows: [s] });
  }
  return groups.sort((a, b) => a.date.localeCompare(b.date));
}

/**
 * Plain JSON view of upcoming official sittings for the agent endpoints
 * (MCP, A2A, WebMCP). Labels are English; every row carries its publisher,
 * deadline type and source so an agent can quote both Stichprobentest
 * publishers without merging them.
 */
export function officialSittingsForAgents(
  query: OfficialQuery = {},
  sittings: readonly OfficialSitting[] = OFFICIAL_SITTINGS
) {
  const now = query.now ?? new Date();
  return getUpcomingOfficialFor(query, sittings).map((s) => ({
    exam: s.exam_key,
    name: s.learner_label.en,
    date: s.date,
    ...(s.date_end ? { dateEnd: s.date_end } : {}),
    deadlineType:
      s.deadline_type === "filing_cutoff"
        ? "filing cutoff (Einreichungsfrist)"
        : "registration deadline (Anmeldefrist)",
    deadlineDate: s.registration_closes,
    ...(s.closes_at_time ? { deadlineTimeVienna: s.closes_at_time } : {}),
    windowOpens: s.registration_opens,
    windowStatus: !s.registration_closes
      ? "not published"
      : isOfficialWindowOpen(s, now)
        ? hasOfficialWindowStarted(s, now)
          ? "open"
          : "not open yet"
        : "closed",
    publisher: s.publisher,
    ...(s.exam_key === "stichprobentest"
      ? {
          note:
            s.deadline_type === "filing_cutoff"
              ? "Filing cutoff in the MedUni Wien Merkblatt (MedUni Wien's own document for its applicants)."
              : "Registration deadline in the i-med Termine PDF, which says to register at the university where you filed your application.",
        }
      : {}),
    sourceUrl: s.source_url,
    readOn: s.read_on,
  }));
}

/** Which official exams each bank covers, as agent-facing names. */
const BANK_AGENT_NOTE: Record<PuypExamType, string> = {
  kenntnispruefung:
    "The Vienna question bank prepares for the MedUni Wien SIP4a and SIP5a exams that nostrification applicants sit. It is not the postgraduate ÖÄK Arztprüfung, so no ÖÄK date is given here.",
  kmp_innsbruck:
    "The national Stichprobentest (nostrification screening). Each sitting has two published deadlines from two publishers: a filing cutoff in the MedUni Wien Merkblatt and a registration deadline in the i-med Termine PDF. Both are listed; the i-med PDF says to register at the university where you filed.",
  pharma:
    "Rezeptierkunde (pharmacology) and Gerichtsmedizin at MedUni Wien share fixed exam weeks; registration closes on a Tuesday at 12:00 Vienna time. Summer semester 2027 weeks are not published yet.",
};

/**
 * get_exam_info payload for one bank (MCP, A2A, WebMCP share it): the next
 * official deadline and every upcoming official sitting of that bank.
 */
export function officialExamInfoForAgents(bank: PuypExamType, now: Date = new Date()) {
  const exams = OFFICIAL_KEYS_BY_BANK[bank];
  const next = getNextOfficialDeadlineGroup({ exams, now });
  return {
    examType: bank,
    officialExams: exams,
    note: BANK_AGENT_NOTE[bank],
    nextDeadline: next
      ? {
          date: next.registration_closes,
          ...(next.closes_at_time ? { timeVienna: next.closes_at_time } : {}),
          type: next.deadline_type,
          publisher: next.publisher,
          windowStatus: next.started ? "open" : "not open yet",
          sittings: next.rows.map((r) => ({ exam: r.exam_key, date: r.date, ...(r.date_end ? { dateEnd: r.date_end } : {}) })),
        }
      : null,
    upcomingSittings: officialSittingsForAgents({ exams, now }),
  };
}
