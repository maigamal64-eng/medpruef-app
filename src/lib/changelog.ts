/**
 * MedPrüf Changelog
 *
 * IMPORTANT: Update this file whenever user-facing features are added, fixed, or removed.
 * Add new entries at the TOP of the array (reverse chronological).
 *
 * Tags:
 * - "feature" — new user-facing feature
 * - "improvement" — enhancement to existing feature
 * - "fix" — bug fix
 * - "admin" — admin-only change (shown only in admin changelog)
 */

export type ChangelogTag = "feature" | "improvement" | "fix" | "admin";

export interface ChangelogEntry {
  date: string;        // ISO date YYYY-MM-DD
  version?: string;    // Optional semver
  tag: ChangelogTag;
  title: { de: string; en: string };
  description: { de: string; en: string };
}

export const CHANGELOG: ChangelogEntry[] = [
  // ═══ 2026-04-12 ═══
  {
    date: "2026-04-12",
    tag: "feature",
    title: {
      de: "Prüfungs-Umschalter oben rechts",
      en: "Exam switcher in the top-right",
    },
    description: {
      de: "Ein neuer Umschalter schwebt oben rechts auf jeder Seite. Darüber wechseln Sie zwischen Kenntnisprüfung und Pharmakologie, ohne sich abzumelden. Alle Fragen, Prüfungen, Fortschritte und Statistiken aktualisieren sich automatisch für die ausgewählte Prüfung.",
      en: "A new floating switcher sits in the top-right corner of every page. Use it to toggle between Kenntnisprüfung and Pharmacology without logging out. All questions, exams, progress, and stats update automatically for the selected exam.",
    },
  },
  {
    date: "2026-04-12",
    tag: "feature",
    title: {
      de: "Neue Prüfung: Pharmakologie Rezeptierkunde (335 Fragen)",
      en: "New exam: Pharmacology Prescription Studies (335 questions)",
    },
    description: {
      de: "Eine komplett neue Prüfungskategorie ist jetzt verfügbar: Pharmakologie Rezeptierkunde/Stichpunkte mit 335 kurzen Q&A-Fragen. Über einen Prüfungs-Umschalter in der Kopfzeile wählen Sie zwischen Kenntnisprüfung und Pharma (weitere Prüfungen folgen).",
      en: "A completely new exam category is now available: Pharmacology Prescription Studies with 335 short-answer questions. Use the exam switcher in the header to toggle between Kenntnisprüfung and Pharma (more exams coming).",
    },
  },
  {
    date: "2026-04-12",
    tag: "feature",
    title: {
      de: "Februar-2026 SIP5a Prüfung hinzugefügt",
      en: "February 2026 SIP5a exam added",
    },
    description: {
      de: "Die brandneue Wiener SIP5a Prüfung vom 16. Februar 2026 wurde als 154 frische Fragen in die Kenntnisprüfung-Bibliothek aufgenommen. Sie decken Neurologie, Psychiatrie, Kinder- und Jugendheilkunde, Frauenheilkunde, Augenheilkunde, HNO sowie Notfall- und Intensivmedizin ab und sind mit dem Tag sip2026 markiert.",
      en: "The brand-new Vienna SIP5a exam from February 16, 2026 has been added as 154 fresh questions to the Kenntnisprüfung library. They cover Neurology, Psychiatry, Pediatrics, Gynecology, Ophthalmology, ENT, and Emergency/Intensive Care, and are tagged with sip2026.",
    },
  },
  {
    date: "2026-04-12",
    tag: "improvement",
    title: {
      de: "Fragenqualität: Themen gegen offizielle Prüfungsunterlagen validiert",
      en: "Question quality: topics validated against official exam sources",
    },
    description: {
      de: "Jede Frage wurde gegen die offiziellen Wiener Tertial-Prüfungsunterlagen abgeglichen. 19 falsch zugeordnete Fragen wurden in das korrekte Fachgebiet verschoben (z.B. Katatonie von Neurologie zu Psychiatrie, kindliches Exanthem von Dermatologie zu Kinderheilkunde, Diabetes insipidus eines 14-Jährigen von Neurologie zu Kinderheilkunde). 99,9% der bestehenden Zuordnungen wurden als korrekt bestätigt.",
      en: "Every question was cross-checked against the official Vienna tertial exam source materials. 19 mis-assigned questions were moved to their correct specialty (e.g. catatonia from Neurology to Psychiatry, childhood exanthem from Dermatology to Pediatrics, 14-year-old with diabetes insipidus from Neurology to Pediatrics). 99.9% of existing assignments were confirmed correct.",
    },
  },
  {
    date: "2026-04-12",
    tag: "admin",
    title: {
      de: "Datenbank-Bereinigung: veraltete Legacy-Einträge entfernt",
      en: "Database cleanup: legacy entries purged",
    },
    description: {
      de: "Rund 7.900 veraltete, inaktive Fragen aus der ersten Import-Generation wurden entfernt. Die 3 Einträge mit Nutzerhistorie wurden in eine Archivtabelle gesichert. Die Datenbank ist jetzt 50% schlanker.",
      en: "About 7,900 obsolete inactive questions from the first import generation were removed. The 3 entries with user history were preserved in an archive table. The database is now 50% leaner.",
    },
  },
  // ═══ 2026-04-11 ═══
  {
    date: "2026-04-11",
    tag: "feature",
    title: { de: "Landing-Page komplett überarbeitet", en: "Landing page rewrite" },
    description: {
      de: "Neue, launch-bereite Startseite mit Hero, Funktionsübersicht, Beispielfrage zum Ausprobieren, transparenter Preisgestaltung, FAQ und Teaser für kommende Prüfungen (Approbation Deutschland).",
      en: "New launch-ready landing page with hero, feature overview, interactive sample question, transparent pricing, FAQ, and a teaser for upcoming exams (Approbation Germany).",
    },
  },
  {
    date: "2026-04-11",
    tag: "feature",
    title: { de: "Live-Anmelde-Tracker im Admin", en: "Live new-users tracker in admin" },
    description: {
      de: "Das Admin-Dashboard zeigt jetzt eine Echtzeit-Karte mit neuen Registrierungen (letzte Stunde, heute, 7/30 Tage) plus die letzten 10 Anmeldungen — automatische Aktualisierung alle 30 Sekunden.",
      en: "The admin dashboard now shows a live card with new registrations (last hour, today, 7/30 days) plus the last 10 signups — auto-refreshing every 30 seconds.",
    },
  },
  {
    date: "2026-04-11",
    tag: "improvement",
    title: { de: "Schlankere Seitenleiste", en: "Streamlined sidebar" },
    description: {
      de: "Die Seitenleiste passt jetzt vollständig auf den Desktop ohne zu scrollen. Während eines Quiz oder einer Prüfung wird sie automatisch ausgeblendet, damit du dich konzentrieren kannst.",
      en: "The sidebar now fits the desktop without scrolling. During a quiz or exam it auto-hides so you can focus.",
    },
  },
  {
    date: "2026-04-11",
    tag: "improvement",
    title: { de: "Prüfungsfragen nach Fach gruppiert", en: "Exam questions grouped by subject" },
    description: {
      de: "In der Prüfungssimulation kommen jetzt alle Fragen eines Fachs hintereinander, dann das nächste Fach — wie in der echten Wiener Kenntnisprüfung. SIP-4- und Vollprüfungen enthalten außerdem 2-3 garantierte EKG-Fragen.",
      en: "Exam simulation now groups all questions of one subject consecutively before moving to the next — matching the real Vienna Kenntnisprüfung. SIP 4 and full exams now also include 2-3 guaranteed ECG questions.",
    },
  },
  {
    date: "2026-04-11",
    tag: "fix",
    title: { de: "Erklärungsbilder erscheinen erst nach der Antwort", en: "Explanation images now appear after answering" },
    description: {
      de: "Bilder, die zur Erklärung gehören, wurden bisher zusammen mit der Frage angezeigt. Sie erscheinen jetzt erst, nachdem du geantwortet hast.",
      en: "Images that belong to the explanation used to appear together with the question. They now appear only after you have answered.",
    },
  },
  {
    date: "2026-04-11",
    tag: "fix",
    title: { de: "Dark Mode synchronisiert", en: "Dark mode unified" },
    description: {
      de: "Die automatische Dunkelmodus-Erkennung und der manuelle Schalter sind jetzt vollständig synchronisiert — keine gemischten Themes mehr.",
      en: "Automatic dark mode detection and the manual toggle are now fully unified — no more mixed themes.",
    },
  },
  {
    date: "2026-04-11",
    tag: "fix",
    title: { de: "Transparentes Favicon mit Dark/Light", en: "Transparent favicon with dark/light variants" },
    description: {
      de: "Neues SVG-Favicon mit transparentem Hintergrund, das automatisch zwischen Dark- und Light-Mode wechselt.",
      en: "New SVG favicon with transparent background that automatically switches between dark and light mode.",
    },
  },
  // ═══ 2026-04-10 ═══
  {
    date: "2026-04-10",
    tag: "improvement",
    title: { de: "Prüfung verwendet jetzt die neue Fragekarte", en: "Exam now uses the unified question card" },
    description: {
      de: "Die Prüfung rendert Fragen jetzt mit derselben Karte wie das Quiz. Hervorhebungen, Bild-Lightbox, KI-Erklärung, Notizen, Favorit, Melden — alles funktioniert konsistent zwischen Quiz und Prüfung.",
      en: "The exam now renders questions with the same card as the quiz. Highlights, image lightbox, AI explain, notes, favorite, report — everything works consistently between quiz and exam.",
    },
  },
  {
    date: "2026-04-10",
    tag: "admin",
    title: { de: "Bereinigungsskript für Erklärungen", en: "Explanation cleanup script" },
    description: {
      de: "Neues Skript scripts/clean_explanations.py extrahiert versehentlich in Erklärungen gelandete Prüfungsdaten ([2016-09]) und schreibt sie in das exam_dates-Feld zurück.",
      en: "New scripts/clean_explanations.py extracts exam-date markers ([2016-09]) accidentally captured into explanations and writes them back to the exam_dates column.",
    },
  },
  {
    date: "2026-04-10",
    tag: "improvement",
    title: { de: "Prüfungsmodus erhält neue Funktionen", en: "Exam mode gets new features" },
    description: {
      de: "Die Prüfungsseite zeigt jetzt die neue Aktionsleiste (Favorit, KI-Erklärung, Notizen, Melden), öffnet Bilder im Lightbox und entfernt automatisch fehlerhafte Datumsmarkierungen aus Erklärungstexten.",
      en: "The exam page now shows the new action rail (favorite, AI explain, notes, report), opens images in a lightbox, and automatically strips malformed date markers from explanation text.",
    },
  },
  {
    date: "2026-04-10",
    tag: "fix",
    title: { de: "Fehlerhafte Erklärungen bereinigt", en: "Cleaned up malformed explanations" },
    description: {
      de: "Erklärungen, die fälschlicherweise mit Prüfungsdaten wie [2016-09] beginnen, werden jetzt überall im Quiz und in der Prüfung automatisch bereinigt.",
      en: "Explanations that wrongly began with exam-date markers like [2016-09] are now stripped automatically across the quiz and exam.",
    },
  },
  {
    date: "2026-04-10",
    tag: "feature",
    title: { de: "Quiz-Erlebnis komplett überarbeitet", en: "Quiz experience overhaul" },
    description: {
      de: "Neuer Konfigurationsbildschirm beim Quizstart (Fächer, Tags, Anzahl, Zeitlimit, Prüfungszeitraum). Aktionen (Favorit, KI-Erklärung, Notizen, Melden) sind jetzt in einer dedizierten Seitenleiste platziert. Frage melden öffnet sich als Modal. Die nächste Frage wird vorab geladen und erscheint sofort. Fortschrittsbalken spiegelt die gewählte Quizlänge präzise wider. Erfolgsmeldungen erscheinen unter der Karte ohne den Quizfluss zu unterbrechen.",
      en: "New customization screen on quiz start (subjects, tags, count, time limit, exam date range). Action buttons (favorite, AI explain, notes, report) moved to a dedicated side rail using available negative space. Report opens as a modal. The next question is preloaded and appears instantly. Progress bar precisely reflects the chosen quiz length. Milestone cards appear below without interrupting the quiz flow.",
    },
  },
  {
    date: "2026-04-10",
    tag: "feature",
    title: { de: "Änderungsprotokoll", en: "Changelog" },
    description: {
      de: "Neue Seite, auf der alle Updates und Verbesserungen an MedPrüf aufgelistet sind.",
      en: "New page listing all updates and improvements to MedPrüf.",
    },
  },
  {
    date: "2026-04-10",
    tag: "fix",
    title: { de: "Fragenkarten-Breite stabil", en: "Question card width stable" },
    description: {
      de: "Die Fragenkarte ändert nicht mehr ihre Breite, wenn du eine Antwort auswählst.",
      en: "The question card no longer changes width when you select an answer.",
    },
  },
  {
    date: "2026-04-10",
    tag: "improvement",
    title: { de: "KI-Erklärungen zwischengespeichert", en: "AI explanations cached" },
    description: {
      de: "KI-Erklärungen werden jetzt einmal pro Frage generiert und für alle Nutzer zwischengespeichert — schneller und effizienter.",
      en: "AI explanations are now generated once per question and cached for all users — faster and more efficient.",
    },
  },
  {
    date: "2026-04-10",
    tag: "feature",
    title: { de: "Markdown-Rendering in KI-Chat", en: "Markdown rendering in AI chat" },
    description: {
      de: "KI-Erklärungen werden jetzt mit formatierter Darstellung (Überschriften, Listen, Fettdruck) angezeigt.",
      en: "AI explanations now render with proper formatting (headings, lists, bold text).",
    },
  },
  {
    date: "2026-04-10",
    tag: "feature",
    title: { de: "Frage melden & Vorschläge", en: "Report questions & suggest edits" },
    description: {
      de: "Melde Probleme oder schlage Änderungen an Fragen direkt beim Lernen vor. Klicke auf das Flag-Symbol oben rechts.",
      en: "Report issues or suggest edits to questions directly while studying. Click the flag icon in the top right.",
    },
  },
  {
    date: "2026-04-10",
    tag: "feature",
    title: { de: "Zeitübung", en: "Timed Practice" },
    description: {
      de: "Neue Zeitübung: 10, 20 oder 30 Fragen mit Zeitlimit und Zusammenfassung am Ende.",
      en: "New timed practice mode: 10, 20, or 30 questions with a time limit and summary at the end.",
    },
  },
  {
    date: "2026-04-10",
    tag: "feature",
    title: { de: "Prüfungs-Countdown auf Startseite", en: "Exam countdown on home" },
    description: {
      de: "Setze dein Prüfungsdatum und sieh die verbleibenden Tage direkt auf der Startseite.",
      en: "Set your exam date and see the days remaining directly on the home page.",
    },
  },
  {
    date: "2026-04-10",
    tag: "feature",
    title: { de: "Tastaturkürzel-Leitfaden", en: "Keyboard shortcut guide" },
    description: {
      de: "Drücke ?, um alle verfügbaren Tastaturkürzel zu sehen (A-E Antwort auswählen, F Lesezeichen, N nächste Frage).",
      en: "Press ? to see all available keyboard shortcuts (A-E select answer, F bookmark, N next question).",
    },
  },
  {
    date: "2026-04-10",
    tag: "feature",
    title: { de: "Bewertung von Erklärungen", en: "Rate explanations" },
    description: {
      de: "Bewerte KI-Erklärungen mit Daumen hoch/runter, um uns zu helfen, die Qualität zu verbessern.",
      en: "Rate AI explanations with thumbs up/down to help us improve quality.",
    },
  },
  {
    date: "2026-04-10",
    tag: "feature",
    title: { de: "Automatischer Dunkelmodus", en: "Auto dark mode" },
    description: {
      de: "MedPrüf erkennt jetzt automatisch dein System-Farbschema (hell/dunkel).",
      en: "MedPrüf now automatically detects your system color scheme (light/dark).",
    },
  },
  {
    date: "2026-04-10",
    tag: "feature",
    title: { de: "Rechtliche Seiten hinzugefügt", en: "Legal pages added" },
    description: {
      de: "Datenschutz, Nutzungsbedingungen und Impressum sind jetzt verfügbar (gesetzlich erforderlich).",
      en: "Privacy policy, terms of service, and legal notice are now available (legally required).",
    },
  },
  {
    date: "2026-04-10",
    tag: "feature",
    title: { de: "Cookie-Banner", en: "Cookie banner" },
    description: {
      de: "GDPR-konformer Cookie-Banner — akzeptiere oder lehne Analyse-Cookies ab.",
      en: "GDPR-compliant cookie banner — accept or decline analytics cookies.",
    },
  },
  {
    date: "2026-04-10",
    tag: "admin",
    title: { de: "Admin: Vorschläge-Warteschlange", en: "Admin: Suggestions queue" },
    description: {
      de: "Admin kann jetzt Nutzer-Meldungen und Bearbeitungsvorschläge im Admin-Panel überprüfen.",
      en: "Admin can now review user reports and edit suggestions in the admin panel.",
    },
  },
  {
    date: "2026-04-10",
    tag: "admin",
    title: { de: "Admin: Tier-Verwaltung", en: "Admin: Tier management" },
    description: {
      de: "Admin kann Nutzer-Tier (Free/Pro/Admin) direkt aus der Nutzertabelle ändern.",
      en: "Admin can change user tier (Free/Pro/Admin) directly from the users table.",
    },
  },

  // ═══ 2026-04-09 ═══
  {
    date: "2026-04-09",
    tag: "feature",
    title: { de: "E-Mail-Anmeldung", en: "Email login" },
    description: {
      de: "Registriere und melde dich mit E-Mail und Passwort an — keine Telegram-Nutzung erforderlich.",
      en: "Register and sign in with email and password — no Telegram required.",
    },
  },
  {
    date: "2026-04-09",
    tag: "feature",
    title: { de: "Umfassendes Admin-Dashboard", en: "Comprehensive admin dashboard" },
    description: {
      de: "Admin-Panel mit 5 Bereichen: Dashboard, Nutzer, Fragen, Analysen, System.",
      en: "Admin panel with 5 sections: Dashboard, Users, Questions, Analytics, System.",
    },
  },
  {
    date: "2026-04-09",
    tag: "improvement",
    title: { de: "Login-Flow vereinfacht", en: "Simplified login flow" },
    description: {
      de: "Neue /login-Seite mit allen Authentifizierungsoptionen an einem Ort.",
      en: "New /login page with all authentication options in one place.",
    },
  },
  {
    date: "2026-04-09",
    tag: "improvement",
    title: { de: "Mobiles Design verbessert", en: "Improved mobile design" },
    description: {
      de: "Bessere Navigation auf mobilen Geräten mit prominentem Quiz-Button in der unteren Leiste.",
      en: "Better mobile navigation with prominent quiz button in the bottom bar.",
    },
  },
  {
    date: "2026-04-09",
    tag: "feature",
    title: { de: "Medpruf.com Domain", en: "Medpruf.com domain" },
    description: {
      de: "MedPrüf ist jetzt unter medpruf.com erreichbar!",
      en: "MedPrüf is now available at medpruf.com!",
    },
  },

  // ═══ 2026-04-08 ═══
  {
    date: "2026-04-08",
    tag: "feature",
    title: { de: "Curriculum-Karte", en: "Curriculum map" },
    description: {
      de: "Neue Seite mit Baumansicht aller Fachgebiete und deinem Fortschritt.",
      en: "New page with tree view of all specialties and your progress.",
    },
  },
  {
    date: "2026-04-08",
    tag: "feature",
    title: { de: "Karteikarten-Modus", en: "Flashcard mode" },
    description: {
      de: "Lerne mit interaktiven Karteikarten mit 3D-Flip-Animation und Vertrauensbewertungen.",
      en: "Study with interactive flashcards featuring 3D flip animation and confidence ratings.",
    },
  },
  {
    date: "2026-04-08",
    tag: "feature",
    title: { de: "Fortschritts-Dashboard", en: "Progress dashboard" },
    description: {
      de: "Umfassende Statistiken mit Radar-Diagramm, Wochenansicht und Prüfungsbereitschaft.",
      en: "Comprehensive stats with radar chart, weekly view, and exam readiness.",
    },
  },
  {
    date: "2026-04-08",
    tag: "feature",
    title: { de: "PWA-Unterstützung", en: "PWA support" },
    description: {
      de: "Installiere MedPrüf auf deinem Startbildschirm für schnellen Zugriff.",
      en: "Install MedPrüf on your home screen for quick access.",
    },
  },
  {
    date: "2026-04-08",
    tag: "improvement",
    title: { de: "Dark Mode", en: "Dark mode" },
    description: {
      de: "Vollständiger Dunkelmodus mit Umschalter in der Kopfzeile.",
      en: "Full dark mode with toggle in the header.",
    },
  },

  // ═══ 2026-04-07 ═══
  {
    date: "2026-04-07",
    tag: "feature",
    title: { de: "Individueller Prüfungs-Builder", en: "Custom exam builder" },
    description: {
      de: "Erstelle deine eigene Prüfung mit Filtern für Fächer, Tags, Prüfungsdaten und mehr.",
      en: "Create your own exam with filters for subjects, tags, exam dates, and more.",
    },
  },
  {
    date: "2026-04-07",
    tag: "feature",
    title: { de: "Suchfunktion", en: "Search function" },
    description: {
      de: "Suche schnell nach Fragen mit Cmd+K oder dem Suchsymbol.",
      en: "Quickly search for questions with Cmd+K or the search icon.",
    },
  },

  // ═══ 2026-04-06 ═══
  {
    date: "2026-04-06",
    tag: "feature",
    title: { de: "7.725 Fragen importiert", en: "7,725 questions imported" },
    description: {
      de: "Vollständige Fragensammlung aus SIP 4 & SIP 5 ist jetzt verfügbar, einschließlich Bildern.",
      en: "Complete question bank from SIP 4 & SIP 5 is now available, including images.",
    },
  },
  {
    date: "2026-04-06",
    tag: "feature",
    title: { de: "Multi-Antwort-Fragen", en: "Multi-select questions" },
    description: {
      de: "Unterstützung für Fragen mit mehreren richtigen Antworten (Checkbox-UI).",
      en: "Support for questions with multiple correct answers (checkbox UI).",
    },
  },

  // ═══ 2026-04-05 ═══
  {
    date: "2026-04-05",
    tag: "feature",
    title: { de: "Telegram-Anmeldung", en: "Telegram login" },
    description: {
      de: "Melde dich mit deinem Telegram-Konto an — schnell und sicher.",
      en: "Sign in with your Telegram account — fast and secure.",
    },
  },
  {
    date: "2026-04-05",
    tag: "feature",
    title: { de: "Prüfungssimulation", en: "Exam simulation" },
    description: {
      de: "Vollständige 250-Fragen-Prüfungssimulation mit 4-Stunden-Zeitlimit.",
      en: "Full 250-question exam simulation with 4-hour time limit.",
    },
  },

  // ═══ 2026-04-04 ═══
  {
    date: "2026-04-04",
    tag: "feature",
    title: { de: "XP & Streaks", en: "XP & Streaks" },
    description: {
      de: "Verdiene XP für jede beantwortete Frage und halte deine tägliche Serie aufrecht.",
      en: "Earn XP for every answered question and maintain your daily streak.",
    },
  },
  {
    date: "2026-04-04",
    tag: "feature",
    title: { de: "Lesezeichen & Notizen", en: "Bookmarks & notes" },
    description: {
      de: "Markiere Fragen als Favoriten und füge persönliche Notizen hinzu.",
      en: "Bookmark questions and add personal notes.",
    },
  },

  // ═══ 2026-04-01 ═══
  {
    date: "2026-04-01",
    tag: "feature",
    title: { de: "MedPrüf Launch", en: "MedPrüf Launch" },
    description: {
      de: "MedPrüf ist live! Die erste App speziell für die österreichische Kenntnisprüfung (Wien).",
      en: "MedPrüf is live! The first app specifically for the Austrian Kenntnisprüfung (Vienna).",
    },
  },
];
