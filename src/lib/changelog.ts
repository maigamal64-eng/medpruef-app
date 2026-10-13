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
  {
    date: "2026-10-14",
    tag: "improvement",
    title: { de: "Hinweis zum Ende des Zugangs: Tarife in der Reihenfolge der Preisseite", en: "Access-ending notice: plans in the same order as the pricing page" },
    description: {
      de: "Die E-Mail vor dem Ende Ihres Pro-Zugangs nennt die Tarife jetzt wie die Preisseite: zuerst 3 Monate (empfohlen), dann das Monatsabo, dann die Prüfungs-Kohorte. Sie sagt außerdem klar, dass Sie einen neuen Tarif erst nach dem Ende Ihres aktuellen Zugangs buchen können.",
      en: "The email before your Pro access ends now lists the plans as the pricing page does: 3 months (recommended) first, then the monthly plan, then the Exam Cohort. It also states clearly that you can book a new plan only after your current access ends.",
    },
  },
  {
    date: "2026-10-14",
    tag: "improvement",
    title: { de: "Stichprobentest: Anmeldeschluss für Rezeptierkunde und Gerichtsmedizin auf der Startseite", en: "Stichprobentest: Rezeptierkunde and Gerichtsmedizin registration close on Home" },
    description: {
      de: "Wenn Sie mit der Stichprobentest-Fragenbank lernen, zeigt die Startseite jetzt auch den Anmeldeschluss für Rezeptierkunde und Gerichtsmedizin an der MedUni Wien, solange die Anmeldung offen ist, mit Quelle und einem Link zur Anmeldeanleitung. Ihre gewählte Fragenbank bleibt unverändert. Der Hinweis gilt nur, wenn Ihr Antrag an der MedUni Wien läuft.",
      en: "If you study with the Stichprobentest bank, Home now also shows the MedUni Wien registration close for Rezeptierkunde and Gerichtsmedizin while registration is open, with its source and a link to the registration guide. Your chosen question bank stays as it is. The note applies only if your application is filed at MedUni Wien.",
    },
  },
  {
    date: "2026-10-13",
    tag: "admin",
    title: { de: "Admin auf dem Handy: größere Ziele, Karten statt breiter Tabellen", en: "Admin on phones: bigger targets, cards instead of wide tables" },
    description: {
      de: "Die Geldleiste auf Today zeigt unter 400 px zwei Spalten. Die Zahlungstabellen werden unter 1024 px zu Karten. Die Lernenden-Filter liegen auf dem Handy in einem Filter-Blatt mit Zähler. Fragen blättern mit Seite x von y. Retry-, Melde- und Filterknöpfe sind mindestens 44 px hoch.",
      en: "Today's money strip uses two columns under 400 px. Payment tables become cards under 1024 px. Learner filters sit in a Filters sheet with a count on phones. Questions page with page x of y. Retry, note-report and filter buttons are at least 44 px tall.",
    },
  },
  {
    date: "2026-10-13",
    tag: "fix",
    title: { de: "Ältere Tabs laden sich nach einem Update selbst neu", en: "Older tabs reload themselves after an update" },
    description: {
      de: "War ein Tab seit einem Update geöffnet, konnte eine Seite wie das Üben manchmal nicht mehr laden. Die App holt Seitendaten jetzt immer frisch. Kann ein Teil der Seite trotzdem nicht geladen werden, lädt sich der Tab einmal automatisch neu.",
      en: "A tab left open across an update could sometimes fail to load a page such as practice. The app now always fetches page data fresh. If part of a page still cannot load, the tab reloads itself once.",
    },
  },
  {
    date: "2026-10-13",
    tag: "improvement",
    title: { de: "Telegram-Bot mit klarerer Begrüßung", en: "Clearer welcome in the Telegram bot" },
    description: {
      de: "Der MedPrüf-Bot begrüßt Sie jetzt mit einer kurzen, sachlichen Beschreibung und nennt die Fragenbanken mit ihren aktuellen Namen. Die Aktivierungsnachricht spricht Sie mit Sie an.",
      en: "The MedPrüf bot now welcomes you with a short, factual description and names the question banks as they are called today. The activation message is worded more clearly.",
    },
  },
  {
    date: "2026-10-13",
    tag: "fix",
    title: { de: "Arabischer Hinweis auf \"Welche Fragenbank passt zu Ihnen?\" korrigiert", en: "Arabic note on \"Which question bank fits you?\" corrected" },
    description: {
      de: "Der arabische Text beschrieb eine andere Prüfung mit festen Terminen und Gebühren. Er sagt jetzt wie die deutsche und englische Fassung, dass die Wiener Fragenbank auf SIP4a/SIP5a-Material beruht und die ÖÄK-Prüfung eine eigene Prüfung ist.",
      en: "The Arabic text described a different exam with fixed dates and fees. Like the German and English versions, it now says the Vienna bank is built on SIP4a/SIP5a material and the ÖÄK exam is a separate exam.",
    },
  },
  {
    date: "2026-10-13",
    tag: "admin",
    title: { de: "Datenbank entlastet vor der Anmeldefrist", en: "Database relief before the registration deadline" },
    description: {
      de: "Themenzahlen und Fragenbank-Abdeckung kommen aus einem gemeinsamen 24-Stunden-Cache (Bearbeitungen leeren nur die betroffenen Teile, höchstens alle 15 Minuten), Admin-Zähler aktualisieren alle 5 Minuten, ein Tab fragt den Kontostatus nur einmal ab, /api/auth/me liest das Konto einmal, /api/health/db und eine E-Mail-Warnung alle 5 Minuten bei Datenbankausfall. Bei einem Ausfall antworten Antworten und Fragen mit 503 statt einer falschen Bezahlschranke.",
      en: "Topic counts and bank coverage come from a shared 24-hour cache (edits purge only the affected parts, at most every 15 minutes), admin counts refresh every 5 minutes, one tab polls the account state once, /api/auth/me reads the account once, /api/health/db plus an email alert checked every 5 minutes when the database fails. During an outage answers and questions return 503 instead of a false paywall.",
    },
  },
{
  "date": "2026-10-13",
  "tag": "fix",
  "title": {
    "de": "Kopfzeilen überlappen auf dem Handy nicht mehr",
    "en": "Page headers no longer overlap on phones"
  },
  "description": {
    "de": "Auf schmalen Handys lagen in der Kopfzeile von Kenntnisprüfung Wien, Neuigkeiten, Statistik, Fortschritt, Häufige Fragen und Materialien Schalter über dem Titel oder stießen direkt an ihn. Passt nicht alles in eine Zeile, rücken die Schalter jetzt rechtsbündig in eine zweite Zeile. Auf dem Computer sieht alles aus wie bisher.",
    "en": "On narrow phones, controls in the header of Kenntnisprüfung Wien, What's New, Statistics, Progress, FAQ and Materials covered or touched the page title. When everything does not fit one line, the controls now move to a right-aligned second row. Computers look exactly as before."
  }
},
{
  "date": "2026-10-13",
  "tag": "fix",
  "title": {
    "de": "Sechs Seiten passen jetzt auf sehr schmale Handys",
    "en": "Six pages now fit very narrow phones"
  },
  "description": {
    "de": "Auf Handys mit 320 Pixel Breite ließen sich die Seiten Kenntnisprüfung Wien, Stichprobentest, Neuigkeiten, Prüfungssimulation, Statistik und Lehrplan seitlich verschieben. Jetzt rücken Sprachwahl und Schalter in eine zweite Zeile, lange Titel werden getrennt und die Statistik-Kacheln teilen sich die Breite. Auf breiteren Bildschirmen sieht alles aus wie bisher.",
    "en": "On 320 pixel wide phones the Kenntnisprüfung Wien, Stichprobentest, What's New, exam simulation, Statistics and curriculum pages could be dragged sideways. Language and theme controls now move to a second row, long titles break cleanly and the Statistics tiles share the width. Wider screens look exactly as before."
  }
},
{
  "date": "2026-10-13",
  "tag": "fix",
  "title": {
    "de": "Feedback-Knopf auf dem Handy wieder an seinem Platz, Kurzanleitung KAF bei den Materialien",
    "en": "Phone feedback button back in place, KAF short guide under Materials"
  },
  "description": {
    "de": "Auf dem Handy schwebt der Feedback-Knopf wieder unten rechts, statt am Seitenende halb abgeschnitten zwischen den Inhalten zu stehen. Unter Materialien finden Sie jetzt auch die Kurzanleitung der MedUni Wien zu Kurzantwortfragen (KAF), dazu die Seiten zur Antragstellung und zu Med.Campus; jeder offizielle Link wurde am 13. Oktober 2026 geprüft.",
    "en": "On phones the feedback button floats at the bottom right again instead of sitting half cut off at the end of the page. Materials now also lists the MedUni Wien short guide to short-answer questions (KAF), plus the application and Med.Campus pages; every official link was checked on 13 October 2026."
  }
},
{
  "date": "2026-10-12",
  "tag": "admin",
  "title": {
    "de": "a44: Gerichtsmedizin vorbereitet (Schalter aus)",
    "en": "a44: Gerichtsmedizin prepared (flag off)"
  },
  "description": {
    "de": "128 von MedPrüf verfasste, je zweimal gegen ihre zitierte Quelle geprüfte Gerichtsmedizin-Fragen liegen als Daten-Artefakt bereit: Thema Gerichtsmedizin in der Fragenbank Pharmakologie / Rezeptierkunde, zuerst inaktiv eingefügt, freigeschaltet nur über das b20-Aktivierungstor in Stapeln (127 Fragen, eine wegen Überschneidung zurückgehalten; das Tor ist bei voller Fragenbank noch zu langsam und muss vorher beschleunigt werden). Neu: mündliche Übung unter /gm-practice (Frage ohne Optionen, 10 Minuten, keine Vorbereitungszeit, Musterantwort mit Quelle, Selbsteinschätzung nur auf dem Gerät; Fragen, die ihre Optionen brauchen, bleiben Multiple Choice) und ein Übungsblock auf /gerichtsmedizin mit Formatkarte (Wien nicht bestätigt, zwei Kandidatenberichte als berichtet). Alles erst mit NEXT_PUBLIC_GM_PRACTICE=true und mindestens 100 aktiven Fragen sichtbar.",
    "en": "128 Gerichtsmedizin questions written by MedPrüf, each checked twice against its cited source, are ready as a data artifact: topic Gerichtsmedizin in the Pharmacology / Rezeptierkunde bank, inserted inactive first and activated only through the b20 activation gate in batches (127 questions, one held for an overlap; the gate is still too slow on the full bank and must be sped up first). New: oral practice at /gm-practice (question without options, 10 minutes, no preparation time, model answer with source, self-assessment kept on the device; questions that need their options stay multiple choice) and a practice block on /gerichtsmedizin with a format card (Vienna not confirmed, two candidate accounts marked as reported). Visible only with NEXT_PUBLIC_GM_PRACTICE=true and at least 100 active questions."
  }
},
{
  "date": "2026-10-12",
  "tag": "fix",
  "title": {
    "de": "Elf Antwortschlüssel korrigiert",
    "en": "Eleven answer keys corrected"
  },
  "description": {
    "de": "Wir haben elf Fragen mit falsch markierter Antwort nach zwei unabhängigen medizinischen Prüfungen korrigiert, darunter eine falsche Rasburicase-Dosis. Die Erklärungen wurden passend zur richtigen Antwort neu geschrieben.",
    "en": "After two independent medical reviews we corrected eleven questions with a wrongly marked answer, including a wrong rasburicase dose. Their explanations were rewritten to match the correct answer."
  }
},
{
  "date": "2026-10-12",
  "tag": "admin",
  "title": {
    "de": "Do-not-email-Liste und Zugangsende-Erinnerung vorbereitet",
    "en": "Do-not-email list and access-ending reminder prepared"
  },
  "description": {
    "de": "Abmeldungen und Bounces stehen in einer gemeinsamen Liste, die die Erinnerungsmails und ihre Bestätigungsmails vor dem Senden prüfen; Learners zeigt sie als Markierung. Die Erinnerung zum Zugangsende nennt das tatsächliche Pro-Ende, ist neutral formuliert und bleibt ausgeschaltet. Die Bezahlliste zeigt dasselbe Zugangsende.",
    "en": "Opt-outs and bounces live in one shared list that the reminder mails and their confirmation mails check before sending; Learners shows it as a flag. The access-ending reminder states the real Pro end date, uses neutral wording and stays off. The paid roster shows the same access end."
  }
},
{
  "date": "2026-10-12",
  "tag": "improvement",
  "title": {
    "de": "Übersetzte Erklärungen klar gekennzeichnet",
    "en": "Translated explanations clearly labelled"
  },
  "description": {
    "de": "Übersetzte Erklärungen tragen jetzt den Hinweis, dass sie maschinell übersetzt und noch nicht fachlich geprüft sind; maßgeblich ist das deutsche Original. Eine leere Übersetzung wird nie mehr angezeigt. Wenn Sie Russisch, Ukrainisch, Türkisch oder Arabisch gewählt haben, sagen die Seiten zu Prüfungsweg, Terminen und Regeln jetzt sichtbar, dass Sie die englische Fassung lesen, und sie ändern Ihre gewählte Sprache nicht mehr. Datumsangaben im Hinweis zum Zugangsende stehen in derselben Sprache wie der Satz.",
    "en": "Translated explanations now say that they are machine translated and not yet reviewed; the German original is authoritative. An empty translation is never shown. If you chose Russian, Ukrainian, Turkish or Arabic, the exam pathway, dates and rules pages now say visibly that you are reading the English version, and they no longer change your chosen language. Dates in the access-ending notice are in the same language as the sentence."
  }
},
{
  "date": "2026-10-12",
  "tag": "improvement",
  "title": {
    "de": "Verlauf: Antworten zu früheren Fassungen einer Frage gekennzeichnet",
    "en": "History: answers to earlier versions of a question are marked"
  },
  "description": {
    "de": "Passt eine gespeicherte Antwort im Fragen-Verlauf zu keiner der heutigen Antwortoptionen, etwa weil die Frage seitdem überarbeitet wurde, steht darunter jetzt: Diese Antwort gehört zu einer früheren Fassung der Frage. Die Wertung von damals bleibt erhalten.",
    "en": "If a saved answer in your question history matches none of today's answer options, for example because the question was revised since, it now says: This answer belongs to an earlier version of the question. The result from then is kept."
  }
},
{
  "date": "2026-10-12",
  "tag": "admin",
  "title": {
    "de": "a43: Umstellung Pharmakologie auf Antwortoptionen vorbereitet (Schalter aus)",
    "en": "a43: pharmacology switch to answer options prepared (flag off)"
  },
  "description": {
    "de": "Die Rezeptierkunde-Simulation zieht nur Fragen mit fünf Optionen und genau einer besten Antwort. Ein Hinweis zur Umstellung auf der Pharmakologie-Übung erscheint erst mit NEXT_PUBLIC_PHARMA_MC_NOTE=true, im selben Release wie die geprüften Daten. Probelauf der vorbereiteten SQL auf PostgreSQL 16: Die Blocks laufen, die MC-Stapel brechen auf dem heutigen Schema sicher ab und müssen neu erzeugt werden.",
    "en": "The Rezeptierkunde simulation draws only items with five options and exactly one best answer. A note about the switch on pharmacology practice appears only with NEXT_PUBLIC_PHARMA_MC_NOTE=true, in the same release as the reviewed data. PostgreSQL 16 rehearsal of the staged SQL: block tags apply, the MC batches abort safely on today's schema and must be regenerated."
  }
},
{
  "date": "2026-10-12",
  "tag": "improvement",
  "title": {
    "de": "Offline lernen: ganze Fragenbank oder ein Fachgebiet herunterladen",
    "en": "Study offline: download the whole bank or one subject"
  },
  "description": {
    "de": "Unter Einstellungen, Offline lernen laden Sie jetzt die ganze Fragenbank Ihrer Prüfung oder ein Fachgebiet herunter, auf Wunsch mit Bildern. Sie sehen vorher Anzahl und ungefähre Größe, danach den Fortschritt, und ein unterbrochener Download lässt sich fortsetzen. Startseite und Übungsseite zeigen, wie viele Fragen auf Ihrem Gerät sind. Ist die App bereits geöffnet, üben Sie damit ohne Verbindung weiter; ohne Verbindung neu starten lässt sich die App noch nicht, und die Hinweisseite sagt das jetzt klar. Auf dem iPhone erklärt MedPrüf in den Einstellungen, wie Sie die App auf den Home-Bildschirm legen, und in Telegram oder Instagram, wie Sie die Seite in Safari öffnen.",
    "en": "Under Settings, Study offline you can now download the whole question bank of your exam or one subject, with images if you like. You see the number and approximate size first, then the progress, and an interrupted download can be resumed. Home and the practice page show how many questions are on your device. If the app is already open, you can keep practising without a connection; the app cannot be restarted without a connection yet, and the notice page now says so clearly. On iPhone, Settings explains how to add MedPrüf to the Home Screen, and inside Telegram or Instagram how to open the page in Safari."
  }
},
  {
    date: "2026-09-20",
    tag: "feature",
    title: {
      de: "Neu: Dein Verlauf (Pro)",
      en: "New: Your History (Pro)",
    },
    description: {
      de: "Jede gespeicherte Prüfungssimulation bleibt jetzt dauerhaft erhalten: öffne sie jederzeit wieder, Frage für Frage, mit deiner Auswahl, der richtigen Antwort und der Erklärung dazu. Außerdem findest du unter „Verlauf“ deinen kompletten Fragen-Verlauf (filterbar nach Prüfung, Fachgebiet, richtig/falsch und Zeitraum) und eine Übersicht über deinen Fortschritt. Verlauf ist ein Pro-Feature; gespeicherte Prüfungen bleiben auch für dich gespeichert, wenn du später upgradest.",
      en: "Every exam simulation you submit is now saved for good: reopen it any time, question by question, with your answer, the correct answer and the explanation. The question history tab lets you browse every question you ever answered, filterable by exam, specialty, correct/wrong and time window, alongside a progress overview. History is a Pro feature; your attempts keep saving either way.",
    },
  },
  {
    date: "2026-07-09",
    tag: "improvement",
    title: {
      de: "Pro-Testphase: 7 Tage gratis, Karte hinterlegen",
      en: "Pro trial: 7 days free, card on file",
    },
    description: {
      de: "Die Pro-Testphase läuft wieder über Whop mit hinterlegter Karte: heute 0 €, 7 Tage voller Pro-Zugang, danach 19 €/Monat, jederzeit in der Testphase kündbar. Alles klar angeschrieben, keine versteckte Verlängerung. Die Karte hält die Testphase ernst und deckt die echten KI-Kosten von Pro.",
      en: "The Pro trial runs through Whop with a card on file again: €0 today, 7 days of full Pro, then €19/month, cancel anytime during the trial. All stated up front, no hidden renewal. The card keeps the trial serious and covers Pro's real AI costs.",
    },
  },
  {
    date: "2026-07-01",
    tag: "improvement",
    title: {
      de: "Hinweis auf die Gratis-Testwoche im Dashboard",
      en: "Free trial reminder on the dashboard",
    },
    description: {
      de: "Kostenlose Nutzer sehen beim Öffnen der App jetzt einen kurzen, schließbaren Hinweis auf die 7-tägige Pro-Testwoche direkt im Dashboard. Einmal geschlossen, erscheint er nicht erneut.",
      en: "Free users now see a short, dismissible reminder about the 7-day Pro trial right on the dashboard when they open the app. Once closed, it won't reappear.",
    },
  },
  {
    date: "2026-06-30",
    tag: "feature",
    title: {
      de: "Neu: Lernkarten-Notizen + deine Bibliothek",
      en: "New: flash-notes + your Library",
    },
    description: {
      de: "Mach mit einem Tipp aus jeder Frage, jeder Notiz oder jeder KI-Erklärung eine Lernkarte. Du kannst die Sprache wählen und einen Fokus angeben, und deine Antwort fließt mit ein, damit die Karte genau deine Lücken trifft. Alle Karten leben in deiner neuen Bibliothek (jetzt der mittlere Knopf in der unteren Leiste) und lassen sich dort durchsuchen, sortieren und mit Spaced Repetition wiederholen. Jede Karte zeigt auch ihre Quellen (Ursprungsfrage, KI-Nachricht, Bild).",
      en: "Turn any question, note, or AI explanation into a flash-note with one tap. Choose the language, add a focus, and your own answer is factored in so the card targets your gaps. Every card lives in your new Library (now the center button in the bottom bar), where you can search, sort, and review it with spaced repetition. Each card also shows its sources (the question, the AI message, the image).",
    },
  },
  {
    date: "2026-06-26",
    tag: "improvement",
    title: {
      de: "Lesbarer Dunkelmodus, neue Ladeanimation und ein aufgeräumter Hilfe-Button",
      en: "Readable dark mode, a new loading animation, and a tidier help button",
    },
    description: {
      de: "Der Dunkelmodus ist jetzt durchgehend in unserem Oxford-Blau gehalten, mit klar lesbarem Text auf jeder Karte (kein Dunkel-auf-Dunkel mehr). Beim Laden begrüßt dich neu eine ruhige EKG-Herzschlag-Animation mit dem MedPrüf-Logo. Und die zwei schwebenden Buttons unten rechts sind am Handy zu einem einzigen Button zusammengefasst, der Chat und Feedback aufklappt, sauber über der unteren Navigation.",
      en: "Dark mode is now consistently in our Oxford blue with clearly readable text on every card (no more dark-on-dark). A calm ECG heartbeat animation with the MedPrüf logo now greets you while pages load. And on mobile the two floating buttons in the bottom-right are merged into one button that fans up Chat and Feedback, cleanly above the bottom navigation.",
    },
  },
  {
    date: "2026-06-20",
    tag: "feature",
    title: {
      de: "Neuer Prüfungskalender, immer aktuell",
      en: "New exam calendar, always current",
    },
    description: {
      de: "Auf der Startseite und der Preisseite gibt es jetzt einen Prüfungskalender mit den nächsten Terminen: Kenntnisprüfung Wien am 28. September 2026 (Anmeldeschluss 28. Juli) und der nationale Stichprobentest (KMP) am 23. September 2026 in Graz (Anmeldeschluss 26. August). Die Pharmakologie-Prüfung hat keinen fixen Jahrestermin, sie folgt den Semesterwochen deiner Universität und wird entsprechend angezeigt. Der Kalender pflegt sich selbst: vergangene Termine fallen automatisch heraus, sobald sie vorbei sind, sodass die Daten immer stimmen.",
      en: "The home page and the pricing page now show an exam calendar with the next dates: Kenntnisprüfung Vienna on 28 September 2026 (registration closes 28 July) and the national Stichprobentest (KMP) on 23 September 2026 in Graz (registration closes 26 August). The Pharmakologie exam has no fixed annual date, it follows your university's semester weeks and is shown that way. The calendar maintains itself: past dates drop off automatically once they pass, so the dates are always correct.",
    },
  },
  {
    date: "2026-04-26",
    tag: "fix",
    title: {
      de: "Telegram-Bot antwortet jetzt auf /start, plus 9 UX-Fixes",
      en: "Telegram bot now replies to /start, plus 9 UX fixes",
    },
    description: {
      de: "Der Telegram-Bot hat auf einen leeren /start-Befehl bisher gar nicht reagiert: Nutzer sahen nur Stille. Jetzt antwortet er sofort mit einer Willkommensnachricht und zwei Buttons: „MedPrüf öffnen & anmelden\" und „Mini App öffnen\". Außerdem: Der Bot antwortet ab sofort in der Sprache, die du in der App verwendest (DE/EN), nicht mehr immer auf Englisch. Das PWA-Installationsbanner überlagert den Seiteninhalt nicht mehr, es sitzt jetzt als schmale Leiste oben. Der Feedback-Button überlappt nicht mehr die untere Navigation auf Mobilgeräten. Der \"Bot aktivieren\"-Banner wird innerhalb der Telegram-App selbst nicht mehr angezeigt. Der Preis in der Beschreibung wurde auf €79 für 3 Monate korrigiert (von fälschlich €19). Weitere kleinere Verbesserungen.",
      en: "The Telegram bot was completely silent when you sent a bare /start command: users saw nothing. It now replies immediately with a welcome message and two buttons: \"Open MedPrüf & sign in\" and \"Open Mini App\". Also: the bot now replies in the language you're using in the app (DE/EN) instead of always defaulting to English. The PWA install banner no longer overlaps page content; it's now a slim bar pinned to the top. The feedback button no longer overlaps the bottom nav on mobile. The \"Activate bot\" banner is no longer shown when you're already inside the Telegram app. The price in the description was corrected to €79 for 3 months (was incorrectly €19). Plus other minor polish.",
    },
  },
  {
    date: "2026-04-23",
    tag: "improvement",
    title: {
      de: "Landing, Preise & FAQ: Premium-Politur",
      en: "Landing, Pricing & FAQ: premium polish",
    },
    description: {
      de: "Öffentliche Flächen komplett überarbeitet. Landing: neues Mobile-Hamburger-Menü, Hero-CTAs stapeln sich jetzt sauber auf schmalen Screens, sichtbare Zahlenreihe (10.992 Fragen · 3 Prüfungen · 7 Sprachen · 1.806 Mehrfachantworten) schrumpft nicht mehr zusammen. Pricing: Mobile-Reihenfolge priorisiert 6 Monate („Beliebt\") vor 3/12/Monatlich, ruhigere Referral- und Pass-Until-You-Pass-Blöcke unter den Tarifkarten, Warteliste-Dialog in klar „du\"-freundlicher Tonalität. FAQ: sticky Inhaltsverzeichnis links am Desktop, aufklappbar am Handy, Info-Callouts für harte Regeln (max. 2 Zyklen, kein SEPA), „Zurück zu den Preisen\"-CTA am Ende der relevantesten Antworten.",
      en: "Public-facing surfaces re-polished end-to-end. Landing: new mobile hamburger menu, hero CTAs stack cleanly on narrow screens, the stats strip (10,992 questions · 3 exam types · 7 languages · 1,806 multi-correct) now renders coherently on every viewport. Pricing: mobile tier order prioritises 6 months (\"Popular\") ahead of 3/12/monthly, referral and Pass-Until-You-Pass blocks subordinate visually to the tier cards above them, waitlist dialog rewritten in \"du\"-friendly tone. FAQ: sticky TOC on desktop, collapsible TOC on mobile, info callouts for hard constraints (max 2 cycles, no SEPA), \"Back to pricing\" CTA at the end of the highest-intent answers.",
    },
  },
  {
    date: "2026-04-18",
    tag: "improvement",
    title: {
      de: "Alle zwischengespeicherten KI-Erklärungen im neuen strikten Format neu generiert",
      en: "All cached AI explanations regenerated in the new strict format",
    },
    description: {
      de: "Seit 17.04. läuft ein neuer, strikter Prompt für die KI-Erklärungen: TL;DR → Begründung der richtigen Antwort → Distraktor-Analyse → Leitlinien-Referenzen (ERC 2021, ESC, ÖDG, Österreichischer Impfplan). Ältere Erklärungen mit dem alten, unstrukturierten Format wurden im Hintergrund aktualisiert, damit alle Nutzer (auch kostenlose) sofort die klarere Fassung sehen, ohne „Neu generieren\u201C zu klicken. Bewertungen wurden zurückgesetzt, damit die neuen Erklärungen auf ihren eigenen Beinen stehen.",
      en: "Since Apr 17, a new strict prompt powers AI explanations: TL;DR → correct-answer reasoning → distractor-by-distractor breakdown → guideline citations (ERC 2021, ESC, ÖDG, Austrian immunization schedule). Older cached explanations from the pre-Apr-17 loose prompt were regenerated in the background so every user (including free) sees the crisper version immediately, no need to click \"Regenerate.\" Ratings were reset so the new explanations are judged on their own merits.",
    },
  },
  // ═══ 2026-04-12 ═══
  {
    date: "2026-04-12",
    tag: "feature",
    title: {
      de: "Neue Prüfung: KMP Innsbruck",
      en: "New exam: KMP Innsbruck",
    },
    description: {
      de: "Die Vorbereitung für Innsbruck ist jetzt verfügbar. Wählen Sie im Prüfungs-Umschalter in der Seitenleiste zwischen Kenntnisprüfung Wien, KMP Innsbruck und Pharmakologie.",
      en: "Preparation for Innsbruck is now available. Use the exam switcher in the sidebar to choose between Vienna Kenntnisprüfung, KMP Innsbruck, and Pharmacology.",
    },
  },
{
  "date": "2026-10-12",
  "tag": "improvement",
  "title": {
    "de": "Offline lernen: Fachgebiete herunterladen, mit bezahltem Plan die ganze Fragenbank",
    "en": "Study offline: download subjects, the whole bank with a paid plan"
  },
  "description": {
    "de": "Unter Einstellungen, Offline lernen laden Sie jetzt ein Fachgebiet Ihrer Prüfung herunter, auf Wunsch mit Bildern. Mit einem bezahlten Plan laden Sie auch die ganze Fragenbank; im kostenlosen Zugang und während des Pro-Tests laden Sie einzelne Fachgebiete; der kostenlose Zugang bleibt auf Ihre kostenlosen Fragen begrenzt. Sie sehen vorher Anzahl und ungefähre Größe, danach den Fortschritt, und ein unterbrochener Download lässt sich fortsetzen. Startseite und Übungsseite zeigen, wie viele Fragen auf Ihrem Gerät sind. Ist die App bereits geöffnet, üben Sie damit ohne Verbindung weiter; ohne Verbindung neu starten lässt sich die App noch nicht, und die Hinweisseite sagt das jetzt klar. Auf dem iPhone erklärt MedPrüf in den Einstellungen, wie Sie die App auf den Home-Bildschirm legen, und in Telegram oder Instagram, wie Sie die Seite in Safari öffnen.",
    "en": "Under Settings, Study offline you can now download a subject of your exam, with images if you like. With a paid plan you can also download the whole question bank; with free access and during the Pro trial you download single subjects; free access stays limited to your free questions. You see the number and approximate size first, then the progress, and an interrupted download can be resumed. Home and the practice page show how many questions are on your device. If the app is already open, you can keep practising without a connection; the app cannot be restarted without a connection yet, and the notice page now says so clearly. On iPhone, Settings explains how to add MedPrüf to the Home Screen, and inside Telegram or Instagram how to open the page in Safari."
  }
},
{
  "date": "2026-10-12",
  "tag": "improvement",
  "title": {
    "de": "Kostenlose Fragen in jedem Fachgebiet",
    "en": "Free questions in every subject"
  },
  "description": {
    "de": "Die 150 kostenlosen Fragen pro Prüfung verteilen sich jetzt auf alle Fachgebiete, statt fast nur auf eines. Fragen, die Sie schon beantwortet haben, bleiben lesbar, und Ihre bisherigen Antworten zählen weiter. Hat ein Fachgebiet keine kostenlose Frage mehr, sagen wir Ihnen das und zeigen Fachgebiete, in denen noch kostenlose Fragen warten. Auf der Startseite sehen Sie pro Fachgebiet, wie viele kostenlose Fragen übrig sind. Neue Lernende beginnen mit fünf kürzeren Fragen aus verschiedenen Fachgebieten.",
    "en": "The 150 free questions per exam are now spread across all subjects instead of mostly one. Questions you have already answered stay readable, and your earlier answers still count. When a subject has no free question left, we tell you so and show subjects that still have free questions. Home shows how many free questions are left in each subject. New learners start with five shorter questions from different subjects."
  }
},
{
  "date": "2026-10-12",
  "tag": "improvement",
  "title": {
    "de": "Termine mit Quelle und Lesedatum, Garantie mit Beispielen",
    "en": "Dates with source and read date, guarantee with examples"
  },
  "description": {
    "de": "Jeder offizielle Termin im Hinweisbalken, auf der Startseite, im Wegweiser und auf der Stichprobentest-Seite nennt jetzt, wer ihn veröffentlicht hat und wann wir ihn zuletzt gelesen haben, mit Link. Die Pass-Until-You-Pass-Garantie erklärt in FAQ, AGB und Preisen zwei Fälle: einen SIP-Block unter der Bestehensgrenze und die Prüfungen nach dem Stichprobentest. Eine Verlängerung läuft bis zum nächsten offiziellen Termin Ihrer Prüfung mit offener Anmeldung plus 14 Tage.",
    "en": "Every official date in the notice bar, on Home, in the path finder and on the Stichprobentest page now names who published it and when we last read it, with a link. The Pass-Until-You-Pass guarantee explains two cases in the FAQ, terms and pricing: an SIP block under the pass mark and the exams after the Stichprobentest. An extension runs until the next official sitting of your exam with open registration plus 14 days."
  }
},
{
  "date": "2026-10-12",
  "tag": "improvement",
  "title": {
    "de": "Probeprüfung: Hinweis direkt auf der Seite statt Weiterleitung",
    "en": "Mock exam: explanation on the page instead of a redirect"
  },
  "description": {
    "de": "Wenn Sie im kostenlosen Zugang die Probeprüfung öffnen, erklärt ein Hinweis direkt auf der Seite, dass sie Teil von Pro ist, und zeigt die Tarife. Sie werden nicht mehr ohne Erklärung auf die Preisseite umgeleitet und können mit einem Tipp zur Übung zurückkehren.",
    "en": "When you open the mock exam on the free plan, a notice on the page explains that it is part of Pro and shows the plans. You are no longer sent to the pricing page without an explanation, and one tap takes you back to practice."
  }
},
{
  "date": "2026-10-12",
  "tag": "fix",
  "title": {
    "de": "Übersetzungen für Pro wieder ohne Tageslimit",
    "en": "Translations for Pro have no daily limit again"
  },
  "description": {
    "de": "Mit Pro übersetzen Sie Erklärungen wieder ohne Tageslimit, wie versprochen. Bereits übersetzte Erklärungen werden für niemanden mitgezählt. Im kostenlosen Zugang bleiben es 5 neue Übersetzungen pro Tag.",
    "en": "With Pro you can translate explanations without a daily limit again, as promised. Explanations that were already translated never count for anyone. The free plan keeps 5 new translations per day."
  }
},
{
  "date": "2026-10-12",
  "tag": "fix",
  "title": {
    "de": "Rückkehr vom Checkout: klare Meldung, wenn keine Zahlung eingegangen ist",
    "en": "Checkout return: a clear message when no payment arrived"
  },
  "description": {
    "de": "Wenn Sie den Checkout ohne Zahlung verlassen, zeigt die Rückkehrseite nicht mehr „Zahlung wird geprüft“, sondern dass noch keine Zahlung eingegangen ist. Nach einigen Minuten ohne Zahlung sagt sie das eindeutig, Ihr Konto bleibt unverändert, und Sie können den Kauf mit „Erneut versuchen“ neu starten.",
    "en": "If you leave the checkout without paying, the return page no longer says \"Checking payment\" but that no payment has arrived yet. After a few minutes without a payment it says so plainly, your account stays unchanged, and you can start the purchase again with \"Try again\"."
  }
},
{
  "date": "2026-10-12",
  "tag": "feature",
  "title": {
    "de": "Prüfungsinfos mit Quelle: Kalender, Regeln, Umfang und Korrekturen",
    "en": "Exam information with sources: calendar, rules, scope and corrections"
  },
  "description": {
    "de": "Neue öffentliche Seiten zeigen den Prüfungskalender, Formate und Regeln je Prüfung, den Weg nach dem Stichprobentest, Hinweise für Graz und Innsbruck, was MedPrüf nicht abdeckt und welche Fragen korrigiert wurden, jeweils mit offizieller Quelle und Prüfdatum. Jede Prüfungsseite zeigt den Stand ihrer Fragenbank. Die Pharmakologie-Seite nennt das Wiener Rezeptierkunde-Format laut aktueller Ausschreibung und die nächsten Prüfungswochen.",
    "en": "New public pages show the exam calendar, formats and rules per exam, the path after the Stichprobentest, guidance for Graz and Innsbruck, what MedPrüf does not cover and which questions were corrected, each with its official source and check date. Every exam page shows the state of its question bank. The pharmacology page states the Vienna Rezeptierkunde format from the current announcement and the next exam weeks."
  }
},
{
  "date": "2026-10-12",
  "tag": "improvement",
  "title": {
    "de": "Keine Antwort geht verloren, wenn der Server kurz nicht antwortet",
    "en": "No answer is lost when the server briefly stops responding"
  },
  "description": {
    "de": "Antwortet der Server beim Speichern einer Antwort, einer Karteikarten-Bewertung oder eines Simulationsergebnisses nicht rechtzeitig, bleibt der Eintrag auf Ihrem Gerät gespeichert und wird automatisch nachgesendet, auch ohne Verbindungsabbruch. Sie sehen dazu einen Hinweis. Jede Antwort wird dabei nur einmal gezählt, auch für XP und Serie.",
    "en": "If the server does not respond in time while saving an answer, a flashcard rating or an exam simulation result, the entry stays saved on your device and is sent again automatically, even without a lost connection. A note tells you so. Each answer is still counted only once, including XP and streak."
  }
},
{
  "date": "2026-10-12",
  "tag": "improvement",
  "title": {
    "de": "Bibliothek: Lernnotizen bearbeiten, melden und Listen üben",
    "en": "Library: edit and report study notes, practice lists"
  },
  "description": {
    "de": "Lernnotizen lassen sich über ihr Menü bearbeiten und als fehlerhaft melden. Kostenlose Konten sehen, wie viele ihrer 10 Lernnotizen sie verwendet haben. Listen zeigen klare Fehlermeldungen und lassen sich direkt üben. Die Notiz öffnet sich zum Lesen, geübt wird mit „Üben“.",
    "en": "Study notes can be edited and reported from their menu. Free accounts see how many of their 10 study notes they have used. Lists show clear error messages and can be practiced directly. A note opens for reading; practice starts with Practice."
  }
},
{
  "date": "2026-10-12",
  "tag": "feature",
  "title": {
    "de": "Lernplan für alle: vorläufiges Ziel, Aufwand pro Tag und Probeprüfungen",
    "en": "A study plan for everyone: provisional target, daily effort and mock exams"
  },
  "description": {
    "de": "Ohne eigenes Prüfungsdatum plant der Lernplan jetzt bis zum nächsten offiziellen Termin Ihrer Prüfung und zeigt das als vorläufig an; Ihr Profil ändert sich dabei nicht. Ist Ihr Termin vorbei, stellen Sie den Plan mit einem Tipp auf den nächsten Termin um. Der Plan zeigt, wie viele Fragen pro Tag das Datum bedeutet (Schätzung: etwa 1,5 Minuten je Frage), und sagt offen, wenn es knapp wird. In der Wiederholungsphase stehen Probeprüfungen mit Zeitlimit an festen Tagen. Dazu: Phasen mit Datum, beide veröffentlichten Stichprobentest-Fristen mit Quelle, ein ehrlicher Tagesstand, ein leichterer Tag pro Woche und der Weg zurück zum Plan nach dem Üben.",
    "en": "Without your own exam date, the study plan now targets the next official sitting of your exam and marks it as provisional; your profile is not changed. If your date has passed, one tap switches the plan to the next sitting. The plan shows how many questions a day the date implies (estimate: about 1.5 minutes per question) and says plainly when it is tight. Timed mock exams sit on named days in the review phase. Also: phases with dates, both published Stichprobentest deadlines with sources, an honest count for today, one lighter day a week and a way back to the plan after practice."
  }
},
{
  "date": "2026-10-12",
  "tag": "feature",
  "title": {
    "de": "Fortschritt: Countdown, Wochen im Überblick und Stand je Prüfungsfach",
    "en": "Progress: countdown, weeks at a glance and status by exam field"
  },
  "description": {
    "de": "Fortschritt zeigt Ihren eigenen Countdown, Antworten und Trefferquote der letzten 12 Wochen und Ihre Trefferquote je Fach im Vergleich zur 60-%-Marke, mit der offiziellen Regel und der Grundlage daneben. Pro: Nach drei vollständigen Probeprüfungen sehen Sie die Entwicklung je Fach. Das ist keine Vorhersage Ihres Ergebnisses. Der nächste Schritt nennt Ihr schwächstes Fach, das Wissensprofil hat lesbare Fachnamen und eine Liste.",
    "en": "Progress shows your own countdown, answers and accuracy for the last 12 weeks and your accuracy per subject against the 60% mark, with the official rule and the basis beside it. Pro: after three full mock exams you see the trend per subject. This is not a prediction of your result. The next step names your weakest subject, and the knowledge profile has readable subject names and a list."
  }
},
{
  "date": "2026-10-12",
  "tag": "improvement",
  "title": {
    "de": "Lehrplan und Statistik: klare Abdeckung und Stufen als Zahl",
    "en": "Curriculum and statistics: clear coverage and levels as numbers"
  },
  "description": {
    "de": "Im Lehrplan zeigen die Ringe nur noch die Abdeckung, mit Legende und Schwellen, und Sie können nach dem schwächsten Fach sortieren. Für Stichprobentest und Pharmakologie gibt es eine eigene Fächerliste. Die Statistik zeigt Ihre Stufe als Zahl (Stufe 3 von 8).",
    "en": "In the curriculum, rings now show coverage only, with a legend and thresholds, and subjects can be sorted weakest first. Stichprobentest and Pharmacology get their own subject list. Statistics shows your level as a number (Level 3 of 8)."
  }
},
{
  "date": "2026-10-12",
  "tag": "admin",
  "title": {
    "de": "Whop-Zahlungsabgleich nutzt den neuen Konto-Filter",
    "en": "Whop payment lookup uses the new account filter"
  },
  "description": {
    "de": "Whop filtert Zahlungslisten jetzt nach account_id statt company_id. Die Rückkehr aus dem Checkout und die Mentor-Kaufprüfung lesen Zahlungen wieder korrekt.",
    "en": "Whop now filters payment lists by account_id instead of company_id. The checkout return check and the mentor purchase check read payments correctly again."
  }
},
{
  "date": "2026-10-12",
  "tag": "admin",
  "title": {
    "de": "KI-Mentor: Umsatz neben Kosten, ein Berechtigungsschema, Datum für das Ende der Pause (ausgeschaltet)",
    "en": "AI mentor: revenue next to cost, one permission map, a date for the end of a pause (switched off)"
  },
  "description": {
    "de": "Pausiert der Mentor wegen der monatlichen Kostengrenze, sehen Sie, ab wann er voraussichtlich wieder da ist; Ihre Credits bleiben erhalten. Admin: Der Kosten-Tab zeigt Nettoumsatz, echte API-Kosten und Kosten der in Pro enthaltenen Credits der letzten 30 Tage sowie Umsatz je Paket. Die Marge bleibt „Unavailable“, bis Whop-Gebühr und Wechselkurs belegt sind. Alle Mentor-Admin-Routen laufen über dieselbe Berechtigungstabelle wie der Rest des Admin-Bereichs. Der Mentor selbst bleibt ohne Umgebungsschalter aus.",
    "en": "When the monthly spend cap pauses the mentor, you see when it is expected back; your credits are kept. Admin: the Cost tab shows net revenue, true API cost and the cost of Pro-included credits for the last 30 days, plus revenue per package. Margin stays \"Unavailable\" until the Whop fee and exchange rate are on record. All mentor admin routes use the same permission map as the rest of the admin area. The mentor itself stays off without environment switches."
  }
},
{
  "date": "2026-10-12",
  "tag": "admin",
  "title": {
    "de": "KI-Mentor: erster Besuch mit Preis und Beispielantwort, Fragekarte, Heute-Karte, klare Zahlungsfehler (ausgeschaltet)",
    "en": "AI mentor: first visit with price and sample answer, question card, Today card, clear payment errors (switched off)"
  },
  "description": {
    "de": "Ohne Credits zeigt der Mentor den Preis aus dem Paket und eine kostenlose Beispielantwort aus einer geprüften Quelle; das Eingabefeld bleibt mit Begründung geschlossen. Der Gratis-Test ist als solcher beschriftet und endet mit „Das war Ihr Gratis-Test“. Bei einer besprochenen Frage bleiben Stamm und Antworten sichtbar, Ihre Wahl und die richtige Antwort nur nach dem Beantworten. Eine Erklärung lässt sich als Lernkarte speichern. Eine kostenlose Heute-Karte zeigt Tage bis zur Prüfung, das schwächste Fachgebiet und fällige Wiederholungen. Paketkarten nennen Verlängerung und die 3 Tage Nachfrist. Eine fehlgeschlagene Zahlung sagt, was passiert ist (abgelehnt, erstattet oder manuelle Freischaltung mit Referenz). Einträge auf der Übungsfrage, auf Start, bei Fehlern und Terminen sowie eine Mentor-Karte in den Einstellungen erscheinen nur, wenn der Mentor für Sie freigeschaltet ist. Admin: Feedback-Filter „Mentor only“. Öffentliche Texte (Preise, Datenschutz, AGB, FAQ) bleiben hinter NEXT_PUBLIC_MENTOR_PUBLIC_COPY verborgen. Der Mentor bleibt ohne Umgebungsschalter aus.",
    "en": "Without credits the mentor shows the price from the package and a free sample answer from a checked source; the composer stays closed with a reason. The free trial is labelled as such and ends with \"That was your free trial\". A discussed question keeps its stem and options visible, your choice and the key only after answering. An explanation can be saved as a flashcard. A free Today card shows days to the exam, the weakest topic and due reviews. Package cards state renewal and the 3-day grace. A failed payment says what happened (declined, refunded or manual unlock with a reference). Entries on the practice question, Home, mistakes and exam dates and a mentor card in Settings appear only when the mentor is switched on for you. Admin: feedback filter \"Mentor only\". Public copy (pricing, privacy, terms, FAQ) stays hidden behind NEXT_PUBLIC_MENTOR_PUBLIC_COPY. The mentor itself stays off without environment switches."
  }
},
{
  "date": "2026-10-12",
  "tag": "admin",
  "title": {
    "de": "KI-Mentor: ehrliche Abrechnung, Ausblenden statt Stopp, getrennte Kostengrenzen (ausgeschaltet)",
    "en": "AI mentor: honest billing, Hide instead of Stop, separate spend caps (switched off)"
  },
  "description": {
    "de": "Fehler, Absagen und Antworten, in denen der Mentor eine ungeprüfte Angabe ersetzen musste, kosten Sie keine Credits, und die Antwort sagt dann „Nicht berechnet“. Der Knopf „Ausblenden“ blendet eine laufende Antwort aus, der Mentor schreibt sie aber fertig; danach sehen Sie, ob sie berechnet wurde, und können sie ansehen. Reicht Ihr Guthaben nicht mehr für eine neue Nachricht, nennt der Mentor die nötige Mindestmenge an Credits statt „aufgebraucht“. Admin: Mentor und übrige KI-Funktionen haben je einen eigenen Anteil an der monatlichen Kostengrenze (MENTOR_CAP_SHARE_PCT, Standard 50). Neu und sofort aktiv: auch die KI-Erklärung prüft ihren Anteil und pausiert an der Grenze wie Übersetzung und Lernkarten. Der Mentor selbst bleibt ohne Umgebungsschalter aus.",
    "en": "Errors, refusals and answers in which the mentor had to replace an unchecked detail cost you no credits, and the answer then says \"Not charged\". The Hide button hides an answer in progress, but the mentor still finishes it; afterwards you see whether it was charged and can view it. When your balance no longer covers a new message, the mentor names the minimum credits needed instead of saying \"used up\". Admin: the mentor and the other AI features each have their own share of the monthly spend cap (MENTOR_CAP_SHARE_PCT, default 50). New and live right away: the AI explanation also checks its share and pauses at the limit like translation and flash-notes. The mentor itself stays off without environment switches."
  }
},
{
  "date": "2026-10-12",
  "tag": "improvement",
  "title": {
    "de": "Prüfungssimulation: eigene Regeln je Teil, ehrliche Zeit und ein klarer nächster Schritt",
    "en": "Exam simulation: rules per part, honest timing and a clear next step"
  },
  "description": {
    "de": "Die Simulation startet für jede Fragenbank mit eigener Auswahl: Vollsimulation, SIP4a, SIP5a oder Eigene, für Stichprobentest und Pharmakologie ebenfalls mit eigener Auswahl. Bei SIP4a und SIP5a wählen Sie die Fächer, die Sie noch ablegen müssen. Vor dem Start sehen Sie Fragenzahl, Übungszeit und das angekündigte Format des nächsten Termins mit Prüfdatum. Eigene Prüfungen unter 50 Fragen können Sie ohne Zeitlimit üben. Während der Prüfung tickt nur noch die Uhr, die Übersicht öffnet sich als Blatt, Markieren hat eine eigene Taste, und auf Wunsch zeigt eine Tempo-Zeile, ob Sie im Plan liegen. Vor der Abgabe sehen Sie Beantwortet, Offen und Markiert und können direkt zur ersten offenen Frage springen. Das Ergebnis zeigt Richtig, Falsch, Offen, Markiert, Zeit und Zeit pro Frage, die Fächer vom schwächsten an, bei SIP4a die Regel der MedUni Wien je Block mit Quelle, und als nächsten Schritt das Üben genau der falschen und offenen Fragen. Die Antwortübersicht filtert nach Falsch, Offen, Markiert oder Fach. Es bleibt eine Übung, keine Vorhersage.",
    "en": "The simulation now starts with a choice per question bank: full simulation, SIP4a, SIP5a or custom, and a custom run for the Stichprobentest and pharmacology too. For SIP4a and SIP5a you pick the subjects you still have to take. Before starting you see the number of questions, the practice time and the announced format of the next sitting with the date it was checked. Custom runs under 50 questions can run without a time limit. During the exam only the clock ticks, the overview opens as a sheet, flagging has its own button, and an optional pace line shows whether you are on plan. Before submitting you see answered, open and flagged and can jump to the first open question. The result shows correct, wrong, open, flagged, time and time per question, subjects from the weakest, for SIP4a the MedUni Wien rule per block with its source, and as the next step practice of exactly the wrong and open questions. The answer review filters by wrong, open, flagged or subject. It stays practice, not a prediction."
  }
},
{
  "date": "2026-10-12",
  "tag": "improvement",
  "title": {
    "de": "Verlauf für alle Konten und eine eigene Seite pro Prüfung",
    "en": "History for every account and one page per exam"
  },
  "description": {
    "de": "Im Verlauf sehen jetzt auch kostenlose und abgelaufene Konten die Liste ihrer gespeicherten Prüfungen mit Datum und Ergebnis; die Auswertung Frage für Frage bleibt Pro. Jede Prüfung hat eine eigene Adresse mit Zurück-Knopf, Filtern nach Falsch, Offen und Markiert und einem Link, um die falschen Fragen im Quiz zu üben. Ab drei vergleichbaren Prüfungen zeigt eine kleine Linie Ihren Verlauf.",
    "en": "Free and lapsed accounts now see the list of their saved exams with date and score in History; the question-by-question review stays Pro. Every exam has its own address with a back button, filters for wrong, open and flagged, and a link to practise the wrong questions in the quiz. From three comparable exams a small line shows your trend."
  }
},
{
  "date": "2026-10-12",
  "tag": "improvement",
  "title": {
    "de": "Echte Prüfung eintragen: für alle, auch ohne Nachweis",
    "en": "Record your real exam: for everyone, also without proof"
  },
  "description": {
    "de": "Die Seite für das Ergebnis der echten Prüfung fragt jetzt direkt, wie es lief. Jedes Konto kann ein Nicht bestanden eintragen; nur wer die Verlängerung der Prüfungs-Kohorte beanspruchen kann, lädt einen Nachweis hoch. Fotos werden auf dem Handy vor dem Hochladen verkleinert, und nach einem Fehler bleiben Formular und Datei erhalten. Sie erreichen die Seite auch über die Einstellungen und das Simulationsergebnis.",
    "en": "The real-exam result page now asks directly how it went. Every account can record a fail; only learners who can claim the Exam Cohort extension upload proof. Photos are downscaled on the phone before upload, and after an error the form and file stay. You can also reach the page from Settings and the simulation result."
  }
},
{
  "date": "2026-10-12",
  "tag": "admin",
  "title": {
    "de": "a24: Prüfungs-Engine, KAF-Übung und Pharmakologie-Simulation vorbereitet (Schalter aus)",
    "en": "a24: exam engine, KAF practice and pharmacology simulation prepared (flags off)"
  },
  "description": {
    "de": "KAF-Übung unter /exam/kaf hinter KAF_TIMED_ENABLED (aus) mit unangewendetem Changeset 20261223090000 (kaf_items) und einem Seed aus der Medic-Doppelprüfung. Falsche und offene Simulationsfragen als fällige Wiederholung hinter EXAM_MISSES_TO_REVIEW_ENABLED (aus). Rezeptierkunde-Simulation (30 Fragen, 60 Minuten) schaltet sich erst frei, wenn die geprüften MC-Zeilen angewendet sind; Stichprobentest 250 bleibt aus, bis Fächerzuordnung und offizielle Dauer vorliegen.",
    "en": "KAF practice at /exam/kaf behind KAF_TIMED_ENABLED (off) with the unapplied changeset 20261223090000 (kaf_items) and a seed from the two-read Medic triage. Wrong and open simulation items as due reviews behind EXAM_MISSES_TO_REVIEW_ENABLED (off). The Rezeptierkunde simulation (30 questions, 60 minutes) unlocks only once the reviewed MC rows are applied; the Stichprobentest 250 preset stays off until the field mapping and the official duration are confirmed."
  }
},
{
  "date": "2026-10-12",
  "tag": "improvement",
  "title": {
    "de": "Üben, Karteikarten und Fehlerliste sagen genauer, was passiert",
    "en": "Practice, flashcards and the mistake list say more precisely what happens"
  },
  "description": {
    "de": "Im Quiz gibt es vor dem Antworten keinen ausgegrauten Prüfen-Knopf und keine Jahres-Chips mehr; eine Antwort wird beim ersten Tippen geprüft, ein Tippen am Ende eines Wischens zählt nicht. Nach dem Antworten sehen Sie nur die Punkte, die tatsächlich gespeichert wurden, bei Pro den gespeicherten Wiederholungsabstand und eine Zeile mit Thema und Prüfungsjahr. Auf dem Handy bleibt „Nächste Frage“ unten erreichbar, die nächste Frage wird nach dem Speichern vorgeladen. Mehrfachauswahl-Fragen lassen sich erst mit der genannten Anzahl prüfen. Die KI-Erklärung zeigt Fehler als klaren Hinweis mit „Erneut versuchen“ oder dem Zeitpunkt, ab dem es weitergeht. Übersetzt wird nur noch im Tab „Übersetzen“, Ihre Lesesprache bleibt gespeichert. Notizen werden nach dem Speichern geprüft. Im Testbaukasten können Sie SIP4a oder SIP5a üben. Karteikarten haben einen Meldeknopf, zeigen die Frage auch auf der Rückseite, formatieren die Erklärung und öffnen lange Erklärungen mit „Mehr lesen“; Fragen, die ihre Antwortoptionen brauchen, bleiben im Quiz. Meine Fehler zeigt offene und korrigierte Fehler getrennt: Eine Frage gilt als korrigiert, wenn Sie sie danach zweimal richtig beantworten, mit mindestens einem Tag Abstand. Eine gemeldete Frage können Sie überspringen, ohne dass sie gewertet wird.",
    "en": "In the quiz there is no greyed-out check button and no year chips before you answer; an answer is checked on the first tap, and a tap that ends a scroll does not count. After answering you see only the points that were actually saved, with Pro the stored review interval, and one line with topic and exam year. On phones Next question stays reachable at the bottom, and the next question is preloaded after the save. Multiple-answer questions can only be checked with the stated number of picks. The AI explanation shows failures as a clear notice with Try again or the time it continues. Translation now lives only in the Translate tab and your reading language is remembered. Notes are verified after saving. The test builder lets you practise SIP4a or SIP5a. Flashcards have a report button, keep the question on the back, format the explanation and open long ones with Read more; questions that need their answer options stay in the quiz. My mistakes shows open and corrected mistakes separately: a question counts as corrected once you answer it correctly twice afterwards, at least a day apart. A reported question can be skipped without being counted."
  }
},
{
  "date": "2026-10-12",
  "tag": "admin",
  "title": {
    "de": "a23: abgestufte Wiederholung, Karteikarten-Bewertungen und offene Fehler vorbereitet (Schalter aus)",
    "en": "a23: graded repetition, flashcard ratings and open mistakes prepared (flags off)"
  },
  "description": {
    "de": "Unangewendetes Changeset 20261222090000: Intervalle höchstens 180 Tage und nie nach dem Prüfungsdatum minus 2 Tage, abgestufte Wiederholung, eigenes Karteikarten-Protokoll ohne XP und ohne Kontingent, eine Serverregel für offene Fehler. Schalter SRS_GRADE_ENABLED, FLASHCARD_REVIEW_KIND_ENABLED und FREE_SCHEDULE_ENABLED sind aus.",
    "en": "Unapplied changeset 20261222090000: intervals at most 180 days and never after the exam date minus 2 days, graded repetition, a separate flashcard review log without XP or allowance, one server rule for open mistakes. Flags SRS_GRADE_ENABLED, FLASHCARD_REVIEW_KIND_ENABLED and FREE_SCHEDULE_ENABLED are off."
  }
},
{
  "date": "2026-10-12",
  "tag": "improvement",
  "title": {
    "de": "KI-Erklärungen klar als KI gekennzeichnet",
    "en": "AI explanations clearly marked as AI"
  },
  "description": {
    "de": "Der Tab KI-Erklärung trägt ein KI-Zeichen. Unter jeder KI-Antwort steht, dass sie Fehler enthalten kann, und ein Tipp auf „Falsch? Frage melden“ öffnet die Meldung. Die KI nennt keine erfundenen Quellen mehr: Wo sie unsicher ist, sagt sie das. Erklärungen aus der Fragenbank sind als solche erkennbar, auch auf den Lernkarten.",
    "en": "The AI Explanation tab carries an AI badge. Every AI answer says it may contain errors, and one tap on \"Wrong? Report question\" opens the report. The AI no longer names invented sources: where it is unsure, it says so. Question-bank explanations are labelled as such, also on flashcards."
  }
},
{
  "date": "2026-10-12",
  "tag": "fix",
  "title": {
    "de": "Preisseite sagt nur, was über Ihr Abo sicher bekannt ist",
    "en": "Pricing page states only what is known about your plan"
  },
  "description": {
    "de": "Die Preisseite schreibt nur noch, dass sich Ihr Abo automatisch verlängert, wenn Whop das bestätigt. Kann Ihr Tarif nicht geprüft werden, sehen Sie einen neutralen Hinweis und keinen zweiten Tarif. Nach der Anmeldung führt ein gewählter Tarif nur dann weiter zur Zahlung, wenn ein Kauf für Ihr Konto möglich ist. Der Hinweis zu Ihrem Pro-Zugang steht einmal oben statt auf jedem Tarif, die Kündigungszeile lautet jetzt: bis Sie bei Whop kündigen. Die Bestätigungsseite kündigt keine neue Quittung an, wenn Ihr Zugang schon vorher aktiv war.",
    "en": "The pricing page now says your plan renews automatically only when Whop confirms it. If your plan cannot be checked, you see a neutral note and no second plan. After sign-in, a chosen plan continues to payment only when a purchase is possible for your account. The note about your Pro access appears once at the top instead of on every plan, and the cancel line now reads: until you cancel at Whop. The confirmation page no longer announces a new receipt when your access was already active."
  }
},
{
  "date": "2026-10-12",
  "tag": "admin",
  "title": {
    "de": "Admin: Wachstum nach Zeitraum und Quelle, getaggte Links pro Post, alte Seiten entfernt",
    "en": "Admin: Growth by window and source, tagged links per post, dead pages removed"
  },
  "description": {
    "de": "Wachstum zeigt Anmeldungen für 7, 30 oder 90 Tage oder insgesamt, was diese Kohorte daraus gemacht hat, und eine Tabelle nach Quelle und Kampagne (Besuche, Anmeldungen, zahlend). Pro Telegram-Post entstehen ein Website-Link und ein Bot-Link mit derselben Kampagne. Kampagnen-Tags bleiben jetzt bei der Weiterleitung auf die Startseite und bei der Telegram-Anmeldung erhalten. Plan & Actions, Waitlist, SQL und weitere alte Seiten und Endpunkte sind entfernt; alte Adressen leiten weiter.",
    "en": "Growth shows signups for 7, 30 or 90 days or all time, what that cohort did next, and a table by source and campaign (arrivals, signups, paying now). Each Telegram post gets a site link and a bot link with the same campaign. Campaign tags now survive the redirect to the landing page and the Telegram sign-in. Plan & Actions, Waitlist, SQL and other dead pages and endpoints are removed; old addresses redirect."
  }
},
{
  "date": "2026-10-12",
  "tag": "improvement",
  "title": {
    "de": "Startseite, Anmeldung und Einstieg überarbeitet",
    "en": "Home, sign-in and first steps reworked"
  },
  "description": {
    "de": "Die Startseite zeigt oben Ihren Übungsstand in Worten statt einer Prozentzahl, darunter wie viel der Fragenbank Sie gesehen haben. Serie, Antworten heute und Trefferquote kommen jetzt vom Server und stimmen auf jedem Gerät; eine Pause heißt Pause. Neu sind die fälligen Wiederholungen mit einem Tipp, ein Bereich „Anders üben“ mit offenen Fehlern, die Prüfungssimulation als eigener Eintrag und auf dem Handy die fünf schwächsten Fachgebiete zuerst. Ein Prüfungswechsel lädt die Seite nicht mehr neu. Die Anmeldung erklärt jeden Fehler mit einem nächsten Schritt, behält Ihre Eingaben und hat ein Feld für den Telegram-Code. Der Einstieg fragt zuerst Ihre Prüfung, speichert jede Auswahl sofort und setzt nach einer Unterbrechung dort fort, wo Sie waren. Die E-Mail-Bestätigung startet erst mit Ihrem Tippen.",
    "en": "Home now leads with your practice level in words instead of a percentage, with how much of the question bank you have seen below it. Streak, answers today and hit rate come from the server and match on every device; a break is shown as a pause. New: due reviews with one tap, an \"Other ways to practise\" row with open mistakes, the mock exam as its own entry and, on phones, the five weakest topics first. Switching exams no longer reloads the page. Sign-in explains each error with a next step, keeps what you typed and has a field for the Telegram code. The first steps ask for your exam first, save every choice at once and resume where you left off after an interruption. Email confirmation only starts when you tap."
  }
},
{
  "date": "2026-10-12",
  "tag": "improvement",
  "title": {
    "de": "Klarere Preise, sichere Zahlung und ehrliche Angaben",
    "en": "Clearer pricing, safer payment and honest details"
  },
  "description": {
    "de": "Die Preisseite zeigt jeden Tarif gleich aufgebaut: Preis wie abgebucht, heutige Zahlung, Verlängerung oder Einmalzahlung und wie Sie kündigen. Empfohlen ist der 3-Monats-Tarif. Eine laufende Zahlung sperrt einen zweiten Kauf, und die Bestätigungsseite zeigt einen Beleg statt einer automatischen Weiterleitung. Neu sind die Gesamtkosten bis zu Ihrem Prüfungstermin, ein Kontaktformular ohne Konto und eine einheitliche Beschreibung der Garantie. Seiten und Hinweise sprechen Sie jetzt mit Sie an.",
    "en": "The pricing page shows every plan the same way: price as charged, today's payment, renewal or one-time and how to cancel. The 3-month plan is recommended. A payment in progress blocks a second purchase, and the confirmation page shows a receipt instead of redirecting. New: the total cost until your exam date, a contact form without an account and one description of the guarantee."
  }
},
{
  "date": "2026-10-12",
  "tag": "improvement",
  "title": {
    "de": "Antwortzeiten im Support stehen jetzt in den FAQ",
    "en": "Support reply times are now stated in the FAQ"
  },
  "description": {
    "de": "Wir antworten in der Regel innerhalb von 1 bis 2 Werktagen, und gemeldete Fragen sehen wir uns innerhalb von 3 Werktagen an. Beides steht jetzt in den FAQ und in den Nutzungsbedingungen.",
    "en": "We usually reply within 1 to 2 working days, and we look at reported questions within 3 working days. Both are now stated in the FAQ and the terms."
  }
},
{
  "date": "2026-10-12",
  "tag": "admin",
  "title": {
    "de": "Admin: Jobs nach Zeitplan, Notschalter-Banner, Wiederholungsmeldungen, Aktionsalarm",
    "en": "Admin: jobs judged by schedule, kill-switch banner, repeat reports, action alert"
  },
  "description": {
    "de": "Crons und Heute zeigen jeden geplanten Job mit Namen und Status (OK, verspätet, überfällig, hängt, fehlgeschlagen) aus seinen Heartbeats. Ein roter Banner erscheint auf jeder Admin-Seite, solange ein Notschalter an ist. Heute zeigt das Produktions-Deployment und offene Sentry-Fehler, Deploys markiert die neueste Produktionsversion. Fragen mit mehreren Meldungen tragen 'repeat (N)' und stehen oben; Bearbeitungszeiten der letzten 90 Tage stehen über der Liste. Ein stündlicher Aktionsalarm an den internen Bot ist vorbereitet und bleibt aus.",
    "en": "Crons and Today show every scheduled job by name with its state (OK, Late, Overdue, Stuck, Failed) read from its heartbeats. A red banner shows on every admin page while an emergency switch is on. Today shows the production deploy and unresolved Sentry issues; Deploys marks the latest production version. Questions reported more than once carry 'repeat (N)' and sort first; 90-day fix times sit above the list. An hourly action alert to the internal bot is prepared and stays off."
  }
},
{
  "date": "2026-10-12",
  "tag": "improvement",
  "title": {
    "de": "Klarere Pro-Hinweise, ehrliche Wiederholungen und weniger Unterbrechungen",
    "en": "Clearer Pro labels, honest reviews and fewer interruptions"
  },
  "description": {
    "de": "Pro-Funktionen sind vor dem Antippen als Pro gekennzeichnet und öffnen den Hinweis direkt an Ort und Stelle. Karteikarten zeigen nach der Bewertung den tatsächlich gespeicherten nächsten Termin, und „Nochmal“ bringt die Karte in derselben Runde zurück. Fachgebiete zeigen „gesehen“ und „zuletzt richtig“ mit klaren Grenzen. Pro Sitzung erscheint höchstens ein Hinweisfenster und eine Hinweiskarte, nie über dem Einstieg. Der Offline-Hinweis erscheint erst nach drei Sekunden und nennt nur, was auf diesem Gerät wirklich bereitliegt.",
    "en": "Pro features are labelled as Pro before you tap them and open their explanation in place. Flashcards show the next review date that was actually saved, and \"Again\" brings the card back in the same round. Topics show \"seen\" and \"last correct\" with clear thresholds. Each session shows at most one pop-up and one card, never over onboarding. The offline notice appears after three seconds and only names what is really stored on this device."
  }
},
{
  "date": "2026-10-12",
  "tag": "admin",
  "title": {
    "de": "Admin: Seite Heute, Menü nach Aufgaben, ehrliche Aktualität",
    "en": "Admin: Today page, menu by job, honest freshness"
  },
  "description": {
    "de": "Die Startseite heißt jetzt Heute und zeigt zuerst, was auf Sie wartet: eine Zeile pro Warteschlange mit Anzahl, Wartezeit und Link, sonst Nichts wartet auf Sie. Darunter Geldeingang des Monats, zahlende Lernende und Anmeldungen, dann eine Systemzeile. Das Menü ist nach Aufgaben gruppiert: Heute, Posteingang, Lernende, Geld, Inhalte, Wachstum, System. Am Telefon gibt es eine untere Leiste mit Heute, Posteingang, Suchen, Geld und Mehr. Eine Zahl, die nicht geladen werden konnte, zeigt -- oder Konnte nicht laden mit Erneut versuchen, nie 0. LIVE-Abzeichen sind ersetzt durch Aktualisiert hh:mm (Wiener Zeit); Heute, Zahlungen und Audit laden jede Minute neu. Tabellen werden am Telefon zu Karten mit großen Schaltflächen.",
    "en": "The admin home is now Today and leads with what is waiting on you: one row per queue with its count, how long the oldest item waited and a link, or Nothing waiting on you. Below it: money in this month, paying learners and signups, then one system line. The menu is grouped by job: Today, Inbox, Learners, Money, Content, Growth, System. Phones get a bottom bar with Today, Inbox, Find, Money and More. A number that could not load shows -- or Could not load with Retry, never 0. LIVE badges are replaced by Updated hh:mm (Vienna time); Today, Payments and Audit refresh every minute. Tables become cards with large buttons on phones."
  }
},
{
  "date": "2026-10-12",
  "tag": "admin",
  "title": {
    "de": "Admin: Ops-Freigaben in klaren Sätzen, Verbindungen trennen",
    "en": "Admin: Ops approvals in plain sentences, disconnect connections"
  },
  "description": {
    "de": "Ops-Freigaben stehen jetzt im Posteingang mit Zähler. Jede vorbereitete Änderung steht als Satz mit Vorher und Nachher aus Live-Daten, gruppiert nach Entscheidung offen, freigegeben, erledigt und abgelaufen. Freigeben bestätigt diesen Satz, Ablehnen nimmt einen Grund (Pflicht bei Zugriffsänderungen). Ergebnisse erscheinen in der Karte. Verbundene Agenten lassen sich mit einem Schritt trennen. Eine Ops-Verbindung wird nur in dem Browser fertig, der sie gestartet hat, und Ablehnen sagt dem Client Nein.",
    "en": "Ops approvals now sit in the Inbox with a count. Each prepared change reads as a sentence with before and after from live data, grouped into needs your decision, approved, done and expired. Approve confirms that sentence; Reject takes a reason (required for access changes). Results show in the card. Connected agents can be disconnected in one step. An Ops connection only completes in the browser that started it, and Decline tells the client no."
  }
},
{
  "date": "2026-10-12",
  "tag": "admin",
  "title": {
    "de": "Admin: ehrliche Lernendenseiten, Zugriffsleiste und Audit-Verlauf",
    "en": "Admin: honest learner pages, access strip and audit history"
  },
  "description": {
    "de": "Zuletzt aktiv zählt nur Antworten, Lernereignisse und Sitzungen. Bezahlt zählt nur mit Zahlungsreferenz. Statistiken lesen alle Antworten (Wiener Tage, Streaks aus Antworttagen). Unter dem Namen zeigt eine Zugriffsleiste, woher Pro kommt und wann es endet. Jede Lernendenseite hat einen Admin-Verlauf. Das Audit-Log hat Filter (Personen und Zugriff, Inhalte, System, Ops-Entscheidungen, Lernende, Akteur, Aktion), aufklappbare Daten und eine ehrliche Zählung. Die Nutzerliste hat Segmente mit Zahlen, Lernenden-Links überall und ein Feld Find learner.",
    "en": "Last active counts only answers, learner events and sessions. Paid needs a payment reference. Stats read every answer (Vienna days, streaks from answer days). An access strip under the name says where Pro comes from and when it ends. Every learner page has an Admin history. The audit log has filters (People and access, Content, System, Ops decisions, learner, actor, action), expandable payloads and an honest count. The Users list gets segments with counts, learner links appear across admin pages and the top bar has Find learner."
  }
},
{
  "date": "2026-10-12",
  "tag": "feature",
  "title": {
    "de": "Gemeldete Fragen: Bestätigung und Status unter Meine Meldungen",
    "en": "Reported questions: confirmation and status under My reports"
  },
  "description": {
    "de": "Wenn Sie eine Frage melden, bestätigen wir jetzt, dass die Meldung angekommen ist, oder sagen Ihnen, dass sie nicht gesendet werden konnte. In den Einstellungen finden Sie unter Meine Meldungen alle Ihre Meldungen mit Status: offen, angenommen, korrigiert, kein Fehler oder mehr Angaben nötig, dazu die aktuelle typische Bearbeitungszeit.",
    "en": "When you report a question we now confirm that the report arrived, or tell you that it could not be sent. Settings now has My reports, listing every report with its status: open, accepted, fixed, not an error or more information needed, plus the current typical turnaround."
  }
},
{
  "date": "2026-10-12",
  "tag": "improvement",
  "title": {
    "de": "Öffentliche Lernkarten zeigen, ob sie geprüft wurden",
    "en": "Public study cards show whether they were reviewed"
  },
  "description": {
    "de": "Lernkarten, die automatisch aus einer Erklärung erstellt und noch nicht geprüft wurden, tragen jetzt den Hinweis KI-Entwurf, ungeprüft. Geprüfte Karten nennen, wer sie wann geprüft hat.",
    "en": "Study cards generated automatically from an explanation and not yet reviewed now say AI draft, not reviewed. Reviewed cards say who reviewed them and when."
  }
},
{
  "date": "2026-10-12",
  "tag": "admin",
  "title": {
    "de": "Admin: Meldungen als Arbeitsliste, Inbox mit Zählern, Feedback-Antworten",
    "en": "Admin: reports as a work queue, Inbox with counts, feedback replies"
  },
  "description": {
    "de": "Fragenmeldungen öffnen direkt die passende Zeile mit vollständiger Frage, Antwortoptionen samt Schlüssel und Erklärung. Bestätigen und Verwerfen speichern ein Ergebnis für die meldende Person, lassen sich 10 Sekunden lang rückgängig machen und können (Schalter standardmäßig aus) eine E-Mail an sie senden. Neue Inbox-Gruppe mit Zählern für Fragenmeldungen, Lernkarten-Meldungen und Feedback, Feedback mit Notiz, Kontakt und Erfasst-Antwort, Bestätigung vor dem Entfernen einer Lernkarte, Liste der Erklärungen mit mindestens zwei negativen Bewertungen und eine Medienliste mit Bildstatus.",
    "en": "Question reports open the exact row with the full question, choices with the key and the explanation. Confirm and Dismiss record an outcome for the reporter, can be undone for 10 seconds and can (flag off by default) email the reporter. New Inbox group with counts for question reports, note reports and feedback; feedback with notes, contact and Mark replied; a confirmation before a note takedown; a list of explanations with two or more down-votes; and a media queue with image state."
  }
},
{
  "date": "2026-10-12",
  "tag": "admin",
  "title": {
    "de": "Admin: ehrliche Umsatzzahlen, offene Zahlungen und zahlende Lernende",
    "en": "Admin: honest money numbers, unresolved payments and the paid roster"
  },
  "description": {
    "de": "Startseite, Zahlungen und Wachstum nutzen dieselbe Definition: Geldeingang nach Zahlungsdatum (brutto, Rückerstattungen am eigenen Tag, Wiener Zeit) und zahlende Lernende ohne Test- und Team-Konten, Testphasen getrennt. Der Zahlungsalarm meldet nur noch echte Probleme; bezahlte Zahlungen ohne Freischaltung erscheinen in einer Liste mit „Lernenden zuordnen“, „Als Test markieren“ und „Nicht unsere“. Neu: Monatsübersicht mit Whop-Gebühren, Suche nach einer Zahlung, Rückerstattungen mit Zugangsstatus und eine Abo-Liste, wer zahlt, wer verlängert und wessen Pro bald endet.",
    "en": "Home, Payments and Growth share one definition: money in by payment date (gross, refunds on their own day, Vienna time) and paying learners without test or staff accounts, trials apart. The payment alarm only fires on real problems; paid payments that never granted Pro sit in a queue with Link to learner, Mark as test and Mark not ours. New: a monthly view with Whop fees, a payment search, refunds with access outcome and a roster of who pays, who renews and whose Pro ends soon."
  }
},
{
  "date": "2026-10-12",
  "tag": "admin",
  "title": {
    "de": "Admin: sichere Fragenkorrekturen, Lernenden-Schutz und PUYP-Nachverfolgung",
    "en": "Admin: safe question edits, learner safeguards and PUYP follow-up"
  },
  "description": {
    "de": "Vorgeschlagene Korrekturen zeigen vor dem Übernehmen einen Vorher/Nachher-Vergleich und lassen sich rückgängig machen; Antworten und Auswahlmöglichkeiten werden nie automatisch übernommen. Profiländerungen prüfen E-Mail-Adressen, Sperren und Freischaltungen gibt es nur noch im Profil, und dauerhaftes Pro wird nicht verkürzt. Neu: Abmelden auf allen Geräten, Duplikatsuche über die ganze Fragenbank und eine Nachverfolgungsliste für abgelehnte PUYP-Anträge.",
    "en": "Suggested question edits show a before/after view before they are applied and can be reverted; answers and choices are never applied automatically. Profile edits validate email addresses, lock and grant live only on the learner profile, and permanent Pro is never shortened. New: sign out on all devices, a duplicate scan over the whole question bank and a follow-up list for rejected PUYP claims."
  }
},
{
  "date": "2026-10-12",
  "tag": "admin",
  "title": {
    "de": "Mentor-Fakten: SIP-Termine neu gelesen, Wiederholungsregel angeglichen",
    "en": "Mentor facts: SIP dates re-read, repeat rule aligned"
  },
  "description": {
    "de": "Die 18 Mentor-Fakten mit wöchentlicher Prüfung (SIP-Prüfungskalender, Rezeptierkunde und Gerichtsmedizin) wurden an den offiziellen Quellen der MedUni Wien neu gelesen; beide Quellen sind unverändert. Die SIP4a- und SIP5a-Bestehensregel nennt jetzt wie die Beurteilungskriterien bis zu zwei wiederholbare Blöcke bzw. Fächer.",
    "en": "The 18 weekly-review mentor facts (SIP exam calendar, Rezeptierkunde and Gerichtsmedizin) were re-read against MedUni Wien's official sources; both sources are unchanged. The SIP4a and SIP5a pass rule now states up to two repeatable blocks or subjects, as the Beurteilungskriterien do."
  }
},
{
  "date": "2026-10-12",
  "tag": "improvement",
  "title": {
    "de": "Neue Navigation, klarere Antworten und besser lesbare Farben",
    "en": "New navigation, clearer answers and more readable colours"
  },
  "description": {
    "de": "Auf dem Smartphone zeigt die Leiste unten jetzt Start, Simulation, Üben, Lernplan und Mehr. Unter Mehr finden Sie alle weiteren Bereiche wie Verlauf, Meine Fehler, Einstellungen und Feedback, in derselben Ordnung wie in der Seitenleiste am Computer. Nach dem Beantworten zeigt jede Option ihr Ergebnis in Worten und mit einem Symbol, nicht nur in Farbe. Bilder in Fragen verschieben die Antworten nicht mehr beim Laden und lassen sich vergrößern und neu laden. Prüfungsergebnisse zeigen den Abstand zur Übungsgrenze ohne Bestehensaussage. Fehler- und Hinweisfarben sind kontrastreicher, die Fokusmarkierung ist deutlich sichtbar, und Animationen respektieren die Einstellung für reduzierte Bewegung.",
    "en": "On phones the bottom bar now shows Home, Simulation, Practise, Study plan and More. More lists every other area, such as History, My mistakes, Settings and Feedback, in the same order as the desktop sidebar. After answering, every option states its result in words and with an icon, not only in colour. Question images no longer move the answers while loading and can be enlarged and reloaded. Exam results show the distance to the practice threshold without a pass claim. Error and notice colours have more contrast, the focus outline is clearly visible, and animations respect the reduced-motion setting."
  }
},
{
  "date": "2026-10-12",
  "tag": "improvement",
  "title": {
    "de": "Klarere Prüfungsnamen und einheitliche Zahlen",
    "en": "Clearer exam names and consistent numbers"
  },
  "description": {
    "de": "Die Wiener Fragenbank heißt jetzt SIP4a / SIP5a Wien, die Kurzbezeichnungen lauten SIP, SPT und Pharma, und jede Auswahl nennt die Fragenbank als Übungsfragen. Die Seitenleiste zeigt Ihre aktive Prüfung. Zahlen, Prozentwerte und Tage erscheinen auf der Startseite einheitlich formatiert. Prüfungsfragen bleiben auch bei einer anderen App-Sprache als deutscher Text markiert. Hinweise und Einstellungen funktionieren auch in privaten Fenstern, und auf einem geteilten Gerät übernimmt ein neues Konto nicht mehr die Prüfungsauswahl des vorherigen Kontos.",
    "en": "The Vienna question bank is now called SIP4a / SIP5a Wien, the short names are SIP, SPT and Pharma, and every picker describes the bank as practice questions. The sidebar shows your active exam. Numbers, percentages and days on the home page use one consistent format. Exam questions stay marked as German text in any app language. Notices and settings also work in private windows, and on a shared device a new account no longer inherits the previous account's exam choice."
  }
},
{
  "date": "2026-10-12",
  "tag": "fix",
  "title": {
    "de": "Korrigierte Antworten zeigen keine veralteten KI-Erklärungen mehr",
    "en": "Corrected answers no longer show outdated AI explanations"
  },
  "description": {
    "de": "Wenn wir die richtige Antwort einer Frage oder ihre Antwortoptionen korrigieren, sehen Sie keine KI-Erklärung mehr, die für die alte Lösung geschrieben wurde.",
    "en": "When we correct a question's right answer or its answer options, you no longer see an AI explanation written for the old solution."
  }
},
{
  "date": "2026-10-12",
  "tag": "improvement",
  "title": {
    "de": "Genauere Angaben zu Funktionen und SIP-Regeln",
    "en": "More precise feature details and SIP rules"
  },
  "description": {
    "de": "Preise und Startseite beschreiben die Funktionen jetzt genau: KI-Erklärungen mit fairem Tageslimit, Wiederholung angelehnt an SM-2 und die tatsächlich angebotenen Erklärungssprachen. Die Seite zu den SIP4a- und SIP5a-Regeln nennt jetzt Prüfungsteile, Wiederholungen und Antritte mit Quelle und Stand. Übungen starten immer mit der in Ihrem Konto gewählten Prüfung; ein Link zu einer anderen Prüfung bietet den Wechsel an.",
    "en": "Pricing and the home page now describe features precisely: AI explanations with a fair daily limit, review scheduling based on SM-2 and the explanation languages actually offered. The SIP4a and SIP5a rules page now lists exam parts, repeats and attempts with source and edition. Practice always starts with the exam chosen in your account; a link to another exam offers to switch."
  }
},
{
  "date": "2026-10-12",
  "tag": "admin",
  "title": {
    "de": "KI-Mentor: kostenlose Beta vorbereitet (ausgeschaltet)",
    "en": "AI mentor: free beta prepared (switched off)"
  },
  "description": {
    "de": "Der Mentor ist nur noch für Nutzer auf der Beta-Liste erreichbar; eine leere Liste lässt niemanden zu. Neuer Beta-Reiter unter Admin, AI Mentor: Nutzer-IDs freischalten, einmalig Beta-Credits vergeben und Nutzung je Beta-Nutzer verfolgen (Nachrichten, verbrauchte Credits, Fehler, Kosten). Kostenlose Testcredits: 5 Credits einmalig für verifizierte Gratis-Nutzer, nur Fristen und Fakten. Whop-Webhook: ein unpassender Kaufbeleg wird nicht mehr endlos wiederholt, ein Fehler beim Mentor-Abgleich blockiert keine Pro-Erstattung. Die Mentor-Navigation fragt nicht mehr jede Minute nach, solange der Mentor aus ist. Alles bleibt ohne Umgebungsschalter aus.",
    "en": "The mentor is now reachable only for users on the beta list; an empty list admits nobody. New Beta tab under Admin, AI Mentor: allowlist user ids, grant one-time beta credits and track usage per beta user (messages, credits used, failures, cost). Free taste: 5 credits once for verified free users, deadlines and facts only. Whop webhook: a mismatched purchase receipt no longer retries forever, and a failing mentor lookup never blocks a Pro refund. The mentor navigation no longer polls every minute while the mentor is off. Everything stays off without the environment switches."
  }
},
{
  "date": "2026-10-12",
  "tag": "admin",
  "title": {
    "de": "Sichereres Feedback-Formular, korrekte Prüfungsbeschreibung",
    "en": "Safer feedback form, correct exam description"
  },
  "description": {
    "de": "Feedback und Hinweise zu Fehlern auf den Anmeldeseiten sind jetzt in Häufigkeit und Größe begrenzt, damit das Formular zuverlässig bleibt. Die Beschreibung für KI-Assistenten stellt richtig: Die Wiener Fragenbank basiert auf SIP4a/SIP5a-Lernmaterial, die postgraduale Arztprüfung Allgemeinmedizin der ÖÄK ist eine andere Prüfung.",
    "en": "Feedback and error reports on the registration pages now have frequency and size limits so the form stays reliable. The description for AI assistants now states correctly that the Vienna bank is based on SIP4a/SIP5a study material and that the ÖÄK postgraduate Allgemeinmedizin examination is a different examination."
  }
},
{
  "date": "2026-10-12",
  "tag": "improvement",
  "title": {
    "de": "Anmeldeschluss auf der Startseite, klarere Tarife",
    "en": "Registration deadline on Home, clearer plans"
  },
  "description": {
    "de": "Die Startseite zeigt allen den nächsten offiziellen Anmeldeschluss mit Quelle. Der 3-Monats-Tarif ist als empfohlen markiert, die Startseite beginnt mit dem kostenlosen Einstieg ohne Karte, und Hinweise zu Offline-Nutzung und Support-Antwortzeit sind jetzt genau.",
    "en": "Home shows everyone the next official registration deadline with its source. The 3-month plan is marked as recommended, the landing page leads with the free no-card start, and offline and support reply-time notes are now accurate."
  }
},
{
  "date": "2026-10-11",
  "tag": "fix",
  "title": {
    "de": "Zahlung klar prüfen und sicher zurückkehren",
    "en": "Check payment clearly and return safely"
  },
  "description": {
    "de": "Die Zahlungsprüfung zeigt den Zugang erst nach Bestätigung als aktiv. Laufende Zahlungen bleiben sichtbar, Rückkehr aus Whop löst blockierte Schaltflächen und fehlgeschlagenes Feedback lässt sich erneut senden.",
    "en": "Payment checks show access as active after confirmation. Pending payments stay visible, returning from Whop clears stuck controls, and failed feedback can be retried."
  }
},
{
  "date": "2026-10-11",
  "tag": "improvement",
  "title": {
    "de": "Abrechnung und Pro-Test verständlicher",
    "en": "Clearer billing and Pro trial terms"
  },
  "description": {
    "de": "Einstellungen unterscheiden Abrechnungsdatum und Zugangsende. Unbekannte Angaben bleiben offen. Der Pro-Test nennt die Karte, Kosten und das anschließende Fragenlimit.",
    "en": "Settings distinguish billing dates from access expiry. Unknown details stay explicit. The Pro trial states card requirements, charges and the question limit afterward."
  }
},
{
  "date": "2026-10-11",
  "tag": "fix",
  "title": {
    "de": "Lesefehler mit erneutem Laden",
    "en": "Retry failed study reads"
  },
  "description": {
    "de": "Lernplan, Bibliothek, Statistik und Übungs-Bereitschaft zeigen fehlgeschlagene Anfragen mit einer erneuten Ladeaktion. Bereits geladene Inhalte bleiben sichtbar.",
    "en": "Study plan, library, statistics and practice readiness show failed requests with a retry action. Previously loaded content remains visible."
  }
},
{
  "date": "2026-10-11",
  "tag": "feature",
  "title": {
    "de": "Lernplan direkt einrichten",
    "en": "Set up your study plan in place"
  },
  "description": {
    "de": "Wähle deinen Prüfungstermin direkt im Lernplan. Ohne Termin kannst du einen vorläufigen Tagesplan mit neuen Fragen und fälligen Wiederholungen verwenden.",
    "en": "Choose your exam date directly in the study plan. Without a date, use a provisional daily plan with new questions and due reviews."
  }
},
{
  "date": "2026-10-11",
  "tag": "fix",
  "title": {
    "de": "Lernnotizen lesen oder bewusst wiederholen",
    "en": "Read study notes or deliberately review"
  },
  "description": {
    "de": "Notizen öffnen in der Leseansicht. Üben startet eine eigene Wiederholung mit bewusstem Aufdecken, Bewertung und Überspringen. Fällige Notizen öffnen direkt die Wiederholung.",
    "en": "Notes open in a reading view. Practice starts a separate review with deliberate reveal, rating and skip actions. Due notes open review directly."
  }
},
{
  "date": "2026-10-11",
  "tag": "fix",
  "title": {
    "de": "Prüfungsergebnis ehrlich bestätigt",
    "en": "Honest exam result acknowledgement"
  },
  "description": {
    "de": "Die Statistik bestätigt ein gespeichertes Bestehen erst nach erfolgreicher Speicherung. Eine fehlende Bestätigung bietet einen Weg zum erneuten Versuch.",
    "en": "Statistics acknowledge a recorded pass after successful saving. A missing acknowledgement offers a way to retry."
  }
},
  {
    "date": "2026-10-11",
    "tag": "fix",
    "title": {
      "de": "Prüfung mit sichtbarer Uhr und klarer Navigation",
      "en": "Exam with a visible clock and clear navigation"
    },
    "description": {
      "de": "Die Uhr berücksichtigt Zeit im Hintergrund. Fragewechsel beginnen am Textanfang und unvollständige Mehrfachantworten bleiben sichtbar offen.",
      "en": "The clock accounts for time in the background. Question changes start at the stem and incomplete multiple answers remain visibly open."
    }
  },
  {
    "date": "2026-10-11",
    "tag": "fix",
    "title": {
      "de": "Prüfungen sicher fortsetzen und Ergebnisse erneut speichern",
      "en": "Resume exams safely and retry saving results"
    },
    "description": {
      "de": "Neue Prüfungen ersetzen eine laufende Sicherung erst nach Bestätigung. Fehlgeschlagene Ergebnissicherungen lassen sich auf demselben Gerät wiederherstellen und erneut speichern.",
      "en": "Replacing a running save requires confirmation. Results that fail to save can be recovered on the same device and retried."
    }
  },
  {
    "date": "2026-10-11",
    "tag": "improvement",
    "title": {
      "de": "Prüfungsverlauf leichter öffnen",
      "en": "Open exam history more easily"
    },
    "description": {
      "de": "Prüfungsverlauf ist in den Einstellungen erreichbar. Auf der Prüfungsseite sehen Pro-Lernende die letzte Simulation. Ladefehler und leere Verläufe haben unterschiedliche Hinweise.",
      "en": "Exam history is available in Settings. Pro learners can open their latest simulation from the exam page. Loading errors and empty history have distinct messages."
    }
  },
  {
    "date": "2026-10-11",
    "tag": "fix",
    "title": {
      "de": "Mehrfachantworten und Tastaturwahl stimmen überein",
      "en": "Consistent multiple-answer feedback and keyboard selection"
    },
    "description": {
      "de": "Nur die vollständige richtige Auswahl zählt als richtig. Teilweise Antworten zeigen einen klaren Fehlerhinweis. Antworttasten nutzen einzelne A-E- oder 1-5-Eingaben. Die Tastenkürzel lassen sich ausschalten und die Optionen bleiben nach der Bewertung zugänglich.",
      "en": "Only the exact correct set counts as correct. Partial answers show clear incorrect feedback. Answer shortcuts use single A-E or 1-5 inputs. Shortcuts can be turned off and options stay accessible after grading."
    }
  },
  {
    "date": "2026-10-11",
    "tag": "fix",
    "title": {
      "de": "Abgelehnte Antworten erhalten keine gespeicherte Bewertung",
      "en": "Rejected answers do not appear as saved attempts"
    },
    "description": {
      "de": "Ein erreichtes Zugriffslimit ersetzt die Frage durch einen Tarifhinweis. Verbindungsfehler können Antworten auf diesem Gerät vormerken, ohne bestätigte Erfahrungspunkte anzuzeigen.",
      "en": "An access limit replaces the question with plan information. Connection failures can queue an answer on this device without displaying confirmed XP."
    }
  },
  {
    "date": "2026-10-11",
    "tag": "fix",
    "title": {
      "de": "Karteikarten respektieren die fokussierte Taste",
      "en": "Flashcards respect the focused control"
    },
    "description": {
      "de": "Enter und Leertaste aktivieren die fokussierte Aktion. Die Antwortseite erhält nach dem Umdrehen den Fokus und die inaktive Kartenseite ist nicht bedienbar.",
      "en": "Enter and Space activate the focused action. After flipping, focus moves to the answer region and the inactive face cannot be operated."
    }
  },
  {
  "date": "2026-10-11",
  "tag": "fix",
  "title": {
    "de": "Prüfungsergebnisse ohne doppelte Einreichung",
    "en": "Prevent duplicate exam-result submissions"
  },
  "description": {
    "de": "Beim Einreichen sehen Sie, dass die Übermittlung läuft. Wenn Sie einen Nachweis erneut senden, entsteht kein zweiter Eintrag, und Ihr bereits bestätigtes Ergebnis bleibt erhalten.",
    "en": "While submitting you see that it is in progress. Sending a proof again does not create a second entry, and your confirmed result is kept."
  }
},
  {
    date: "2026-10-11", tag: "fix",
    title: { de: "Startseite bleibt bei Verbindungsproblemen erreichbar", en: "Home remains available during connection problems" },
    description: { de: "Fachgebiete lassen sich nach einem Fehler erneut laden. Fehlender Fortschritt erscheint als Ladezustand statt als null Prozent.", en: "Topics can be retried after a failed load. Unavailable progress appears as a loading state instead of zero percent." },
  },
  {
    date: "2026-10-11", tag: "fix",
    title: { de: "Fortschritt in allen Fragenbanken sehen", en: "See progress in every question bank" },
    description: { de: "Fachgebietskarten zeigen den vorhandenen Fortschritt auch im Stichprobentest und in Pharmakologie. Die Prüfungssimulation ist dort direkt erreichbar.", en: "Topic cards also show existing progress in Stichprobentest and Pharmacology. Exam simulation is directly reachable for these banks." },
  },
  {
    date: "2026-10-11", tag: "improvement",
    title: { de: "Sprache auf der Startseite klar erkennen", en: "Recognize your language on Home" },
    description: { de: "Die kompakte Sprachauswahl zeigt die gespeicherte Sprache. Noch nicht freigegebene Übersetzungen verwenden englische Texte. Zahlen bleiben klar lesbar.", en: "The compact language picker shows your saved language. Translations awaiting review use English text. Numbers remain clearly readable." },
  },
  {
    date: "2026-10-11", tag: "fix",
    title: { de: "Pro-Test zeigt nur bekannte Zahlungsbedingungen", en: "Pro trial shows only known payment terms" },
    description: { de: "Der Hinweis nutzt den bekannten Betrag mit genauen Centwerten. Ein konkretes Belastungsdatum erscheint nur, wenn es vorliegt.", en: "The announcement uses the known amount with exact cents. A specific charge date appears only when available." },
  },
  {
    date: "2026-10-11", tag: "fix",
    title: { de: "Deine Auswahl bleibt beim Anmelden erhalten", en: "Keep your selection when signing in" },
    description: { de: "Kostenlose Einstiege öffnen die Registrierung mit deiner Fragenbank. Der Pro-Test führt zur bewussten Auswahl mit einer Möglichkeit, ohne Karte weiterzulernen. Hilfe beim Anmelden ist direkt erreichbar.", en: "Free entry opens registration with your question bank. The Pro trial returns to a deliberate choice with an option to continue without a card. Sign-in contact is directly available." },
  },
  {
    date: "2026-10-11", tag: "improvement",
    title: { de: "Kostenlosen Umfang vor dem Start sehen", en: "See the free allowance before starting" },
    description: { de: "Die kostenlosen Angebote zeigen die Begrenzung pro Fragenbank, den nächsten Schritt und einen Link zu den Preisen.", en: "Free offers show the limit per question bank, the next step and a link to pricing." },
  },
  {
    date: "2026-10-11", tag: "fix",
    title: { de: "Rezeptierkunde: Prüfungswoche und Anmeldeschluss", en: "Prescribing: exam week and registration deadline" },
    description: { de: "Die Pharma-Seite zeigt die veröffentlichten MedUni-Wien-Termine mit Quelle. Nach dem Anmeldeschluss wechselt das Terminfeld automatisch zum geschlossenen Status.", en: "The Pharma page shows published MedUni Vienna dates with their source. After the registration deadline, the date card switches automatically to the closed state." },
  },
  {"date": "2026-10-11", "tag": "improvement", "title": {"de": "Eine gemeinsame Sprachauswahl", "en": "One shared language picker"}, "description": {"de": "Die Sprachauswahl verwendet jetzt die native Liste deines Geräts. Gespeicherte Einstellungen bleiben erhalten; nicht freigegebene Übersetzungen zeigen englische Menüs. Die Prüfungsfragen bleiben auf Deutsch.", "en": "The language picker now uses your device's native list. Saved preferences are retained; unreviewed translations use English menus. Exam questions remain in German."}},
  {"date": "2026-10-11", "tag": "fix", "title": {"de": "Nach der Anmeldung dort weitermachen", "en": "Continue where you intended after sign-in"}, "description": {"de": "Anmeldung, Telegram-Code und E-Mail-Bestätigung behalten das gewählte Lernziel. Ein Pro-Test führt zuerst zu den Bedingungen, bevor du ihn startest.", "en": "Sign-in, Telegram codes and email verification retain your chosen destination. A Pro trial takes you to its terms before you start it."}},
  {"date": "2026-10-11", "tag": "fix", "title": {"de": "Daten erneut laden, ohne den Kontext zu verlieren", "en": "Retry data without losing context"}, "description": {"de": "Ladefehler zeigen einen Hinweis mit einer erneuten Versuchsmöglichkeit. Bereits geladene Inhalte bleiben sichtbar; eine fehlgeschlagene Kartenbewertung führt nicht zur nächsten Karte.", "en": "Loading failures show a retry option. Previously loaded content remains visible; a failed flashcard rating keeps the current card."}},
  {"date": "2026-10-11", "tag": "fix", "title": {"de": "Zahlungsstatus und gebuchte Beträge klarer anzeigen", "en": "Clearer payment states and recorded amounts"}, "description": {"de": "Zahlung und Zugang werden getrennt geprüft. Gebuchte Beträge zeigen die genauen Cent-Werte. Eine Verlängerung führt zuerst zu den Tarifbedingungen.", "en": "Payment and access are checked separately. Recorded charges show exact cents. Renewal first takes you to the plan terms."}},
  {"date": "2026-10-11", "tag": "fix", "title": {"de": "Lernlinks ohne Kontokennung", "en": "Study links without an account identifier"}, "description": {"de": "Geteilte Lernlinks enthalten keine Kontokennung mehr. Nicht verfügbare Erinnerungsangebote werden ausgeblendet.", "en": "Shared study links no longer include an account identifier. Unavailable reminder offers are hidden."}},
  {
    date: "2026-10-12",
    tag: "feature",
    title: { de: "Wien: Anmeldefristen und Prüfungsregeln", en: "Vienna: registration deadlines and exam rules" },
    description: {
      de: "Neue Hinweise zu SIP4a, SIP5a, Rezeptierkunde und Gerichtsmedizin mit offiziellen Quellen, Wiener Ortszeit, Quellenstand und Meldemöglichkeit. Nicht bestätigte Anmeldefenster werden gekennzeichnet.",
      en: "New guidance for SIP4a, SIP5a, Rezeptierkunde and Gerichtsmedizin with official sources, Vienna local time, review stamps and discrepancy reporting. Unconfirmed registration windows are labelled.",
    },
  },
  {
    date: "2026-10-11",
    tag: "feature",
    title: { de: "Anmeldefrist für SIP4a und SIP5a im Kalender", en: "SIP4a and SIP5a registration deadline in the calendar" },
    description: {
      de: "Der Prüfungskalender zeigt das Datum des nächsten Anmeldeschlusses und die verbleibenden Tage nach Wiener Zeit. Unter 14 Tagen hebt ein dezenter Hinweis die Frist hervor. Nach Ablauf erscheint das nächste veröffentlichte Anmeldefenster.",
      en: "The exam calendar shows the next registration deadline date and days left in Vienna time. A subtle badge highlights deadlines under 14 days away. After the deadline, the calendar moves to the next published registration window.",
    },
  },
  {
  "date": "2026-10-11",
  "tag": "fix",
  "title": {
    "de": "Zugang nach Erstattungen korrekt berechnen",
    "en": "Calculate access correctly after refunds"
  },
  "description": {
    "de": "Nach einer Erstattung berechnen wir Ihren verbleibenden Zugang aus den Zahlungen, die nicht erstattet wurden. Eine Testphase behält ihre ursprüngliche Laufzeit, spätere Käufe bleiben erhalten, und eine doppelte Zahlung verlängert den Zugang nur einmal.",
    "en": "After a refund, your remaining access is calculated from the payments that were not refunded. A trial keeps its original length, later purchases are kept, and a duplicate payment extends access only once."
  }
},
  {
    date: "2026-10-11",
    tag: "admin",
    title: { de: "Kanal-Strategie nur für Admins", en: "Channel strategy admin-only" },
    description: {
      de: "Strategie, Outreach-Ziele und Präsenzliste der Kanäle-Seite werden nur noch über eine Admin-Abfrage geladen und sind in keinem öffentlichen Skript enthalten. Plan & Actions wurde entfernt; alte Links führen zur Admin-Startseite.",
      en: "The Channels page strategy, outreach targets and presence list now load only through an admin request and ship in no public script. Plan & Actions was removed; old links open the admin home.",
    },
  },
  {
    date: "2026-10-11", tag: "admin",
    title: { de: "Mentor-Datenschutz, Belege und Betriebsansichten vorbereitet", en: "Mentor privacy, receipts and operations views prepared" },
    description: {
      de: "Der deaktivierte Mentor-Kandidat ergänzt löschbare Chats, geprüfte Einstiegskontexte, bestätigte Prüfungsdaten, zahlungsbezogene Belege und Betriebsansichten. Datenbank-, Browser-, Modell- und Sprachprüfungen stehen vor der Freigabe.",
      en: "The disabled mentor candidate adds chat erasure, validated entry context, confirmed exam dates, payment receipts and operations views. Database, browser, model and language checks remain release gates.",
    },
  },
  {
    date: "2026-10-11", tag: "admin",
    title: { de: "Mentor-Verlauf, Guthaben und Erklärungen vorbereitet", en: "Mentor history, credits and explanations prepared" },
    description: {
      de: "Der deaktivierte Mentor-Kandidat bewahrt Fragen und Verlauf, trennt Rate-Limits und Erklärungsebenen und ergänzt wiederherstellbare Paketkäufe. Datenbank-, Browser-, Modell-, Sprach- und medizinische Prüfungen stehen vor der Freigabe.",
      en: "The disabled mentor candidate preserves questions and history, distinguishes rate limits and explanation layers and adds recoverable package purchases. Database, browser, model, language and medical reviews remain release gates.",
    },
  },
  {
    date: "2026-10-11", tag: "admin",
    title: { de: "Mentor-Prüfung und Betriebsansichten vorbereitet", en: "Mentor review and operations views prepared" },
    description: {
      de: "Der deaktivierte Mentor-Kandidat ergänzt Quellenansichten, Antwortprüfung, Faktenstatus, Einführungskontrollen und begrenzte Auswertung. Datenbank-, Browser-, Sprach- und Modellprüfungen bleiben vor der Freigabe erforderlich.",
      en: "The disabled mentor candidate adds source presentation, answer review, fact health, rollout controls and bounded analytics. Database, browser, language and model checks remain required before release.",
    },
  },
  {
    date: "2026-10-11", tag: "admin",
    title: { de: "Mentor-Quellen und Bedienung vorbereitet", en: "Mentor sources and controls prepared" },
    description: {
      de: "Der deaktivierte Mentor-Kandidat zeigt Quellenprüfdaten, ältere Angaben und getrennte Prüfhinweise. Guthaben, Antwortwiederherstellung und Frage-Meldungen wurden vorbereitet. Sprach-, Browser- und Modellprüfungen stehen vor der Freigabe.",
      en: "The disabled mentor candidate shows source check dates, older information and separate validation notices. Credits, answer recovery and question reports have been prepared. Language, browser and model gates precede release.",
    },
  },
  {
    date: "2026-10-11", tag: "admin",
    title: { de: "Mentor-Sicherungen zur Einführung vorbereitet", en: "Mentor safeguards prepared for launch" },
    description: {
      de: "Vorbereitete Mentor-Ansichten behalten Guthaben bei Pausen, verhindern doppelte Zahlungsversuche und erlauben Antwortmeldungen. Wiederholte Anfragen nutzen dieselbe Antwort. Die Einführung bleibt hinter deaktivierten Einstellungen; Datenbank- und Browserprüfungen stehen vor der Freigabe.",
      en: "Prepared mentor views preserve credits during pauses, prevent duplicate payment attempts and support answer reports. Repeated requests recover the same answer. Launch remains behind disabled settings; database and browser acceptance checks precede release.",
    },
  },
  {
    date: "2026-10-11",
    tag: "admin",
    title: {"de": "Admin-Datenschutz", "en": "Admin privacy"},
    description: {"de": "Admin-Seiten laden keine Analyse- oder Werbeskripte und kein Telegram-SDK.", "en": "Admin pages exclude analytics, advertising pixels and the Telegram SDK."},
  },
  {
    date: "2026-10-11",
    tag: "admin",
    title: {"de": "Sichere Weiterleitung nach Anmeldung", "en": "Safer login redirects"},
    description: {"de": "Links nach der Anmeldung akzeptieren nur Pfade auf dieser Website.", "en": "Login return links now accept paths on this site only."},
  },
  {
    date: "2026-10-11",
    tag: "admin",
    title: {"de": "Reduzierte Admin-Antworten", "en": "Smaller admin responses"},
    description: {"de": "Audit- und Webhook-Abfragen lassen ungenutzte sensible Felder weg; die Übersicht zeigt Aktivitätszahlen.", "en": "Audit and webhook reads omit unused sensitive fields; overview shows activity counts."},
  },
  {
    date: "2026-10-11",
    tag: "admin",
    title: {"de": "Verständliche Admin-Fehler", "en": "Readable admin errors"},
    description: {"de": "Fehlgeschlagene Datenabfragen zeigen eine allgemeine Fehlermeldung mit Referenz.", "en": "Failed data requests return a generic error and a reference for diagnosis."},
  },
  {
    date: "2026-10-11",
    tag: "admin",
    title: {"de": "Sichere CSV-Exporte", "en": "Safe CSV exports"},
    description: {"de": "Wartelisten-CSV-Zellen starten keine Tabellenformeln.", "en": "Waitlist CSV cells cannot start spreadsheet formulas."},
  },
  {
    date: "2026-10-11",
    tag: "admin",
    title: {"de": "Ladefehler in der Übersicht", "en": "Overview load failures"},
    description: {"de": "Fehlgeschlagene Übersichts- und Audit-Abfragen zeigen Erneut versuchen statt leerer Zähler.", "en": "Failed overview and audit-summary loads show Retry instead of empty counters."},
  },
  {
    date: "2026-10-11",
    tag: "admin",
    title: {"de": "Admin-Fehlerzustände", "en": "Admin retry states"},
    description: {"de": "Fehlgeschlagene Admin-Abfragen zeigen Fehler und Erneut versuchen statt leerer Warteschlangen.", "en": "Failed admin reads show errors and Retry without successful empty queues."},
  },
  {
    date: "2026-10-11",
    tag: "admin",
    title: {"de": "Feedback mit Handlungsbedarf", "en": "Feedback needs action"},
    description: {"de": "Der Posteingang zeigt neues und geprüftes Feedback; geprüfte Einträge können abgeschlossen oder verworfen werden.", "en": "The inbox opens on new and reviewed feedback; reviewed rows can be resolved or dismissed."},
  },
  {
    date: "2026-10-11",
    tag: "admin",
    title: {"de": "Vollständige Themenzahlen", "en": "Complete topic counts"},
    description: {"de": "Fragenthemen nutzen nach Prüfung gefilterte Datenbank-Aggregate.", "en": "Question topics use database aggregates filtered by exam."},
  },
  {
    date: "2026-10-11",
    tag: "admin",
    title: {"de": "Warteschlange fehlender Bilder", "en": "Missing-image queue"},
    description: {"de": "Die Medienseite zeigt markierte aktive Fragen mit Link zum Fragenbrowser.", "en": "Media lists the active tagged questions and links each to Browse."},
  },
  {
    date: "2026-10-11",
    tag: "admin",
    title: {"de": "MCQ-Bereichsangabe", "en": "MCQ scope label"},
    description: {"de": "Der MCQ-Anteil ist als Wien + Innsbruck gekennzeichnet und schließt die Pharmakologie-Bank aus.", "en": "MCQ share is labeled Wien + Innsbruck and excludes the pharma bank."},
  },
  {
    date: "2026-10-11",
    tag: "admin",
    title: {"de": "Protokollierte Fragenänderungen", "en": "Audited question edits"},
    description: {"de": "Änderungen senden nur geänderte Felder, protokollieren Vorher/Nachher und bestätigen das Ausblenden.", "en": "Edits send only changed fields, retain before/after audit values and confirm hiding questions."},
  },
  {
    date: "2026-10-11",
    tag: "admin",
    title: {"de": "Stabile Berichtsseite", "en": "Stable Reviews page"},
    description: {"de": "Die Berichtsseite zeigt keine nicht verfügbaren Kontextangaben mehr.", "en": "Reviews no longer render unavailable context chips."},
  },
  {
    date: "2026-10-11",
    tag: "admin",
    title: {"de": "Lernendennamen nach Berechtigung", "en": "Permission-aware learner names"},
    description: {"de": "Inhaltsprüfer ohne Zugriff auf Lernendendaten sehen eine neutrale Bezeichnung.", "en": "Content reviewers without learner access see a neutral learner label."},
  },
  {
    date: "2026-10-11",
    tag: "admin",
    title: {"de": "Lesbarer Lernendenkopf", "en": "Readable learner header"},
    description: {"de": "Der Profilkopf wird auf Smartphones gestapelt, damit Namen lesbar bleiben.", "en": "The learner profile header stacks on phones to keep names readable."},
  },
  {
    date: "2026-10-11",
    tag: "admin",
    title: {"de": "Sichtbare Zeilenaktionen", "en": "Visible row actions"},
    description: {"de": "Zeilenmenüs bleiben außerhalb des Tabellenrahmens sichtbar und öffnen bei unteren Zeilen nach oben.", "en": "Row menus escape table clipping and open above low rows."},
  },
  {
    date: "2026-10-11",
    tag: "admin",
    title: {"de": "Verzeichnisfilter in der URL", "en": "Directory URL state"},
    description: {"de": "Suche, Filter, Sortierung und Seite bleiben bei Aktualisierung und Zurück erhalten.", "en": "Search, filters, sort and page survive refresh and browser Back."},
  },
  {
    date: "2026-10-11",
    tag: "admin",
    title: {"de": "Identitäten im Verzeichnis", "en": "Directory identities"},
    description: {"de": "Zeilen zeigen E-Mail oder Benutzernamen unter dem Namen; die redundante Rollenspalte entfällt.", "en": "User rows show email or username beneath the name and omit the redundant Role column."},
  },
  {
    date: "2026-10-11",
    tag: "admin",
    title: {"de": "Eine Aktualisierung pro Seite", "en": "One page refresh control"},
    description: {"de": "Die Admin-Kopfleiste zeigt keinen zusätzlichen wirkungslosen Aktualisierungsknopf.", "en": "The admin top bar no longer shows an ineffective extra Refresh button."},
  },
  {
    date: "2026-10-11",
    tag: "admin",
    title: {"de": "Admin-Zugriffsprüfung", "en": "Admin access recovery"},
    description: {"de": "Lernende werden von Admin-Seiten zur Startseite geleitet; temporäre Zugriffsfehler werden einmal erneut geprüft.", "en": "Learners opening admin return home; transient access failures retry once."},
  },
  {
    date: "2026-10-11",
    tag: "admin",
    title: {"de": "Freigabeknopf im Dunkelmodus", "en": "Dark-mode approval button"},
    description: {"de": "Primäre Admin-Knöpfe haben im Dunkelmodus einen sichtbaren Hintergrund.", "en": "Primary admin buttons have a visible fill in dark mode."},
  },
  {
    date: "2026-10-11",
    tag: "admin",
    title: {"de": "Begrenzte Systemabfragen", "en": "Bounded system reads"},
    description: {"de": "Die Fehlerseite zeigt die ersten 25 der offenen Gesamtzahl; Anbieterabfragen enden nach acht Sekunden.", "en": "Errors lists the first 25 of the unresolved total; provider reads time out after eight seconds."},
  },
  {
    date: "2026-10-11",
    tag: "admin",
    title: {"de": "Gleichzeitige Empfehlungszahlungen", "en": "Referral payout concurrency"},
    description: {"de": "Nur weiterhin qualifizierte Geldempfehlungen können als bezahlt markiert werden; gleichzeitige Anfragen zeigen einen Konflikt.", "en": "Only still-qualified cash referrals can be marked paid; overlapping requests return a conflict."},
  },
  {
    date: "2026-10-07", tag: "admin",
    title: { de: "Manuell gewährten Pro-Zugang bewahren", en: "Preserve manually granted Pro access" },
    description: {
      de: "Ein unbefristeter Pro-Zugang bleibt bei einer zusätzlichen Zahlung oder beim Ablauf eines älteren Abonnements erhalten. Ein separat gewährter längerer Zugang wird durch die Deaktivierung einer kürzeren Mitgliedschaft nicht gekürzt.",
      en: "Non-expiring Pro access is preserved when an additional payment arrives or an older subscription expires. Deactivating a shorter membership preserves separately granted longer access.",
    },
  },
  {
    date: "2026-10-06", tag: "admin",
    title: { de: "Support-Chat zur Einrichtung vorbereitet", en: "Support chat prepared for configuration" },
    description: {
      de: "Intercom ist hinter einer standardmäßig deaktivierten Einstellung wieder integriert. Die Identität wird serverseitig geprüft; das Feedback-Formular bleibt verfügbar.",
      en: "Intercom is integrated behind a default-off setting. Identity is verified server-side; the feedback form remains available.",
    },
  },
  {
    date: "2026-10-05", tag: "admin",
    title: { de: "Vorbereitete Ops-Aktionen prüfen", en: "Review prepared Ops actions" },
    description: {
      de: "Neue geschützte Owner-Ansicht für exakt vorbereitete Zugangsänderungen. Freigabe und Ausführung sind getrennt; APIs und Schreibfunktionen bleiben bis zur Einrichtung deaktiviert.",
      en: "A protected owner view reviews exact prepared access changes. Approval and execution are separate; APIs and writes stay disabled until provisioning is complete.",
    },
  },
  {
    date: "2026-10-05",
    tag: "feature",
    title: {
      de: "Neuer Blogartikel: Ukrainische Flüchtlingsärzt:innen in Österreich",
      en: "New blog post: Ukrainian refugee physicians in Austria",
    },
    description: {
      de: "Veröffentlicht: Der vollständige Weg für ukrainische Ärzt:innen zur österreichischen Approbation: Nostrifizierung, Sprachprüfung, Stichprobentest (250 Fragen), Kosten, Fristen und Sofort-Schritte.",
      en: "Published: The complete pathway for Ukrainian physicians to Austrian medical licensure: nostrification, language exam, Stichprobentest (250 questions), costs, deadlines, and immediate next steps.",
    },
  },
  {
    date: "2026-10-03", tag: "improvement",
    title: { de: "Feedback direkt an MedPrüf senden", en: "Send feedback directly to MedPrüf" },
    description: {
      de: "Der Feedback-Button öffnet jetzt auf Handy und Desktop direkt das Formular in der App. Nachrichten und Fehlermeldungen landen wie gewohnt bei unserem Support-Team.",
      en: "The feedback button now opens the in-app form directly on phone and desktop. Messages and problem reports continue to reach our support team.",
    },
  },
  {
    date: "2026-10-02", tag: "admin",
    title: {
      de: "Zahlungen und Freikontingent serverseitig gehärtet",
      en: "Payments and free quota hardened server-side",
    },
    description: {
      de: "Verlängerungszahlungen werden jetzt über die Whop-Mitgliedschaft dem richtigen Konto zugeordnet (nicht mehr über die E-Mail des Zahlers). Abgelehnte Karten lösen genau eine Hinweis-Mail mit dem Whop-Abrechnungslink aus; die Kulanzfrist gilt nur noch für das betroffene Konto. Der tägliche Ablauf-Cron läuft wieder. Das Freikontingent wird auf allen Inhalts-Endpunkten serverseitig durchgesetzt, inklusive KI-Erklärungen, Übersetzungen, Prüfungsauswertung und Notizen; der öffentliche Datenbank-Schlüssel kann keine Fragentexte mehr lesen.",
      en: "Renewal payments now map to the right account via the Whop membership (no longer via the payer's email). A declined card triggers exactly one notice email with the Whop billing link; the dunning grace now applies only to the affected account. The daily expiry cron runs again. The free quota is enforced server-side on every content endpoint, including AI explanations, translations, exam grading and notes; the public database key can no longer read question content.",
    },
  },
  {
    date: "2026-10-02", tag: "fix",
    title: { de: "Klarstellung: Verlängerung und Kündigung", en: "Clarification: renewal and cancellation" },
    description: {
      de: "FAQ, AGB, Preise und Einstellungen sagen jetzt klar: Einzelmonat (19 € pro Monat) und 3-Monats-Tarif (49 € pro Quartal) verlängern sich automatisch, bis du kündigst. Die Prüfungs-Kohorte (129 €) ist eine Einmalzahlung. Kündigen kannst du jederzeit bei Whop unter whop.com/@me/settings/memberships. Frühere Hinweise wie „kein Abo“ trafen auf diese beiden Tarife nicht zu.",
      en: "FAQ, Terms, Pricing and Settings now say it plainly: the Single Month (19 € per month) and 3-Month plan (49 € per quarter) renew automatically until you cancel. The Exam Cohort (129 €) is a one-time payment. You can cancel anytime at Whop via whop.com/@me/settings/memberships. Earlier statements such as \"not a subscription\" did not apply to those two plans.",
    },
  },
  {
    date: "2026-09-27", tag: "fix",
    title: { de: "Direkt ins gewählte Lernen", en: "Go straight to the study mode you chose" },
    description: {
      de: "Jetzt lernen und Themenkarten starten direkt mit neuen Fragen. Eine frühere Sitzung wird nur über Weitermachen fortgesetzt. Der Test-Builder erscheint nur, wenn du ihn öffnest.",
      en: "Study now and topic cards start directly with new questions. A previous session resumes only through Continue. The test builder appears only when you open it.",
    },
  },
  {
    date: "2026-09-27", tag: "fix",
    title: { de: "Prüfungsinfos bleiben aktuell und lesbar", en: "Exam information stays current and readable" },
    description: {
      de: "Prüfung und Prüfungstermin in den Einstellungen werden mit deinem Konto abgeglichen. Prüfungstermine und Anmeldefristen bleiben aktuell, und Prüfungsnamen passen besser auf kleine Bildschirme.",
      en: "Exam track and date in Settings now match your account and study plan. Exam dates stay current, and long exam names are easier to read on small screens.",
    },
  },
  {
    date: "2026-09-27", tag: "improvement",
    title: { de: "Lernen auf jedem Bildschirm verlässlicher", en: "More reliable study on every screen" },
    description: {
      de: "Lesezeichen und Notizen sind deinem Konto zugeordnet. Quizfortschritt lässt sich zuverlässiger fortsetzen, und offline gespeicherte Antworten werden bei erneuter Verbindung synchronisiert. Die Lernansichten passen sich besser an Handy, Tablet und Desktop an.",
      en: "Bookmarks and notes are linked to your account. Quiz progress is more reliable to resume, and answers saved offline sync when you reconnect. Study screens adapt better to phones, tablets, and desktop.",
    },
  },
  {
    date: "2026-09-25", tag: "fix",
    title: { de: "Neue Fragen und Wiederholungen klar getrennt", en: "New questions and reviews clearly separated" },
    description: {
      de: "Wähle im Quiz zwischen neuen Fragen, Fehlern, fälligen Wiederholungen und gemischtem Lernen. Neue Fragen werden der Reihe nach ohne bereits beantwortete Fragen geladen. Deine Fehlerliste ist direkt am Thema erreichbar. Antworten zählen erst nach bestätigtem Speichern; bei Verbindungsproblemen kannst du das Speichern erneut versuchen.",
      en: "Choose new questions, mistakes, due reviews or mixed practice in the quiz. New questions load in order without already-answered questions. Your mistake list is accessible from each topic. Answers count only after saving is confirmed, with a retry option for connection problems.",
    },
  },
  {
    date: "2026-09-25",
    tag: "improvement",
    title: {
      de: "Ein klarer Tag Kulanz nach dem Pro-Testzeitraum",
      en: "One clear grace day after the Pro trial",
    },
    description: {
      de: "Wenn die erste Zahlung nach dem 7-tägigen Pro-Testzeitraum nicht eingeht, bleibt Pro noch einen Tag aktiv. Danach wird der Zugang auf Free umgestellt.",
      en: "If the first payment does not go through after the 7-day Pro trial, Pro stays active for one extra day. Access then moves to Free.",
    },
  },
  {
    date: "2026-09-24",
    tag: "improvement",
    title: {
      de: "Klarer Lernfortschritt ohne wiederholte neue Fragen",
      en: "Clearer progress with no repeated new questions",
    },
    description: {
      de: "Neue-Fragen-Sitzungen merken sich beantwortete Fragen fach- und examensbezogen über mehrere Tage. Eine Sitzung endet nach deinem Tagesziel oder dem Ziel des Lernplans. Dein Fortschritt zählt jetzt einzigartige Fragen im gewählten Examen; Antwortversuche und Trefferquote bleiben separat sichtbar.",
      en: "New-question sessions remember answered questions by specialty and exam across study days. Each session ends at your daily goal or the study-plan target. Progress now counts unique questions in your selected exam, while answer attempts and accuracy remain separate.",
    },
  },
  {
    date: "2026-09-21",
    tag: "improvement",
    title: {
      de: "Monatliche und vierteljährliche Pro-Tarife",
      en: "Monthly and quarterly Pro plans",
    },
    description: {
      de: "Der Pro-Zugang ist jetzt monatlich für 19 € oder vierteljährlich für 49 € erhältlich. Beide Tarife verlängern sich automatisch und können jederzeit vor der nächsten Verlängerung gekündigt werden. Die Prüfungs-Kohorte für 129 € bleibt ein einmaliger Tarif mit Pass-Until-You-Pass.",
      en: "Pro is now available monthly for €19 or quarterly for €49. Both plans renew automatically and can be cancelled before the next renewal. The €129 Exam Cohort remains a one-time plan with Pass-Until-You-Pass.",
    },
  },
  {
    date: "2026-09-21",
    tag: "improvement",
    title: {
      de: "Klarere Zahlungsbestätigung",
      en: "Clearer payment confirmation",
    },
    description: {
      de: "Die Seite nach dem Kauf bestätigt deine Zahlung jetzt ehrlich und in Echtzeit: Solange die Freischaltung läuft, siehst du genau das, und die Seite prüft bis zu fünf Minuten lang weiter, auch wenn eine Kartenzahlung etwas länger dauert. Ab zehn Sekunden siehst du den Status und kannst in der Zwischenzeit direkt weiterlernen; falls etwas nicht automatisch zugeordnet werden kann, melden wir uns per E-Mail und schalten dich frei. Niemand muss mehr zweimal zahlen, weil die Seite einen Status angezeigt hat, der noch nicht stimmte.",
      en: "The page after checkout now confirms your payment honestly and in real time: while activation is still running, it says exactly that, and it keeps checking for up to five minutes, even when a card payment takes a little longer. After ten seconds you see the status and can keep learning right away in the meantime; if a payment cannot be tied to your account automatically, we will email you and unlock your access. Nobody has to pay twice because the page showed a status that was not true yet.",
    },
  },
  {
    date: "2026-09-21",
    tag: "admin",
    title: {
      de: "Empfehlungshinweise ausblendbar",
      en: "Referral prompts can be dismissed",
    },
    description: {
      de: "Der schwebende Empfehlungshinweis und die Empfehlungskarte auf dem Dashboard haben jetzt ein X zum Schließen. Nach dem Ausblenden bleiben beide mindestens 30 Tage ruhig, auch nach einem Neuladen.",
      en: "The floating referral prompt and the referral card on the dashboard now have an X to close them. After dismissing, both stay quiet for at least 30 days, even after a reload.",
    },
  },
  {
    date: "2026-09-20",
    tag: "fix",
    title: {
      de: "Quiz-Fortschritt bleibt erhalten",
      en: "Quiz progress is now kept",
    },
    description: {
      de: "Bis jetzt wurde eine laufende Quiz-Sitzung nicht gespeichert: nach einer Pause, einem App-Update oder einem Browser-Neustart ging es wieder bei Frage 1 los. Deine Sitzung wird jetzt laufend gespeichert und beim nächsten Öffnen kannst du genau dort weitermachen, wo du aufgehört hast.",
      en: "Until now, an in-progress quiz was lost on any reload, app update or browser restart, and you started over at question 1. Your session is now saved continuously and offered for resumption, so you continue exactly where you stopped.",
    },
  },
  {
  "date": "2026-09-20",
  "tag": "feature",
  "title": {
    "de": "Verlauf Ihrer Prüfungssimulationen",
    "en": "History of your exam simulations"
  },
  "description": {
    "de": "Jede eingereichte Prüfungssimulation wird dauerhaft gespeichert. Mit Pro öffnen Sie sie jederzeit Frage für Frage wieder, mit der richtigen Antwort und der Erklärung, und durchsuchen alle beantworteten Fragen nach Prüfung, Fachgebiet, richtig oder falsch und Zeitraum.",
    "en": "Every exam simulation you submit is saved for good. With Pro you can reopen it question by question with the correct answer and the explanation, and browse every question you answered by exam, subject, right or wrong and time window."
  }
},
  {
    date: "2026-09-20",
    tag: "admin",
    title: {
      de: "Zahlungs-Rückgewinnung und Testende-Erinnerung (Whop v1 Webhook)",
      en: "Payment recovery and trial-ending reminder (Whop v1 webhook)",
    },
    description: {
      de: "Interne Härtung: Ein neuer Whop-Webhook (Standard Webhooks, api_version v1) liefert jetzt auch fehlgeschlagene Zahlungen und Prüf-Anforderungen der Bank. Schlägt eine Verlängerung fehl oder will die Bank die Zahlung bestätigt haben, erhält der Käufer automatisch eine E-Mail mit einem Wiederherstellungs-Link, mit dem dieselbe Zahlung in einer Minute abgeschlossen werden kann. Zusätzlich sendet Whop jetzt sein eigenes Signal, bevor ein kostenloser 7-Tage-Test endet, und der Käufer bekommt eine Erinnerung mit den Konditionen (19 €/Monat danach) und dem Kündigungslink.",
      en: "Internal hardening: a new Whop webhook (Standard Webhooks, api_version v1) also delivers failed payments and bank verification requests. If a renewal fails or the bank wants the buyer to confirm a charge, the buyer automatically receives an email with a recovery link that resumes the exact payment in one minute. Whop also now sends its own signal before a 7-day trial ends, and the buyer gets a reminder stating the 19 €/month terms and how to cancel.",
    },
  },
  {
    date: "2026-09-20",
    tag: "improvement",
    title: {
      de: "Schnellere Pro-Aktivierung nach der Zahlung",
      en: "Faster Pro activation after payment",
    },
    description: {
      de: "Nach einer erfolgreichen Zahlung wird dein Pro-Zugang jetzt direkt beim Zurückkehren freigeschaltet, statt nur auf die Zahlungsbestätigung des Anbieters zu warten. Erworbene Zeiträume addieren sich außerdem korrekt: Wer erneut kauft, verliert keine bereits gebuchten Tage mehr.",
      en: "After a successful payment, your Pro access now activates immediately when you return, instead of waiting for the payment notification. Purchased periods also now add up correctly, so buying again never costs you days you already had.",
    },
  },
  {
    date: "2026-09-20",
    tag: "admin",
    title: {
      de: "Whop-Grant-Erweiterung + Rückkehr-Verifizierung + Cron-Heartbeat",
      en: "Whop grant extension + return verify + cron heartbeat",
    },
    description: {
      de: "Interne Zahlungshärting: Webhook-Grants erweitern jetzt ein aktives Whop-Abo (extend-or-insert) statt die Laufzeit zu überschreiben. Neue Route /api/whop/checkout/verify verifiziert bezahlte Rückkehrer serverseitig gegen das Whop-Ledger (der Auslöser war eine ~3h verspätete Webhook-Zustellung am 17.09., die einen Doppelkauf verursachte). Cross-Path-Idempotenz über die Payment-ID verhindert Doppel-Extensions. Cron-Heartbeat-Event für die Verifikation, ob der Vercel-Cron überhaupt feuert.",
      en: "Internal payment hardening: webhook grants now extend an active Whop subscription in place (extend-or-insert). New route /api/whop/checkout/verify verifies paid returns server-side against the Whop ledger (trigger: a ~3h-late webhook delivery on 2026-09-17 caused a real double purchase). Cross-path idempotency keyed on the payment id prevents double extensions. Cron heartbeat event added to verify whether the Vercel cron actually fires.",
    },
  },
  {
    date: "2026-07-31",
    tag: "admin",
    title: {
      de: "Whop-Pixel eingebunden (nur nach Einwilligung)",
      en: "Whop pixel added (consent-gated)",
    },
    description: {
      de: "Der Attributions-Pixel unseres Zahlungsanbieters Whop ist eingebunden, damit wir sehen, welche Inhalte zu einem Kauf führen. Er wird auf allen Seiten geladen, auf Grundlage unseres berechtigten Interesses an dieser Messung. Die Datenschutzerklärung nennt ihn jetzt ausdrücklich, inklusive des verwendeten Geräte-Erkennungsmerkmals und Ihres Widerspruchsrechts.",
      en: "Our payment provider Whop's attribution pixel is now installed so we can see which content leads to a purchase. It loads on all pages on the basis of our legitimate interest in that measurement. The privacy policy now names it explicitly, including the device fingerprint it uses and your right to object.",
    },
  },
  {
    date: "2026-07-31",
    tag: "improvement",
    title: {
      de: "Klarer Hinweis: ein zweites Konto schaltet keine weiteren Gratis-Fragen frei",
      en: "Clearer note: a second account does not unlock more free questions",
    },
    description: {
      de: "Wer bereits ein Konto hat, sieht beim Anmelden jetzt einen Hinweis auf sein bekanntes Konto, damit der Lernfortschritt nicht versehentlich auf zwei Konten aufgeteilt wird. Am Limit der Gratis-Fragen steht jetzt außerdem offen dabei, dass die 150 kostenlosen Fragen pro Prüfung bei jedem Konto dieselben sind.",
      en: "If you already have an account, the login screen now points you back to it so your progress does not get split across two accounts by accident. The free-question limit also now says openly that the 150 free questions per exam are the same on every account.",
    },
  },
  {
    date: "2026-07-31",
    tag: "admin",
    title: {
      de: "Interne Härtung: Auswertungs-View nicht mehr öffentlich lesbar",
      en: "Internal hardening: analytics view no longer publicly readable",
    },
    description: {
      de: "Die interne View question_popularity lief ohne security_invoker und war über den öffentlichen API-Schlüssel lesbar, wodurch die Antwortzahlen pro Frage plattformweit abrufbar waren. Keine personenbezogenen Daten betroffen (die View enthält keine Nutzer-ID). Zugriff jetzt auf die Service-Rolle beschränkt.",
      en: "The internal question_popularity view ran without security_invoker and was readable with the public API key, exposing platform-wide answer counts per question. No personal data was involved (the view carries no user id). Access is now restricted to the service role.",
    },
  },
  {
    date: "2026-07-11",
    tag: "admin",
    title: {
      de: "Für freigeschaltete Konten: Empfehlungen zählen nach dem Pro-Trial",
      en: "For eligible accounts: referrals count after the Pro trial",
    },
    description: {
      de: "Damit eine Empfehlung zählt, muss die eingeladene Person zusätzlich zum aktiven Üben den Pro-Trial starten: Karte hinterlegt, 0 € heute, jederzeit in der Testwoche kündbar, danach 19 €/Monat. Das Empfehlungsprogramm ist nur für ausgewählte Konten freigeschaltet.",
      en: "For a referral to count, the invited person must start the Pro trial as well as actively practise: card on file, 0 € today, cancel anytime during the trial week, then 19 €/month. The referral program is enabled only for selected accounts.",
    },
  },
  {
    date: "2026-07-11",
    tag: "admin",
    title: {
      de: "Empfehlungs-Bonus für ausgewählte Konten",
      en: "Referral reward for selected accounts",
    },
    description: {
      de: "Wenn dein Konto für das Empfehlungsprogramm freigeschaltet ist, kannst du Kolleginnen und Kollegen einladen. Wenn zwei Einladungen die Teilnahmebedingungen erfüllen, erhältst du MedPrüf Pro kostenlos durch dein Prüfungsfenster. Das Programm ist nicht für alle Konten verfügbar.",
      en: "If your account is enabled for the referral program, you can invite colleagues. When two referrals meet the participation requirements, you receive MedPrüf Pro free through your exam window. The program is not available to every account.",
    },
  },
  {
  "date": "2026-07-09",
  "tag": "improvement",
  "title": {
    "de": "Pro-Testphase: 7 Tage gratis mit hinterlegter Karte",
    "en": "Pro trial: 7 days free with a card on file"
  },
  "description": {
    "de": "Sie testen Pro 7 Tage lang ohne Kosten. Sie hinterlegen eine Karte, heute werden 0 € belastet. Danach kostet Pro 19 € pro Monat, außer Sie kündigen während der Testwoche. Alle Bedingungen stehen vorab da, ohne versteckte Verlängerung.",
    "en": "Try Pro for 7 days at no cost. You add a card and are charged 0 € today. After that Pro costs 19 € per month unless you cancel during the trial week. All terms are shown up front, with no hidden renewal."
  }
},
  {
    date: "2026-07-05",
    tag: "admin",
    title: {
      de: "MedPrüf ist jetzt für KI-Agenten auffindbar",
      en: "MedPrüf is now discoverable by AI agents",
    },
    description: {
      de: "Neue offene Metadaten (RFC 8288 Link-Header, robots Content-Signals, Markdown für Agenten, API-Katalog, Agent-Skills, MCP) lassen KI-Assistenten den Prüfungskalender und die Ressourcen finden. Deine Inhalte und der Fragenpool bleiben geschützt, nichts ändert sich für Nutzer.",
      en: "New open metadata (RFC 8288 Link headers, robots Content-Signals, Markdown for agents, API catalog, Agent Skills, MCP) lets AI assistants discover the exam calendar and resources. Your content and the question bank stay protected, and nothing changes for users.",
    },
  },
  {
    date: "2026-07-04",
    tag: "admin",
    title: {
      de: "Admin: Nutzer-Detailseite mit Aktivitäts-Timeline",
      en: "Admin: per-user detail page with activity timeline",
    },
    description: {
      de: "Jede Zeile der Nutzer-Tabelle öffnet jetzt eine eigene Profilseite: Identität, Statistik-Kacheln, Lern-Heatmap, Themen-Stärke und eine visuelle Aktivitäts-Timeline (Antworten, Sitzungen, Notizen, Zahlungen) mit genauen Details.",
      en: "Each row in the users table now opens a dedicated profile page: identity, stat cards, study heatmap, topic mastery, and a visual activity timeline (answers, sessions, notes, payments) with exact details.",
    },
  },
  {
    date: "2026-07-04",
    tag: "improvement",
    title: {
      de: "KI-Erklärung direkt im Tab, keine Seitenleiste mehr",
      en: "AI explanation right in the tab, no more side drawer",
    },
    description: {
      de: "Die KI-Erklärung öffnet sich jetzt direkt dort, wo du klickst: im Tab unter der Frage, neben Erklärung und Notizen. Die seitliche Schublade ist weg, auch beim Lesen von Notizen aus Entdecken (jetzt ein zentriertes Fenster). Deine Unterhaltung bleibt beim Tab-Wechsel erhalten.",
      en: "The AI explanation now opens right where you click: in the tab under the question, next to Explanation and Notes. The side drawer is gone, including when reading notes from Explore (now a centered window). Your conversation survives switching tabs.",
    },
  },
  {
    date: "2026-07-04",
    tag: "fix",
    title: {
      de: "Quiz- und Notiz-Verbesserungen",
      en: "Quiz and notes improvements",
    },
    description: {
      de: "Mehrere Verbesserungen: Die KI-Rückfrage behält jetzt beim Tippen den Fokus. Der KAF-Modus wird beim ersten Aktivieren kurz erklärt (mit einem Fragezeichen zum Nachlesen). Das doppelte Lesezeichen wurde zu einem zusammengeführt. Notizen zu einer Frage (deine eigenen, kuratierte und Community-Notizen) leben jetzt an einem Ort im Notizen-Tab.",
      en: "Several fixes: the AI follow-up input now keeps focus while typing. KAF mode is briefly explained on first activation (with a question mark to reread it). The duplicate bookmark was merged into one. Notes for a question (your own, curated, and community) now live in one place in the Notes tab.",
    },
  },
  {
    date: "2026-07-04",
    tag: "admin",
    title: {
      de: "Archiv: frühere Pro-Testwoche ohne Karte",
      en: "Archive: previous no-card Pro trial",
    },
    description: {
      de: "Diese frühere Testwoche ist beendet und kein aktuelles Angebot. Die heutigen Testbedingungen findest du auf der Preisseite.",
      en: "This previous trial has ended and is not a current offer. See the pricing page for current trial terms.",
    },
  },
  {
    date: "2026-07-04",
    tag: "improvement",
    title: {
      de: "Erklärungen: schöner formatiert und in deiner Sprache",
      en: "Explanations: better formatted and in your language",
    },
    description: {
      de: "Erklärungen werden jetzt richtig formatiert (Fettdruck, Listen) statt mit rohen Zeichen. Und wenn eine Übersetzung in deiner Sprache schon vorhanden ist, siehst du sie sofort, ohne zu klicken, mit einem Umschalter zwischen den Sprachen. Jede erzeugte Übersetzung wird gespeichert, sodass sie für alle sofort da ist.",
      en: "Explanations now render properly (bold, lists) instead of raw markers. And if a translation in your language already exists, you see it instantly without clicking, with a switcher between languages. Every generated translation is saved so it is instant for everyone.",
    },
  },
  {
    date: "2026-07-04",
    tag: "improvement",
    title: {
      de: "Bibliothek und Entdecken überarbeitet",
      en: "Library and Explore reworked",
    },
    description: {
      de: "Der Entdecken-Bereich zeigt jetzt durchsuchbare, filterbare und sortierbare Notizen, die du direkt öffnen und lesen kannst, ohne sie zu importieren. Kuratierte Inhalte sind als „MedPrüf Team\" gekennzeichnet. Neu: eigene Listen (Sammlungen), um Notizen zu organisieren.",
      en: "The Explore section now shows searchable, filterable and sortable notes you can open and read directly, without importing. Curated content is badged \"MedPrüf Team\". New: your own lists (collections) to organize notes.",
    },
  },
  {
    date: "2026-07-04",
    tag: "fix",
    title: {
      de: "Quiz springt zuverlässig zur nächsten Frage",
      en: "Quiz reliably advances to the next question",
    },
    description: {
      de: "In seltenen Fällen blieb das Quiz nach dem Prüfen der Antwort auf derselben Frage stehen. Das ist behoben: Die nächste Frage wird jetzt immer sauber geladen.",
      en: "In rare cases the quiz stayed on the same question after checking the answer. Fixed: the next question now always loads cleanly.",
    },
  },
  {
    date: "2026-07-04",
    tag: "feature",
    title: {
      de: "Oberfläche jetzt auch auf Arabisch",
      en: "Interface now also in Arabic",
    },
    description: {
      de: "Die App-Oberfläche gibt es jetzt auch auf Arabisch, mit vollständiger Rechts-nach-links-Darstellung. Umschaltbar in den Einstellungen und auf der Startseite. Die Prüfungsfragen bleiben auf Deutsch, wie in der echten Prüfung.",
      en: "The app interface is now available in Arabic too, with full right-to-left layout. Switchable in Settings and on the home page. Exam questions stay in German, exactly like the real exam.",
    },
  },
  {
    date: "2026-07-03",
    tag: "feature",
    title: {
      de: "KAF-Modus: erst frei antworten, wie in der echten Prüfung",
      en: "KAF mode: answer freely first, like in the real exam",
    },
    description: {
      de: "Die echte Kenntnisprüfung fragt offen (Kurzantwortfragen). Im Quiz gibt es jetzt den KAF-Modus: Die Antwortoptionen bleiben zunächst verdeckt, du formulierst deine Antwort frei und blendest die Optionen erst danach ein. Aktivierbar über den Schalter oberhalb der Frage (nur Kenntnisprüfung).",
      en: "The real Kenntnisprüfung asks open short-answer questions. The quiz now has KAF mode: options stay hidden at first, you formulate your answer freely, then reveal the options. Toggle above the question (Kenntnisprüfung only).",
    },
  },
  {
    date: "2026-07-03",
    tag: "feature",
    title: {
      de: "Kuratierte Notizen: Guides und Merkkarten zu Fragen",
      en: "Curated notes: guides and key-point cards on questions",
    },
    description: {
      de: "Das MedPrüf-Team stellt jetzt kuratierte Lerninhalte bereit: kompakte Guides nach Themen und Merkkarten, die dich beim Üben unterstützen. Du findest sie im Entdecken-Bereich der Bibliothek und direkt unter beantworteten Fragen (\"Notizen zu dieser Frage\").",
      en: "The MedPrüf team now provides curated study content: compact guides by topic and key-point cards to support your practice. Find them in the Library's Explore section and directly under answered questions (\"Notes for this question\").",
    },
  },
  {
    date: "2026-07-03",
    tag: "feature",
    title: {
      de: "Oberfläche auf Russisch, Ukrainisch und Türkisch",
      en: "Interface in Russian, Ukrainian and Turkish",
    },
    description: {
      de: "Die App-Oberfläche gibt es jetzt zusätzlich auf Русский, Українська und Türkçe (umschaltbar in den Einstellungen und auf der Startseite). Die Prüfungsfragen bleiben bewusst auf Deutsch, so wie in der echten Prüfung; Erklärungen kannst du weiterhin in 7 Sprachen übersetzen.",
      en: "The app interface is now also available in Russian, Ukrainian and Turkish (switchable in Settings and on the home page). Exam questions deliberately stay in German, exactly like the real exam; explanations can still be translated into 7 languages.",
    },
  },
  {
    date: "2026-07-03",
    tag: "admin",
    title: {
      de: "Fristerinnerung: verpass keine Anmeldung mehr",
      en: "Deadline reminders: never miss a registration",
    },
    description: {
      de: "Auf der Startseite kannst du jetzt deine E-Mail-Adresse hinterlassen und wir erinnern dich rechtzeitig, bevor die Anmeldefrist deiner Prüfung schließt (z. B. Kenntnisprüfung Wien: Anmeldeschluss 28. Juli 2026). Nur Fristerinnerungen, kein Spam, jederzeit abbestellbar.",
      en: "On the landing page you can now leave your email and we will remind you in good time before your exam's registration deadline closes (e.g. Kenntnisprüfung Vienna: registration closes 28 July 2026). Deadline reminders only, no spam, unsubscribe anytime.",
    },
  },
  {
    date: "2026-07-03",
    tag: "improvement",
    title: {
      de: "Tausende neue Erklärungen",
      en: "Thousands of new explanations",
    },
    description: {
      de: "Wir ergänzen gerade systematisch strukturierte deutsche Erklärungen für alle Fragen, die bisher keine hatten: warum die richtige Antwort stimmt und warum jede falsche Option nicht zutrifft. Tausende Fragen haben ihre Erklärung bereits erhalten, der Rest folgt laufend. Zusätzlich wurden Formatierungsfehler aus dem PDF-Import bereinigt.",
      en: "We are systematically adding structured German explanations to every question that lacked one: why the correct answer is right and why each wrong option does not apply. Thousands of questions already have theirs, the rest are being filled continuously. PDF-import formatting artifacts were cleaned up as well.",
    },
  },
  {
    date: "2026-07-03",
    tag: "improvement",
    title: {
      de: "Transparenz: Analyse in der Beta",
      en: "Transparency: analytics during beta",
    },
    description: {
      de: "Während der Beta ist die Nutzungsanalyse standardmäßig aktiv, damit wir Probleme schneller finden und beheben. Du kannst jederzeit im Cookie-Banner ablehnen; deine Wahl wird dauerhaft gespeichert. Details in der Datenschutzerklärung (Abschnitt 2.5).",
      en: "During beta, usage analytics are on by default so we can find and fix problems faster. You can decline anytime in the cookie banner; your choice is stored persistently. Details in the privacy policy (section 2.5).",
    },
  },
  {
    date: "2026-07-01",
    tag: "fix",
    title: {
      de: "Telegram-Anmeldung am Handy in der installierten App",
      en: "Telegram sign-in on mobile inside the installed app",
    },
    description: {
      de: "Wer die App aufs Handy installiert hat, konnte sich per Telegram bisher nicht anmelden: Der Login-Link öffnete Telegrams internen Browser, und die Sitzung landete nicht in der App. Der Bot schickt jetzt zusätzlich einen Anmelde-Code zum Kopieren. In der App gibt es auf der Anmeldeseite „Mit Telegram-Code anmelden“, dort den Code einfügen und fertig. Die Anmeldung ist unverändert sicher (Code einmalig gültig, 10 Minuten).",
      en: "If you installed the app on your phone, Telegram sign-in did not work: the login link opened Telegram's in-app browser, so the session never reached the app. The bot now also sends a copyable sign-in code. In the app, the sign-in screen has \"Sign in with Telegram code\": paste the code there and you're in. Sign-in stays just as secure (code is single-use, valid 10 minutes).",
    },
  },
  {
  "date": "2026-07-01",
  "tag": "improvement",
  "title": {
    "de": "Hinweis auf die Gratis-Testwoche auf der Startseite",
    "en": "Free trial reminder on Home"
  },
  "description": {
    "de": "Kostenlose Nutzer sehen auf der Startseite einen kurzen, schließbaren Hinweis auf die 7-tägige Pro-Testwoche.",
    "en": "Free users see a short, dismissible reminder about the 7-day Pro trial on Home."
  }
},
  {
    date: "2026-07-01",
    tag: "feature",
    title: {
      de: "7 Tage MedPrüf Pro gratis testen",
      en: "Try MedPrüf Pro free for 7 days",
    },
    description: {
      de: "Testen Sie eine Woche lang alles aus Pro: unbegrenzte Lernkarten-Notizen, KI-Erklärungen und mehr. Sie hinterlegen eine Karte, heute werden 0 € abgebucht. Danach 19 €/Monat, wenn Sie nicht vorher kündigen. Sichere Zahlung über Whop.",
      en: "Try everything in Pro for a week: unlimited flash-notes, AI explanations and more. You add a card, €0 is charged today. Then €19/month unless you cancel before. Secure payment via Whop.",
    },
  },
  {
  "date": "2026-06-30",
  "tag": "feature",
  "title": {
    "de": "Neu: Lernkarten-Notizen und Ihre Bibliothek",
    "en": "New: flash-notes and your Library"
  },
  "description": {
    "de": "Mit einem Tipp machen Sie aus jeder Frage, jeder Notiz oder jeder KI-Erklärung eine Lernkarte. Sie wählen die Sprache und einen Fokus, und Ihre eigene Antwort fließt mit ein, damit die Karte Ihre Lücken trifft. Alle Karten liegen in Ihrer Bibliothek, wo Sie sie durchsuchen, sortieren und mit Spaced Repetition wiederholen. Jede Karte zeigt auch ihre Quellen (Ursprungsfrage, KI-Nachricht, Bild).",
    "en": "Turn any question, note or AI explanation into a flash-note with one tap. Choose the language, add a focus, and your own answer is factored in so the card targets your gaps. Every card lives in your Library, where you can search, sort and review it with spaced repetition. Each card also shows its sources (the question, the AI message, the image)."
  }
},
  {
    date: "2026-06-30",
    tag: "admin",
    title: {
      de: "Admin-Dashboard verschlankt",
      en: "Admin dashboard consolidated",
    },
    description: {
      de: "Die Ops-Tabs sind von sechs auf drei reduziert: Overview, Plan & Actions und Channels. Neu: ein Published-und-Results-Feed (was pro Kanal veröffentlicht wurde und was es gebracht hat) plus der Sam-Schritt ganz oben in der Aktionsliste. Veraltete Preis- und Krypto-Texte korrigiert (jetzt 129 €, Whop-Karte).",
      en: "The ops tabs are down from six to three: Overview, Plan & Actions, and Channels. New: a Published and Results feed (what shipped per channel and what it produced) plus the Sam keystroke pinned at the top of the action queue. Stale price and crypto copy corrected (now 129 €, Whop card).",
    },
  },
  {
    date: "2026-06-27",
    tag: "admin",
    title: {
      de: "Aufgeräumte untere Navigation am Handy",
      en: "Tidier bottom navigation on mobile",
    },
    description: {
      de: "Die untere Leiste am Handy ist jetzt ausgewogen: Startseite, Prüfung, der hervorgehobene Quiz-Knopf in der Mitte, Karteikarten und Fortschritt. Profil und Einstellungen findest du jetzt oben rechts über dein Initial-Symbol, damit die Leiste links und rechts vom Quiz-Knopf gleichmäßig wirkt und nichts mehr gedrängt aussieht.",
      en: "The bottom bar on mobile is now balanced: Home, Exam, the highlighted Quiz button in the middle, Flashcards and Progress. Profile and Settings now live top right behind your initial badge, so the bar sits evenly on both sides of the Quiz button and nothing looks cramped.",
    },
  },
  {
    date: "2026-06-26",
    tag: "feature",
    title: {
      de: "Finde deinen Weg: kurze Orientierung für deinen Anerkennungsweg",
      en: "Find your path: a short orientation for your recognition route",
    },
    description: {
      de: "Neu und noch nicht sicher, welcher Prüfungsweg deiner ist? Beantworte drei kurze Fragen und du siehst, ob die Kenntnisprüfung Wien oder der Stichprobentest dein Weg ist, wann deine Anmeldefristen sind und wo du am besten anfängst. Du erreichst die Orientierung über die Startseite mit dem Hinweis Nicht sicher, wo du anfangen sollst. Kein Konto nötig: du kannst danach direkt kostenlos üben.",
      en: "New and not sure which exam route is yours? Answer three short questions and see whether the Kenntnisprüfung Vienna or the Stichprobentest is your path, when your registration deadlines are, and where to begin. You can reach it from the landing page via Not sure where to start. No account needed: you can practice free right after.",
    },
  },
  {
  "date": "2026-06-26",
  "tag": "improvement",
  "title": {
    "de": "Aufgeräumte Frageansicht, mehrere Notizen, KI-Erklärung in Ihrer Sprache und eine echte Prüfungssimulation",
    "en": "Tidier question view, multiple notes, AI explanation in your language, and a true exam simulation"
  },
  "description": {
    "de": "Die Frageansicht hat jetzt nur noch eine Stelle pro Aktion: Erklärung, KI-Erklärung, Notizen und Übersetzen sitzen in den Reitern, Merken und Melden in der Leiste, ohne doppelte oder tote Knöpfe (auch am Handy). Sie können mehrere Notizen pro Frage anlegen, und sie sind überall synchron. Die Übersetzung funktioniert wieder, und die KI-Erklärung erscheint in Ihrer Oberflächensprache. Die Prüfungssimulation bildet die echte Prüfung ab (volle Fragenanzahl und Verteilung), und die Fragenübersicht überlappt nicht mehr. Gemerkte Fragen werden im Fortschritt richtig angezeigt.",
    "en": "The question view now has one home per action: Explanation, AI Explanation, Notes and Translate live in the tabs, Bookmark and Report in the bar, with no duplicate or dead buttons (on mobile too). You can keep multiple notes per question, and they stay in sync everywhere. Translation works again, and the AI explanation appears in your interface language. The exam simulation reflects the real exam (full question count and distribution), and the question navigator no longer overlaps. Bookmarked questions show up correctly in Progress."
  }
},
  {
  "date": "2026-06-26",
  "tag": "improvement",
  "title": {
    "de": "Lesbarer Dunkelmodus und eine neue Ladeanimation",
    "en": "Readable dark mode and a new loading animation"
  },
  "description": {
    "de": "Der Dunkelmodus ist durchgehend in unserem Oxford-Blau gehalten, mit klar lesbarem Text auf jeder Karte (kein Dunkel-auf-Dunkel mehr). Beim Laden begrüßt Sie eine ruhige EKG-Herzschlag-Animation mit dem MedPrüf-Logo.",
    "en": "Dark mode is consistently in our Oxford blue with clearly readable text on every card (no more dark-on-dark). A calm ECG heartbeat animation with the MedPrüf logo greets you while pages load."
  }
},
  {
    date: "2026-06-26",
    tag: "feature",
    title: {
      de: "Eigene Tests zusammenstellen",
      en: "Build your own tests",
    },
    description: {
      de: "Neu: Stelle dir mit „Neuen Test erstellen\" deinen eigenen Test zusammen. Wähle Modus (Tutor oder Zeitlimit), Fragenpool (alle, ungesehen, falsch beantwortet oder gespeichert), Fachgebiete pro Prüfungstyp, Fragenanzahl und Prüfungsjahr. Schnellzugriffe für schwache Themen und den Wochenplan sind dabei.",
      en: "New: build your own test with \"Create New Test\". Choose mode (Tutor or Timed), question pool (all, unseen, incorrect, or saved), subjects per exam type, question count, and exam year. Quick presets for weak topics and your weekly plan are included.",
    },
  },
  {
    date: "2026-06-26",
    tag: "feature",
    title: {
      de: "E-Mail-Adresse zum Konto hinzufügen",
      en: "Add email address to account",
    },
    description: {
      de: "Nutzer, die sich über Telegram angemeldet haben, können jetzt in den Einstellungen eine E-Mail-Adresse und ein Passwort hinzufügen. Die Telegram-Anmeldung bleibt dabei aktiv. Die E-Mail wird per Bestätigungslink verifiziert, bevor sie gespeichert wird.",
      en: "Users who signed in via Telegram can now add an email address and password in Settings. Telegram login stays active. The email is verified via a one-time confirmation link before being saved.",
    },
  },
  {
  "date": "2026-06-26",
  "tag": "improvement",
  "title": {
    "de": "Anmeldeseite: E-Mail als primäre Option",
    "en": "Login page: email as primary option"
  },
  "description": {
    "de": "Die Anmeldung mit E-Mail und Passwort ist jetzt die erste Option auf der Anmeldeseite. Die Telegram-Anmeldung bleibt vollständig verfügbar und erscheint als zweite Option.",
    "en": "Email and password sign-in is now the primary option on the login page. Telegram sign-in remains fully available as a secondary option."
  }
},
  {
    date: "2026-06-25",
    tag: "admin",
    title: {
      de: "Österreichische Ressourcenbibliothek",
      en: "Austrian Resource Library",
    },
    description: {
      de: "Die Ressourcen-Seite zeigt jetzt geprüfte Links zu offiziellen österreichischen Quellen in drei Abschnitten: offizielle Anmeldestellen (mit Route-A/B-Kennzeichnung), klinische Leitlinien und Nachschlagewerke. Alle Links öffnen in einem neuen Tab.",
      en: "The Resources page now shows verified links to official Austrian sources in three sections: official registration pages (with Route A/B labels), clinical guidelines, and reference tools. All links open in a new tab.",
    },
  },
  {
    date: "2026-06-25",
    tag: "feature",
    title: {
      de: "Dein Weg zur Prüfung: geführter Lernpfad",
      en: "Your path to the exam: a guided study path",
    },
    description: {
      de: "Beim Onboarding und in den Einstellungen wählst du deinen Prüfungstermin jetzt direkt aus dem österreichischen Prüfungskalender, inklusive Anmeldeschluss. Dein Lernplan zeigt dir dann einen klaren Weg bis zum Prüfungstag in vier Phasen (Grundlagen, Aufbau, Festigen, Endspurt), und auf der Startseite siehst du den Countdown und deine aktuelle Phase auf einen Blick.",
      en: "During onboarding and in Settings you now pick your exam date straight from the Austrian exam calendar, including the registration deadline. Your study plan then shows a clear path to exam day in four phases (Foundation, Build, Consolidate, Taper), and the home screen shows your countdown and current phase at a glance.",
    },
  },
  {
    date: "2026-06-25",
    tag: "feature",
    title: {
      de: "Übungs-Bereitschaft: ein ehrliches Signal statt Prozentzahl",
      en: "Practice readiness: an honest signal, not a percentage",
    },
    description: {
      de: "Auf der Fortschritts-Seite siehst du jetzt, wie bereit deine Übung aussieht: Abdeckung, Genauigkeit, Beständigkeit und Tempo, plus einen Trend und einen konkreten Tipp, was als Nächstes am meisten hilft. Es ist bewusst keine Vorhersage deines Prüfungsergebnisses, sondern ein ehrlicher Blick auf deinen Übungsstand.",
      en: "On the Progress page you now see how ready your practice looks: coverage, accuracy, consistency, and pace, plus a trend and one concrete tip on what helps most next. It is deliberately not a prediction of your exam result, just an honest read on where your practice stands.",
    },
  },
  {
    date: "2026-06-24",
    tag: "improvement",
    title: {
      de: "Startseite nennt jetzt beide Anerkennungswege",
      en: "Landing page now names both recognition routes",
    },
    description: {
      de: "Die Startseite macht jetzt deutlich, dass MedPrüf beide österreichischen Anerkennungswege abdeckt: die Arztprüfung Allgemeinmedizin (Kenntnisprüfung) der Ärztekammer und den Stichprobentest der universitären Nostrifizierung. So findest du schneller den Weg, der zu deinem Verfahren passt.",
      en: "The landing page now makes it clear that MedPrüf covers both Austrian recognition routes: the Ärztekammer's Arztprüfung Allgemeinmedizin (Kenntnisprüfung) and the Stichprobentest of the university Nostrifizierung. That makes it easier to find the route that matches your own process.",
    },
  },
  {
    date: "2026-06-23",
    tag: "improvement",
    title: {
      de: "Prüfung wird automatisch gespeichert",
      en: "Your exam now auto-saves",
    },
    description: {
      de: "Wenn du eine Prüfungssimulation läufst und die Seite neu lädt, der Browser abstürzt oder ein Update erscheint, geht dein Fortschritt nicht mehr verloren. Deine Antworten, markierten Fragen und der 4-Stunden-Timer werden laufend gespeichert. Beim Zurückkommen kannst du genau dort weitermachen, wo du aufgehört hast, und ein neues Update unterbricht eine laufende Prüfung nicht mehr.",
      en: "If you are running an exam simulation and the page reloads, the browser crashes, or an update ships, your progress is no longer lost. Your answers, flagged questions and the 4-hour timer are saved as you go. When you come back you can resume exactly where you left off, and a new update no longer interrupts an exam in progress.",
    },
  },
  {
    date: "2026-06-23",
    tag: "fix",
    title: {
      de: "Genauere Themen-Statistik bei sehr vielen Antworten",
      en: "More accurate topic stats for heavy users",
    },
    description: {
      de: "Wenn du sehr viele Fragen beantwortet hast (über 1.000), wurde deine Trefferquote pro Thema bisher nur aus einem Teil deiner Antworten berechnet. Jetzt zählen wir alle deine Antworten korrekt.",
      en: "If you had answered very many questions (over 1,000), your per-topic accuracy was previously computed from only part of your answers. Now we count all of your answers correctly.",
    },
  },
  {
    date: "2026-06-21",
    tag: "improvement",
    title: {
      de: "Prüfung umbenannt: aus „KMP Innsbruck\" wird „Stichprobentest (Innsbruck)\"",
      en: "Exam renamed: \"KMP Innsbruck\" is now \"Stichprobentest (Innsbruck)\"",
    },
    description: {
      de: "Der frühere Anzeigename wurde zu „Stichprobentest (Innsbruck)“ geändert, damit der Lernbereich den Nostrifizierungsweg klarer bezeichnet. Der Fragenpool bietet Übung auf Grundlage des klinischen Curriculums der Med Uni Innsbruck. Fragen, Fortschritt und Zugang blieben bei der Umbenennung unverändert.",
      en: "The previous display name changed to “Stichprobentest (Innsbruck)” to make the nostrification pathway clearer. The question bank provides practice based on the Med Uni Innsbruck clinical curriculum. Questions, progress and access were unchanged by the rename.",
    },
  },
  {
  "date": "2026-06-20",
  "tag": "feature",
  "title": {
    "de": "Prüfungskalender mit den nächsten Terminen",
    "en": "Exam calendar with the next dates"
  },
  "description": {
    "de": "Ein Prüfungskalender zeigt die nächsten Termine und Anmeldefristen für die Kenntnisprüfung Wien und den Stichprobentest. Vergangene Termine verschwinden automatisch.",
    "en": "An exam calendar shows the next dates and registration deadlines for the Kenntnisprüfung Vienna and the Stichprobentest. Past dates drop off automatically."
  }
},
  {
    date: "2026-06-20",
    tag: "improvement",
    title: {
      de: "Tarif-Name jetzt prüfungsneutral: Prüfungs-Kohorte",
      en: "Tier name is now exam-neutral: Exam Cohort",
    },
    description: {
      de: "Unser Lerngemeinschafts-Tarif heißt jetzt Prüfungs-Kohorte statt Kenntnisprüfung-Kohorte. Der Name gilt damit für alle drei Prüfungen (Kenntnisprüfung Wien, KMP, Pharmakologie), nicht nur für eine. Preis, Laufzeit und die Pass-Until-You-Pass-Garantie bleiben unverändert.",
      en: "Our study-group plan is now called the Exam Cohort instead of the Kenntnisprüfung Cohort. The name now covers all three exams (Kenntnisprüfung Vienna, KMP, Pharmakologie), not just one. Price, duration and the Pass-Until-You-Pass guarantee are unchanged.",
    },
  },
  {
    date: "2026-06-20",
    tag: "improvement",
    title: {
      de: "Kostenlos üben: 150 Fragen pro Prüfungstyp",
      en: "Free practice: 150 questions per exam type",
    },
    description: {
      de: "Mit dem kostenlosen Zugang kannst du bis zu 150 Fragen pro Prüfungstyp bearbeiten. Bereits beantwortete Fragen und verfügbare Erklärungen bleiben zugänglich. Wenn du weiterüben möchtest, kannst du Pro wählen.",
      en: "With free access, you can practise up to 150 questions per exam type. Questions you have already answered and available explanations remain accessible. Choose Pro if you want to continue practising.",
    },
  },
  {
    date: "2026-06-19",
    tag: "admin",
    title: {
      de: "Zahlung: Krypto-Zahlungen werden jetzt zuverlässig automatisch aktiviert",
      en: "Payments: crypto payments now reliably auto-activate",
    },
    description: {
      de: "Fehlerbehebung im NOWPayments-Webhook: Da NOWPayments pro Statuswechsel eine Benachrichtigung sendet (waiting, confirming, finished) und alle dieselbe payment_id teilen, hat die frühere Idempotenz-Sperre die erste waiting-Nachricht reserviert und die spätere finished-Nachricht als Duplikat verworfen, sodass eine echte Zahlung nie automatisch freigeschaltet wurde. Die Sperre greift jetzt erst beim tatsächlichen Aktivierungsschritt, der Schutz gegen doppelte Verarbeitung bleibt erhalten. Der Selbsttest prüft jetzt die echte Abfolge (waiting, dann finished).",
      en: "Fix in the NOWPayments webhook: because NOWPayments sends one notification per status change (waiting, confirming, finished) all sharing the same payment_id, the previous idempotency lock was consumed by the first waiting notification and the later finished one was dropped as a duplicate, so a real payment never auto-activated. The lock now applies only at the actual activation step, and the double-processing protection is preserved. The self-test now exercises the real sequence (waiting then finished).",
    },
  },
  {
    date: "2026-06-19",
    tag: "admin",
    title: {
      de: "Diagnose: Webhook-Versuche werden jetzt korrekt klassifiziert",
      en: "Diagnostics: webhook attempts are now classified correctly",
    },
    description: {
      de: "Interne Diagnose zur Zahlungsabwicklung; keine Änderung der Funktionen für Kundinnen und Kunden.",
      en: "Internal payment diagnostics; no customer-facing behavior changed.",
    },
  },
  {
    date: "2026-06-02",
    tag: "admin",
    title: {
      de: "Sicherheit: Pro-Zugang prüft fehlertolerant ab (fail-closed)",
      en: "Security: Pro-access check now fails closed",
    },
    description: {
      de: "Interne Härtung: Bei einem unlesbaren tier_expires_at verweigern hasProAccess/isPaidTier jetzt den Pro-Zugang, statt ihn zu gewähren. Gültige zukünftige Abläufe bleiben unverändert. Außerdem: Telegram-Aktivierungstext entspricht jetzt dem tatsächlichen Bot-Verhalten (Feedback über den In-App-Button).",
      en: "Internal hardening: an unparseable tier_expires_at now denies Pro access in hasProAccess/isPaidTier instead of granting it; valid future expiries are unchanged. Also: the Telegram activation copy now matches actual bot behavior (feedback via the in-app button).",
    },
  },
  {
    date: "2026-04-28",
    tag: "admin",
    title: {
      de: "Neuer 3-Monats-Einstieg: 27 € einmalig, ungefähr 9 € pro Monat",
      en: "New 3-Month Starter: €27 one-time, about €9 per month",
    },
    description: {
      de: "Der bisherige Erste-Monat-Test (19 €) wird zum Einzelmonat-Fallback. Neuer Standard-Einstieg: 90 Tage Vollzugang für 27 €: ein einmaliger Kauf, keine automatische Verlängerung. Limitiert auf einen Kauf pro Konto, danach geht es weiter mit der Juni-26-Kohorte oder einem einmaligen Bridging-Monat.",
      en: "The former €19 first-month trial becomes the single-month fallback. New default entry: 90 days of full access for €27: one-time purchase, no auto-renewal. Capped at one purchase per account; afterward upgrade to the June 26 Cohort or buy a single bridging month.",
    },
  },
  {
    date: "2026-04-28",
    tag: "admin",
    title: {
      de: "Empfehlungsprogramm sichtbarer: Telegram, WhatsApp & Social",
      en: "Referral program more prominent: Telegram, WhatsApp & socials",
    },
    description: {
      de: "Auf der Preise-Seite haben wir das Empfehlungsprogramm prominenter gemacht. Empfehlungslohn bleibt 25 € / 50 € / 75 € je nach Tarif, neu: 15 € pro 3-Monats-Einstieg. Der Empfehlungslink lässt sich direkt aus dem Empfehlungs-Dashboard auf Telegram/WhatsApp teilen.",
      en: "Referrals are now more prominent on the pricing page. Payout stays €25 / €50 / €75 per tier, new: €15 per 3-month starter sign-up. Your referral link can be shared straight to Telegram/WhatsApp from the referrals dashboard.",
    },
  },
  {
    date: "2026-04-26",
    tag: "fix",
    title: {
      de: "Tippen im Feedback-Dialog bleibt jetzt stabil: kein Fokusverlust mehr",
      en: "Typing in feedback dialogs is now stable: no more focus loss",
    },
    description: {
      de: "Das Eingabefeld in Feedback und Fragenmeldungen behält beim Schreiben jetzt den Fokus.",
      en: "Feedback and question-report text fields now keep focus while you type.",
    },
  },
  {
    date: "2026-04-26",
    tag: "improvement",
    title: {
      de: "Umfrage erscheint erst nach echtem Nutzungserlebnis",
      en: "Survey now waits until you have real usage experience",
    },
    description: {
      de: "Die kurze Nutzungsumfrage öffnet sich nun erst ab der 3. Sitzung und nach mindestens 25 beantworteten Fragen: nicht mehr für neue Nutzer beim ersten Besuch.",
      en: "The short user survey now opens only from session 3+ and after at least 25 questions answered: no longer shown to brand-new users on first visit.",
    },
  },
  {
  "date": "2026-04-26",
  "tag": "fix",
  "title": {
    "de": "Telegram-Bot antwortet auf /start, plus Verbesserungen",
    "en": "Telegram bot replies to /start, plus fixes"
  },
  "description": {
    "de": "Der Telegram-Bot antwortet auf /start jetzt sofort mit einer Begrüßung und den Schaltflächen zum Öffnen von MedPrüf und der Mini-App, in der Sprache, die Sie in der App nutzen. Das Banner zur App-Installation verdeckt keine Inhalte mehr, und der Feedback-Button überlappt die untere Navigation am Handy nicht mehr.",
    "en": "The Telegram bot now replies to /start right away with a welcome and buttons to open MedPrüf and the Mini App, in the language you use in the app. The app install banner no longer covers content, and the feedback button no longer overlaps the bottom navigation on mobile."
  }
},
  {
    date: "2026-04-24",
    tag: "admin",
    title: {
      de: "Empfehlungen: Code ab Tag 1 sichtbar, Auszahlungsmethode später",
      en: "Referrals: code visible from day 1, payout method set later",
    },
    description: {
      de: "Wir haben den Empfehlungs-Flow umgebaut. Vorher mussten alle zuerst eine Auszahlungsmethode (Wallet oder Wise) eingeben, bevor irgendetwas passierte: Resultat, kaum jemand hat den Code je geteilt. Neu: dein Empfehlungscode erscheint sofort auf der Startseite, mit einem „Kopieren\"-Button und einer einzigen Zeile Kontext („Freund wird Pro → beide bekommen Bonus\"). Die Auszahlungsmethode wirst du erst dann gefragt, wenn dein erster Empfehlter tatsächlich bezahlt hat: per E-Mail, mit direktem Link zur Einrichtung. Dazu: subtiles oranges Signal in der Seitenleiste neben „Empfehlungen\", solange du den Code noch nicht kopiert hast. Kleine „Teile MedPrüf\"-Karte nach einem Quiz mit ≥80% Genauigkeit (einmalig, wegklickbar). Community-Zähler auf /empfehlungen („Empfehlungen diese Woche\") für ehrliche soziale Signale, die ersten 10 Empfehler bekommen einen extra Bonus.",
      en: "We've reworked the referral flow. Before, everyone had to configure a payout method (crypto wallet or Wise) before anything happened: result, almost nobody ever shared their code. Now: your referral code appears on the home page from day 1, with a „Copy\" button and a single line of context („Friend goes Pro → both get a bonus\"). You're only asked for a payout method once your first referee actually pays: by email, with a direct setup link. Also: a small amber dot next to „Referrals\" in the sidebar until you've copied your code. A one-time „Share MedPrüf\" chip after a quiz with ≥80% accuracy (dismissible). Community counts on /referrals („Referrals this week\") for honest social proof, the first 10 referrers get a bonus on top.",
    },
  },
  {
    date: "2026-04-24",
    tag: "admin",
    title: {
      de: "Prüfungs-Landingpages & Blog: SEO-Fundament",
      en: "Exam landing pages & blog: SEO foundation",
    },
    description: {
      de: "Drei eigenständige Landingpages für die Hauptprüfungstypen sind online: /kenntnispruefung-wien (7.566 Fragen, SIP 4 + SIP 5), /kmp-innsbruck (3.091 Fragen, 12 Module) und /pharmakologie-pruefung-wien (335 Fragen, inklusive sichtbarem Countdown zur Juni-26-Prüfung). Jede Seite hat eigene Meta-Tags, OpenGraph-Bilder (automatisch generiert via next/og), JSON-LD Course-Schema und 5-7 prüfungsspezifische FAQ-Einträge. Zusätzlich: /blog-Index + erster 1.800-Wörter-Guide „Kenntnisprüfung Wien: vollständiges Handbuch 2026\" (Nostrifikation, SIP-Struktur, Lernplan, häufige Fehler). Sitemap + robots.txt aktualisiert. Infrastruktur für organische Suchakquise steht, Content-Produktion folgt.",
      en: "Three standalone landing pages for the main exam types are live: /kenntnispruefung-wien (7,566 questions, SIP 4 + SIP 5), /kmp-innsbruck (3,091 questions, 12 modules), and /pharmakologie-pruefung-wien (335 questions, including a visible countdown to the 26 June 2026 exam). Each page has its own meta tags, OpenGraph images (auto-generated via next/og), JSON-LD Course schema, and 5-7 exam-specific FAQ entries. Also: /blog index + first 1,800-word guide „Kenntnisprüfung Wien: vollständiges Handbuch 2026\" (nostrification, SIP structure, study plan, common mistakes). Sitemap + robots.txt updated. Organic-search acquisition infrastructure is now in place, content production follows.",
    },
  },
  {
    date: "2026-04-24",
    tag: "admin",
    title: {
      de: "Neuer Einsteiger-Tarif: erster Monat für €19 (einmalig)",
      en: "New entry tier: first month for €19 (one-time)",
    },
    description: {
      de: "Ab sofort gibt es einen €19-Einsteiger-Tarif: 30 Tage Vollzugang auf alle drei Prüfungen (Kenntnisprüfung Wien, KMP Innsbruck, Pharmakologie), einmalig bezahlt in Krypto (USDT oder USDC). Es ist bewusst KEIN Abo: nichts verlängert sich automatisch, wir speichern keine Kreditkartendaten, der Zugang läuft nach 30 Tagen einfach aus. Am Tag 25 erinnern wir dich einmalig per E-Mail, falls du einen längeren Tarif wählen willst. Damit kostet „echt ausprobieren\" weniger als ein Lehrbuchkapitel. Der €114-Juni-26-Kohorten-Tarif bleibt unverändert der empfohlene Weg für alle, die auf die Juni-Prüfung hinarbeiten.",
      en: "There's now a €19 entry tier: 30 days of full access to all three exam types (Kenntnisprüfung Wien, KMP Innsbruck, Pharmakologie), paid once in crypto (USDT or USDC). It is deliberately NOT a subscription: nothing auto-renews, we store no card details, access simply expires after 30 days. On day 25 we send a single reminder email in case you want to pick a longer plan. That brings \"try it for real\" below the price of a textbook chapter. The €114 June 26 Cohort tier remains the recommended path for anyone prepping for the June sitting.",
    },
  },
  {
    date: "2026-04-23",
    tag: "admin",
    title: {
      de: "Admin: Audit-Log vollständig verdrahtet + Mission-Control-Indikator",
      en: "Admin: audit log fully wired + mission-control indicator",
    },
    description: {
      de: "Jede Admin-Mutation (Nutzer sperren, Fragen bearbeiten, PUYP genehmigen, Feedback-Status ändern, Referrals auszahlen, SQL-Runner, CSV-Exporte) schreibt jetzt eine Zeile in admin_audit_log mit actor_id, Aktion, Ziel, Payload, IP, User-Agent. Der Helper behandelt UUID- und Integer-Ziele richtig (Integer landen in payload.target_ref, damit der Insert nicht still scheitert). Neuer Indikator oben auf /admin/overview zeigt „Admin-Aktionen heute: N · Letzte: vor X Min\" live via Realtime. Integrationstest unter tests/e2e/admin/audit-log.spec.ts beweist end-to-end, dass eine Mutation tatsächlich eine Audit-Zeile schreibt.",
      en: "Every admin mutation (lock user, edit question, approve PUYP, change feedback status, mark referral paid, SQL runner, CSV exports) now writes a row into admin_audit_log with actor_id, action, target, payload, IP, user-agent. The helper now handles UUID AND integer targets correctly (integers land in payload.target_ref so the insert never silently fails). A new indicator at the top of /admin/overview shows \"Admin actions today: N · Last: X min ago\" live via Realtime. An integration test at tests/e2e/admin/audit-log.spec.ts proves end-to-end that a mutation actually writes an audit row.",
    },
  },
  {
    date: "2026-04-24",
    tag: "improvement",
    title: {
      de: "Englische Übersetzungen: Modals, Toasts, Onboarding",
      en: "English translations: modals, toasts, onboarding",
    },
    description: {
      de: "Wer MedPrüf auf Englisch nutzt, sah bisher an vielen Stellen (Onboarding, Modals, Toasts, Banner, PWA-Hinweise, Feedback-Widget) immer noch deutsche Texte. Jetzt sind die wichtigsten UI-Oberflächen durchgängig zweisprachig. Zusätzlich: Das Onboarding hat einen eigenen Sprach-Schalter oben rechts auf jedem Schritt bekommen, so dass du die Sprache auch mitten im Einrichten wechseln kannst.",
      en: "If you used MedPrüf in English, many surfaces (onboarding, modals, toasts, banners, PWA prompts, the feedback widget) still showed German text. We went through the app and made every user-visible string fully bilingual. On top of that: the onboarding flow now has its own language switcher in the top-right of every step, so you can switch mid-setup.",
    },
  },
  {
    date: "2026-04-24",
    tag: "fix",
    title: {
      de: "KI-Erklärung: ehrlichere Anzeige für kostenlose Nutzer",
      en: "AI Explain: honest messaging for free users",
    },
    description: {
      de: "Wenn für eine Frage noch keine zwischengespeicherte KI-Erklärung existiert, zeigte die KI für kostenlose Nutzer bisher „KI-Assistent ist momentan nicht verfügbar\" (was wie eine Serverstörung klang und zu Rückmeldungen wie „Die KI funktioniert überhaupt nicht\" führte). Neu: wir zeigen stattdessen die vorhandene Lehrbuch-Erklärung der Frage und erklären klar, dass automatische KI-Neugenerierung ein Pro-Feature ist, nicht ein Defekt. Wenn ein Pro-Nutzer die Erklärung später anfragt, wird sie auch für kostenlose Nutzer dauerhaft sichtbar.",
      en: "When no AI explanation was cached for a question yet, free users used to see \"AI assistant is currently unavailable\" (which reads like an outage, and prompted feedback like \"the AI is completely broken\"). Now we render the question's existing textbook explanation instead, and clearly explain that automatic AI regeneration is a Pro feature, not a bug. Once any Pro user requests an explanation, it's cached and free for everyone to read.",
    },
  },
  {
    date: "2026-04-23",
    tag: "admin",
    title: {
      de: "Startseite: Premium-Redesign",
      en: "Dashboard: premium redesign",
    },
    description: {
      de: "Die Startseite wurde von Grund auf überarbeitet: Gamification-Hero steht jetzt oben und bekommt den Platz, den er verdient, mit Streak (warmes Orange), Tagesziel-Ring (Viridian), Genauigkeit und einem neuen Fortschrittsbalken zum nächsten Rang. Warngelbe „Smart Recommendation\" ersetzt durch eine ruhige Viridian-Coach-Empfehlung („10 Fragen üben\"). Neue Begrüßung je nach Tageszeit („Guten Morgen/Tag/Abend\") + Kohorten-Chip mit Prüfungsdatum. Eine einzige klare Haupt-CTA (Weiterlernen) statt drei gleichgewichtiger Buttons. Konsistentes 8-Punkt-Raster, einheitliche 16px-Kartenradien, Tokens statt Inline-Hex.",
      en: "The dashboard has been rebuilt end-to-end: the gamification hero now sits at the top and gets the room it deserves, with streak (warm orange), daily goal ring (viridian), accuracy, and a new progress bar to the next rank. Warning-yellow \"Smart Recommendation\" replaced by a calm viridian coach card (\"Practice 10 questions\"). New time-of-day greeting (\"Good morning/afternoon/evening\") + cohort chip showing your exam in days. One clear primary CTA (Continue) instead of three equal-weight buttons. Consistent 8-pt spacing grid, unified 16px card radius, tokens instead of inline hex throughout.",
    },
  },
  {
  "date": "2026-04-23",
  "tag": "improvement",
  "title": {
    "de": "Startseite, Preise und FAQ überarbeitet",
    "en": "Landing, pricing and FAQ polished"
  },
  "description": {
    "de": "Die Startseite hat ein Menü für das Handy und Schaltflächen, die auf schmalen Bildschirmen sauber untereinander stehen. Die Preisseite ist auf dem Handy übersichtlicher. Die FAQ hat ein Inhaltsverzeichnis, das am Computer mitläuft und am Handy einklappbar ist.",
    "en": "The landing page has a mobile menu and buttons that stack cleanly on narrow screens. The pricing page is easier to scan on mobile. The FAQ has a table of contents that stays visible on desktop and collapses on mobile."
  }
},
  {
    date: "2026-04-23",
    tag: "admin",
    title: {
      de: "Empfehlungen: gestaffelte Prämien €25/€50/€75",
      en: "Referrals: tiered €25/€50/€75 payouts",
    },
    description: {
      de: "Pro Abo-Typ deines Empfehlten: Monatlich & 3 Monate = €25, 6 Monate & 12 Monate = €50, Juni-26-Kohorte = €75. Nach Zahlungseingang startet eine 30-Tage-Sperrfrist, anschließend wird die Prämie auszahlbar (USDT oder Wise, kein SEPA). Jahreslimit: €600 pro Empfehlender. Neue Referral-Seite mit 4-Spalten-Statusleiste (gesamt · in Sperre · auszahlbar · verdient) + Prämientabelle nach Abo-Typ.",
      en: "Payout per plan your referee picks: monthly & 3 months = €25, 6 months & 12 months = €50, June 26 Cohort = €75. A 30-day hold starts once they pay, then the reward becomes claimable in USDT or via Wise (no SEPA). Annual cap: €600 per referrer. New referral page with 4-stat strip (total · in hold · claimable · earned) and a per-plan payout table.",
    },
  },
  {
    date: "2026-04-23",
    tag: "admin",
    title: {
      de: "Kostenlose Stufe: 150 Fragen pro Prüfung",
      en: "Free tier: 150 questions per exam",
    },
    description: {
      de: "Kostenlose Nutzer sehen ab sofort die ersten 150 aktiven Fragen pro Prüfungstyp (Kenntnisprüfung Wien, KMP Innsbruck, Pharmakologie). Spaced-Repetition, Mock-Exam, Bookmarks und Notizen bleiben der Pro-Stufe vorbehalten. Beim Wechsel zwischen Prüfungen gibt es erneut 150 kostenlose Fragen. Wer alle 150 durchgearbeitet hat, sieht einen Paywall-Dialog mit Link zu den Tarifen.",
      en: "Free users now see the first 150 active questions per exam type (Kenntnisprüfung Vienna, KMP Innsbruck, Pharmakologie). Spaced repetition, mock exam, bookmarks and notes remain Pro features. Switching exams unlocks another 150 free questions. Users who complete the free slice see a paywall dialog with a direct link to pricing.",
    },
  },
  {
    date: "2026-04-23",
    tag: "admin",
    title: {
      de: "Pass-Until-You-Pass-Garantie: Nachweis-Upload + Verlängerung",
      en: "Pass-Until-You-Pass guarantee: proof upload + extension flow",
    },
    description: {
      de: "Wer in der Juni-26-Kohorte oder im Jahresabo den ersten echten Prüfungsversuch nicht besteht und ≥70 % des Fragenkatalogs bearbeitet hat, bekommt den Zugang kostenlos bis zum nächsten Prüfungszyklus verlängert (maximal 2 zusätzliche Zyklen pro Abonnement, kein Bargeld-Rückerstattungs-Weg). Nach dem konfigurierten Prüfungsdatum erscheinen im Dashboard zwei Buttons: „Bestanden\" (wird sofort gespeichert) oder „Nicht bestanden\" (Datum + Prüfungstyp + Nachweis-Upload, PDF oder Bild, max. 10 MB). Ein Admin prüft den Nachweis und genehmigt oder lehnt ab; jede Verlängerung wird protokolliert.",
      en: "June 26 Cohort and 12-month subscribers who fail their first real attempt and have ≥70% Qbank completion get their access extended free through the next exam cycle (max 2 extra cycles per subscription, no cash-refund surface). After the configured exam date the dashboard shows two buttons: \"I passed\" (self-recorded) or \"I failed\" (date + exam type + proof upload, PDF or image, max 10MB). An admin reviews the proof and approves or rejects; every extension is logged.", // date-ok: legacy tier name "June 26 Cohort" in a dated changelog entry, not a date claim
    },
  },
  {
    date: "2026-04-23",
    tag: "admin",
    title: {
      de: "Positionierungs-Update 23. April",
      en: "April 23 positioning update",
    },
    description: {
      de: "Die Juni-26-Kohorte ersetzt das Founders-Framing auf der Preis- und Landingpage. Kernversprechen: „Beim ersten Versuch bestehen, oder kostenlos weiterlernen, bis du es schaffst.\" Kostenloser Tarif (150 Fragen × 3 Prüfungstypen, volle Erklärungen, kein Ablaufdatum) bekommt eine eigene Karte. Pass-Until-You-Pass-Garantie auf der Juni-26-Kohorte (€114, 6 Monate) und dem Jahresabo. Gestaffelte Empfehlungsauszahlungen (€25 / €50 / €75 je nach Empfehlungs-Tarif, 30-Tage-Sperrfrist, €600/Jahr-Cap). Jeder bezahlte Tarif enthält jetzt alle drei Prüfungstypen. Neue `/faq` Seite mit PUYP-, Krypto-, Empfehlungs- und Free-Tier-FAQ. Jede „Founders\"-Referenz außerhalb historischer Changelogs wurde entfernt.",
      en: "The June 26 Cohort replaces the Founders' framing on pricing + landing. Core promise: \"Pass first try, or study free until you do.\" Free tier (150 questions × 3 exam types, full explanations, no expiry) gets its own card. Pass-Until-You-Pass guarantee on the June 26 Cohort (€114, 6 months) and the annual plan. Tiered referral payouts (€25 / €50 / €75 depending on the referee's plan, 30-day hold, €600/year cap). Every paid tier now includes all three exam types. New `/faq` page with PUYP, crypto, referral and free-tier answers. Every \"Founders'\" string outside historical changelogs has been removed.",
    },
  },
  {
    date: "2026-04-23",
    tag: "admin",
    title: {
      de: "Krypto-Zahlungsrail (NOWPayments) + Subscriptions-Schema live",
      en: "Crypto payment rail (NOWPayments) + subscriptions schema live",
    },
    description: {
      de: "Infrastruktur für den Founders'-Launch am 26. Juni: neue Migration `20260423000000_crypto_payments_and_referrals.sql` legt `subscriptions` (Audit-Tabelle + Source of Truth), `processed_webhook_events` (Idempotenz-Guard für IPN-Retries), `referrals` (€40/Empfehlung, bis zu €400 Prüfungsgebühr-Rückerstattung) und `waitlist` (Stripe-pending Non-Krypto-Signups) an. Neue Routes: `POST /api/checkout/nowpayments` (requireUser-geschützt, erzeugt eine NOWPayments-Rechnung nur für den Founders'-Tier; andere Tarife sind `available:false` bis Stripe Atlas klar ist) und `POST /api/webhooks/nowpayments` (keine Auth, HMAC-SHA512-Signatur über `x-nowpayments-sig` mit `JSON.stringify(body, Object.keys(body).sort())`, Idempotenz via `processed_webhook_events`-PK). Bei erfolgreicher Zahlung: Subscription auf `active`, `users.tier='pro'`, `users.tier_expires_at = jetzt + 6 Monate`, Empfehlungszeile qualifiziert. `partially_paid` innerhalb 0,5 %-Toleranz zählt als bezahlt (Netzwerkgebühr-Drift). Tests: `scripts/test_nowpayments_signature.mjs` (Node `--test`, 10 Cases für Signaturverifikation).",
      en: "Infrastructure for the June 26 Founders' launch: new migration `20260423000000_crypto_payments_and_referrals.sql` adds `subscriptions` (audit table + source of truth), `processed_webhook_events` (idempotency guard for IPN retries), `referrals` (€40/referral, up to €400 exam-fee rebate) and `waitlist` (Stripe-pending non-crypto signups). New routes: `POST /api/checkout/nowpayments` (requireUser-guarded, creates a NOWPayments invoice only for the Founders' tier; other tiers are `available:false` until Stripe Atlas clears) and `POST /api/webhooks/nowpayments` (no auth, HMAC-SHA512 signature over `x-nowpayments-sig` using `JSON.stringify(body, Object.keys(body).sort())`, idempotency via `processed_webhook_events` PK). On successful payment: subscription → `active`, `users.tier='pro'`, `users.tier_expires_at = now + 6 months`, referral row qualified. `partially_paid` within 0.5% tolerance counts as paid (network-fee drift). Tests: `scripts/test_nowpayments_signature.mjs` (Node `--test`, 10 cases for signature verification).",
    },
  },
  {
    date: "2026-04-23",
    tag: "admin",
    title: {
      de: "Juni-26-Kohorte live: 6 Monate Vollzugang für €114, zahlbar in Krypto",
      en: "June 26 Cohort live: 6 months of full access for €114, payable in crypto",
    },
    description: {
      de: "Neue Preisgestaltung auf `/pricing`: Founders-Tarif als dominante Karte mit Live-Krypto-Checkout (USDT/USDC über NOWPayments). Sechs Monate MedPrüf Pro zum einmaligen Frühbucher-Preis von €114, entspricht €19/Monat, nur 100 Plätze. Standardtarife (€29/Mo, €79 für 3 Mo, €149 für 6 Mo, €229 für 12 Mo) bleiben sichtbar mit Hinweis „Stripe kommt bald\" plus Warteliste-Dialog, der E-Mail, Prüfungstyp (Wien/Innsbruck/Pharma) und optional Prüfungsdatum erfasst. Nach erfolgreicher Krypto-Zahlung landet der Founder auf `/?welcome=founder` und erhält Konfetti + Willkommens-Toast. Referral-Mechanik im Footer: €40 pro Empfehlung, bis zu €400 Rückerstattung der Prüfungsgebühr bei Bestehen.",
      en: "New pricing layout on `/pricing`: Founders' tier as the dominant card with live crypto checkout (USDT/USDC via NOWPayments). Six months of MedPrüf Pro for a one-time early-bird €114, a €19/mo equivalent, 100 seats only. Standard tiers (€29/mo, €79 for 3 mo, €149 for 6 mo, €229 for 12 mo) stay visible with a \"Stripe launching soon\" badge plus waitlist dialog capturing email, exam type (Vienna/Innsbruck/Pharma) and optional exam date. After a successful crypto payment the founder lands on `/?welcome=founder` and gets confetti + a welcome toast. Referral mechanic in the footer: €40 per referral, up to €400 exam-fee rebate on pass.",
    },
  },
  {
    date: "2026-04-22",
    tag: "admin",
    title: {
      de: "KMP-Innsbruck-Bewertung repariert (C-1): 46 historische Antworten rückwirkend korrigiert",
      en: "KMP Innsbruck grading fixed (C-1): 46 historical answers retroactively regraded",
    },
    description: {
      de: "Eine Bewertungsabweichung bei Stichprobentest-Fragen wurde korrigiert. Betroffene frühere Antworten wurden überprüft und angepasst.",
      en: "A grading issue affecting Stichprobentest questions was corrected. Affected previous answers were reviewed and adjusted.",
    },
  },
  {
    date: "2026-04-22",
    tag: "admin",
    title: {
      de: "Streakzähler repariert (C-2): Tagesgrenze jetzt in Europe/Vienna, 33 Nutzerstreaks neu berechnet",
      en: "Streak counter fixed (C-2): day boundary now in Europe/Vienna, 33 user streaks recomputed",
    },
    description: {
      de: "`/api/answer` verglich `last_study_date` mit der UTC-Tagesgrenze (`new Date().toISOString().split('T')[0]`). Wiener Nutzer, die nach 01:00 Ortszeit antworteten, wurden gegen den UTC-Vortag gewertet, dadurch blieben Streaks fälschlich stehen, obwohl ein Tag übersprungen wurde, oder wurden beim Tageswechsel nicht erhöht. Audit (2026-04-21): 40 von 59 Power-Nutzern hatten einen drift-behafteten `current_streak`. Fix: Intl.DateTimeFormat mit `timeZone: 'Europe/Vienna'` für Tagesbucketing (gleiches Muster wie `/api/stats/last7days`) plus Backfill-Script `scripts/backfill_current_streak.py`, das die gespeicherten Streaks gegen aufeinanderfolgende Wiener Kalendertage im `answer_history` neu berechnet. Post-Backfill: 0 Abweichung übrig. `longest_streak` wird nur nach oben korrigiert.",
      en: "`/api/answer` compared `last_study_date` against a UTC day boundary (`new Date().toISOString().split('T')[0]`). Vienna users answering after 01:00 local time were scored against the previous UTC day, so streaks either stayed alive through a missed day or failed to increment on a new day. Audit (2026-04-21): 40 of 59 power users had drifted `current_streak`. Fix: `Intl.DateTimeFormat` with `timeZone: 'Europe/Vienna'` for day-bucketing (same pattern as `/api/stats/last7days`) plus backfill script `scripts/backfill_current_streak.py` that recomputes stored streaks against consecutive Vienna-local days in `answer_history`. Post-backfill: 0 drift remaining. `longest_streak` is only adjusted upward.",
    },
  },
  {
    date: "2026-04-22",
    tag: "improvement",
    title: {
      de: "Neu: Offline-Modus, Cmd+K-Suche und 7-Sprachen-Übersetzung angekündigt",
      en: "What's New: offline mode, Cmd+K search, and 7-language translations announced",
    },
    description: {
      de: "Die Neuigkeiten zeigen jetzt drei Funktionen, die bisher leicht zu übersehen waren: Fragen für die Offline-Nutzung herunterladen, die Schnellsuche mit Cmd+K und mehrsprachige Erklärungen.",
      en: "The What's New panel now highlights three features that were easy to miss: downloading questions for offline use, quick search with Cmd+K, and explanations in multiple languages.",
    },
  },
  {
    date: "2026-04-22",
    tag: "admin",
    title: {
      de: "Sitemap aktualisiert: alle öffentlichen Routen erfasst",
      en: "Sitemap refreshed: every public-facing route covered",
    },
    description: {
      de: "Neue dynamische Sitemap unter `src/app/sitemap.ts` (Next.js 15 MetadataRoute). Abdeckung erweitert um `/pricing`, `/impressum`, `/privacy`, `/terms` und `/changelog` (vorher fehlten sie in der statischen `public/sitemap.xml`, ~2 Wochen stale). Prioritäten: `/` = 1.0, `/landing` + `/pricing` = 0.9, `/about` + `/materials` = 0.7, legale Seiten + `/changelog` = 0.5. `lastModified` wird bei jedem Build dynamisch auf das aktuelle Datum gesetzt.",
      en: "New dynamic sitemap at `src/app/sitemap.ts` (Next.js 15 MetadataRoute). Coverage expanded to include `/pricing`, `/impressum`, `/privacy`, `/terms` and `/changelog` (previously missing from the static `public/sitemap.xml`, ~2 weeks stale). Priorities: `/` = 1.0, `/landing` + `/pricing` = 0.9, `/about` + `/materials` = 0.7, legal pages + `/changelog` = 0.5. `lastModified` is set dynamically to the current date on each build.",
    },
  },
  {
    date: "2026-04-22",
    tag: "admin",
    title: {
      de: "JSON-LD: Fake-AggregateRating entfernt (Schema-Policy)",
      en: "JSON-LD: fake AggregateRating removed (schema policy)",
    },
    description: {
      de: "Der JSON-LD-Strukturdaten-Block in `src/app/layout.tsx` enthielt ein hart kodiertes `aggregateRating` mit 4,8/156 Bewertungen: reale Daten aus der Nutzerumfrage zeigen 23 Antworten, Durchschnitt 4,70. Google kann Websites mit fabrizierten Bewertungsdaten abstrafen, daher wurde der Block komplett entfernt. Wird wieder aufgenommen, sobald 100+ echte Bewertungen vorliegen, idealerweise dynamisch aus `user_feedback`.",
      en: "The JSON-LD structured-data block in `src/app/layout.tsx` hard-coded an `aggregateRating` of 4.8/156 reviews: real user data shows 23 surveys, avg 4.70. Google can penalize sites with fabricated review metadata, so the block was deleted entirely. Will be re-introduced once there are 100+ real reviews, ideally wired dynamically from `user_feedback`.",
    },
  },
  {
    date: "2026-04-21",
    tag: "admin",
    title: {
      de: "KMP-Erklärungen generiert (quellenbezogen, nicht AI-Cache)",
      en: "KMP explanations generated (source text, not AI cache)",
    },
    description: {
      de: "Neues Skript `scripts/generate_missing_kmp_explanations.py` füllt die `explanation`-Spalte (Quell-Text) für alle aktiven `kmp_innsbruck`-Fragen, bei denen die PDF-Import-Pipeline keine Erklärung mitliefern konnte (bisher ~3.091 Zeilen). 80 bis 150 Wörter pro Erklärung in deutscher Sie-Form mit Bezug zu österreichischen/europäischen Leitlinien (ERC 2021, ESC, ÖDG, Österreichischer Impfplan), wo einschlägig. Klar getrennt vom AI-Chat-Cache (`ai_explanation`), der weiterhin über `/api/ai-chat` im strikten Apr-17-Format ausgeliefert wird. Provider: OpenAI gpt-4o-mini (Anthropic Haiku 4.5 als Primäroption, falls API-Key gesetzt). Gesamtkosten: ~$0,50. Idempotent: erneute Läufe überspringen bereits befüllte Zeilen automatisch.",
      en: "New script `scripts/generate_missing_kmp_explanations.py` backfills the `explanation` column (source text) for every active `kmp_innsbruck` question where the PDF import pipeline couldn't carry a rationale through (~3,091 rows previously NULL). 80 to 150-word paragraphs in German Sie-form with Austrian/European guideline references (ERC 2021, ESC, ÖDG, Austrian Vaccination Schedule) where applicable. Strictly separate from the AI chat cache (`ai_explanation`), which continues to be served through `/api/ai-chat` in the Apr-17 strict format. Provider: OpenAI gpt-4o-mini (Anthropic Haiku 4.5 as primary when API key is set). Total cost: ~$0.50. Idempotent: re-running skips already-filled rows automatically.",
    },
  },
  {
    date: "2026-04-21",
    tag: "admin",
    title: {
      de: "Exam-Jahr-Kontamination aus 1 Frage entfernt",
      en: "Exam-year contamination removed from 1 question",
    },
    description: {
      de: "Regex-basierte Bereinigung der `question`-Spalte: Eine Frage (q71637, Thema Gerinnung / Beinvenenthrombose) endete mit einer verrutschten Tag-Kennung „SPT2025“ plus doppeltem „(3 richtige Antworten)“-Fragment aus dem PDF-Import. Strip-Logik beschränkt auf `kenntnispruefung` + `kmp_innsbruck`; der Pharma-Pool ist nicht betroffen. Insgesamt 1 Zeile bereinigt: die übrigen ~10k aktiven Fragen haben keine Jahres-Endkontamination mehr.",
      en: "Regex-based cleanup of the `question` column: one question (q71637, coagulation / deep-vein thrombosis) ended with a stray tag fragment \"SPT2025\" plus a duplicate \"(3 richtige Antworten)\" remnant from the PDF import. Strip logic scoped to `kenntnispruefung` + `kmp_innsbruck`; the Pharma pool is unaffected. Total: 1 row cleaned, the remaining ~10k active questions carry no year-end contamination.",
    },
  },
  {
    date: "2026-04-21",
    tag: "admin",
    title: {
      de: "Import-Pipelines parsen jetzt „(N richtige Antworten)\"-Hinweise",
      en: "Import pipelines now parse \"(N richtige Antworten)\" hints",
    },
    description: {
      de: "`scripts/anki_reimport.py` und `scripts/import_vienna_2026.py` erkennen jetzt Multi-Correct-Hinweise im Frage-Stamm: explizit („(3 richtige Antworten)“, „(2 richtige)“) wie auch vage („Mehrere Antworten“, „Mehrfachauswahl“, flektierte Formen wie „mehreren richtigen“). Stimmt die im Stamm genannte Anzahl nicht mit den tatsächlich als `correct` geflaggten Auswahlmöglichkeiten überein, gibt der Import eine WARN-Meldung auf stderr aus (statt stillem Drop-in). Das verhindert die Wiedereinschleppung des Pre-Apr-18-Bugs, bei dem der PDF-Importer bei Mehrfach-Antworten oft nur die erste flaggte (siehe `reports/content-audit-2026-04-18/multi-correct-count-mismatch.md`).",
      en: "`scripts/anki_reimport.py` and `scripts/import_vienna_2026.py` now detect multi-correct hints in the question stem: both explicit (\"(3 richtige Antworten)\", \"(2 richtige)\") and vague (\"Mehrere Antworten\", \"Mehrfachauswahl\", inflected forms like \"mehreren richtigen\"). If the count in the stem doesn't match the number of options actually flagged as `correct`, the import emits a WARN to stderr (instead of silent drop-in). This prevents re-introducing the pre-Apr-18 bug where the PDF importer frequently flagged only the first correct option on multi-correct questions (see `reports/content-audit-2026-04-18/multi-correct-count-mismatch.md`).",
    },
  },
  {
    date: "2026-04-21",
    tag: "improvement",
    title: {
      de: "Geräteübergreifende Stärken-Analyse",
      en: "Cross-device strength analysis",
    },
    description: {
      de: "Dein Fortschritt pro Fachgebiet ist jetzt geräteübergreifend synchron. Handy und Laptop zeigen dieselben Schwächen und denselben Lernplan.",
      en: "Your progress by specialty now syncs across devices. Your phone and laptop show the same weak topics and study plan.",
    },
  },
  {
    date: "2026-04-21",
    tag: "feature",
    title: {
      de: "Offline-Modus: Fragen vorab herunterladen und ohne Internet weiterlernen",
      en: "Offline mode: pre-download questions and keep studying without internet",
    },
    description: {
      de: "Unter Einstellungen → Offline-Modus können Sie jetzt 100, 250 oder 500 Fragen auf Ihr Gerät laden. Wenn die Verbindung abbricht (U-Bahn, Krankenhaus-WLAN, Zug), zieht das Quiz nahtlos aus der lokalen IndexedDB. Antworten werden lokal in einer Warteschlange gespeichert und automatisch an den Server gesendet, sobald Sie wieder online sind, XP, Streak und Fortschritt bleiben also erhalten. Oben erscheint bei Offline-Betrieb eine dezente Statusanzeige („Offline · N Fragen verfügbar\u201C).",
      en: "Under Settings → Offline mode you can now download 100, 250, or 500 questions to your device. If connectivity drops (metro, hospital WiFi, train), the quiz seamlessly pulls from your local IndexedDB instead of the server. Answers you record offline queue locally and auto-sync the moment you come back online, so XP, streak, and progress all catch up. A small pill at the top of the screen indicates offline state (\"Offline · N questions available\").",
    },
  },
  {
    date: "2026-04-21",
    tag: "feature",
    title: {
      de: "Schnellsuche per Cmd+K",
      en: "Quick search with Cmd+K",
    },
    description: {
      de: "Drücke ⌘K (oder Ctrl+K auf Windows) überall im Produkt, um das neue Schnellsuche-Fenster zu öffnen. Finde Fragen, springe zu einem Fachgebiet, oder navigiere per Tastatur direkt zu einer Seite: mit den Pfeiltasten die Treffer durchwandern, Enter zum Öffnen, Esc zum Schließen. Alternativ funktioniert auch „/“, solange kein Eingabefeld aktiv ist.",
      en: "Press ⌘K (or Ctrl+K on Windows) anywhere in the product to open the new quick-search palette. Find questions, jump to a specialty, or navigate to any page: arrow keys to walk the results, Enter to open, Esc to close. You can also press \u201C/\u201D when no input field is focused.",
    },
  },
  {
    date: "2026-04-21",
    tag: "fix",
    title: {
      de: "KI-Erklärung vs. KI-Chat: klarere Benennung",
      en: "AI Explanation vs. AI Chat: clearer naming",
    },
    description: {
      de: "Der Tab unter jeder Frage heißt jetzt „KI-Erklärung“ statt „KI-Chat“, und eine kurze Info erklärt, dass KI-Erklärungen für alle kostenlos sind: nur eigene Rückfragen an die KI benötigen Pro. Frei-Nutzer:innen sehen beim Öffnen eine klare Erklär-Karte, damit sie nicht mehr glauben, die KI sei defekt.",
      en: "The tab under every question is now called \u201cAI Explanation\u201d instead of \u201cAI Chat,\u201d and a short info tooltip clarifies that AI explanations are free for everyone: only your own follow-up questions to the AI require Pro. Free users now see a clear explainer card on open so they no longer think the AI is broken.",
    },
  },
  {
    date: "2026-04-18",
    tag: "admin",
    title: {
      de: "OCR-Tippfehler in KMP-Innsbruck- und Vienna-2026-Import-Fragen korrigiert",
      en: "OCR typos in KMP Innsbruck + Vienna 2026 imported questions fixed",
    },
    description: {
      de: "Systematischer OCR-Bereinigungslauf über 3.245 importierte KMP-Innsbruck- und Vienna-2026-SIP5a-Fragen: Etwa 3.800 unsichtbare Private-Use-Area-Unicode-Artefakte aus dem PDF-OCR-Import wurden in die korrekten Zeichen ausgetauscht (Bindestriche, Klammern, Leerzeichen). Zusätzlich wurden ~45 zusammengebrochene Bindestrich-Komposita (z. B. „HNOPraxis → HNO-Praxis“, „Lyme-Borreliose“, „Mutter-Kind-Pass“, „Vitamin-K-Antagonisten“), ~308 Satzgrenzen ohne Leerzeichen („erhöhtWie → erhöht. Wie“) sowie einzelne Rechtschreibfehler („metastastierten → metastasierten“) korrigiert. Abkürzungen wie „z. B.“, „u. a.“, „i. v.“, „bzw.“ blieben unangetastet. Insgesamt ~1.200 Fragen mit ~4.500 einzelnen Korrekturen.",
      en: "Systematic OCR cleanup across 3,245 imported KMP Innsbruck + Vienna 2026 SIP5a questions: ~3,800 invisible Private-Use-Area unicode artifacts from the PDF OCR import swapped back to the right characters (hyphens, parens, spaces). Also fixed ~45 broken-hyphen compound words (e.g. \"HNOPraxis → HNO-Praxis\", \"Lyme-Borreliose\", \"Mutter-Kind-Pass\", \"Vitamin-K-Antagonisten\"), ~308 missing-space-after-punctuation sentence boundaries (\"erhöhtWie → erhöht. Wie\"), and isolated spelling errors (\"metastastierten → metastasierten\"). Abbreviations like \"z.B.\", \"u.a.\", \"i.v.\", \"bzw.\" preserved. Total ~1,200 questions touched with ~4,500 individual fixes.",
    },
  },
  {
  "date": "2026-04-18",
  "tag": "improvement",
  "title": {
    "de": "KI-Erklärungen im neuen Format für alle",
    "en": "AI explanations in the new format for everyone"
  },
  "description": {
    "de": "Ältere KI-Erklärungen wurden im neuen, klareren Format neu erstellt: zuerst die Kurzfassung, dann die Begründung der richtigen Antwort, jede falsche Option einzeln und passende Leitlinien. Alle, auch im kostenlosen Zugang, sehen sofort die neue Version.",
    "en": "Older AI explanations were rebuilt in the new, clearer format: a short summary first, then why the correct answer is right, each wrong option on its own, and relevant guidelines. Everyone, free plan included, sees the new version right away."
  }
},
  {
    date: "2026-04-18",
    tag: "admin",
    title: {
      de: "39 Fragen mit falscher Anzahl korrekter Antworten gefunden und korrigiert (Import-Pipeline-Fehler)",
      en: "39 questions with wrong correct-answer count detected and fixed (import pipeline bug)",
    },
    description: {
      de: "Inhalts-Audit: 63 Fragen hatten im Stamm einen Hinweis wie „(3 richtige Antworten)\u201C, aber die choices-JSONB markierte eine abweichende Anzahl als correct. Ursache: der PDF-Import hat oft nur die erstgenannte richtige Option geflaggt. 39 eindeutige Fälle wurden medizinisch geprüft (ERC 2021, ESC 2023, ÖDG, Herold, Amboss) und korrigiert: fehlende richtige Optionen ergänzt oder falsch markierte entfernt. 24 Fälle wurden zur manuellen Prüfung geflaggt (16 mit Import-Textmerge-Bug „\\nF)\u201C, 8 mit medizinisch zweideutigem Stamm). Bericht in reports/content-audit-2026-04-18/multi-correct-count-mismatch.md.",
      en: "Content audit: 63 questions had stem hints like \"(3 correct answers)\" but the choices JSONB marked a different count as correct. Root cause: the PDF importer often only flagged the first-listed correct option. 39 clear cases were medically reviewed (ERC 2021, ESC 2023, ÖDG, Herold, Amboss) and fixed: missing correct options added or wrong ones unmarked. 24 cases flagged for human review (16 with an import text-merge bug \"\\nF)\", 8 with medically ambiguous stems). Report at reports/content-audit-2026-04-18/multi-correct-count-mismatch.md.",
    },
  },
  {
    date: "2026-04-18",
    tag: "admin",
    title: {
      de: "31 Fragen mit fehlenden Bildern identifiziert und für Admin-Prüfung markiert",
      en: "31 questions with missing images identified and tagged for admin review",
    },
    description: {
      de: "Datenqualitäts-Audit: Fragen mit Text wie „auf dem Bild zu sehen\u201C, „folgendes EKG\u201C, „dieses Röntgenbild\u201C, die aber keine image_url haben (Bild verloren beim Import). 31 bestätigte Fälle (3 Kenntnisprüfung Wien, 28 KMP Innsbruck, 0 Pharma) mit dem Tag missing_image markiert. Neuer Admin-Endpoint /api/stats/admin/missing-images für Triage. Keine Fragen deaktiviert: [name] entscheidet pro Frage, ob umgeschrieben oder manuell beschafft wird.",
      en: "Data-quality audit: questions with stems like \"auf dem Bild zu sehen\", \"folgendes EKG\", \"dieses Röntgenbild\" that have no image_url (image lost during import). 31 confirmed cases (3 Kenntnisprüfung Wien, 28 KMP Innsbruck, 0 Pharma) tagged with missing_image. New admin endpoint /api/stats/admin/missing-images for triage. No questions deactivated: [name] decides per question whether to rewrite the stem or source the image manually.",
    },
  },
  {
  "date": "2026-04-18",
  "tag": "feature",
  "title": {
    "de": "Übersetzung der Erklärungen in Ihre Sprache",
    "en": "Translate explanations into your language"
  },
  "description": {
    "de": "Erklärungen lassen sich ins Russische, Arabische, Englische, Französische, Türkische, Ukrainische oder Serbische übersetzen. Medizinische Fachbegriffe, Medikamentennamen und Leitlinien-Bezeichnungen bleiben im Original. Übersetzungen werden einmal erstellt und dann für alle gespeichert. Kostenloser Zugang: 5 Übersetzungen pro Tag. Pro: unbegrenzt.",
    "en": "Explanations can be translated into Russian, Arabic, English, French, Turkish, Ukrainian or Serbian. Medical terms, drug names and guideline references stay in the original. Translations are created once and then saved for everyone. Free plan: 5 translations per day. Pro: unlimited."
  }
},
  {
    date: "2026-04-18",
    tag: "admin",
    title: {
      de: "Audit: alle Fragen mit fälschlich als alle-korrekt markierten Antworten behoben",
      en: "Audit: all questions with falsely all-correct marked answers resolved",
    },
    description: {
      de: "Vollständiger Scan der Datenbank nach Fragen, bei denen durch einen Import-Fehler ALLE Antwortmöglichkeiten als richtig markiert waren. Ergebnis: 0 verbleibende Fälle, der Datenfehler aus den Anki/KMP-Innsbruck/Wien-2026-Importpipelines ist vollständig beseitigt (20 Fragen in früheren Sweeps korrigiert). Nur q71498 (Spannungspneumothorax-Zeichen) behält legitimerweise alle 5 korrekten Antworten.",
      en: "Full DB sweep for questions where an import bug marked ALL choices as correct. Result: 0 remaining cases, the data corruption from the Anki/KMP-Innsbruck/Vienna-2026 import pipelines is fully cleared (20 questions fixed in prior sweeps). Only q71498 (tension pneumothorax signs) legitimately keeps all 5 correct.",
    },
  },
  {
    date: "2026-04-18",
    tag: "fix",
    title: {
      de: "KI-Chat: Markdown jetzt korrekt dargestellt",
      en: "AI chat: markdown now renders correctly",
    },
    description: {
      de: "KI-Erklärungen zeigen jetzt Fettdruck, Überschriften und Aufzählungen korrekt formatiert an, vorher erschien Markdown als Rohtext (**Fett** statt Fett, Bindestriche statt Bullet-Points). Die neue Darstellung passt sich automatisch an Hell-/Dunkelmodus an und nutzt die App-Farben für Fachbegriffe und Überschriften. Außerdem: klarere „Pro-Feature: Folgefragen stellen\u201C-Markierung für Gratis-Nutzer unter dem Chatfenster.",
      en: "AI explanations now render bold text, headings, and bullet lists correctly: previously markdown appeared as raw text (**bold** instead of bold, dashes instead of bullet points). The new rendering adapts to light/dark mode and uses app brand colors for medical terms and headings. Also: clearer \"Pro feature: ask follow-up questions\" label for free users below the chat.",
    },
  },
  {
    date: "2026-04-17",
    tag: "feature",
    title: {
      de: "Weiterlernen, wo du aufgehört hast",
      en: "Continue where you left off",
    },
    description: {
      de: "Neue „Fortsetzen\u201C-Karte auf der Startseite: sobald du Fragen beantwortet hast, merken wir uns dein letztes Fachgebiet und schlagen dir die nächste fällige Frage vor (Spaced-Repetition-Logik). Ein Klick bringt dich direkt dorthin, wo du gestern warst. Karte blendet sich automatisch aus, wenn deine letzte Sitzung länger als 7 Tage her ist.",
      en: "New \"Continue\" card on the home page: once you've answered any questions, we remember your last topic and suggest the next spaced-rep-due question. One click takes you back to exactly where you left off yesterday. Auto-hides if your last session was more than 7 days ago.",
    },
  },
  {
    date: "2026-04-17",
    tag: "improvement",
    title: {
      de: "KI-Erklärungen: besser strukturiert, jetzt regenerierbar (Pro)",
      en: "AI explanations: better structure, regeneratable (Pro)",
    },
    description: {
      de: "Neues strengeres Format für KI-Erklärungen: TL;DR zuerst, dann „Warum die richtige Antwort\u201C mit Bullet-Points und Fettdruck für Fachbegriffe, dann Distraktor-für-Distraktor Begründung, mit Leitlinien-Referenzen (ERC 2021, ESC, ÖDG, AGES). Max. ~400 Wörter damit es auf das Handy passt. Pro-Nutzer können eine Erklärung jetzt neu generieren lassen (Refresh-Button oben im KI-Chat): der neue Text überschreibt den alten und setzt die Bewertungen zurück. Thumbs-down landet jetzt außerdem im Feedback-Posteingang, damit schlechte Erklärungen systematisch verbessert werden.",
      en: "Stricter format for AI explanations: TL;DR first, then \"Why the correct answer\" with bullet points and bold medical terms, then distractor-by-distractor reasoning with guideline references (ERC 2021, ESC, ÖDG, AGES). Capped at ~400 words so it fits on mobile. Pro users can now regenerate an explanation (Refresh button at the top of the AI chat): the new text overwrites the old and resets the ratings. Thumbs-down now also drops into the feedback inbox so bad explanations get systematically improved.",
    },
  },
  {
    date: "2026-04-17",
    tag: "feature",
    title: {
      de: "Personalisierter Lernplan (Lernplan)",
      en: "Personalized study plan (Lernplan)",
    },
    description: {
      de: "Neue Seite /study-plan baut dir aus deinem Prüfungsdatum, Tagesziel und Fortschritt pro Fachgebiet einen Tag-für-Tag-Lernplan. Die ersten 70% der Zeit fokussieren neues Material, die letzten 30% reine Wiederholung. Schwache Themen (< 60% Genauigkeit) bekommen mehr Gewicht. Jede Tages-Karte zeigt Fachgebiete mit Anzahl, direktem Start-Button und grünem Haken, sobald das Tagesziel erfüllt ist.",
      en: "New /study-plan page generates a day-by-day learning plan from your exam date, daily goal, and per-topic progress. First 70% of the timeline focuses on new material, last 30% on pure review. Weak topics (< 60% accuracy) get extra weight. Every day card shows topics with target counts, a direct Start button, and a green checkmark once today's goal is met.",
    },
  },
  {
    date: "2026-04-17",
    tag: "admin",
    title: {
      de: "Preisseite: Free, Pro und Gruppentarife transparent",
      en: "Pricing page: Free, Pro, and Group plans, transparent",
    },
    description: {
      de: "Neue Seite /pricing zeigt, was heute kostenlos ist, und welche Pro- und Gruppentarife bald verfügbar sind. Interesse anmelden per E-Mail, wir melden uns mit dem endgültigen Preis vor dem Launch. Erreichbar über die Seitenleiste (Preise), die Einstellungen (Konto) und die Startseiten-Fußzeile.",
      en: "New /pricing page shows what's free today and which Pro + Group plans are coming soon. Sign up by email, we'll share final pricing before launch. Reachable from the sidebar (Pricing), settings (Account), and the landing-page footer.",
    },
  },
  {
    date: "2026-04-16",
    tag: "feature",
    title: {
      de: "E-Mail-Validierung: Benachrichtigung bei ungültiger E-Mail-Adresse",
      en: "Email validation: notification for invalid email addresses",
    },
    description: {
      de: "Nutzer mit ungültigen E-Mail-Adressen werden beim nächsten Login benachrichtigt und können ihre Adresse direkt aktualisieren.",
      en: "Users with invalid email addresses are notified on next login and can update their address directly.",
    },
  },
  {
    date: "2026-04-16",
    tag: "admin",
    title: {
      de: "E-Mail-Status-Tracking in der Datenbank",
      en: "Email status tracking in database",
    },
    description: {
      de: "Neue Spalte email_status (valid/bounced/unverified) zur Nachverfolgung der E-Mail-Zustellbarkeit. API-Endpunkt /api/user/email-update für Nutzer-Self-Service.",
      en: "New email_status column (valid/bounced/unverified) for delivery tracking. API endpoint /api/user/email-update for user self-service.",
    },
  },
  // ═══ 2026-04-15 (overnight audit) ═══
  {
    date: "2026-04-15",
    tag: "admin",
    title: {
      de: "Sicherheits-Generalüberholung: Admin-Bereich geschützt, neue Zugriffskontrollen",
      en: "Security overhaul: admin panel protected, new access controls",
    },
    description: {
      de: "Wir haben die Sicherheitsvorkehrungen für Konten und private Daten verstärkt.",
      en: "We strengthened protections for accounts and private data.",
    },
  },
  {
    date: "2026-04-15",
    tag: "admin",
    title: {
      de: "Cookie-Banner aktiv: GA4 und Clarity nur nach Zustimmung",
      en: "Cookie banner active: GA4 and Clarity only after consent",
    },
    description: {
      de: "Bisher wurden Google Analytics und Microsoft Clarity bei jedem Seitenaufruf sofort geladen, unabhängig von der Cookie-Entscheidung. Ein Cookie-Banner war im Code vorhanden, aber nicht aktiviert. Das haben wir jetzt korrekt zusammengeführt: beim ersten Besuch erscheint der Banner, und die Analyse-Tools werden erst nach dem Klick auf „Akzeptieren\" geladen.",
      en: "Until now, Google Analytics and Microsoft Clarity loaded on every page visit regardless of the cookie choice. A cookie banner existed in the code but was never mounted. Now wired up correctly: first visit shows the banner, and analytics tools only load after clicking \"Accept\".",
    },
  },
  {
    date: "2026-04-15",
    tag: "admin",
    title: {
      de: "Alle bisherigen Fragen-Meldungen wurden anonym gespeichert: korrigiert",
      en: "All previous question reports were stored anonymously: fixed",
    },
    description: {
      de: "Wir haben die Bearbeitung gemeldeter Fragen verbessert. Neue Meldungen können jetzt bei Bedarf gezielter nachverfolgt werden.",
      en: "We improved how question reports are handled. New reports can now be followed up more effectively when needed.",
    },
  },
  {
    date: "2026-04-15",
    tag: "fix",
    title: {
      de: "Zoom auf Handy wieder freigegeben",
      en: "Pinch-to-zoom restored on mobile",
    },
    description: {
      de: "Beim Lesen langer klinischer Fragentexte konnte man bisher auf dem Handy nicht zoomen. Das war ein Barrierefreiheits-Fehler (WCAG 2.1 1.4.4) und ist jetzt behoben: du kannst wieder mit zwei Fingern zoomen.",
      en: "Reading long clinical question texts on mobile used to block pinch-zoom. This was an accessibility violation (WCAG 2.1 1.4.4) and is now fixed: two-finger zoom works again.",
    },
  },
  {
    date: "2026-04-15",
    tag: "fix",
    title: {
      de: "Streak-Widget zeigt nur echte Aktivität, keine erfundenen Tage mehr",
      en: "Streak widget now shows real activity only, no more invented days",
    },
    description: {
      de: "Das 7-Tage-Streak-Widget zeigte bisher für Tage außerhalb deines aktuellen Streaks zufällig aktive/inaktive Zellen: das war Fake-Daten, die sich bei jedem Seitenaufruf geändert haben. Jetzt zeigt das Widget nur deinen tatsächlichen Streak; nicht-gestreakte Tage sind ausgegraut.",
      en: "The 7-day streak widget used to randomly flip non-streak days active/inactive: that was fake data that changed on every page render. The widget now shows only your real streak; non-streak days are greyed out honestly.",
    },
  },
  {
    date: "2026-04-15",
    tag: "admin",
    title: {
      de: "Admin-Statistiken korrigiert: DAU/WAU/MAU zeigen jetzt die echten Zahlen",
      en: "Admin statistics fixed: DAU/WAU/MAU now show real numbers",
    },
    description: {
      de: "Das Admin-Dashboard zählte tägliche/wöchentliche/monatliche aktive Nutzer:innen, indem es alle Events in den Browser lud und dort zählte, aber Supabase liefert nur die letzten 1000 Zeilen. Sobald mehr Events vorlagen, fing die Zahl an zu lügen. Die Berechnung läuft jetzt serverseitig in der Datenbank und ist bei jedem Volumen korrekt.",
      en: "The admin dashboard counted daily/weekly/monthly active users by loading all events into the browser and counting there, but Supabase only returns the last 1000 rows. Once events crossed 1000 the number started lying. The computation now runs server-side in the database and stays correct at any volume.",
    },
  },
  {
    date: "2026-04-15",
    tag: "admin",
    title: {
      de: "Seitenaufrufe-Tracking über alle Routen wiederhergestellt",
      en: "Pageview tracking restored across all routes",
    },
    description: {
      de: "Google Analytics registrierte bisher nur die Landing-Seite jedes Besuchs, weil der SPA-Navigation nie ein neues `config`-Event mitgegeben wurde. Ein neuer TrackRouteChange-Baustein löst bei jeder Navigation korrekt ein Pageview-Event aus. Damit werden Funnel-Analysen und Verweilzeit pro Seite zum ersten Mal überhaupt in GA4 verwertbar.",
      en: "Google Analytics only tracked the landing URL of each visit because the App Router's client-side navigation never re-fired `config`. A new TrackRouteChange component now triggers a pageview event on every soft navigation. For the first time, funnel analysis and per-page engagement are actually usable in GA4.",
    },
  },
  {
    date: "2026-04-15",
    tag: "admin",
    title: {
      de: "Sitzungsende wird jetzt korrekt registriert",
      en: "Session end now correctly recorded",
    },
    description: {
      de: "Alle 1240 bisherigen Sitzungen in der Datenbank hatten kein Ende-Datum: die `endSession`-Funktion war vorhanden, wurde aber nie aufgerufen. Jetzt wird jede Sitzung beim Schließen des Tabs (mit 5 Minuten Karenzzeit beim Tab-Wechsel) korrekt beendet. Damit lassen sich erstmals echte Sitzungsdauern messen.",
      en: "All 1,240 previous sessions in the database had no end timestamp: the `endSession` function existed but was never called. Sessions now terminate correctly on tab close (with a 5-minute grace window for tab-switching). Real session durations are now measurable for the first time.",
    },
  },
  {
    date: "2026-04-15",
    tag: "admin",
    title: {
      de: "Alle Fragenzahlen im Produkt auf 10.992 aktualisiert",
      en: "All question counts across the product updated to 10,992",
    },
    description: {
      de: "Mehrere Stellen im Produkt (Startseite, Login, Onboarding, Landingpage, Metadaten) zeigten noch „7.725 Fragen\", den Stand vor der Erweiterung um KMP Innsbruck und Pharmakologie. Alle Zahlen wurden auf 10.992 aktualisiert und die Landingpage nennt jetzt alle drei Prüfungstypen korrekt.",
      en: "Several places in the product (home, login, onboarding, landing, metadata) still showed \"7,725 questions\", the count from before the KMP Innsbruck and Pharmakologie expansion. Updated to 10,992 everywhere, and the landing page now correctly names all three exam types.",
    },
  },
  {
    date: "2026-04-15",
    tag: "fix",
    title: {
      de: "Themen-Übung startet wieder direkt: ohne Konfigurations-Umweg",
      en: "Topic practice now starts directly: no more customize detour",
    },
    description: {
      de: "Wenn du ein Fach auf der Startseite oder im Curriculum antippst oder „Zufallsfragen\" wählst, springst du jetzt sofort in die Fragen, ohne den Umweg über den „Quiz konfigurieren\"-Bildschirm. Die Spaced-Repetition-Logik entscheidet im Hintergrund automatisch, welche Frage als nächstes dran ist, sodass du dort weitermachst, wo du aufgehört hast. Das Konfigurations-Menü bleibt für den expliziten „Quiz konfigurieren\"-Einstieg erhalten.",
      en: "Tapping a subject on the home page or curriculum, or hitting \"Random questions\", now drops you straight into practice, no more detour through the \"Customize your quiz\" screen. The spaced-repetition engine picks the next question for you so you pick up where you left off. The customize screen is still available for explicit opt-in.",
    },
  },
  {
    date: "2026-04-15",
    tag: "fix",
    title: {
      de: "„Neue Version verfügbar\"-Schleife gestoppt",
      en: "\"New version available\" loop stopped",
    },
    description: {
      de: "Der Hinweis auf eine neue App-Version erscheint jetzt nur bei einem tatsächlichen Update.",
      en: "The new-version notice now appears only when an app update is available.",
    },
  },
  {
    date: "2026-04-15",
    tag: "fix",
    title: {
      de: "Zwei fehlerhafte Fragen korrigiert (Psychiatrie + Pädiatrie)",
      en: "Two incorrect questions fixed (Psychiatry + Pediatrics)",
    },
    description: {
      de: "Die Frage zu Mydriasis und Intoxikation (Psychiatrie) hatte alle 5 Antworten als richtig markiert, jetzt sind nur noch Kokain, Amphetamin und Anticholinergika richtig (Opiate und Benzodiazepine verursachen dagegen Miosis). Die Frage zu Spastik bei Cerebralparese (Pädiatrie) hatte gar keinen echten Fragesatz, jetzt steht dort korrekt „Welche der folgenden Maßnahmen verbessern die Spastik bei Cerebralparese (CP)? (3 richtige Antworten)\". Beide Fragen mit medizinischer Erklärung versehen. Danke an die Nutzer, die diese Fehler gemeldet haben!",
      en: "The mydriasis/intoxication question (Psychiatry) had all 5 choices marked correct; now only Cocaine, Amphetamine, and Anticholinergics are correct (Opiates and Benzodiazepines cause miosis instead). The spasticity in cerebral palsy question (Pediatrics) had no real question stem; now it correctly asks \"Which of the following measures improve spasticity in cerebral palsy (CP)? (3 correct answers)\". Both questions now include a medical explanation. Thanks to the users who reported these!",
    },
  },
  {
    date: "2026-04-15",
    tag: "admin",
    title: {
      de: "Kill-Switch gegen hängende alte App-Versionen",
      en: "Kill-switch for stuck old app versions",
    },
    description: {
      de: "Beim ersten Laden jeder Seite prüft die App jetzt, ob ein alter Service Worker die Kontrolle hat. Falls ja, wird er automatisch abgemeldet, alle Caches geleert und die Seite neu geladen, damit Nutzer nicht in einer alten Version hängen bleiben, bis der Browser von selbst aktualisiert.",
      en: "On every page load, the app now checks if an old service worker is still in control. If so, it automatically unregisters it, clears all caches, and reloads, so users don't stay stuck on an old version until the browser decides to refresh on its own.",
    },
  },
  // ═══ 2026-04-14 ═══
  {
  "date": "2026-04-14",
  "tag": "improvement",
  "title": {
    "de": "Automatische Updates: neue Versionen ohne manuelles Neuladen",
    "en": "Automatic updates: new versions without manual reload"
  },
  "description": {
    "de": "Die App erkennt jetzt automatisch, wenn eine neue Version verfügbar ist. Sie sehen einen Hinweis und laden mit einem Klick neu, statt mit einer veralteten Version weiterzuarbeiten.",
    "en": "The app now detects automatically when a new version is available. You see a notice and reload with one click instead of continuing on an outdated version."
  }
},
  {
    date: "2026-04-14",
    tag: "admin",
    title: {
      de: "Fragen-Meldungen erfassen jetzt vollständigen Kontext",
      en: "Question reports now capture full context",
    },
    description: {
      de: "Bei jeder gemeldeten Frage werden jetzt URL, Prüfungstyp, Gerät und Browser mitgespeichert, auch bei anonymen und Gast-Nutzern. Dadurch kann jede Meldung zuverlässig nachverfolgt werden.",
      en: "Every question report now captures URL, exam type, device, and browser, even for anonymous and guest users. This makes every report traceable and triageable.",
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
    tag: "admin",
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
  "date": "2026-04-12",
  "tag": "feature",
  "title": {
    "de": "Neue Prüfung: Stichprobentest (Innsbruck)",
    "en": "New exam: Stichprobentest (Innsbruck)"
  },
  "description": {
    "de": "Die Vorbereitung auf den Stichprobentest (Innsbruck) ist jetzt verfügbar. Sie wählen ihn in der Prüfungsauswahl.",
    "en": "Preparation for the Stichprobentest (Innsbruck) is now available. Choose it in the exam picker."
  }
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
      de: "Die Fragenbank wurde überarbeitet: falsch zugeordnete Fragen wurden korrigiert und doppelte Einträge entfernt. Dieser Eintrag beschreibt den damaligen Stand.",
      en: "The question bank was revised: misassigned items were corrected and duplicate entries removed. This entry describes the state at that time.",
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
  "date": "2026-04-11",
  "tag": "feature",
  "title": {
    "de": "Startseite komplett überarbeitet",
    "en": "Landing page rewrite"
  },
  "description": {
    "de": "Neue Startseite mit Überblick über die Funktionen, einer interaktiven Beispielfrage, transparenten Preisen und FAQ.",
    "en": "New landing page with a feature overview, an interactive sample question, transparent pricing and an FAQ."
  }
},
  {
    date: "2026-04-11",
    tag: "admin",
    title: { de: "Live-Anmelde-Tracker im Admin", en: "Live new-users tracker in admin" },
    description: {
      de: "Das Admin-Dashboard zeigt jetzt eine Echtzeit-Karte mit neuen Registrierungen (letzte Stunde, heute, 7/30 Tage) plus die letzten 10 Anmeldungen, automatische Aktualisierung alle 30 Sekunden.",
      en: "The admin dashboard now shows a live card with new registrations (last hour, today, 7/30 days) plus the last 10 signups, auto-refreshing every 30 seconds.",
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
      de: "In der Prüfungssimulation kommen jetzt alle Fragen eines Fachs hintereinander, dann das nächste Fach, wie in der echten Wiener Kenntnisprüfung. SIP-4- und Vollprüfungen enthalten außerdem 2-3 garantierte EKG-Fragen.",
      en: "Exam simulation now groups all questions of one subject consecutively before moving to the next, matching the real Vienna Kenntnisprüfung. SIP 4 and full exams now also include 2-3 guaranteed ECG questions.",
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
      de: "Die automatische Dunkelmodus-Erkennung und der manuelle Schalter sind jetzt vollständig synchronisiert: keine gemischten Themes mehr.",
      en: "Automatic dark mode detection and the manual toggle are now fully unified: no more mixed themes.",
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
      de: "Die Prüfung rendert Fragen jetzt mit derselben Karte wie das Quiz. Hervorhebungen, Bild-Lightbox, KI-Erklärung, Notizen, Favorit, Melden: alles funktioniert konsistent zwischen Quiz und Prüfung.",
      en: "The exam now renders questions with the same card as the quiz. Highlights, image lightbox, AI explain, notes, favorite, report: everything works consistently between quiz and exam.",
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
      de: "KI-Erklärungen werden jetzt einmal pro Frage generiert und für alle Nutzer zwischengespeichert: schneller und effizienter.",
      en: "AI explanations are now generated once per question and cached for all users: faster and more efficient.",
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
    tag: "admin",
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
      de: "Datenschutz, Nutzungsbedingungen und Impressum sind jetzt verfügbar.",
      en: "Privacy policy, terms of service, and legal notice are now available.",
    },
  },
  {
    date: "2026-04-10",
    tag: "feature",
    title: { de: "Cookie-Banner", en: "Cookie banner" },
    description: {
      de: "Cookie-Banner: akzeptiere oder lehne Analyse-Cookies ab.",
      en: "Cookie banner: accept or decline analytics cookies.",
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
      de: "Registriere und melde dich mit E-Mail und Passwort an: keine Telegram-Nutzung erforderlich.",
      en: "Register and sign in with email and password: no Telegram required.",
    },
  },
  {
    date: "2026-04-09",
    tag: "admin",
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
      de: "Melde dich mit deinem Telegram-Konto an: schnell und sicher.",
      en: "Sign in with your Telegram account: fast and secure.",
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

export function getPublicChangelogEntries(
  entries: ChangelogEntry[] = CHANGELOG,
): ChangelogEntry[] {
  return entries.filter((entry) => entry.tag !== "admin");
}
