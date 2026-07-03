import { useEffect, useState } from 'react'
import { EXTRA_TRANSLATIONS, RTL_LANGS } from './i18n-extra'

/**
 * Supported UI languages. `de`/`en` are the fully-authored base (every key
 * present in the `translations` map below). The additional codes are served
 * from the additive `EXTRA_TRANSLATIONS` overlay (src/lib/i18n-extra.ts):
 * any key missing there falls back to English, then German, so a partial
 * translation can never render a blank string. `ar` is RTL and, per [name]'s
 * standing rule, stays behind LIVE_LANGS review before it appears in the
 * public picker.
 */
export type Lang = 'de' | 'en' | 'ru' | 'uk' | 'tr' | 'ar'

/**
 * Languages shown in the public language picker. de/en authored; ru/tr have
 * full translator overlays. uk is added the moment its overlay lands; ar only
 * after [name] signs off on the wording (standing rule).
 */
export const LIVE_LANGS: readonly Lang[] = ['de', 'en', 'ru', 'uk', 'tr']

export const LANG_LABELS: Record<Lang, string> = {
  de: 'Deutsch',
  en: 'English',
  ru: 'Русский',
  uk: 'Українська',
  tr: 'Türkçe',
  ar: 'العربية',
}

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
  'quick_start': { de: 'Schnellstart: Zufälliges Thema', en: 'Quick Start: Random Topic' },
  'specialties': { de: 'Fachgebiete', en: 'Specialties' },
  'connection_error': { de: 'Verbindungsfehler', en: 'Connection error' },
  'exam_prep': { de: 'Österreichische Kenntnisprüfung Vorbereitung (Wien)', en: 'Austrian Kenntnisprüfung Preparation (Vienna)' },
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
  'mock_exam': { de: 'Prüfung testen', en: 'Test yourself (Mock Exam)' },
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
  'exam_sim_desc': { de: 'Vollständige Prüfungssimulation · 4 Stunden', en: 'Full exam simulation · 4 hours' },
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
  'sip4_label': { de: 'SIP 4: Teil 1', en: 'SIP 4: Part 1' },
  'sip5_label': { de: 'SIP 5: Teil 2', en: 'SIP 5: Part 2' },
  'practice_sip4': { de: 'SIP 4 üben', en: 'Practice SIP 4' },
  'practice_sip5': { de: 'SIP 5 üben', en: 'Practice SIP 5' },
  'all_parts': { de: 'Alle Teile', en: 'All Parts' },
  'exam_part_selector': { de: 'Prüfungsteil wählen', en: 'Choose Exam Part' },

  // Custom exam builder
  'custom_exam': { de: 'Eigene', en: 'Custom' },
  'custom_exam_label': { de: 'Eigene Auswahl: filtern', en: 'Custom: filter questions' },
  'custom_subjects': { de: 'Fachgebiete', en: 'Subjects' },
  'custom_tags': { de: 'Tags (Komma-getrennt)', en: 'Tags (comma-separated)' },
  'custom_date_range': { de: 'Prüfungsdatum (Zeitraum)', en: 'Exam date range' },
  'custom_date_from': { de: 'Von', en: 'From' },
  'custom_date_to': { de: 'Bis', en: 'To' },
  'custom_bookmarks_only': { de: 'Nur gemerkte Fragen', en: 'Bookmarked only' },
  'custom_notes_only': { de: 'Nur Fragen mit Notizen', en: 'Questions with notes only' },
  'custom_size': { de: 'Anzahl Fragen', en: 'Number of questions' },
  'custom_search_label': { de: 'Im Text suchen', en: 'Search in text' },
  'custom_matching': { de: 'passende Fragen', en: 'matching questions' },
  'custom_no_matches': { de: 'Keine passenden Fragen', en: 'No matching questions' },
  'custom_loading_count': { de: 'Zählt…', en: 'Counting…' },

  // Stats enhancements
  'study_time_est': { de: 'Geschätzte Lernzeit', en: 'Estimated Study Time' },
  'completion_pct': { de: 'Gesamtfortschritt', en: 'Overall Progress' },
  'questions_per_specialty': { de: 'Fragen pro Fachgebiet', en: 'Questions per Specialty' },
  'weekly_activity': { de: 'Wochenaktivität', en: 'Weekly Activity' },
  'sign_in_for_stats': { de: 'Melde dich an um Statistiken zu sehen', en: 'Sign in to see statistics' },

  // Progress dashboard
  'progress': { de: 'Fortschritt', en: 'Progress' },
  'progress_title': { de: 'Lernfortschritt', en: 'Learning Progress' },
  'current_streak_label': { de: 'Aktuelle Serie', en: 'Current Streak' },
  'level_and_xp': { de: 'Level & XP', en: 'Level & XP' },
  'topic_progress': { de: 'Fortschritt nach Fachgebiet', en: 'Progress by Specialty' },
  'sort_by_accuracy': { de: 'Nach Genauigkeit', en: 'By Accuracy' },
  'sort_by_count': { de: 'Nach Anzahl', en: 'By Count' },
  'bookmarked_questions': { de: 'Gemerkte Fragen', en: 'Bookmarked Questions' },
  'my_notes': { de: 'Meine Notizen', en: 'My Notes' },
  'no_bookmarks': { de: 'Noch keine Lesezeichen: markiere Fragen mit \u2605 beim Lernen', en: 'No bookmarks yet: star \u2605 questions while studying' },
  'no_notes': { de: 'Noch keine Notizen: füge Notizen beim Lernen hinzu', en: 'No notes yet: add notes while reviewing answers' },
  'exam_readiness': { de: 'Prüfungsbereitschaft', en: 'Exam Readiness' },
  'days_until_exam': { de: 'Tage bis zur Prüfung', en: 'Days until exam' },
  'practice_weak': { de: 'Schwächen üben', en: 'Practice Weak Topics' },
  'of_total': { de: 'von gesamt', en: 'of total' },
  'correct_of': { de: 'richtig von', en: 'correct of' },

  // Settings page
  'settings': { de: 'Einstellungen', en: 'Settings' },
  'appearance': { de: 'Darstellung', en: 'Appearance' },
  'dark_mode': { de: 'Dunkelmodus', en: 'Dark Mode' },
  'language': { de: 'Sprache', en: 'Language' },
  'study_preferences': { de: 'Lerneinstellungen', en: 'Study Preferences' },
  'daily_goal_setting': { de: 'Tagesziel (Fragen)', en: 'Daily Goal (Questions)' },
  'exam_target_date': { de: 'Prüfungstermin', en: 'Exam Target Date' },
  'exam_source_label': { de: 'Prüfungsquelle', en: 'Exam Source' },
  'notifications': { de: 'Benachrichtigungen', en: 'Notifications' },
  'coming_soon_label': { de: 'Bald verfügbar', en: 'Coming Soon' },
  'daily_reminder': { de: 'Tägliche Erinnerung', en: 'Daily Reminder' },
  'streak_warning': { de: 'Serie-Warnung', en: 'Streak Warning' },
  'weekly_progress_notif': { de: 'Wöchentlicher Fortschritt', en: 'Weekly Progress' },
  'data_privacy': { de: 'Daten & Datenschutz', en: 'Data & Privacy' },
  'clear_data': { de: 'Lerndaten löschen', en: 'Clear Study Data' },
  'clear_data_confirm': { de: 'Alle lokalen Lerndaten wirklich löschen? Dies kann nicht rückgängig gemacht werden.', en: 'Really clear all local study data? This cannot be undone.' },
  'data_cleared': { de: 'Daten gelöscht', en: 'Data Cleared' },
  'export_progress': { de: 'Fortschritt exportieren', en: 'Export Progress' },
  'logout': { de: 'Abmelden', en: 'Sign Out' },
  'app_version': { de: 'App-Version', en: 'App Version' },

  // Flashcards page
  'flashcards': { de: 'Karteikarten', en: 'Flashcards' },
  'flip_card': { de: 'Karte umdrehen', en: 'Flip Card' },
  'tap_to_flip': { de: 'Tippe zum Umdrehen', en: 'Tap to flip' },
  'again': { de: 'Nochmal', en: 'Again' },
  'hard': { de: 'Schwer', en: 'Hard' },
  'good': { de: 'Gut', en: 'Good' },
  'easy': { de: 'Einfach', en: 'Easy' },
  'flashcard_hint': { de: 'Wie gut konntest du die Antwort?', en: 'How well did you know the answer?' },
  'cards_today': { de: 'Karten heute', en: 'Cards today' },

  // Curriculum page
  'curriculum': { de: 'Lehrplan', en: 'Curriculum' },
  'curriculum_title': { de: 'Lehrplan-Übersicht', en: 'Curriculum Map' },
  'total_questions_label': { de: 'Fragen gesamt', en: 'Total Questions' },
  'completion': { de: 'Abschluss', en: 'Completion' },
  'start_practice_topic': { de: 'Üben starten', en: 'Start Practice' },
  'random_practice': { de: 'Zufällige Übung', en: 'Random Practice' },
  'start_exam_simulation': { de: 'Prüfungssimulation starten', en: 'Start Exam Simulation' },

  // Landing page
  'landing_hero_title': { de: 'Bestehe deine Kenntnisprüfung', en: 'Pass Your Kenntnisprüfung' },
  'landing_hero_subtitle': { de: 'Auf Deutsch oder Englisch lernen, nach österreichischen Standards entwickelt', en: 'Study in German or English, built to Austrian standards' },
  'landing_cta': { de: 'Kostenlos starten', en: 'Start Free' },
  'landing_cta_sub': { de: 'Keine Kreditkarte erforderlich', en: 'No Credit Card Required' },
  'landing_questions_badge': { de: '10.000+ Fragen', en: '10,000+ Questions' },
  'landing_updated_badge': { de: 'Aktualisiert 2026', en: 'Updated 2026' },
  'landing_specialties_badge': { de: '16 Fachgebiete', en: '16 Specialties' },
  'landing_social_proof': { de: '2.400+ Ärzte dabei', en: '2,400+ doctors joined' },
  'landing_problem_title': { de: 'Wir wissen, wie schwer dieser Weg ist', en: 'We Know How Hard This Journey Is' },
  'landing_problem_1': { de: 'Lernen in einer Zweitsprache', en: 'Studying in a second language' },
  'landing_problem_2': { de: 'Verstreute Lernmaterialien', en: 'Scattered study resources' },
  'landing_problem_3': { de: 'Eine einzigartige Prüfung', en: 'A unique exam format' },
  'landing_problem_transition': { de: 'Deshalb haben wir MedPrüf entwickelt', en: "That's why we built MedPrüf" },
  'landing_features_title': { de: 'Funktionen', en: 'Features' },
  'landing_feature_arabic': { de: 'Zweisprachige Erklärungen', en: 'Bilingual Explanations' },
  'landing_feature_arabic_desc': { de: 'Jede Erklärung auf Deutsch und Englisch, damit du die Konzepte wirklich verstehst', en: 'Every explanation in German and English so you truly understand the concepts' },
  'landing_feature_realistic': { de: 'Prüfungsnahe Fragen', en: 'Exam-Realistic Questions' },
  'landing_feature_realistic_desc': { de: 'Fragen im Stil der echten Kenntnisprüfung mit allen Formaten', en: 'Questions matching the real exam format and difficulty' },
  'landing_feature_analytics': { de: 'Leistungsanalyse', en: 'Performance Analytics' },
  'landing_feature_analytics_desc': { de: 'Verfolge deinen Fortschritt und erkenne Schwächen', en: 'Track your progress and identify weak areas' },
  'landing_feature_mobile': { de: 'Überall lernen', en: 'Study Anywhere' },
  'landing_feature_mobile_desc': { de: 'Optimiert für Handy, Tablet und Desktop', en: 'Optimized for phone, tablet, and desktop' },
  'landing_feature_plan': { de: 'Personalisierter Plan', en: 'Personalized Plan' },
  'landing_feature_plan_desc': { de: 'KI-gestützter Lernplan basierend auf deinen Stärken und Schwächen', en: 'AI-powered study plan based on your strengths and weaknesses' },
  'landing_testimonials_title': { de: 'Ärzte, die bestanden haben', en: 'Doctors Who Passed' },
  'landing_pricing_title': { de: 'Preise', en: 'Pricing' },
  'landing_pricing_free': { de: 'Kostenlos', en: 'Free' },
  'landing_pricing_pro': { de: 'Pro', en: 'Pro' },
  'landing_pricing_group': { de: 'Gruppe', en: 'Group' },
  'landing_pricing_popular': { de: 'Am beliebtesten', en: 'Most Popular' },
  'landing_pricing_free_desc': { de: '50 Fragen/Monat', en: '50 questions/month' },
  'landing_pricing_pro_desc': { de: 'Voller Zugang', en: 'Full access' },
  'landing_pricing_group_desc': { de: 'Kontaktiere uns', en: 'Contact Us' },
  'landing_final_cta': { de: 'Deine Prüfung wartet nicht: Fang heute an', en: "Your Exam Won't Wait: Start Today" },
  'landing_footer_tagline': { de: 'Dein Weg zur österreichischen Approbation', en: 'Your path to Austrian medical licensure' },
  'landing_footer_disclaimer': { de: 'Nicht affiliiert mit einer Ärztekammer', en: 'Not affiliated with any Ärztekammer' },
  'landing_pass_rate': { de: '92% Bestehensquote', en: '92% pass rate' },
  'landing_coming_soon_tag': { de: 'Bald verfügbar', en: 'Coming soon' },
  'privacy': { de: 'Datenschutz', en: 'Privacy' },
  'shortcut_guide': { de: 'Tastenkürzel', en: 'Keyboard Shortcuts' },
  'press_to_close': { de: 'Drücke Esc zum Schließen', en: 'Press Esc to close' },
  'cookie_banner': { de: 'Wir nutzen anonyme Analysen, um MedPrüf in der Beta zu verbessern. Du kannst jederzeit ablehnen.', en: 'We use anonymous analytics to improve MedPrüf during beta. You can decline anytime.' },

  // Exam deadline reminder (lead magnet)
  'reminder_title': { de: 'Verpass die Anmeldefrist nicht', en: 'Do not miss the registration deadline' },
  'reminder_next': { de: 'Nächster Termin:', en: 'Next exam:' },
  'reminder_deadline': { de: 'Anmeldeschluss', en: 'registration closes' },
  'reminder_days_left': { de: 'Tage', en: 'days left' },
  'reminder_email_placeholder': { de: 'Deine E-Mail-Adresse', en: 'Your email address' },
  'reminder_cta': { de: 'Erinnere mich', en: 'Remind me' },
  'reminder_sending': { de: 'Wird gesendet...', en: 'Sending...' },
  'reminder_done': { de: 'Erledigt. Wir melden uns rechtzeitig vor der Frist.', en: 'Done. We will remind you in good time before the deadline.' },
  'reminder_error': { de: 'Etwas ist schiefgelaufen. Bitte versuch es erneut.', en: 'Something went wrong. Please try again.' },
  'reminder_privacy': { de: 'Nur Fristerinnerungen. Kein Spam, jederzeit abbestellbar.', en: 'Deadline reminders only. No spam, unsubscribe anytime.' },
  'cookie_accept': { de: 'Akzeptieren', en: 'Accept' },
  'cookie_decline': { de: 'Ablehnen', en: 'Decline' },
  'privacy_policy': { de: 'Datenschutz', en: 'Privacy Policy' },
  'terms_of_service': { de: 'Nutzungsbedingungen', en: 'Terms of Service' },
  'impressum': { de: 'Impressum', en: 'Legal Notice' },
  'exam_countdown': { de: 'Prüfungs-Countdown', en: 'Exam Countdown' },
  'helpful': { de: 'Hilfreich', en: 'Helpful' },
  'not_helpful': { de: 'Nicht hilfreich', en: 'Not helpful' },
  'timed_practice': { de: 'Zeitübung', en: 'Timed Practice' },
  'select_duration': { de: 'Dauer wählen', en: 'Select Duration' },
  'questions_count': { de: 'Fragenanzahl', en: 'Number of Questions' },
  'time_limit': { de: 'Zeitlimit', en: 'Time Limit' },
  'start_timed': { de: 'Zeitübung starten', en: 'Start Timed Practice' },
  'time_up_submit': { de: 'Zeit abgelaufen! Automatisch abgegeben.', en: 'Time is up! Auto-submitted.' },
  'avg_time_per_q': { de: 'Ø Zeit pro Frage', en: 'Avg. time per question' },
  'streak_freeze': { de: 'Serie einfrieren', en: 'Freeze Streak' },
  'freeze_available': { de: 'Einfrierung verfügbar', en: 'Freeze available' },
  'freeze_used': { de: 'Serie eingefroren ✓', en: 'Streak frozen ✓' },
  'pro_feature': { de: 'Pro-Feature', en: 'Pro Feature' },

  // Dashboard redesign (Apr 23) — premium/calm tone
  'dashboard_greeting_morning': { de: 'Guten Morgen', en: 'Good morning' },
  'dashboard_greeting_afternoon': { de: 'Guten Tag', en: 'Good afternoon' },
  'dashboard_greeting_evening': { de: 'Guten Abend', en: 'Good evening' },
  'dashboard_subtitle': { de: 'Bereit für die nächste Runde?', en: 'Ready for the next round?' },
  'continue_studying_cta': { de: 'Weiterlernen', en: 'Continue' },
  'next_question_cta': { de: 'Nächste Frage', en: 'Next question' },
  'start_a_session': { de: 'Sitzung starten', en: 'Start a session' },
  'coach_weak_topic_title': { de: 'Fokus-Empfehlung', en: 'Focus Recommendation' },
  'coach_weak_topic_body': { de: '{topic} steht auf {acc}%: 10 gezielte Fragen können dich sichtbar voranbringen.', en: '{topic} is at {acc}%: 10 focused questions can move the needle.' },
  'coach_practice_10': { de: '10 Fragen üben', en: 'Practice 10 questions' },
  'ahead_of_cohort': { de: 'Du liegst vor {pct}% der Prüfungs-Kohorte bei {topic}.', en: "You're ahead of {pct}% of the Exam Cohort on {topic}." },
  'review_bookmarks': { de: 'Lesezeichen', en: 'Bookmarks' },
  'review_mistakes': { de: 'Fehler wiederholen', en: 'Review mistakes' },
  'review_bookmarks_hint': { de: 'Gespeicherte Fragen', en: 'Saved questions' },
  'review_mistakes_hint': { de: 'Falsch beantwortet', en: 'Got wrong last time' },
  'lernplan_title': { de: 'Dein Lernplan', en: 'Your Study Plan' },
  'lernplan_subtitle': { de: 'Tagesplan bis zur Prüfung', en: 'Day-by-day to exam day' },
  'sprache_wechseln': { de: 'Sprache wechseln', en: 'Switch language' },
  'thema_wechseln': { de: 'Thema wechseln', en: 'Toggle theme' },
  'suche_oeffnen': { de: 'Suche öffnen', en: 'Open search' },
  'welcome_cohort_title': { de: 'Willkommen in der Prüfungs-Kohorte', en: 'Welcome to the Exam Cohort' },
  'welcome_cohort_body': { de: 'Dein Vollzugang ist 6 Monate lang aktiv, inkl. Pass-Until-You-Pass.', en: 'Your full access is active for 6 months, with Pass-Until-You-Pass.' },
  'view_full_progress': { de: 'Vollständigen Fortschritt ansehen', en: 'View full progress' },
  'progress_to_next_rank': { de: 'Fortschritt zum nächsten Rang', en: 'Progress to next rank' },

  // Onboarding
  'onb_step_label': { de: 'Schritt {current} von {total}', en: 'Step {current} of {total}' },
  'onb_back': { de: 'Zurück', en: 'Back' },
  'onb_next': { de: 'Weiter', en: 'Next' },
  'onb_skip': { de: 'Überspringen', en: 'Skip' },
  'onb_finish': { de: 'Los geht\'s!', en: "Let's go!" },
  'onb_step1_title': { de: 'Welche Prüfung machst du?', en: 'Which exam are you taking?' },
  'onb_step1_subtitle': { de: 'Wir richten deine Inhalte und deinen Lernplan danach aus.', en: 'We tailor your content and study plan to it.' },
  'onb_step2_title': { de: 'Wann ist deine Prüfung?', en: 'When is your exam?' },
  'onb_step2_subtitle': { de: 'Für deinen persönlichen Lernplan', en: 'For your personalized study plan' },
  'onb_step3_title': { de: 'Tägliches Lernziel', en: 'Daily study goal' },
  'onb_step3_subtitle': { de: 'Wie viele Fragen pro Tag?', en: 'How many questions per day?' },
  'onb_step4_title': { de: 'Dein Wissensstand', en: 'Your current level' },
  'onb_step4_subtitle': { de: 'Damit wir den richtigen Start finden', en: 'So we find the right starting point' },
  'onb_step5_title': { de: 'Personalisierung', en: 'Personalization' },
  'onb_step5_subtitle': { de: 'Deine Einstellungen', en: 'Your preferences' },
  'onb_exam_primary_desc': { de: 'Kenntnisprüfung Medizin (Wien, Österreich)', en: 'Medical Knowledge Exam (Vienna, Austria)' },
  'onb_exam_kmp_desc': { de: 'Nationaler Stichprobentest, Fragen aus dem Innsbruck-Curriculum', en: 'National Stichprobentest, questions from the Innsbruck curriculum' },
  'onb_exam_pharma_desc': { de: 'Pharmakologie · Rezeptierkunde', en: 'Pharmacology · Prescription Studies' },
  'onb_exam_questions_label': { de: 'Fragen', en: 'questions' },
  'onb_exam_specialties_label': { de: 'Fachgebiete', en: 'specialties' },
  'onb_more_exams': { de: 'Weitere Prüfungen', en: 'More exams' },
  'onb_coming_soon': { de: 'Bald verfügbar', en: 'Coming soon' },
  'onb_soon_badge': { de: 'Bald', en: 'Soon' },
  'onb_exam_change_later': { de: 'Du kannst dies jederzeit in den Einstellungen ändern.', en: 'You can change this anytime in Settings.' },
  'onb_date_1month': { de: 'In 1 Monat', en: 'In 1 month' },
  'onb_date_3months': { de: 'In 3 Monaten', en: 'In 3 months' },
  'onb_date_6months': { de: 'In 6 Monaten', en: 'In 6 months' },
  'onb_date_not_planned': { de: 'Noch nicht geplant', en: 'Not planned yet' },
  'onb_date_custom': { de: 'Anderes Datum', en: 'Custom date' },
  'onb_goal_qpd': { de: 'Fragen pro Tag', en: 'questions per day' },
  'onb_goal_relaxed': { de: '🌱 Entspannt, perfekt zum Anfangen', en: '🌱 Relaxed, perfect to start' },
  'onb_goal_recommended': { de: '📚 Empfohlen, gute Balance', en: '📚 Recommended, good balance' },
  'onb_goal_intense': { de: '🔥 Intensiv, schneller Fortschritt', en: '🔥 Intense, fast progress' },
  'onb_goal_hardcore': { de: '⚡ Hardcore, maximaler Fortschritt', en: '⚡ Hardcore, maximum progress' },
  'onb_level_beginner': { de: 'Anfänger', en: 'Beginner' },
  'onb_level_beginner_desc': { de: 'Ich fange gerade an', en: 'Just starting my preparation' },
  'onb_level_intermediate': { de: 'Mittelstufe', en: 'Intermediate' },
  'onb_level_intermediate_desc': { de: 'Ich habe schon etwas gelernt', en: "I've done some studying already" },
  'onb_level_advanced': { de: 'Fortgeschritten', en: 'Advanced' },
  'onb_level_advanced_desc': { de: 'Will mich perfektionieren', en: 'Fine-tuning my knowledge' },
  'onb_language_label': { de: 'Sprache', en: 'Language' },
  'onb_dark_mode_title': { de: 'Dunkles Design', en: 'Dark Mode' },
  'onb_dark_mode_desc': { de: 'Augen schonen beim Nachtlernen', en: 'Easy on eyes for night study' },
  'onb_summary_label': { de: 'Zusammenfassung', en: 'Summary' },
  'onb_summary_not_planned': { de: 'Noch nicht geplant', en: 'Not planned' },
  'onb_summary_not_selected': { de: 'Nicht gewählt', en: 'Not selected' },
  'onb_summary_qpd': { de: 'Fragen/Tag', en: 'questions/day' },

  // Generic UI
  'close': { de: 'Schließen', en: 'Close' },
  'confirm': { de: 'Bestätigen', en: 'Confirm' },
  'submit': { de: 'Absenden', en: 'Submit' },
  'sending': { de: 'Wird gesendet…', en: 'Sending…' },
  'retry': { de: 'Erneut versuchen', en: 'Retry' },
  'ok': { de: 'OK', en: 'OK' },
  'yes': { de: 'Ja', en: 'Yes' },
  'no': { de: 'Nein', en: 'No' },
  'copy': { de: 'Kopieren', en: 'Copy' },
  'copied': { de: 'Kopiert', en: 'Copied' },
  'share': { de: 'Teilen', en: 'Share' },
  'continue': { de: 'Weiter', en: 'Continue' },
  'something_went_wrong': { de: 'Etwas ist schiefgelaufen. Bitte versuche es erneut.', en: 'Something went wrong. Please try again.' },
  'network_error': { de: 'Netzwerkfehler, bitte erneut versuchen.', en: 'Network error, please try again.' },

  // Toast messages (common)
  'toast_saved': { de: 'Gespeichert', en: 'Saved' },
  'toast_copied_to_clipboard': { de: 'In die Zwischenablage kopiert', en: 'Copied to clipboard' },
  'toast_feedback_sent': { de: 'Feedback gesendet, danke!', en: 'Feedback sent, thanks!' },
  'toast_feedback_failed': { de: 'Feedback konnte nicht gesendet werden.', en: 'Could not send feedback.' },
  'toast_report_sent': { de: 'Meldung gesendet', en: 'Report sent' },
  'toast_report_failed': { de: 'Meldung fehlgeschlagen', en: 'Report failed' },

  // Orientation modal
  'orient_title': { de: 'Willkommen bei MedPrüf', en: 'Welcome to MedPrüf' },
  'orient_subtitle': { de: 'Zwei Dinge, die du wissen solltest, bevor du loslegst.', en: 'Two things to know before you start.' },
  'orient_item1_title': { de: 'Bestehe beim ersten Versuch, oder lerne kostenlos weiter, bis du bestehst.', en: 'Pass on your first try, or keep learning free until you do.' },
  'orient_item1_body': { de: 'Wenn du in der Prüfungs-Kohorte oder im Jahresabo nicht bestehst, verlängern wir deinen Zugang kostenlos bis zum nächsten Prüfungszyklus.', en: "If you're on the Exam Cohort or annual plan and don't pass, we extend your access free until the next exam cycle." },
  'orient_item1_link': { de: 'So funktioniert\'s', en: 'How it works' },
  'orient_item2_title': { de: '150 kostenlose Fragen pro Prüfungstyp.', en: '150 free questions per exam type.' },
  'orient_item2_body': { de: 'Keine Zahlungsmittel nötig. Voller Zugriff auf Erklärungen. Kein Zeitlimit: lerne in deinem Tempo.', en: 'No payment required. Full access to explanations. No time limit: learn at your own pace.' },
  'orient_item2_link': { de: 'Jetzt üben', en: 'Start practicing' },
  'orient_learn_more_link': { de: 'Mehr erfahren', en: 'Learn more' },
  'orient_primary_cta': { de: 'Weiterlernen', en: 'Keep learning' },
  'orient_secondary_cta': { de: 'Pläne später ansehen', en: 'View plans later' },

  // Paywall modal
  'paywall_title': { de: '150 Fragen erreicht', en: '150 questions reached' },
  'paywall_body': { de: 'Dein Gratis-Kontingent ist aufgebraucht. Hol dir vollen Zugang, inkl. Pass-Until-You-Pass Garantie.', en: "You've used your free allowance. Unlock full access, with our Pass-Until-You-Pass guarantee." },
  'paywall_cta': { de: 'Zugang freischalten', en: 'Unlock access' },
  'paywall_later': { de: 'Später', en: 'Later' },

  // WhatsNew modal
  'whats_new_title': { de: 'Was ist neu bei MedPrüf', en: "What's New in MedPrüf" },
  'whats_new_subtitle': { de: 'Update April 2026', en: 'April 2026 Update' },
  'whats_new_dismiss': { de: 'Alles klar, los geht\'s', en: "Got it, let's study" },
  'whats_new_view_all': { de: 'Alle Änderungen', en: 'View all changes' },
  'whatsnew_offline_title': { de: 'Offline-Modus ist live: Fragen vorab herunterladen', en: 'Offline mode is live: download questions in advance' },
  'whatsnew_offline_body': { de: 'Lade 100 bis 500 Fragen vorab in Einstellungen → Offline-Modus. Dann kannst du im Zug, Flugzeug oder in der Kaffeepause lernen, auch ohne WLAN. Deine Antworten werden synchronisiert, sobald du wieder online bist.', en: 'Download 100 to 500 questions in advance in Settings → Offline mode. Then you can study on the train, on a plane, or on a coffee break, even without Wi-Fi. Your answers sync as soon as you\'re back online.' },
  'whatsnew_search_title': { de: 'Schnellsuche mit Cmd+K', en: 'Quick search with Cmd+K' },
  'whatsnew_search_body': { de: 'Drücke Cmd+K (Mac) oder Strg+K (Windows), um sofort die Volltextsuche über mehr als 10.000 Fragen zu öffnen, ohne Mausklick, von jeder Seite aus.', en: 'Press Cmd+K (Mac) or Ctrl+K (Windows) to open full-text search across more than 10,000 questions instantly, no mouse click, from any page.' },
  'whatsnew_translations_title': { de: 'Erklärungen in 7 Sprachen', en: 'Explanations in 7 languages' },
  'whatsnew_translations_body': { de: 'Du kannst jede Erklärung jetzt auf Russisch, Arabisch, Englisch, Französisch, Türkisch, Ukrainisch oder Serbisch lesen. Medizinische Fachbegriffe, Medikamentennamen und Leitlinien-Bezüge bleiben dabei erhalten.', en: 'You can now read any explanation in Russian, Arabic, English, French, Turkish, Ukrainian, or Serbian. Medical terminology, drug names, and guideline references stay intact.' },
  'whatsnew_kmp_title': { de: 'Stichprobentest (Innsbruck): 2.742 neue Fragen', en: 'Stichprobentest (Innsbruck): 2,742 new questions' },
  'whatsnew_kmp_body': { de: 'Der nationale Stichprobentest (Nostrifizierung) ist jetzt verfügbar, mit Fragen aus dem klinischen Curriculum der Med Uni Innsbruck. Wechsle die Prüfung über die Seitenleiste.', en: 'The national Stichprobentest (nostrification screening) is now available, with questions from the Med Uni Innsbruck clinical curriculum. Switch exams from the sidebar.' },
  'whatsnew_pharma_title': { de: 'Pharmakologie-Prüfung: 335 Fragen', en: 'Pharmacology exam: 335 questions' },
  'whatsnew_pharma_body': { de: 'Kurzantworten zur Pharmakologie für die Rezeptierkunde-Vorbereitung.', en: 'Short-answer pharmacology questions for Rezeptierkunde preparation.' },
  'whatsnew_sip5a_title': { de: 'SIP5a Februar 2026 hinzugefügt', en: 'February 2026 SIP5a exam added' },
  'whatsnew_sip5a_body': { de: '154 frische Fragen aus der neuesten Wiener Prüfung, nach Fachgebiet geordnet.', en: '154 fresh questions from the latest Vienna exam, organized by specialty.' },
  'whatsnew_examsim_title': { de: 'Prüfungssimulation neu gestaltet', en: 'Exam simulation redesigned' },
  'whatsnew_examsim_body': { de: 'Wähle Antworten frei, navigiere zwischen Fragen und gib ab, wenn du bereit bist, wie in der echten Prüfung.', en: 'Select answers freely, navigate between questions, and submit when ready, just like the real exam.' },
  'whatsnew_bookmarks_title': { de: 'Lesezeichen & Fehlerwiederholung', en: 'Bookmarks & mistake review' },
  'whatsnew_bookmarks_body': { de: 'Schnellzugriff auf der Startseite zu gespeicherten Fragen und zu Fragen, die du falsch beantwortet hast.', en: 'Quick access on the home page to your saved questions and questions you got wrong.' },
  'whatsnew_feedback_title': { de: 'Feedback-Button', en: 'Feedback button' },
  'whatsnew_feedback_body': { de: 'Siehst du den blauen Button unten rechts? Nutze ihn, um Probleme zu melden oder Verbesserungen vorzuschlagen. Wir lesen jede Nachricht.', en: 'See the blue button at the bottom-right? Use it to report issues or suggest improvements. We read every message.' },

  // Cookie banner
  'cookie_body': { de: 'Wir nutzen Cookies und Analyse-Tools, um dir MedPrüf besser zu machen. Du kannst jederzeit widerrufen.', en: 'We use cookies and analytics to improve MedPrüf. You can opt out any time.' },
  'cookie_more': { de: 'Mehr erfahren', en: 'Learn more' },

  // Feedback widget
  'feedback_title': { de: 'Feedback / Problem melden', en: 'Feedback / Report a problem' },
  'feedback_button_title': { de: 'Feedback / Problem melden', en: 'Feedback / Report a problem' },
  'feedback_placeholder': { de: 'Was ist dir aufgefallen?', en: 'What did you notice?' },
  'feedback_send': { de: 'Senden', en: 'Send' },
  'feedback_sending': { de: 'Senden...', en: 'Sending...' },
  'feedback_thanks_title': { de: 'Danke!', en: 'Thank you!' },
  'feedback_thanks_body': { de: 'Wir schauen uns das an.', en: "We'll take a look." },
  'feedback_context_hint': { de: 'Seite & Kontext werden automatisch erfasst', en: 'Page & context are captured automatically' },
  'feedback_textarea_aria': { de: 'Feedback-Nachricht', en: 'Feedback message' },
  'feedback_close': { de: 'Schließen', en: 'Close' },
  // Unified floating launcher (mobile: fans up chat + feedback)
  'launcher_open': { de: 'Hilfe & Feedback öffnen', en: 'Open help & feedback' },
  'launcher_close': { de: 'Menü schließen', en: 'Close menu' },
  'launcher_chat': { de: 'Mit uns chatten', en: 'Chat with us' },
  'launcher_feedback': { de: 'Feedback geben', en: 'Give feedback' },

  // Report question modal
  'report_title': { de: 'Frage melden', en: 'Report question' },
  'report_reason': { de: 'Grund', en: 'Reason' },
  'report_reason_wrong_answer': { de: 'Falsche Antwort markiert', en: 'Wrong answer marked' },
  'report_reason_typo': { de: 'Tippfehler / Rechtschreibung', en: 'Typo / spelling' },
  'report_reason_unclear': { de: 'Unklar formuliert', en: 'Unclear wording' },
  'report_reason_outdated': { de: 'Veraltete Information', en: 'Outdated information' },
  'report_reason_other': { de: 'Anderer Grund', en: 'Other' },
  'report_details': { de: 'Details (optional)', en: 'Details (optional)' },
  'report_submit': { de: 'Meldung senden', en: 'Submit report' },
  'report_suggest_edit': { de: 'Bearbeitung vorschlagen', en: 'Suggest edit' },
  'report_success': { de: 'Danke, wir schauen uns das an.', en: 'Thanks, we\'ll review it.' },

  // PWA banners
  'pwa_update_title': { de: 'Neue Version verfügbar', en: 'New version available' },
  'pwa_update_body': { de: 'Lade neu, um die neuesten Fragen und Fixes zu erhalten.', en: 'Reload to get the latest questions and fixes.' },
  'pwa_update_cta': { de: 'Jetzt neu laden', en: 'Reload now' },
  'pwa_install_title': { de: 'MedPrüf installieren', en: 'Install MedPrüf' },
  'pwa_install_body': { de: 'Offline lernen: im Bus, in der U-Bahn, überall.', en: 'Study offline: on the bus, metro, anywhere.' },
  'pwa_install_cta': { de: 'Installieren', en: 'Install' },
  'pwa_not_now': { de: 'Nicht jetzt', en: 'Not now' },
  'pwa_dismiss': { de: 'Schließen', en: 'Dismiss' },

  // Guest migration banner
  'guest_banner_body': { de: 'Du bist im Gast-Modus: dein Fortschritt wird nicht zwischen Geräten synchronisiert.', en: "You're in guest mode: your progress won't sync across devices." },
  'guest_banner_cta': { de: 'Konto erstellen', en: 'Create Account' },
  'guest_banner_dismiss': { de: 'Für diese Sitzung ausblenden', en: 'Dismiss for this session' },

  // Referral floater — rescue-sprint §4.2 (2026-04-24): no €-figures
  // on first-touch surfaces, frame the ask around community + code
  // ownership rather than dollar bait.
  'ref_floater_region_label': { de: 'Empfehlungsprogramm', en: 'Referral program' },
  'ref_floater_close': { de: 'Hinweis schließen', en: 'Dismiss notice' },
  'ref_floater_title': { de: 'Hast du jemanden, der auch die Prüfung macht?', en: 'Know someone else prepping for the exam?' },
  'ref_floater_body': { de: 'Dein Empfehlungscode wartet. Teile ihn mit anderen Prüflingen: wenn sie Pro werden, bekommt ihr beide einen Bonus.', en: 'Your referral code is waiting. Share it with fellow candidates: when they go Pro, you both get a bonus.' },
  'ref_floater_cta_details': { de: 'Details ansehen', en: 'See details' },
  'ref_floater_cta_not_now': { de: 'Nicht jetzt', en: 'Not now' },
  'ref_copied': { de: 'Link kopiert!', en: 'Link copied!' },

  // Cohort countdown banner
  'cohort_banner_headline': { de: 'Prüfungs-Kohorte', en: 'Exam Cohort' },
  'cohort_banner_body': { de: 'Starte jetzt: gemeinsam vorbereiten, gemeinsam bestehen.', en: 'Start now: prepare together, pass together.' },
  'cohort_banner_cta': { de: 'Mehr erfahren', en: 'Learn more' },
  'cohort_banner_dismiss': { de: 'Schließen', en: 'Dismiss' },

  // Search modal
  'search_close': { de: 'Schließen', en: 'Close' },
  'search_empty_hint': { de: 'Tippe eine Frage, einen Begriff oder eine Diagnose ein.', en: 'Type a question, a term, or a diagnosis.' },
  'search_n_results': { de: '{n} Ergebnisse', en: '{n} results' },
  'search_one_result': { de: '1 Ergebnis', en: '1 result' },
  'search_show_all': { de: 'Alle {n} Ergebnisse anzeigen', en: 'Show all {n} results' },

  // Survey modal
  'survey_title': { de: 'Dein Feedback', en: 'Your Feedback' },
  'survey_success_title': { de: 'Danke!', en: 'Thank you!' },
  'survey_step_label': { de: 'Schritt {current} von 3', en: 'Step {current} of 3' },
  'survey_badge': { de: 'Umfrage', en: 'Survey' },
  'survey_intro_greeting': { de: 'Danke{name}! Dein Feedback hilft uns, MedPrüf besser zu machen.', en: 'Thanks{name}! Your feedback helps us make MedPrüf better.' },
  'survey_q_quality': { de: 'Wie bewertest du die Qualität der Fragen?', en: 'How do you rate the quality of the questions?' },
  'survey_q_ease': { de: 'Wie einfach ist die App zu benutzen?', en: 'How easy is the app to use?' },
  'survey_q_ai': { de: 'Wie hilfreich sind die KI-Erklärungen?', en: 'How helpful are the AI explanations?' },
  'survey_q_overall': { de: 'Wie zufrieden bist du mit der Prüfungsvorbereitung insgesamt?', en: 'How satisfied are you with your exam prep overall?' },
  'survey_q_nps': { de: 'Wie wahrscheinlich empfiehlst du MedPrüf weiter?', en: 'How likely are you to recommend MedPrüf?' },
  'survey_rating_1': { de: 'Schlecht', en: 'Poor' },
  'survey_rating_2': { de: 'Geht so', en: 'Meh' },
  'survey_rating_3': { de: 'OK', en: 'OK' },
  'survey_rating_4': { de: 'Gut', en: 'Good' },
  'survey_rating_5': { de: 'Super', en: 'Great' },
  'survey_best_title': { de: 'Was findest du am besten an MedPrüf?', en: 'What do you love most about MedPrüf?' },
  'survey_best_1': { de: 'Große Fragenbank', en: 'Large question bank' },
  'survey_best_2': { de: 'Spaced Repetition', en: 'Spaced repetition' },
  'survey_best_3': { de: 'KI-Erklärungen', en: 'AI explanations' },
  'survey_best_4': { de: 'Prüfungssimulation', en: 'Exam simulation' },
  'survey_best_5': { de: 'Fortschritts-Tracking', en: 'Progress tracking' },
  'survey_best_6': { de: 'Mobile App (PWA)', en: 'Mobile app (PWA)' },
  'survey_improve_title': { de: 'Was sollten wir als Nächstes verbessern?', en: 'What should we improve next?' },
  'survey_improve_1': { de: 'Mehr Fragen', en: 'More questions' },
  'survey_improve_2': { de: 'Bessere Erklärungen', en: 'Better explanations' },
  'survey_improve_3': { de: 'Lernplan-Funktion', en: 'Study plan feature' },
  'survey_improve_4': { de: 'Gruppenlernen', en: 'Group study' },
  'survey_improve_5': { de: 'Offline-Modus', en: 'Offline mode' },
  'survey_improve_6': { de: 'Preisgestaltung', en: 'Pricing' },
  'survey_other_placeholder': { de: 'Andere...', en: 'Other...' },
  'survey_other_best_aria': { de: 'Andere Funktionen', en: 'Other features' },
  'survey_other_improve_aria': { de: 'Andere Verbesserungen', en: 'Other improvements' },
  'survey_open_title': { de: 'Möchtest du noch etwas hinzufügen?', en: 'Anything else you want to share?' },
  'survey_open_label': { de: 'Dein Kommentar', en: 'Your comment' },
  'survey_open_helper': { de: 'Optional: alles was dir einfällt hilft uns weiter.', en: 'Optional: anything you tell us helps.' },
  'survey_open_placeholder': { de: 'Dein Kommentar...', en: 'Your comment...' },
  'survey_later': { de: 'Später', en: 'Later' },
  'survey_back': { de: 'Zurück', en: 'Back' },
  'survey_next': { de: 'Weiter', en: 'Next' },
  'survey_skip': { de: 'Überspringen', en: 'Skip' },
  'survey_submit': { de: 'Absenden', en: 'Submit' },
  'survey_sending': { de: 'Senden...', en: 'Sending...' },
  'survey_success_body': { de: 'Dein Feedback macht MedPrüf besser.', en: 'Your feedback makes MedPrüf better.' },

  // Empty states
  'empty_no_results_title': { de: 'Keine Ergebnisse', en: 'No results' },
  'empty_no_results_body': { de: 'Probier einen anderen Suchbegriff.', en: 'Try a different search term.' },
  'empty_no_bookmarks_title': { de: 'Noch keine Lesezeichen', en: 'No bookmarks yet' },
  'empty_no_bookmarks_body': { de: 'Markiere eine Frage mit ★ während du übst.', en: 'Star ★ a question while you practice.' },
  'empty_no_notes_title': { de: 'Noch keine Notizen', en: 'No notes yet' },
  'empty_no_notes_body': { de: 'Füge Notizen hinzu, während du Fragen überprüfst.', en: 'Add notes while you review answers.' },

  // Email validation modal
  'email_validation_title': { de: 'E-Mail-Adresse prüfen', en: 'Verify your email' },
  'email_validation_subtitle': { de: 'Deine E-Mail-Adresse scheint nicht zu funktionieren.', en: 'Your email address doesn\'t seem to be working.' },
  'email_validation_error_title': { de: 'Zustellung fehlgeschlagen', en: 'Delivery failed' },
  'email_validation_error_body': { de: 'Nachrichten an {email} konnten nicht zugestellt werden. Bitte überprüfe die Adresse oder hinterlege eine neue, damit du wichtige Updates erhältst.', en: 'Messages to {email} could not be delivered. Please check the address or provide a new one so you receive important updates.' },
  'email_validation_update_fail_title': { de: 'Aktualisierung nicht möglich', en: 'Update failed' },
  'email_validation_new_label': { de: 'Neue E-Mail-Adresse', en: 'New email address' },
  'email_validation_placeholder': { de: 'user-71248681@example.com', en: 'your.email@example.com' },
  'email_validation_remind_later': { de: 'Später erinnern', en: 'Remind me later' },
  'email_validation_submit': { de: 'E-Mail aktualisieren', en: 'Update email' },
  'email_validation_submitting': { de: 'Wird aktualisiert…', en: 'Updating…' },
  'email_validation_success': { de: 'E-Mail-Adresse aktualisiert!', en: 'Email updated!' },
  'email_validation_invalid': { de: 'Bitte gib eine gültige E-Mail-Adresse ein.', en: 'Please enter a valid email address.' },
  'email_validation_duplicate': { de: 'Diese E-Mail-Adresse wird bereits verwendet.', en: 'This email address is already in use.' },
  'email_validation_generic_error': { de: 'Aktualisierung fehlgeschlagen.', en: 'Update failed.' },
  'email_validation_network': { de: 'Verbindungsfehler. Bitte versuche es erneut.', en: 'Connection error. Please try again.' },

  // Find Your Path — guided orientation flow (public, anon-safe). All
  // strings em-dash-free ([name]'s rule); legacy keys carrying em dashes
  // are intentionally NOT reused here.
  'fyp_meta_title': { de: 'Finde deinen Weg', en: 'Find your path' },
  // In-app onboarding affordance (entry point #2) — a confused logged-in
  // user who does not yet know which exam is theirs jumps to the
  // orientation flow instead of guessing on the exam grid.
  'fyp_onb_unsure_link': { de: 'Nicht sicher, welche Prüfung deine ist? Finde deinen Weg', en: 'Not sure which exam is yours? Find your path' },
  'fyp_eyebrow': { de: 'Orientierung', en: 'Get oriented' },
  'fyp_intro_title': { de: 'Finde deinen Weg zur Anerkennung', en: 'Find your path to recognition' },
  'fyp_intro_sub': { de: 'Drei kurze Fragen. Danach weißt du, welcher Prüfungsweg deiner ist, wann deine Fristen sind und wo du anfängst.', en: 'Three short questions. Then you will know which exam route is yours, when your deadlines are, and where to start.' },
  'fyp_step_label': { de: 'Schritt {current} von {total}', en: 'Step {current} of {total}' },
  'fyp_next': { de: 'Weiter', en: 'Next' },
  'fyp_back': { de: 'Zurück', en: 'Back' },
  'fyp_see_path': { de: 'Meinen Weg anzeigen', en: 'Show my path' },
  'fyp_skip_step': { de: 'Diesen Schritt überspringen', en: 'Skip this step' },

  // Step 1 — which route
  'fyp_s1_title': { de: 'Welcher Weg ist deiner?', en: 'Which route are you on?' },
  'fyp_s1_sub': { de: 'Es gibt zwei Anerkennungswege in Österreich. Wähle deinen, oder lass es dir kurz erklären.', en: 'There are two recognition routes in Austria. Pick yours, or let us explain them quickly.' },
  'fyp_route_kp_name': { de: 'Kenntnisprüfung Wien', en: 'Kenntnisprüfung Vienna' },
  'fyp_route_kp_desc': { de: 'Die Arztprüfung der Ärztekammer (Allgemeinmedizin)', en: "The Medical Chamber's Arztprüfung (general medicine)" },
  'fyp_route_stp_name': { de: 'Stichprobentest', en: 'Stichprobentest' },
  'fyp_route_stp_desc': { de: 'Das Screening der universitären Nostrifizierung', en: 'The university nostrification screening' },
  'fyp_route_unsure_name': { de: 'Ich bin nicht sicher', en: "I'm not sure" },
  'fyp_route_unsure_desc': { de: 'Zeig mir kurz den Unterschied', en: 'Show me the difference briefly' },

  // Step 1 — the two-route explainer (facts sourced from SoT §1; dates
  // pulled live from exam-dates.ts, never hardcoded here)
  'fyp_explain_title': { de: 'Die zwei Anerkennungswege', en: 'The two recognition routes' },
  'fyp_explain_sub': { de: 'Welcher gilt für dich, hängt davon ab, wie du in Österreich anerkannt wirst. Lies kurz und wähle dann.', en: 'Which one applies depends on how you are getting recognized in Austria. Read briefly, then choose.' },
  'fyp_explain_kp_p': { de: 'Die Arztprüfung Allgemeinmedizin der Österreichischen Ärztekammer (Arztakademie). Fester Termin, 3x pro Jahr, Anmeldeschluss ausnahmslos 2 Monate vorher. Eine Wiederholung kostet rund 795 € pro Versuch.', en: 'The Arztprüfung Allgemeinmedizin of the Austrian Medical Chamber (Arztakademie). Fixed date, 3x per year, registration closes exactly 2 months before. A re-sit costs around 795 € per attempt.' },
  'fyp_explain_stp_p': { de: 'Das nationale Stichprobentest-Screening der universitären Nostrifizierung (rechtlich keine Prüfung). Rund 10 bis 11 klinische Blöcke, du bestehst meist etwa 6 von 10 mit mindestens 60 %. Der Standort wechselt, du meldest dich an der Uni an, an der du deinen Nostrifizierungs-Antrag gestellt hast.', en: 'The national Stichprobentest screening of the university nostrification (legally not an exam). Around 10 to 11 clinical blocks, you usually pass about 6 of 10 at 60 % or more. The venue rotates, and you register at the university where you filed your nostrification application.' },
  'fyp_explain_choose_kp': { de: 'Das ist mein Weg: Kenntnisprüfung', en: 'This is my route: Kenntnisprüfung' },
  'fyp_explain_choose_stp': { de: 'Das ist mein Weg: Stichprobentest', en: 'This is my route: Stichprobentest' },
  'fyp_explain_next_sitting': { de: 'Nächster Termin', en: 'Next sitting' },
  'fyp_explain_reg_by': { de: 'Anmeldeschluss', en: 'Register by' },
  'fyp_explain_rolling': { de: 'Kein fester Termin', en: 'No fixed date' },

  // Step 2 — when is your exam (wraps ExamSittingPicker)
  'fyp_s2_title': { de: 'Wann ist deine Prüfung?', en: 'When is your exam?' },
  'fyp_s2_sub': { de: 'Wähle den echten Termin, oder sag uns, dass du noch nicht angemeldet bist. Daraus bauen wir deine Zeitleiste.', en: "Pick the real sitting, or tell us you're not registered yet. We build your timeline from it." },

  // Step 3 — quick background (optional)
  'fyp_s3_title': { de: 'Kurz zu dir (optional)', en: 'A little about you (optional)' },
  'fyp_s3_sub': { de: 'Damit wir deinen Plan gewichten können. Du kannst das auch überspringen.', en: 'So we can weight your plan. You can also skip this.' },
  'fyp_s3_weak_label': { de: 'Wo bist du am unsichersten? (optional)', en: 'Where are you least confident? (optional)' },
  'fyp_s3_weak_hint': { de: 'Tippe alle an, die zutreffen.', en: 'Tap any that apply.' },
  'fyp_s3_goal_label': { de: 'Wie viele Fragen pro Tag?', en: 'How many questions per day?' },
  'fyp_s3_goal_qpd': { de: 'Fragen pro Tag', en: 'questions per day' },

  // Output — Your Path
  'fyp_out_eyebrow': { de: 'Dein Weg', en: 'Your path' },
  'fyp_out_title_kp': { de: 'Dein Weg: Kenntnisprüfung Wien', en: 'Your path: Kenntnisprüfung Vienna' },
  'fyp_out_title_stp': { de: 'Dein Weg: Stichprobentest', en: 'Your path: Stichprobentest' },
  'fyp_out_route_kp_p': { de: 'Du bereitest dich auf die Kenntnisprüfung Wien vor, die Arztprüfung Allgemeinmedizin der Österreichischen Ärztekammer. Sie findet 3x pro Jahr zu festen Terminen statt, und der Anmeldeschluss ist ausnahmslos 2 Monate vorher. Wir richten alles auf diesen Termin aus.', en: 'You are preparing for the Kenntnisprüfung Vienna, the Arztprüfung Allgemeinmedizin of the Austrian Medical Chamber. It runs 3x per year on fixed dates, and registration closes exactly 2 months before. We line everything up to that date.' },
  'fyp_out_route_stp_p': { de: 'Du bereitest dich auf den Stichprobentest vor, das nationale Screening der universitären Nostrifizierung. Rund 10 bis 11 klinische Blöcke, du bestehst meist etwa 6 von 10 mit mindestens 60 %. Der Standort wechselt je Termin. Wir richten deinen Plan auf deinen Termin aus.', en: 'You are preparing for the Stichprobentest, the national screening of the university nostrification. Around 10 to 11 clinical blocks, and you usually pass about 6 of 10 at 60 % or more. The venue rotates each sitting. We line your plan up to your date.' },
  'fyp_out_timeline_title': { de: 'Deine Zeitleiste', en: 'Your timeline' },
  'fyp_out_days_left': { de: 'Tage bis zur Prüfung', en: 'days until your exam' },
  'fyp_out_register_cta': { de: 'Du bist noch nicht angemeldet. Melde dich bis zum {date} an.', en: 'You are not registered yet. Register by {date}.' },
  'fyp_out_register_soft': { de: 'Anmeldeschluss ist rund {date}. Markiere ihn dir.', en: 'Registration closes around {date}. Mark it down.' },
  'fyp_out_nodate_title': { de: 'Noch kein Termin gewählt', en: 'No date chosen yet' },
  'fyp_out_nodate_body': { de: 'Kein Problem. Sobald du einen Termin setzt, bauen wir die Tag-für-Tag-Zeitleiste. Bis dahin fang einfach mit kostenlosem Üben an.', en: 'No problem. As soon as you set a date, we build the day-by-day timeline. Until then, just start with free practice.' },
  'fyp_out_plan_title': { de: 'Dein Lernplan', en: 'Your study plan' },
  'fyp_out_plan_days': { de: 'Tage Plan', en: 'days planned' },
  'fyp_out_plan_qpd': { de: 'Fragen pro Tag', en: 'questions per day' },
  'fyp_out_plan_split': { de: '70 % neuer Stoff, dann 30 % Festigung, gewichtet nach deinen Schwächen.', en: '70 % new material, then 30 % consolidation, weighted by your weak topics.' },
  'fyp_out_plan_inapp': { de: 'Den genauen Tagesplan baut die App, sobald du übst und wir deinen Fortschritt kennen.', en: 'The app builds the exact day-by-day once you practice and we know your progress.' },
  'fyp_out_start_title': { de: 'Fang hier an', en: 'Start here' },
  'fyp_out_start_body': { de: 'Mach 150 kostenlose Fragen je Prüfung, ganz ohne Karte. So siehst du sofort, wo du stehst.', en: 'Take 150 free questions per exam, no card needed. You will see right away where you stand.' },
  'fyp_out_cta_practice': { de: 'Kostenlos üben und Niveau einschätzen', en: 'Practice free and gauge your level' },
  'fyp_out_cta_account': { de: 'Kostenloses Konto erstellen', en: 'Create a free account' },
  'fyp_out_cta_account_sub': { de: 'Speichert deinen Weg und synchronisiert deinen Fortschritt', en: 'Saves your path and syncs your progress' },
  'fyp_out_cta_studyplan': { de: 'Zu meinem Lernplan', en: 'Go to my study plan' },
  'fyp_out_restart': { de: 'Von vorne beginnen', en: 'Start over' },
  'fyp_out_price_note': { de: 'MedPrüf gibt es ab 19 € im Monat. Die Prüfungs-Kohorte enthält die Pass-Until-You-Pass-Garantie.', en: 'MedPrüf starts at 19 € a month. The Exam Cohort includes the Pass-Until-You-Pass guarantee.' },

  // Settings extras
  'settings_account': { de: 'Konto', en: 'Account' },
  'settings_section_about': { de: 'Über', en: 'About' },
  'settings_section_support': { de: 'Support', en: 'Support' },
  'settings_support_feedback': { de: 'Feedback geben', en: 'Give feedback' },
  'settings_support_help': { de: 'Hilfe & FAQ', en: 'Help & FAQ' },
  'settings_about_version': { de: 'Version', en: 'Version' },
  'settings_about_changelog': { de: 'Was ist neu', en: "What's new" },
  'settings_pricing_link': { de: 'Preise & Tarife', en: 'Pricing & plans' },
  'settings_delete_account': { de: 'Konto löschen', en: 'Delete account' },
  'settings_delete_confirm': { de: 'Konto wirklich löschen? Diese Aktion ist endgültig.', en: 'Really delete account? This is permanent.' },
  'settings_account_deleted': { de: 'Konto gelöscht', en: 'Account deleted' },
} as const

export type TranslationKey = keyof typeof translations

export function t(key: TranslationKey, lang: Lang = 'de'): string {
  const base = translations[key] as Record<string, string> | undefined
  // de/en come from the fully-authored base map.
  if (lang === 'de' || lang === 'en') return base?.[lang] || key
  // Extra languages: overlay first, then en, then de, then the key.
  return EXTRA_TRANSLATIONS[lang]?.[key] || base?.en || base?.de || key
}

const KNOWN_LANGS: readonly Lang[] = ['de', 'en', 'ru', 'uk', 'tr', 'ar']
function coerceLang(v: string | null): Lang {
  return (KNOWN_LANGS as readonly string[]).includes(v || '') ? (v as Lang) : 'de'
}

/** True for right-to-left languages; drives the `dir` attribute. */
export function isRtl(lang: Lang): boolean {
  return RTL_LANGS.includes(lang)
}

/**
 * Wide reader: the user's ACTUAL chosen language (de/en/ru/uk/tr/ar).
 * Use this + `t()` in multilingual-aware chrome. SSR-safe (returns de).
 */
export function getUiLang(): Lang {
  if (typeof window !== 'undefined') {
    return coerceLang(localStorage.getItem('medpruef-lang'))
  }
  return 'de'
}

/**
 * Narrow reader (de/en only): for pages that still carry their own
 * `{ de, en }` content maps (legal, landing marketing copy). Any language
 * beyond German collapses to English here, so those pages render an English
 * fallback while the shared UI strings (via `t()` + `getUiLang()`) still
 * localize fully. Widen a page by switching it to `getUiLang()` + `t()`.
 */
export function getLang(): 'de' | 'en' {
  return getUiLang() === 'de' ? 'de' : 'en'
}

const LANG_EVENT = 'medpruef-lang-change'

export function setLang(lang: Lang) {
  if (typeof window !== 'undefined') {
    localStorage.setItem('medpruef-lang', lang)
    try {
      window.dispatchEvent(new CustomEvent<Lang>(LANG_EVENT, { detail: lang }))
    } catch {
      /* noop */
    }
  }
}

/**
 * React hook that returns the current language and re-renders whenever
 * setLang() is called anywhere in the app. Safe for SSR — returns 'de'
 * until the client mounts. Use this in shared components (modals,
 * toasts, floaters) so they honor the global language choice without
 * each page having to prop-drill `lang` down.
 */
export function useLang(): Lang {
  const [lang, setLangLocal] = useState<Lang>('de')
  useEffect(() => {
    setLangLocal(getUiLang())
    const handler = (e: Event) => {
      const detail = (e as CustomEvent<Lang>).detail
      if (detail && (KNOWN_LANGS as readonly string[]).includes(detail)) {
        setLangLocal(detail)
      } else {
        setLangLocal(getLang())
      }
    }
    const storageHandler = (e: StorageEvent) => {
      if (e.key === 'medpruef-lang') {
        setLangLocal(getLang())
      }
    }
    window.addEventListener(LANG_EVENT, handler)
    window.addEventListener('storage', storageHandler)
    return () => {
      window.removeEventListener(LANG_EVENT, handler)
      window.removeEventListener('storage', storageHandler)
    }
  }, [])
  return lang
}
