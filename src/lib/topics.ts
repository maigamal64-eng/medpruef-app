export const TOPIC_CONFIG: Record<string, { icon: string; color: string }> = {
  // SIP topics
  'Chirurgische Fächer': { icon: '🔪', color: '#EF4444' },
  'Dermatologie und Venerologie': { icon: '🧬', color: '#F59E0B' },
  'Innere Medizin': { icon: '🫀', color: '#0891B2' },
  'Neurologie': { icon: '🧠', color: '#8B5CF6' },
  'Psychiatrie': { icon: '💭', color: '#6366F1' },
  'Frauenheilkunde/Gynäkologie': { icon: '👶', color: '#EC4899' },
  'Kinder- und Jugendheilkunde': { icon: '🧒', color: '#10B981' },
  'Augenheilkunde': { icon: '👁️', color: '#06B6D4' },
  'Hals-Nasen-Ohrenheilkunde': { icon: '👂', color: '#14B8A6' },
  'Notfall- und Intensivmedizin': { icon: '🚑', color: '#EF4444' },
  // KoalaMed topic variants
  'Dermatologie': { icon: '🧬', color: '#F59E0B' },
  'Gynäkologie und Geburtshilfe': { icon: '👶', color: '#EC4899' },
  'HNO': { icon: '👂', color: '#14B8A6' },
  'Kinder und Jugendheilkunde': { icon: '🧒', color: '#10B981' },
  'Kinder und Jugendpsychiatrie': { icon: '🧒', color: '#10B981' },
  'Intensivmedizin': { icon: '🚑', color: '#EF4444' },
  'chirurgische Spezialfächer und Anästhesie': { icon: '🔪', color: '#EF4444' },
  'Allgemeine Chirurgie': { icon: '🔪', color: '#EF4444' },
}

export function getTopicConfig(topic: string) {
  return TOPIC_CONFIG[topic] || { icon: '📋', color: '#0891B2' }
}

/** Exam source definitions */
export const EXAM_SOURCES = [
  {
    id: 'SIP',
    label: 'SIP',
    fullName: 'Spezifische Interaktive Prüfung',
    questions: 7042,
    badge: '📋',
  },
  {
    id: 'KMP5b',
    label: 'KMP5b',
    fullName: 'KoalaMed KMP5b',
    questions: 672,
    badge: '🐨',
  },
  {
    id: 'KMP6a',
    label: 'KMP6a',
    fullName: 'KoalaMed KMP6a',
    questions: 2087,
    badge: '🐨',
  },
  {
    id: 'KMP6b',
    label: 'KMP6b',
    fullName: 'KoalaMed KMP6b',
    questions: 1763,
    badge: '🐨',
  },
  {
    id: 'all',
    label: 'Alle',
    fullName: 'Alle Prüfungen',
    questions: 11764,
    badge: '📚',
  },
] as const

export type ExamSourceId = typeof EXAM_SOURCES[number]['id']

/** Vienna Kenntnisprüfung exam parts */
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

export function getStoredExamSource(): ExamSourceId {
  if (typeof window === 'undefined') return 'SIP'
  const stored = localStorage.getItem(EXAM_SOURCE_KEY)
  const valid = EXAM_SOURCES.map(e => e.id) as string[]
  return (stored && valid.includes(stored) ? stored : null) as ExamSourceId | null ?? 'SIP'
}

export function hasSelectedExam(): boolean {
  if (typeof window === 'undefined') return false
  return localStorage.getItem(EXAM_SOURCE_KEY) !== null
}

export function setStoredExamSource(id: ExamSourceId): void {
  if (typeof window === 'undefined') return
  localStorage.setItem(EXAM_SOURCE_KEY, id)
}
