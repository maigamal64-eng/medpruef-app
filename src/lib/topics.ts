// Topic + exam configuration for MedPrüf.
//
// The app supports multiple exam types via questions.exam_type:
//   - 'kenntnispruefung' (Vienna Austrian Kenntnisprüfung — the original product)
//   - 'pharma'           (Pharmakologie Rezeptierkunde — 335 short-answer questions)
//   - 'koalamed'         (KoalaMed KMP — reserved, importer pending)
//
// Every API call and every page respects a single "active exam" chosen via the
// ExamSelector in the header. URL-level consistency is handled by the
// `examSource` query param, whose values map 1:1 to exam_type.

export const TOPIC_CONFIG: Record<string, { icon: string; color: string }> = {
  // Kenntnisprüfung topics — icon values are Lucide icon names (rendered by TopicIcon)
  'Chirurgische Fächer': { icon: 'Scissors', color: '#D64545' },
  'Dermatologie und Venerologie': { icon: 'Dna', color: '#007B5F' },
  'Innere Medizin': { icon: 'HeartPulse', color: '#003A8C' },
  'Neurologie': { icon: 'Brain', color: '#6366F1' },
  'Psychiatrie': { icon: 'MessageCircle', color: '#8B5CF6' },
  'Frauenheilkunde/Gynäkologie': { icon: 'Baby', color: '#EC4899' },
  'Kinder- und Jugendheilkunde': { icon: 'Users', color: '#10B981' },
  'Augenheilkunde': { icon: 'Eye', color: '#0891B2' },
  'Hals-Nasen-Ohrenheilkunde': { icon: 'Ear', color: '#14B8A6' },
  'Notfall- und Intensivmedizin': { icon: 'Zap', color: '#D64545' },
  // Pharma exam (single topic)
  'Pharmakologie': { icon: 'Pill', color: '#8B5CF6' },
  // KoalaMed topic variants (kept for future)
  'Dermatologie': { icon: 'Dna', color: '#007B5F' },
  'Gynäkologie und Geburtshilfe': { icon: 'Baby', color: '#EC4899' },
  'HNO': { icon: 'Ear', color: '#14B8A6' },
  'Kinder und Jugendheilkunde': { icon: 'Users', color: '#10B981' },
  'Kinder und Jugendpsychiatrie': { icon: 'Users', color: '#10B981' },
  'Intensivmedizin': { icon: 'Zap', color: '#D64545' },
  'chirurgische Spezialfächer und Anästhesie': { icon: 'Scissors', color: '#D64545' },
  'Allgemeine Chirurgie': { icon: 'Scissors', color: '#D64545' },
}

export function getTopicConfig(topic: string) {
  return TOPIC_CONFIG[topic] || { icon: 'ClipboardList', color: '#003A8C' }
}

/**
 * Exam definitions. `id` MUST match questions.exam_type enum values.
 * The ExamSelector renders these in order. Adding a new exam here is the
 * single place you need to touch for the header dropdown.
 */
export const EXAM_SOURCES = [
  {
    id: 'kenntnispruefung',
    label: 'Kenntnisprüfung',
    fullName: 'Österreichische Kenntnisprüfung (Wien)',
    shortLabel: 'KP',
    badge: '🇦🇹',
    questions: 7661,
    description: { de: 'Wiener Kenntnisprüfung', en: 'Vienna Kenntnisprüfung' },
  },
  {
    id: 'pharma',
    label: 'Pharma',
    fullName: 'Pharmakologie Rezeptierkunde',
    shortLabel: 'Pharma',
    badge: '💊',
    questions: 335,
    description: { de: 'Rezeptierkunde / Stichpunkte', en: 'Prescription Studies' },
  },
  {
    id: 'koalamed',
    label: 'KoalaMed',
    fullName: 'KoalaMed KMP',
    shortLabel: 'KMP',
    badge: '🐨',
    questions: 0,
    description: { de: 'KoalaMed Modulprüfungen (in Vorbereitung)', en: 'KoalaMed KMP (coming soon)' },
  },
] as const

export type ExamSourceId = typeof EXAM_SOURCES[number]['id']
export const EXAM_SOURCE_IDS: ExamSourceId[] = EXAM_SOURCES.map(e => e.id) as ExamSourceId[]
export const DEFAULT_EXAM_SOURCE: ExamSourceId = 'kenntnispruefung'

export function getExamSource(id: string): typeof EXAM_SOURCES[number] | undefined {
  return EXAM_SOURCES.find(e => e.id === id)
}

/** Vienna Kenntnisprüfung exam parts (only meaningful when examSource='kenntnispruefung') */
export const VIENNA_EXAM_PARTS: Record<'sip4' | 'sip5', string[]> = {
  sip4: [
    'Chirurgische Fächer',
    'Innere Medizin',
    'Dermatologie und Venerologie',
  ],
  sip5: [
    'Augenheilkunde',
    'Hals-Nasen-Ohrenheilkunde',
    'Psychiatrie',
    'Notfall- und Intensivmedizin',
    'Frauenheilkunde/Gynäkologie',
    'Kinder- und Jugendheilkunde',
    'Neurologie',
  ],
}

export const EXAM_SOURCE_KEY = 'medpruef_exam_source'

/**
 * Resolve the stored exam source. Migrates legacy 'SIP' → 'kenntnispruefung'
 * so existing users don't lose their selection on first load.
 */
export function getStoredExamSource(): ExamSourceId {
  if (typeof window === 'undefined') return DEFAULT_EXAM_SOURCE
  const stored = localStorage.getItem(EXAM_SOURCE_KEY)
  if (!stored) return DEFAULT_EXAM_SOURCE
  // Legacy migration
  if (stored === 'SIP') {
    localStorage.setItem(EXAM_SOURCE_KEY, DEFAULT_EXAM_SOURCE)
    return DEFAULT_EXAM_SOURCE
  }
  if ((EXAM_SOURCE_IDS as string[]).includes(stored)) {
    return stored as ExamSourceId
  }
  return DEFAULT_EXAM_SOURCE
}

export function hasSelectedExam(): boolean {
  if (typeof window === 'undefined') return false
  const stored = localStorage.getItem(EXAM_SOURCE_KEY)
  return stored !== null && stored !== 'SIP'
}

export function setStoredExamSource(id: ExamSourceId): void {
  if (typeof window === 'undefined') return
  localStorage.setItem(EXAM_SOURCE_KEY, id)
}
