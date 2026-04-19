"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { getLang, setLang } from "@/lib/i18n";
import { TOPIC_CONFIG } from "@/lib/topics";
import Sidebar from "@/components/Sidebar";
import BottomNav from "@/components/BottomNav";
import LanguageToggle from "@/components/LanguageToggle";
import ThemeToggle from "@/components/ThemeToggle";
import { getStoredSession } from "@/lib/auth";
import TopicIcon from "@/components/TopicIcon";
import { Link as LinkIcon, Lightbulb, BookOpen } from "lucide-react";

type Lang = "de" | "en";

interface Resource {
  title: string;
  description: string;
  type: "link" | "tip" | "guideline";
  url?: string;
  specialty?: string;
}

const RESOURCES_DE: Resource[] = [
  // Official guidelines
  { title: "ÖÄK – Österreichische Ärztekammer", description: "Offizielle Informationen zur Kenntnisprüfung und Approbation in Österreich", type: "link", url: "https://www.aerztekammer.at" },
  { title: "MedUni Wien – Kenntnisprüfung", description: "Informationen zur Wiener Kenntnisprüfung für ausländische Ärzte", type: "link", url: "https://www.meduniwien.ac.at" },
  { title: "AMBOSS – Klinisches Wissen", description: "Umfassendes medizinisches Wissen mit Fragen und Lernkarten", type: "link", url: "https://www.amboss.com" },

  // Preparation tips
  { title: "Strukturierter Lernplan", description: "Beginne 6 Monate vor der Prüfung. Plane täglich mindestens 3–4 Stunden ein. Fokus auf Innere Medizin und Chirurgie.", type: "tip" },
  { title: "Schwerpunkte", description: "Innere Medizin und Chirurgie machen jeweils 12% der Prüfung aus. Diese Fächer haben die meisten Fragen – priorisiere sie.", type: "tip" },
  { title: "Sprachvorbereitung", description: "Medizinische Terminologie auf Deutsch ist entscheidend. Nutze Fachwörterbücher und übe mit deutschsprachigen Kollegen.", type: "tip" },
  { title: "Prüfungsstrategie", description: "Bei unklaren Fragen: Schließe offensichtlich falsche Antworten aus. Keine negative Bewertung – beantworte alle Fragen.", type: "tip" },

  // By specialty
  { title: "Innere Medizin", description: "Harrison's Principles of Internal Medicine (engl.) oder Herold Innere Medizin (deutsch) – Standardwerke", type: "guideline", specialty: "Innere Medizin" },
  { title: "Chirurgie", description: "Duale Reihe Chirurgie von Thieme – umfassend und prüfungsrelevant", type: "guideline", specialty: "Chirurgische Fächer" },
  { title: "Pädiatrie", description: "Leitlinien der ÖGKJ (Österreichische Gesellschaft für Kinder- und Jugendheilkunde) online verfügbar", type: "guideline", specialty: "Kinder- und Jugendheilkunde" },
  { title: "Neurologie", description: "Leitlinien der ÖGN (Österreichische Gesellschaft für Neurologie) – kostenlos verfügbar", type: "guideline", specialty: "Neurologie" },
  { title: "Psychiatrie", description: "Leitlinien der ÖGPP (Österreichische Gesellschaft für Psychiatrie und Psychotherapie) für die häufigsten Erkrankungen", type: "guideline", specialty: "Psychiatrie" },
];

const RESOURCES_EN: Resource[] = [
  // Official
  { title: "ÖÄK – Austrian Medical Chamber", description: "Official information on the Kenntnisprüfung and medical licensure in Austria", type: "link", url: "https://www.aerztekammer.at" },
  { title: "MedUni Vienna – Kenntnisprüfung", description: "Information on Vienna's Kenntnisprüfung for foreign doctors", type: "link", url: "https://www.meduniwien.ac.at" },
  { title: "AMBOSS – Clinical Knowledge", description: "Comprehensive medical knowledge with questions and flashcards", type: "link", url: "https://www.amboss.com" },

  // Tips
  { title: "Structured Study Plan", description: "Start 6 months before the exam. Plan at least 3–4 hours daily. Focus on Internal Medicine and Surgery.", type: "tip" },
  { title: "Priority Areas", description: "Internal Medicine and Surgery each make up 12% of the exam. These subjects have the most questions — prioritize them.", type: "tip" },
  { title: "Language Preparation", description: "German medical terminology is crucial. Use medical dictionaries and practice with German-speaking colleagues.", type: "tip" },
  { title: "Exam Strategy", description: "For unclear questions: eliminate obviously wrong answers. No negative marking — answer all questions.", type: "tip" },

  // By specialty
  { title: "Internal Medicine", description: "Harrison's Principles of Internal Medicine (English) or Herold Innere Medizin (German) — standard references", type: "guideline", specialty: "Innere Medizin" },
  { title: "Surgery", description: "Duale Reihe Chirurgie by Thieme — comprehensive and exam-relevant", type: "guideline", specialty: "Chirurgische Fächer" },
  { title: "Pediatrics", description: "ÖGKJ guidelines (Austrian Society for Pediatrics) available online", type: "guideline", specialty: "Kinder- und Jugendheilkunde" },
  { title: "Neurology", description: "ÖGN guidelines (Austrian Society for Neurology) — available online", type: "guideline", specialty: "Neurologie" },
  { title: "Psychiatry", description: "ÖGPP guidelines (Austrian Society for Psychiatry and Psychotherapy) for the most common conditions", type: "guideline", specialty: "Psychiatrie" },
];

const TYPE_ICONS = {
  link: <LinkIcon className="w-5 h-5" />,
  tip: <Lightbulb className="w-5 h-5" />,
  guideline: <BookOpen className="w-5 h-5" />,
};

const TYPE_STYLES = {
  link: { bg: "bg-[var(--mp-viridian)]/8", border: "border-[var(--mp-viridian)]/25", badge: "bg-[var(--mp-viridian)]/15 text-[var(--mp-viridian)]" },
  tip: { bg: "bg-[var(--mp-status-warning)]/6", border: "border-[var(--mp-status-warning)]/25", badge: "bg-[var(--mp-status-warning)]/15 text-[var(--mp-status-warning)]" },
  guideline: { bg: "bg-[var(--mp-surface-raised)]", border: "border-[var(--mp-border)]", badge: "bg-[var(--mp-fg-muted)]/10 text-[var(--mp-fg-muted)]" },
};

export default function MaterialsPage() {
  const [lang, setLangState] = useState<Lang>("de");
  const [userId, setUserId] = useState("");
  const [userName, setUserName] = useState("");
  const [activeSection, setActiveSection] = useState<"all" | "links" | "tips" | "specialty">("all");

  useEffect(() => {
    setLangState(getLang());
    const session = getStoredSession();
    if (session) {
      setUserId(session.user.id);
      setUserName(session.user.first_name);
    }
  }, []);

  const switchLang = (l: Lang) => {
    setLang(l);
    setLangState(l);
  };

  const resources = lang === "de" ? RESOURCES_DE : RESOURCES_EN;

  const filtered = resources.filter((r) => {
    if (activeSection === "all") return true;
    if (activeSection === "links") return r.type === "link";
    if (activeSection === "tips") return r.type === "tip";
    if (activeSection === "specialty") return r.type === "guideline";
    return true;
  });

  const tabs = [
    { key: "all", label: lang === "de" ? "Alle" : "All" },
    { key: "links", label: lang === "de" ? "Ressourcen" : "Resources" },
    { key: "tips", label: lang === "de" ? "Tipps" : "Tips" },
    { key: "specialty", label: lang === "de" ? "Fachgebiete" : "By Specialty" },
  ] as const;

  return (
    <div className="app-layout">
      <Sidebar lang={lang} userId={userId} userName={userName} />

      <main className="main-content safe-area-top safe-area-bottom bg-[var(--mp-surface-sunken)]">
        <div className="px-4 lg:px-8 pt-4 pb-2 flex items-center justify-between border-b border-[var(--mp-border)]">
          <Link href="/" className="text-[var(--mp-fg-subtle)] hover:text-[var(--mp-fg)] text-sm transition-colors">
            ← {lang === "de" ? "Zurück" : "Back"}
          </Link>
          <h1 className="text-base font-bold text-[var(--mp-fg)]">
            {lang === "de" ? "Lernmaterialien" : "Study Materials"}
          </h1>
          <div className="flex items-center gap-2">
            <ThemeToggle />
            <LanguageToggle lang={lang} onChange={switchLang} />
          </div>
        </div>

        <div className="px-4 lg:px-8 py-4 max-w-2xl mx-auto">
          {/* Hero */}
          <div className="card rounded-2xl p-5 mb-5">
            <div className="flex items-center gap-4">
              <div className="text-4xl">📚</div>
              <div>
                <h2 className="text-base font-semibold text-[var(--mp-fg)] mb-1">
                  {lang === "de" ? "Kenntnisprüfung Vorbereitung" : "Kenntnisprüfung Preparation"}
                </h2>
                <p className="text-sm text-[var(--mp-fg-subtle)]">
                  {lang === "de"
                    ? "Offizielle Ressourcen, Lernbuchtipps und Prüfungsstrategie"
                    : "Official resources, textbook recommendations, and exam strategy"}
                </p>
              </div>
            </div>
          </div>

          {/* Tabs */}
          <div className="flex gap-1 mb-5 bg-[var(--mp-surface-sunken)] p-1 rounded-xl border border-[var(--mp-border)]">
            {tabs.map((tab) => (
              <button
                key={tab.key}
                onClick={() => setActiveSection(tab.key)}
                className={`flex-1 py-2 text-xs font-medium rounded-xl transition-all ${
                  activeSection === tab.key
                    ? "bg-[var(--mp-viridian)] text-white shadow-sm"
                    : "text-[var(--mp-fg-subtle)] hover:text-[var(--mp-fg-muted)]"
                }`}
              >
                {tab.label}
              </button>
            ))}
          </div>

          {/* Resources list */}
          <div className="space-y-3 stagger">
            {filtered.map((r, i) => {
              const style = TYPE_STYLES[r.type];
              const specialty = r.specialty ? TOPIC_CONFIG[r.specialty] : null;
              return (
                <div key={i} className={`card-interactive rounded-2xl ${style.bg} border ${style.border} p-5`}>
                  <div className="flex items-start justify-between gap-3 mb-2">
                    <div className="flex items-center gap-2 flex-1 min-w-0">
                      <span className={`w-2 h-2 rounded-full flex-shrink-0 ${r.type === "link" ? "bg-[var(--mp-viridian)]" : r.type === "tip" ? "bg-[var(--mp-status-warning)]" : "bg-[var(--mp-fg-muted)]"}`} />
                      {specialty ? (
                        <span className="flex-shrink-0"><TopicIcon name={specialty.icon} className="w-5 h-5" /></span>
                      ) : (
                        <span className="flex-shrink-0">{TYPE_ICONS[r.type]}</span>
                      )}
                      <h3 className="text-sm font-semibold text-[var(--mp-fg)] truncate">{r.title}</h3>
                    </div>
                    <span className={`text-[10px] px-2 py-0.5 rounded font-medium flex-shrink-0 ${style.badge}`}>
                      {r.type === "link"
                        ? lang === "de" ? "Ressource" : "Resource"
                        : r.type === "tip"
                        ? lang === "de" ? "Tipp" : "Tip"
                        : lang === "de" ? "Fachgebiet" : "Specialty"}
                    </span>
                  </div>
                  <p className="text-sm text-[var(--mp-fg-muted)] leading-relaxed ml-8">{r.description}</p>
                  {r.url && (
                    <a
                      href={r.url}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="inline-flex items-center gap-1 mt-2 ml-8 text-xs text-[var(--mp-viridian)] hover:text-[var(--mp-accent-teal)] transition-colors"
                    >
                      {lang === "de" ? "Öffnen" : "Open"} ↗
                    </a>
                  )}
                </div>
              );
            })}
          </div>

          {/* Exam structure overview */}
          {(activeSection === "all" || activeSection === "specialty") && (
            <div className="mt-6">
              <h2 className="text-base font-semibold text-[var(--mp-fg)] mb-3">
                {lang === "de" ? "Prüfungsstruktur" : "Exam Structure"}
              </h2>
              <div className="grid grid-cols-2 gap-2">
                {[
                  { topic: "Innere Medizin", q: 30 },
                  { topic: "Chirurgische Fächer", q: 30 },
                  { topic: "Kinder- und Jugendheilkunde", q: 30 },
                  { topic: "Neurologie", q: 25 },
                  { topic: "Dermatologie und Venerologie", q: 25 },
                  { topic: "Frauenheilkunde/Gynäkologie", q: 25 },
                  { topic: "Notfall- und Intensivmedizin", q: 25 },
                  { topic: "Hals-Nasen-Ohrenheilkunde", q: 20 },
                  { topic: "Psychiatrie", q: 20 },
                  { topic: "Augenheilkunde", q: 20 },
                ].map(({ topic, q }) => {
                  const cfg = TOPIC_CONFIG[topic] || { icon: "📋", color: "#007B5F" };
                  const pct = Math.round((q / 250) * 100);
                  return (
                    <div key={topic} className="card p-3">
                      <div className="flex items-center gap-2 mb-1.5">
                        <TopicIcon name={cfg.icon} className="w-4 h-4" />
                        <span className="text-xs text-[var(--mp-fg)] font-medium flex-1 truncate">{topic}</span>
                      </div>
                      <div className="flex items-center gap-2">
                        <div className="flex-1 bg-[var(--mp-surface-sunken)] rounded-full h-1 overflow-hidden">
                          <div
                            className="h-full rounded-full"
                            style={{ width: `${pct}%`, backgroundColor: cfg.color }}
                          />
                        </div>
                        <span className="text-[10px] text-[var(--mp-fg-subtle)] font-mono w-8 text-right">{q}F</span>
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>
          )}
        </div>
      </main>

      <BottomNav lang={lang} userId={userId} />
    </div>
  );
}
