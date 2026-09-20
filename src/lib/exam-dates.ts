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
 * Amended 2026-09-07: the three 2027 Stichprobentest sittings were
 * added from the AST Infoblatt (Stand September 2026), which is the
 * first document to publish them. Kenntnisprüfung 2027 dates are still
 * unpublished by arztakademie.at, so that list stays 2026-only.
 *
 * Re-verify cadence (SoT §0/§1): start of every campaign + monthly.
 * The un-gameable check is "does the first FUTURE entry still match
 * the official source URL?" — a 30-second check, not a prose re-audit.
 *
 * Used by: the PUYP flow (suggest the next attempt date when an admin
 * approves an extension — admin UI accepts an override), the SEO
 * layout JSON-LD, the CohortCountdownBanner, and the on-site
 * `<UpcomingExams>` calendar.
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
    // 2027 dates NOT yet published by arztakademie.at as of 2026-06-20.
    // Do NOT add estimated 2027 dates to a customer-facing calendar.
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
 * Suggested new `expires_at` for a PUYP extension covering the next
 * cycle. The user needs the subscription to stay live through at least
 * the exam date itself, plus a small buffer so they can study the
 * morning of the exam and check results afterwards.
 *
 * Default buffer is 14 days past the exam date. If no future sitting
 * is known for the exam type (e.g. Pharma, which is term-based, or a
 * year whose dates aren't published yet), falls back to 3 months from
 * now so the user isn't locked out while the admin researches the
 * next cycle — the admin UI override handles per-user accuracy.
 */
export function suggestNextExpiresAt(
  examType: PuypExamType,
  bufferDays: number = 14
): Date {
  const iso = getNextExamDate(examType);
  if (!iso) {
    const fallback = new Date();
    fallback.setUTCMonth(fallback.getUTCMonth() + 3);
    return fallback;
  }
  const d = new Date(`${iso}T23:59:59Z`);
  d.setUTCDate(d.getUTCDate() + bufferDays);
  return d;
}
