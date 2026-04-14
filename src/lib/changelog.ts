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
  // ═══ 2026-04-14 ═══
  {
    date: "2026-04-14",
    tag: "improvement",
    title: {
      de: "Automatische Updates: Neue Versionen ohne Neuladen",
      en: "Automatic updates: new versions without manual reload",
    },
    description: {
      de: 'Die App erkennt jetzt automatisch, wenn eine neue Version bereitsteht. Du siehst eine "Neue Version verfügbar"-Anzeige und kannst mit einem Klick neu laden. Der Cache wird bei jedem Deploy automatisch geleert – keine hängenden alten Versionen mehr.',
      en: `The app now automatically detects when a new version is available. You'll see a "New version available" prompt and can reload with one click. The cache is purged automatically on every deploy — no more stale old versions.`,
    },
  },
  {
    date: "2026-04-14",
    tag: "admin",
    title: {
      de: "Fragen-Meldungen erfassen jetzt vollständigen Kontext",
      en: "Question reports now capture full context",
    },
    description: {
      de: "Bei jeder gemeldeten Frage werden jetzt URL, Prüfungstyp, Gerät und Browser mitgespeichert – auch bei anonymen und Gast-Nutzern. Dadurch kann jede Meldung zuverlässig nachverfolgt werden.",
      en: "Every question report now captures URL, exam type, device, and browser — even for anonymous and guest users. This makes every report traceable and triageable.",
    },
  },
  {
    date: "2026-04-14",
    tag: "admin",
    title: {
      de: "152 unvollständige Vienna-2026-Fragen ergänzt",
      en: "152 incomplete Vienna 2026 questions completed",
    },
    description: {
      de: "Beim Import der Vienna-2026-Prüfungen wurden bei 152 Fragen nicht alle Antwortoptionen korrekt extrahiert. Die fehlenden Distraktoren wurden für alle betroffenen Fragen ergänzt. Jetzt haben wieder alle Fragen 5 vollständige Antwortoptionen.",
      en: "During the Vienna 2026 exam import, 152 questions had missing answer options. The missing distractors have been added for every affected question. All questions once again have 5 complete answer options.",
    },
  },
  {
    date: "2026-04-14",
    tag: "admin",
    title: {
      de: "9 gemeldete Fragen überprüft und korrigiert",
      en: "9 reported questions reviewed and fixed",
    },
    description: {
      de: "Nutzer-Meldungen zu fehlenden Antwortoptionen (Vienna 2026 Import), falschen Antworten und unvollständigen Erklärungen wurden bearbeitet: Pulmonalembolie-Reanimation, Peritonsillarabszess-Komplikationen, Netzhautperipherie-Untersuchung, SLE/Skleritis, MS/Dimethylfumarat-Monitoring und Adenoviren-Konjunktivitis.",
      en: "User reports about missing answer options (Vienna 2026 import), wrong answers, and incomplete explanations have been resolved: pulmonary embolism reanimation, peritonsillar abscess complications, peripheral retina examination, SLE/scleritis, MS/Dimethylfumarate monitoring, and adenovirus conjunctivitis.",
    },
  },
  {
    date: "2026-04-14",
    tag: "fix",
    title: {
      de: "Service Worker: neue Deploys werden sofort übernommen",
      en: "Service worker: new deploys take effect immediately",
    },
    description: {
      de: "Der Service Worker hat HTML- und JavaScript-Dateien zu aggressiv gecacht (stale-while-revalidate). Neue Features wurden daher erst nach mehrfachem Neuladen sichtbar. Ab jetzt werden HTML-Seiten und Next.js-Bundles immer frisch vom Netz geladen; Icons und Bilder bleiben offline verfügbar.",
      en: "The service worker was caching HTML and JavaScript too aggressively (stale-while-revalidate), so new features only appeared after multiple reloads. From now on, HTML pages and Next.js bundles always load fresh from the network; icons and images remain available offline.",
    },
  },
  // ═══ 2026-04-12 ═══
  {
    date: "2026-04-12",
    tag: "feature",
    title: {
      de: "Neue Prüfung: KMP Innsbruck (3.091 Fragen)",
      en: "New exam: KMP Innsbruck (3,091 questions)",
    },
    description: {
      de: "Die Kumulative Modulprüfung (KMP) der Medizinischen Universität Innsbruck ist jetzt verfügbar. 3.091 Fragen in 12 Fachgebieten. Wählen Sie im Prüfungs-Umschalter in der Seitenleiste zwischen Kenntnisprüfung Wien, KMP Innsbruck und Pharmakologie.",
      en: "The Cumulative Module Exam (KMP) from the Medical University of Innsbruck is now available. 3,091 questions across 12 specialties. Use the exam switcher in the sidebar to choose between Vienna Kenntnisprüfung, KMP Innsbruck, and Pharmacology.",
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
      de: "335 Kurzantwort-Fragen zur Pharmakologie und Rezeptierkunde sind jetzt verfügbar. Ideal zur Vorbereitung auf den Pharmakologie-Teil der Prüfung.",
      en: "335 short-answer questions on pharmacology and prescription studies are now available. Ideal for preparing the pharmacology section of the exam.",
    },
  },
  {
    date: "2026-04-12",
    tag: "feature",
    title: {
      de: "Februar-2026 SIP5a Prüfungsfragen hinzugefügt",
      en: "February 2026 SIP5a exam questions added",
    },
    description: {
      de: "154 brandneue Fragen aus der Wiener SIP5a Prüfung vom Februar 2026 wurden in die Kenntnisprüfung-Bibliothek aufgenommen.",
      en: "154 brand-new questions from the Vienna SIP5a exam (February 2026) have been added to the Kenntnisprüfung library.",
    },
  },
  {
    date: "2026-04-12",
    tag: "feature",
    title: {
      de: "Prüfungssimulation komplett überarbeitet",
      en: "Exam simulation completely redesigned",
    },
    description: {
      de: "Die Prüfungssimulation funktioniert jetzt wie eine echte Prüfung: Antworten auswählen, frei zwischen Fragen navigieren und am Ende abgeben. Keine sofortige Korrektur mehr bei jeder Frage. Links sehen Sie eine fachbasierte Übersicht mit Fortschritt pro Fachgebiet.",
      en: "The exam simulation now works like a real exam: select answers, navigate freely between questions, and submit when done. No instant feedback per question. A topic-based navigator on the left shows your progress by specialty.",
    },
  },
  {
    date: "2026-04-12",
    tag: "feature",
    title: {
      de: "Lesezeichen und Fehler wiederholen",
      en: "Bookmarks and mistake review",
    },
    description: {
      de: "Auf der Startseite gibt es jetzt Schnellzugriff auf gespeicherte Fragen und falsch beantwortete Fragen, damit Sie gezielt wiederholen können.",
      en: "The home page now has quick access to your bookmarked questions and questions you got wrong, so you can review them efficiently.",
    },
  },
  {
    date: "2026-04-12",
    tag: "improvement",
    title: {
      de: "Themen-Karten zeigen Ihren Fortschritt",
      en: "Topic cards show your progress",
    },
    description: {
      de: "Jede Fachgebietskarte auf der Startseite zeigt jetzt Ihre Genauigkeit, einen Stärke-Indikator und wie viele Fragen Sie bereits bearbeitet haben.",
      en: "Each specialty card on the home page now shows your accuracy, a strength indicator, and how many questions you have practiced.",
    },
  },
  {
    date: "2026-04-12",
    tag: "improvement",
    title: {
      de: "Fragenqualität verbessert",
      en: "Question quality improved",
    },
    description: {
      de: "Alle Fragen wurden gegen offizielle Prüfungsunterlagen abgeglichen. Falsch zugeordnete Fragen wurden korrigiert und Duplikate entfernt. Insgesamt jetzt fast 11.000 aktive Fragen.",
      en: "All questions were validated against official exam sources. Mis-assigned questions were corrected and duplicates removed. Nearly 11,000 active questions total.",
    },
  },
  {
    date: "2026-04-12",
    tag: "improvement",
    title: {
      de: "Navigation und Seitenleiste verbessert",
      en: "Navigation and sidebar improved",
    },
    description: {
      de: "Die Seitenleiste wurde kompakter gestaltet und passt ohne Scrollen auf den Desktop. Profil und Einstellungen wurden zusammengeführt.",
      en: "The sidebar has been made more compact and fits on desktop without scrolling. Profile and settings have been merged into one page.",
    },
  },
  {
    date: "2026-04-12",
    tag: "admin",
    title: {
      de: "Datenbank-Bereinigung und Schema-Erweiterung",
      en: "Database cleanup and schema extension",
    },
    description: {
      de: "7.900 Legacy-Einträge entfernt, exam_type/content_hash Spalten, get_topic_counts() RPC, normalize_question_text() Funktion, pdf_question_index + topic_reclassifications Tabellen, 94 Duplikate per SHA256-Hash entfernt, Prüfungs-Umschalter API, Admin exam_type Filter.",
      en: "Purged 7,900 legacy rows, added exam_type/content_hash columns, get_topic_counts() RPC, normalize_question_text() function, pdf_question_index + topic_reclassifications tables, removed 94 duplicates via SHA256 hash, exam preference API, admin exam_type filter.",
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
