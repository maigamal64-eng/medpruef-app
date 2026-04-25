import ExamLandingShell, {
  type ExamLandingContent,
} from "@/components/seo/ExamLandingShell";

/**
 * /kmp-innsbruck — KMP Innsbruck landing page.
 *
 * Content numbers per NOTES.md §Content: 3,091 questions across
 * 12 specialties. Source: 17 KoalaMed PDFs (imported via
 * `scripts/import_koalamed.py`). The exam itself is the MedUni
 * Innsbruck Kumulative Modulprüfung — KoalaMed is a third-party
 * aggregator, we imported from there but the real test is a MedUni
 * Innsbruck internal exam. Do NOT say "KoalaMed exam" anywhere on
 * user-facing surfaces.
 */

const content: ExamLandingContent = {
  examName: {
    de: "KMP Innsbruck",
    en: "KMP Innsbruck",
  },
  eyebrow: {
    de: "Österreich · Innsbruck · Kumulative Modulprüfung",
    en: "Austria · Innsbruck · Cumulative Module Exam",
  },
  heroTitle: {
    de: "Bestehe die KMP Innsbruck beim ersten Versuch.",
    en: "Pass the KMP Innsbruck on your first try.",
  },
  heroSubtitle: {
    de: "Strukturierte Vorbereitung auf die Kumulative Modulprüfung der Med Uni Innsbruck — 3.091 Fragen aus 12 Fachgebieten, klinisch kommentiert, gebaut von Ärzt:innen, die den Weg der Nostrifikation selbst gegangen sind.",
    en: "Structured prep for the Med Uni Innsbruck Cumulative Module Exam — 3,091 questions across 12 specialties, clinically annotated, built by doctors who've walked the nostrification path themselves.",
  },
  primaryCtaHref: "/quiz?exam=kmp_innsbruck&free=1",
  primaryCtaLabel: {
    de: "Free starten — 150 KMP Fragen",
    en: "Start free — 150 KMP questions",
  },
  secondaryCtaHref: "/pricing",
  secondaryCtaLabel: {
    de: "Alle Pläne ansehen",
    en: "See all plans",
  },
  breakdown: [
    {
      label: { de: "Fragen", en: "Questions" },
      value: "3.091",
      sub: {
        de: "Strukturiert aus 17 Modul-PDFs",
        en: "Structured from 17 module PDFs",
      },
    },
    {
      label: { de: "Fachgebiete", en: "Specialties" },
      value: "12",
      sub: {
        de: "Alle KMP-Module abgedeckt",
        en: "Every KMP module covered",
      },
    },
    {
      label: { de: "Sprachen", en: "Languages" },
      value: "7+",
      sub: {
        de: "DE primär · EN · AR · RU · FR · TR · UK",
        en: "DE primary · EN · AR · RU · FR · TR · UK",
      },
    },
    {
      label: { de: "Kostenlos", en: "Free tier" },
      value: "150",
      sub: {
        de: "Fragen ohne Kreditkarte",
        en: "Questions, no credit card",
      },
    },
  ],
  whatYouLearn: [
    {
      de: "Alle 12 Module im Überblick: Innere Medizin, Allgemeine Chirurgie, chirurgische Spezialfächer + Anästhesie, Dermatologie, Gynäkologie & Geburtshilfe, HNO, Kinder- und Jugendheilkunde, Kinder- und Jugendpsychiatrie, Neurologie, Psychiatrie, Intensivmedizin, Augenheilkunde.",
      en: "All 12 modules: Internal Medicine, General Surgery, Surgical Specialties + Anesthesiology, Dermatology, Gynecology & Obstetrics, ENT, Pediatrics, Child & Adolescent Psychiatry, Neurology, Psychiatry, Intensive Care Medicine, Ophthalmology.",
    },
    {
      de: "Fallvignetten im KMP-Stil — Diagnose, Differenzialdiagnose, Therapie und Management-Entscheidungen.",
      en: "Case vignettes in KMP format — diagnosis, differential diagnosis, therapy, and management decisions.",
    },
    {
      de: "KI-Erklärungen zu Guidelines (ÖDG, ERC, ESC, Herold, Amboss) — nicht nur die Antwort, sondern das Warum.",
      en: "AI explanations citing guidelines (ÖDG, ERC, ESC, Herold, Amboss) — not just the answer, but the reasoning.",
    },
    {
      de: "Spaced Repetition + personalisierter Lernplan — fokussiert auf die Module, in denen du noch Luft nach oben hast.",
      en: "Spaced repetition + personalized study plan — focused on the modules where you still have room to grow.",
    },
    {
      de: "Mobile + Offline-fähig: PWA installierbar, Fragen auch ohne Netz abrufbar.",
      en: "Mobile + offline-capable: installable PWA, questions accessible without network.",
    },
  ],
  faq: [
    {
      q: {
        de: "Was ist die Kumulative Modulprüfung (KMP) genau?",
        en: "What exactly is the Kumulative Modulprüfung (KMP)?",
      },
      a: {
        de: "Die KMP ist die Ergänzungsprüfung der Medizinischen Universität Innsbruck für ausländische Ärzt:innen, die die Approbation in Tirol bzw. in Österreich über Innsbruck anstreben. Sie besteht aus Einzelmodulen zu verschiedenen Fachgebieten (12 in Summe). Anders als bei der Wiener Kenntnisprüfung, die in zwei großen Teilen (SIP 4 + SIP 5) geprüft wird, sind hier die Module einzeln ausgestaltet und werden pro Modul geprüft. Die offiziellen Modul-Zuweisungen bekommst du nach deiner Nostrifikation direkt von der MedUni Innsbruck.",
        en: "The KMP is the Med Uni Innsbruck's supplementary exam for foreign doctors seeking Austrian medical licensure through Tyrol. It consists of individual modules covering different specialties (12 in total). Unlike the Vienna Kenntnisprüfung (tested as SIP 4 + SIP 5), here each module is graded independently. Your specific module assignments come from MedUni Innsbruck after your nostrification decision.",
      },
    },
    {
      q: {
        de: "Wann finden die KMP-Prüfungen 2026 statt?",
        en: "When are the KMP exams scheduled in 2026?",
      },
      a: {
        de: "Die MedUni Innsbruck veröffentlicht jährlich mehrere Prüfungstermine. Für 2026 sind uns Termine im März, Mai und Juni bekannt. Die offiziellen Termine, verbindlichen Anmeldefristen und Modulzuteilungen findest du auf i-med.ac.at → Studierende → Prüfungen bzw. im individuellen Nostrifikationsbescheid. Das MedPrüf-Team aktualisiert den Prüfungsdaten-Datensatz zusammen mit jedem neuen veröffentlichten Termin.",
        en: "MedUni Innsbruck publishes several exam dates per year. For 2026 we know of dates in March, May, and June. Official dates, binding registration deadlines, and module assignments are on i-med.ac.at → Students → Exams, or in your personal nostrification decision letter. MedPrüf updates the exam-date dataset as each new date is published.",
      },
    },
    {
      q: {
        de: "Warum unterscheiden sich die MedPrüf-Fragen für KMP und Kenntnisprüfung Wien?",
        en: "Why do MedPrüf questions differ between KMP and Vienna Kenntnisprüfung?",
      },
      a: {
        de: "Die Prüfungsstrukturen sind unterschiedlich. Wien prüft in zwei Summative Integrierte Prüfungen (SIP 4 + SIP 5) mit einer festen Fächerstruktur. Innsbruck prüft modular — einzelne Module mit je eigenem Fokus. Wir halten die Fragenbanken deswegen strikt getrennt: wenn du „KMP Innsbruck\" als Prüfungstyp wählst, siehst du nur die 3.091 KMP-spezifisch kuratierten Fragen. Die Kenntnisprüfung-Wien-Bank (7.567 Fragen) bleibt für dich sichtbar, wenn du den Prüfungstyp wechselst.",
        en: "Exam structures differ. Vienna tests via two Summative Integrated Exams (SIP 4 + SIP 5) with a fixed subject matrix. Innsbruck tests modularly — individual modules with their own focus. We keep the question banks strictly separate: if you pick \"KMP Innsbruck\" as your exam type, you only see the 3,091 KMP-specific questions. The Vienna Kenntnisprüfung bank (7,567 questions) stays available if you switch exam type.",
      },
    },
    {
      q: {
        de: "Kann ich einzelne Module gezielt vorbereiten?",
        en: "Can I focus on specific modules?",
      },
      a: {
        de: "Ja. Nach der Wahl „KMP Innsbruck\" als Prüfungstyp kannst du im Quiz-Modus und im Prüfungs-Builder nach Modul filtern. So übst du z.B. nur HNO oder nur Augenheilkunde, wenn dein Nostrifikationsbescheid gerade diese Module zuweist. Der Studienplan (Lernplan) berücksichtigt automatisch, welche Module du bisher bearbeitet hast und welche noch offen sind.",
        en: "Yes. After selecting \"KMP Innsbruck\" as your exam type, you can filter by module in both Quiz mode and the Exam Builder. For example, you can practice ENT only, or ophthalmology only, if your nostrification decision assigns exactly those modules. The study plan automatically tracks which modules you've covered and which are still open.",
      },
    },
    {
      q: {
        de: "Wie kann ich mich zur KMP anmelden?",
        en: "How do I register for the KMP?",
      },
      a: {
        de: "Die Anmeldung erfolgt direkt bei der MedUni Innsbruck — nicht über uns. Nach der Nostrifikation erhältst du einen Bescheid, welche Module du absolvieren musst und welche Fristen gelten. Die offizielle Anmeldung zum jeweiligen Prüfungstermin, inkl. Gebühr, läuft über das Zulassungsportal der Universität. Die aktuellen Gebühren und Fristen findest du direkt dort. MedPrüf übernimmt die Vorbereitung — die administrative Anmeldung muss aber immer über die Universität laufen.",
        en: "Registration is done directly with MedUni Innsbruck — not through us. After nostrification you receive a decision letter listing which modules you need and what deadlines apply. Official exam registration (including fees) goes through the university's admission portal. Current fees and deadlines are there. MedPrüf handles the preparation side — the administrative registration always happens via the university.",
      },
    },
    {
      q: {
        de: "Wie lange sollte ich für die KMP-Vorbereitung einplanen?",
        en: "How long should I plan for KMP prep?",
      },
      a: {
        de: "Weil die KMP modular ist, hängt die realistische Vorbereitungszeit davon ab, wie viele Module dein Nostrifikationsbescheid auflistet. Für ein einzelnes Modul reichen 3-6 Wochen intensiver Vorbereitung mit 30-60 Minuten pro Tag. Für sechs oder mehr Module plane ruhig 4-6 Monate. Der MedPrüf-Lernplan fragt dich nach Prüfungsdatum und aktiver Modulliste und verteilt die Fragen entsprechend — 70% neue Inhalte, 30% Wiederholung von Schwächen.",
        en: "Because the KMP is modular, realistic prep time depends on how many modules your nostrification decision lists. For a single module, 3-6 weeks of focused prep at 30-60 minutes a day is usually enough. For six or more modules, plan 4-6 months. The MedPrüf study plan asks for your exam date and active module list, then spreads questions accordingly — 70% new content, 30% weakness revision.",
      },
    },
    {
      q: {
        de: "Unterscheidet sich der Prüfungsstil zwischen KMP und der echten Prüfung in einzelnen Modulen?",
        en: "Does the exam style differ between KMP modules and the real exam?",
      },
      a: {
        de: "Die von uns importierten Fragen stammen aus öffentlich zugänglichen Modul-PDFs, die dem realen KMP-Stil sehr nahe kommen: klinische Vignetten, MCQ-Format, teilweise Mehrfachantworten. Wir haben jede Frage auf unicode-artefakte überprüft und typografische Fehler aus dem PDF-Extraktionsprozess behoben (siehe NOTES.md §OCR-Aufräumaktion April 2026). Was wir NICHT versprechen können: identische Fragen. Prüfungsgremien aktualisieren ihre Fragenbank regelmäßig, und der Zweck von MedPrüf ist Verständnis aufbauen, nicht Auswendiglernen.",
        en: "The questions we imported come from publicly available module PDFs that closely mirror the real KMP style: clinical vignettes, MCQ format, some multi-correct. We've cleaned every question of Unicode artifacts and fixed typographic issues from the PDF extraction (see NOTES.md §OCR cleanup April 2026). What we DON'T promise: identical questions. Exam committees update their banks regularly, and MedPrüf's purpose is building understanding, not memorization.",
      },
    },
  ],
};

export default function KmpInnsbruckPage() {
  return <ExamLandingShell content={content} />;
}
