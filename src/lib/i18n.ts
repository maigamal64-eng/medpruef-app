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

  // Navigation new pages
  'exam': { de: 'Prüfung', en: 'Exam' },
  'about': { de: 'Über uns', en: 'About' },
  'materials': { de: 'Materialien', en: 'Materials' },
  'profile': { de: 'Profil', en: 'Profile' },

  // Exam simulation
  'exam_sim_title': { de: 'Prüfungssimulation', en: 'Exam Simulation' },
  'exam_sim_desc': { de: '250 Fragen · 10 Fachgebiete · 4 Stunden', en: '250 questions · 10 specialties · 4 hours' },
  'start_exam': { de: 'Prüfung starten', en: 'Start Exam' },
  'time_remaining': { de: 'Verbleibende Zeit', en: 'Time Remaining' },
  'exam_submit': { de: 'Prüfung abgeben', en: 'Submit Exam' },
  'exam_submit_confirm': { de: 'Prüfung wirklich abgeben? Nicht beantwortete Fragen zählen als falsch.', en: 'Really submit? Unanswered questions count as wrong.' },
  'exam_finished': { de: 'Prüfung abgeschlossen', en: 'Exam Completed' },
  'exam_result': { de: 'Dein Ergebnis', en: 'Your Result' },
  'exam_passed': { de: 'Bestanden ✓', en: 'Passed ✓' },
  'exam_failed': { de: 'Nicht bestanden', en: 'Not Passed' },
  'pass_threshold': { de: '60% zum Bestehen erforderlich', en: '60% required to pass' },
  'review_answers': { de: 'Antworten überprüfen', en: 'Review Answers' },
  'exam_new': { de: 'Neue Prüfung', en: 'New Exam' },
  'exam_loading': { de: 'Prüfung wird vorbereitet...', en: 'Preparing exam...' },
  'unanswered': { de: 'Nicht beantwortet', en: 'Unanswered' },
  'specialty_results': { de: 'Ergebnis nach Fachgebiet', en: 'Results by Specialty' },
  'time_up': { de: 'Zeit abgelaufen!', en: 'Time is up!' },

  // QuestionCard notes & favorites
  'add_note': { de: 'Notiz hinzufügen', en: 'Add Note' },
  'note_placeholder': { de: 'Persönliche Notiz zu dieser Frage...', en: 'Personal note for this question...' },
  'note_saved': { de: 'Gespeichert', en: 'Saved' },
  'save_note': { de: 'Speichern', en: 'Save' },
  'bookmark': { de: 'Merken', en: 'Bookmark' },
  'bookmarked': { de: 'Gemerkt', en: 'Bookmarked' },

  // Profile page
  'edit': { de: 'Bearbeiten', en: 'Edit' },
  'save': { de: 'Speichern', en: 'Save' },
  'cancel': { de: 'Abbrechen', en: 'Cancel' },
  'university': { de: 'Universität', en: 'University' },
  'country_of_origin': { de: 'Herkunftsland', en: 'Country of Origin' },
  'target_exam_date': { de: 'Ziel-Prüfungsdatum', en: 'Target Exam Date' },
  'select_university': { de: 'Universität wählen', en: 'Select university' },
  'select_country': { de: 'Land eingeben', en: 'Enter country' },
  'favorites': { de: 'Gemerkte Fragen', en: 'Bookmarked Questions' },
  'no_favorites': { de: 'Noch keine gemerkten Fragen', en: 'No bookmarked questions yet' },
  'profile_not_logged_in': { de: 'Bitte melde dich an, um dein Profil zu sehen', en: 'Please sign in to view your profile' },
  'progress_overview': { de: 'Fortschrittsübersicht', en: 'Progress Overview' },

  // Materials page
  'study_resources': { de: 'Lernmaterialien', en: 'Study Materials' },
  'exam_guidelines': { de: 'Prüfungsrichtlinien', en: 'Exam Guidelines' },
  'preparation_tips': { de: 'Vorbereitungstipps', en: 'Preparation Tips' },
  'official_resources': { de: 'Offizielle Ressourcen', en: 'Official Resources' },
  'by_specialty': { de: 'Nach Fachgebiet', en: 'By Specialty' },

  // About page
  'about_title': { de: 'Über MedPrüf', en: 'About MedPrüf' },
  'about_description': { de: 'Lernplattform für die Kenntnisprüfung', en: 'Learning platform for the Kenntnisprüfung' },
  'contact': { de: 'Kontakt', en: 'Contact' },
  'team': { de: 'Team', en: 'Team' },
  'social_media': { de: 'Social Media', en: 'Social Media' },

  // Search
  'search_placeholder': { de: 'Frage suchen...', en: 'Search questions...' },
  'search_results': { de: 'Suchergebnisse', en: 'Search Results' },
  'no_search_results': { de: 'Keine Ergebnisse gefunden', en: 'No results found' },

  // Vienna exam parts
  'sip4_label': { de: 'SIP 4 — Teil 1', en: 'SIP 4 — Part 1' },
  'sip5_label': { de: 'SIP 5 — Teil 2', en: 'SIP 5 — Part 2' },
  'practice_sip4': { de: 'SIP 4 üben', en: 'Practice SIP 4' },
  'practice_sip5': { de: 'SIP 5 üben', en: 'Practice SIP 5' },
  'all_parts': { de: 'Alle Teile', en: 'All Parts' },
  'exam_part_selector': { de: 'Prüfungsteil wählen', en: 'Choose Exam Part' },

  // Stats enhancements
  'study_time_est': { de: 'Geschätzte Lernzeit', en: 'Estimated Study Time' },
  'completion_pct': { de: 'Gesamtfortschritt', en: 'Overall Progress' },
  'questions_per_specialty': { de: 'Fragen pro Fachgebiet', en: 'Questions per Specialty' },
  'weekly_activity': { de: 'Wochenaktivität', en: 'Weekly Activity' },
  'sign_in_for_stats': { de: 'Melde dich an um Statistiken zu sehen', en: 'Sign in to see statistics' },
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
