export const TOPIC_CONFIG: Record<string, { icon: string; color: string }> = {
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
}

export function getTopicConfig(topic: string) {
  return TOPIC_CONFIG[topic] || { icon: '📋', color: '#0891B2' }
}
