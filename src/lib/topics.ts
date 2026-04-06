export const TOPIC_CONFIG: Record<string, { icon: string; color: string }> = {
  // SIP topics — icon values are Lucide icon names (rendered by TopicIcon component)
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
  // KoalaMed topic variants
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

/** Exam source definitions */
export const EXAM_SOURCES = [
  {
    id: 'SIP',
    label: 'SIP',
    fullName: 'Spezifische Interaktive Prüfung',
    questions: 7042,
    badge: '📋',
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
