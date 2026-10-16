/**
 * One exam label helper (UX-GLOBAL-04, pick-exam-names A, [name] 2026-10-11).
 *
 * The only source of exam names on learner surfaces. Database keys
 * (`kenntnispruefung`, `kmp_innsbruck`, `pharma`), URL slugs and source data
 * never change; only the displayed words do.
 *
 * Forms:
 * - full:   the display name ("SIP4a / SIP5a Wien").
 * - bridge: a second line in learner vocabulary with the practice qualifier,
 *           shown wherever an exam is chosen, so the name never implies
 *           official exam questions.
 * - short:  the compact chrome chip ("SIP", "SPT", "Pharma"). Its accessible
 *           name starts with the visible text and continues with the full
 *           name (WCAG 2.5.3), see `examChipAccessibleName`.
 *
 * Raw keys, "KP", "KMP", "STP" and emoji flags never render.
 */

export type ExamLabelKey = 'kenntnispruefung' | 'kmp_innsbruck' | 'pharma';
export type ExamLabelForm = 'full' | 'bridge' | 'short';
type Bi = { de: string; en: string };

const LABELS: Record<ExamLabelKey, { full: Bi; bridge: Bi; short: string }> = {
  kenntnispruefung: {
    full: { de: 'SIP4a / SIP5a Wien', en: 'SIP4a / SIP5a Wien' },
    bridge: { de: 'Übungsfragen für SIP4a und SIP5a an der MedUni Wien', en: 'Practice questions for SIP4a and SIP5a at MedUni Wien' },
    short: 'SIP',
  },
  kmp_innsbruck: {
    full: { de: 'Stichprobentest (Innsbruck)', en: 'Stichprobentest (Innsbruck)' },
    bridge: { de: 'Übungsfragen für den Stichprobentest (ein gemeinsamer Test der drei MedUnis, der Ort wechselt)', en: 'Practice questions for the Stichprobentest (one joint test of the three MedUnis, the venue rotates)' },
    short: 'SPT',
  },
  pharma: {
    full: { de: 'Pharmakologie / Rezeptierkunde', en: 'Pharmacology / Rezeptierkunde' },
    bridge: { de: 'Übungsfragen für Pharmakologie und Rezeptierkunde', en: 'Practice questions for pharmacology and Rezeptierkunde' },
    short: 'Pharma',
  },
};

/**
 * a44 (pick-gm-placement B): Gerichtsmedizin is a labelled topic inside the
 * pharma bank. Once NEXT_PUBLIC_GM_PRACTICE is 'true' (flipped in the release
 * that activates the reviewed rows) the bridge line, which describes the
 * practice content shown wherever a bank is chosen, names both subjects. The
 * full name keeps naming the exam (PUYP results, terms) and the chip stays
 * "Pharma"; the database key never changes.
 */
const PHARMA_BRIDGE_WITH_GM: Bi = { de: 'Übungsfragen für Pharmakologie, Rezeptierkunde und Gerichtsmedizin', en: 'Practice questions for pharmacology, Rezeptierkunde and Gerichtsmedizin' };
const gmPracticeOn = (): boolean => process.env.NEXT_PUBLIC_GM_PRACTICE === 'true';

export const EXAM_LABEL_KEYS = Object.keys(LABELS) as ExamLabelKey[];

export function isExamLabelKey(key: unknown): key is ExamLabelKey {
  return typeof key === 'string' && key in LABELS;
}

/**
 * Exam name for a key and form. German for `de`, English for every other
 * rendered language (overlay names follow once reviewed). An unknown key
 * returns a neutral word, never the raw key.
 */
export function getExamLabel(key: string | null | undefined, form: ExamLabelForm = 'full', lang: string = 'de'): string {
  if (!isExamLabelKey(key)) return lang === 'de' ? 'Prüfung' : 'Exam';
  const entry = LABELS[key];
  if (form === 'short') return entry.short;
  const text = key === 'pharma' && form === 'bridge' && gmPracticeOn() ? PHARMA_BRIDGE_WITH_GM : entry[form];
  return lang === 'de' ? text.de : text.en;
}

/** "SIP, SIP4a / SIP5a Wien": visible text first, then the full name. */
export function examChipAccessibleName(key: string | null | undefined, lang: string = 'de'): string {
  if (!isExamLabelKey(key)) return getExamLabel(key, 'full', lang);
  return `${getExamLabel(key, 'short', lang)}, ${getExamLabel(key, 'full', lang)}`;
}

/** Words that must never render as an exam name on learner surfaces. */
export const RETIRED_EXAM_WORDS = ['KP', 'KMP', 'STP', 'Qbank', 'kenntnispruefung', 'kmp_innsbruck'] as const;
