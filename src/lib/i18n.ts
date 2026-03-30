type Lang = 'de' | 'en'

const translations = {
  // Home page
  'welcome': { de: 'Willkommen zurück', en: 'Welcome back' },
  'choose_topic': { de: 'Fachgebiet wählen', en: 'Choose Specialty' },
  'all_topics': { de: 'Alle Fächer', en: 'All Topics' },
  'questions': { de: 'Fragen', en: 'Questions' },
  'daily_progress': { de: 'Tagesziel', en: 'Daily Goal' },
  'streak': { de: 'Serie', en: 'Streak' },
  'level': { de: 'Stufe', en: 'Level' },
  'stats': { de: 'Statistiken', en: 'Statistics' },
  'start_practice': { de: 'Üben starten', en: 'Start Practice' },
  'loading': { de: 'Laden...', en: 'Loading...' },
  'hello': { de: 'Hallo', en: 'Hello' },
  'accuracy': { de: 'Genauigkeit', en: 'Accuracy' },
  'to_next_level': { de: 'zum nächsten Level', en: 'to next level' },
  'quick_start': { de: 'Schnellstart — Zufälliges Thema', en: 'Quick Start — Random Topic' },
  'specialties': { de: 'Fachgebiete', en: 'Specialties' },
  'connection_error': { de: 'Verbindungsfehler', en: 'Connection error' },
  'exam_prep': { de: 'Deutsche Medizinprüfung Vorbereitung', en: 'German Medical Exam Preparation' },
  'open_in_telegram': { de: 'Öffne diese App in Telegram für den vollen Zugang.', en: 'Open this app in Telegram for full access.' },
  'questions_in_topics': { de: 'Fragen in', en: 'questions in' },
  'topics_label': { de: 'Fachgebieten', en: 'specialties' },

  // Quiz page
  'question': { de: 'Frage', en: 'Question' },
  'your_answer': { de: 'Deine Antwort', en: 'Your Answer' },
  'type_answer': { de: 'Deine Antwort eingeben (optional)...', en: 'Type your answer (optional)...' },
  'show_answer': { de: 'Antwort zeigen', en: 'Show Answer' },
  'correct_answer': { de: 'Richtige Antwort', en: 'Correct Answer' },
  'explanation': { de: 'Erklärung', en: 'Explanation' },
  'wrong': { de: 'Falsch', en: 'Wrong' },
  'correct': { de: 'Richtig', en: 'Correct' },
  'next_question': { de: 'Nächste Frage', en: 'Next Question' },
  'back_home': { de: 'Zurück', en: 'Back' },
  'xp_earned': { de: 'XP verdient', en: 'XP Earned' },
  'no_questions': { de: 'Keine Fragen verfügbar', en: 'No questions available' },
  'random': { de: 'Zufällig', en: 'Random' },
  'difficulty': { de: 'Schwierigkeit', en: 'Difficulty' },

  // Stats page
  'statistics': { de: 'Statistiken', en: 'Statistics' },
  'total_xp': { de: 'Gesamt XP', en: 'Total XP' },
  'current_streak': { de: 'Aktuelle Serie', en: 'Current Streak' },
  'days': { de: 'Tage', en: 'Days' },
  'longest_streak': { de: 'Längste Serie', en: 'Longest Streak' },
  'total_answered': { de: 'Fragen beantwortet', en: 'Questions Answered' },
  'topic_breakdown': { de: 'Nach Fachgebiet', en: 'By Specialty' },
  'no_data': { de: 'Noch keine Daten', en: 'No data yet' },

  // New keys for redesign
  'home': { de: 'Startseite', en: 'Home' },
  'quiz': { de: 'Quiz', en: 'Quiz' },
  'continue_where_left': { de: 'Weiter wo du aufgehört hast', en: 'Continue where you left off' },
  'random_quiz': { de: 'Zufälliges Quiz', en: 'Random Quiz' },
  'mock_exam': { de: 'Probeprüfung', en: 'Mock Exam' },
  'coming_soon': { de: 'Bald verfügbar', en: 'Coming Soon' },
  'recent_activity': { de: 'Letzte Aktivität', en: 'Recent Activity' },
  'quick_actions': { de: 'Schnellaktionen', en: 'Quick Actions' },
  'today': { de: 'Heute', en: 'Today' },
  'questions_today': { de: 'Fragen heute', en: 'Questions today' },
  'xp': { de: 'XP', en: 'XP' },
  'level_progress': { de: 'Level-Fortschritt', en: 'Level Progress' },
  'session_complete': { de: 'Sitzung abgeschlossen!', en: 'Session Complete!' },
  'questions_answered': { de: 'Fragen beantwortet', en: 'Questions Answered' },
  'session_accuracy': { de: 'Genauigkeit in dieser Sitzung', en: 'Session Accuracy' },
  'xp_earned_total': { de: 'XP verdient', en: 'XP Earned' },
  'continue_studying': { de: 'Weitermachen', en: 'Continue Studying' },
  'back_to_topics': { de: 'Zurück zu Fachgebieten', en: 'Back to Topics' },
  'of': { de: 'von', en: 'of' },
  'study_calendar': { de: 'Lernkalender', en: 'Study Calendar' },
  'achievements': { de: 'Erfolge', en: 'Achievements' },
  'answered': { de: 'Beantwortet', en: 'Answered' },
  'overall_accuracy': { de: 'Gesamtgenauigkeit', en: 'Overall Accuracy' },
  'navigation': { de: 'Navigation', en: 'Navigation' },
  'your_stats': { de: 'Deine Statistiken', en: 'Your Stats' },
  'topics': { de: 'Fachgebiete', en: 'Topics' },
  'q': { de: 'F', en: 'Q' },
  'session_stats': { de: 'Sitzungsstatistik', en: 'Session Stats' },
  'open_telegram': { de: 'In Telegram öffnen', en: 'Open in Telegram' },
  'demo_mode': { de: 'Demo-Modus', en: 'Demo Mode' },
  'demo_description': { de: 'Anmeldung über Telegram erforderlich für personalisierte Statistiken.', en: 'Sign in via Telegram for personalized stats.' },
  'practice_topics': { de: 'Übungsthemen', en: 'Practice Topics' },
} as const

export type TranslationKey = keyof typeof translations

export function t(key: TranslationKey, lang: Lang = 'de'): string {
  return translations[key]?.[lang] || key
}

export function getLang(): Lang {
  if (typeof window !== 'undefined') {
    return (localStorage.getItem('medpruef-lang') as Lang) || 'de'
  }
  return 'de'
}

export function setLang(lang: Lang) {
  if (typeof window !== 'undefined') {
    localStorage.setItem('medpruef-lang', lang)
  }
}
