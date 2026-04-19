"use client";

import { useEffect, useState } from "react";
import { Star, Bot, FileText, Flag, Save, X } from "lucide-react";
import { t } from "@/lib/i18n";
import { trackEvent } from "@/lib/tracker";
import AIChatAssistant from "@/components/AIChatAssistant";
import ReportQuestionModal from "@/components/ReportQuestionModal";
import type { MCQOption } from "@/lib/mcq";

type Lang = "de" | "en";

interface Question {
  id: number;
  topic: string;
  question: string;
  answer: string;
  explanation: string;
  options?: MCQOption[];
}

interface Props {
  question: Question;
  lang: Lang;
  userTier?: string;
  /** "rail" = vertical icon column for desktop side panels; "row" = horizontal mobile bar */
  layout?: "rail" | "row";
  /** Disable AI / notes until question has been answered (matches old quiz behaviour) */
  unlockAfterAnswer?: boolean;
  answered?: boolean;
}

const FAV_KEY = "medpruef_favorites";

function readFavs(): number[] {
  if (typeof window === "undefined") return [];
  try {
    return JSON.parse(localStorage.getItem(FAV_KEY) || "[]");
  } catch {
    return [];
  }
}

function noteKey(id: number) {
  return `medpruef_notes_${id}`;
}

export default function QuestionActions({
  question,
  lang,
  userTier = "free",
  layout = "rail",
  unlockAfterAnswer = false,
  answered = true,
}: Props) {
  const [isFav, setIsFav] = useState(false);
  const [showAIChat, setShowAIChat] = useState(false);
  const [showReport, setShowReport] = useState(false);
  const [showNotePanel, setShowNotePanel] = useState(false);
  const [note, setNote] = useState("");
  const [noteSaved, setNoteSaved] = useState(false);

  // Sync state with current question
  useEffect(() => {
    if (typeof window === "undefined") return;
    setIsFav(readFavs().includes(question.id));
    const saved = localStorage.getItem(noteKey(question.id)) || "";
    setNote(saved);
    setShowNotePanel(false);
    setNoteSaved(false);
    setShowAIChat(false);
    setShowReport(false);
  }, [question.id]);

  const toggleFav = () => {
    const favs = readFavs();
    const idx = favs.indexOf(question.id);
    if (idx === -1) favs.push(question.id);
    else favs.splice(idx, 1);
    localStorage.setItem(FAV_KEY, JSON.stringify(favs));
    setIsFav(idx === -1);
    trackEvent("bookmark", { questionId: question.id, topic: question.topic });
  };

  const saveNote = () => {
    localStorage.setItem(noteKey(question.id), note);
    setNoteSaved(true);
    setTimeout(() => setNoteSaved(false), 1600);
  };

  const isLocked = unlockAfterAnswer && !answered;
  const aiLocked = isLocked;
  const noteLocked = isLocked;

  const buttons = [
    {
      key: "fav",
      label: isFav ? t("bookmarked", lang) : t("bookmark", lang),
      icon: <Star className={`w-5 h-5 ${isFav ? "fill-[var(--mp-status-warning)] text-[var(--mp-status-warning)]" : ""}`} />,
      active: isFav,
      activeClass: "border-[var(--mp-status-warning)]/40 bg-[var(--mp-status-warning)]/10 text-[var(--mp-status-warning)]",
      onClick: toggleFav,
      locked: false,
    },
    {
      key: "ai",
      label: lang === "de" ? "KI-Erklärung" : "AI Explain",
      icon: <Bot className="w-5 h-5" />,
      active: showAIChat,
      activeClass: "border-[var(--mp-cta-blue)]/40 bg-[var(--mp-cta-blue)]/10 text-[var(--mp-cta-blue)]",
      onClick: () => !aiLocked && setShowAIChat(true),
      locked: aiLocked,
    },
    {
      key: "note",
      label: t("add_note", lang),
      icon: <FileText className="w-5 h-5" />,
      active: showNotePanel || !!note,
      activeClass: "border-[var(--mp-accent-teal)]/40 bg-[var(--mp-accent-teal)]/10 text-[var(--mp-accent-teal)]",
      onClick: () => !noteLocked && setShowNotePanel((v) => !v),
      locked: noteLocked,
    },
    {
      key: "report",
      label: lang === "de" ? "Melden" : "Report",
      icon: <Flag className="w-5 h-5" />,
      active: showReport,
      activeClass: "border-[var(--mp-error)]/40 bg-[var(--mp-error)]/10 text-[var(--mp-error)]",
      onClick: () => setShowReport(true),
      locked: false,
    },
  ];

  const baseBtn =
    "group relative flex items-center justify-center w-12 h-12 rounded-2xl border transition-all active:scale-95 disabled:opacity-30 disabled:cursor-not-allowed";

  if (layout === "row") {
    return (
      <>
        <div className="flex items-center justify-around gap-2 w-full">
          {buttons.map((b) => (
            <button
              key={b.key}
              onClick={b.onClick}
              disabled={b.locked}
              title={b.label}
              className={`${baseBtn} ${
                b.active
                  ? b.activeClass
                  : "border-[var(--mp-border)] text-[var(--mp-fg-muted)] hover:border-[var(--mp-viridian)]/40 hover:text-[var(--mp-viridian)]"
              }`}
            >
              {b.icon}
            </button>
          ))}
        </div>

        {/* Inline note panel under the row when expanded */}
        {showNotePanel && (
          <NotePanel
            note={note}
            setNote={setNote}
            saveNote={saveNote}
            noteSaved={noteSaved}
            onClose={() => setShowNotePanel(false)}
            lang={lang}
          />
        )}

        <AIChatAssistant
          open={showAIChat}
          onClose={() => setShowAIChat(false)}
          lang={lang}
          questionId={question.id}
          questionText={question.question}
          answerText={question.answer}
          explanation={question.explanation}
          topic={question.topic}
          options={(question.options || []).map((o) => ({ text: o.text, correct: o.correct }))}
          userTier={userTier}
        />
        <ReportQuestionModal
          open={showReport}
          onClose={() => setShowReport(false)}
          lang={lang}
          questionId={question.id}
          questionText={question.question}
          explanation={question.explanation}
          topic={question.topic}
        />
      </>
    );
  }

  // Rail layout (vertical)
  return (
    <>
      <div className="flex flex-col items-center gap-3 sticky top-24">
        {buttons.map((b) => (
          <button
            key={b.key}
            onClick={b.onClick}
            disabled={b.locked}
            title={b.label}
            className={`${baseBtn} ${
              b.active
                ? b.activeClass
                : "border-[var(--mp-border)] bg-[var(--mp-surface-raised)] text-[var(--mp-fg-muted)] hover:border-[var(--mp-viridian)]/40 hover:text-[var(--mp-viridian)] hover:shadow-[var(--shadow-card)]"
            }`}
          >
            {b.icon}
            <span className="absolute right-full mr-2 top-1/2 -translate-y-1/2 px-2 py-1 rounded bg-[var(--mp-fg)] text-[var(--mp-fg-inverse)] text-[10px] font-medium opacity-0 group-hover:opacity-100 pointer-events-none transition-opacity whitespace-nowrap">
              {b.label}
            </span>
          </button>
        ))}

        {showNotePanel && (
          <div className="absolute right-full mr-3 top-0 w-72">
            <NotePanel
              note={note}
              setNote={setNote}
              saveNote={saveNote}
              noteSaved={noteSaved}
              onClose={() => setShowNotePanel(false)}
              lang={lang}
            />
          </div>
        )}
      </div>

      <AIChatAssistant
        open={showAIChat}
        onClose={() => setShowAIChat(false)}
        lang={lang}
        questionId={question.id}
        questionText={question.question}
        answerText={question.answer}
        explanation={question.explanation}
        topic={question.topic}
        options={(question.options || []).map((o) => ({ text: o.text, correct: o.correct }))}
        userTier={userTier}
      />
      <ReportQuestionModal
        open={showReport}
        onClose={() => setShowReport(false)}
        lang={lang}
        questionId={question.id}
        questionText={question.question}
        explanation={question.explanation}
        topic={question.topic}
      />
    </>
  );
}

function NotePanel({
  note,
  setNote,
  saveNote,
  noteSaved,
  onClose,
  lang,
}: {
  note: string;
  setNote: (v: string) => void;
  saveNote: () => void;
  noteSaved: boolean;
  onClose: () => void;
  lang: Lang;
}) {
  return (
    <div className="w-full mt-3 bg-[var(--mp-surface-raised)] border border-[var(--mp-border)] rounded-2xl shadow-[var(--shadow-card)] p-3 animate-fade-in">
      <div className="flex items-center justify-between mb-2">
        <p className="text-[11px] uppercase tracking-wider text-[var(--mp-fg-subtle)] font-semibold flex items-center gap-1">
          <FileText className="w-3 h-3" /> {t("add_note", lang)}
        </p>
        <button onClick={onClose} className="text-[var(--mp-fg-subtle)] hover:text-[var(--mp-fg-muted)]">
          <X className="w-3.5 h-3.5" />
        </button>
      </div>
      <textarea
        value={note}
        onChange={(e) => setNote(e.target.value)}
        placeholder={t("note_placeholder", lang)}
        rows={4}
        className="w-full bg-[var(--mp-surface-sunken)] border border-[var(--mp-border)] rounded-lg px-3 py-2 text-sm text-[var(--mp-fg)] placeholder-[var(--mp-fg-subtle)] resize-none focus:outline-none focus:border-[var(--mp-viridian)]/50"
      />
      <button
        onClick={saveNote}
        className="mt-2 w-full inline-flex items-center justify-center gap-1.5 px-3 py-1.5 bg-[var(--mp-viridian)]/15 border border-[var(--mp-viridian)]/30 text-[var(--mp-viridian)] text-xs font-semibold rounded-lg hover:bg-[var(--mp-viridian)]/25 transition-colors"
      >
        <Save className="w-3.5 h-3.5" />
        {noteSaved ? `✓ ${t("note_saved", lang)}` : t("save_note", lang)}
      </button>
    </div>
  );
}
