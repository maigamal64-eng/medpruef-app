"use client";

import { useState, useEffect } from "react";
import { getTopicConfig } from "@/lib/topics";
import { t } from "@/lib/i18n";
import type { MCQOption } from "@/lib/mcq";
import ImageLightbox from "@/components/ImageLightbox";
import { trackEvent } from "@/lib/tracker";
import TopicIcon from "@/components/TopicIcon";
import { Lightbulb, FileText, Highlighter } from "lucide-react";

type Lang = "de" | "en";

interface Question {
  id: number;
  topic: string;
  question: string;
  answer: string;
  explanation: string;
  difficulty: number;
  exam_dates: string[];
  options?: MCQOption[];
  n_correct?: number;
  image_url?: string;
  tags?: string[];
}

interface QuestionCardProps {
  question: Question;
  questionNumber: number;
  totalQuestions: number;
  lang: Lang;
  onAnswer?: (isCorrect: boolean) => void;
  imageUrl?: string;
}

const DE_MONTHS = [
  "Januar", "Februar", "März", "April", "Mai", "Juni",
  "Juli", "August", "September", "Oktober", "November", "Dezember",
];
const EN_MONTHS = [
  "January", "February", "March", "April", "May", "June",
  "July", "August", "September", "October", "November", "December",
];

function formatExamDate(d: string, lang: Lang): string {
  const parts = d.split("-");
  if (parts.length < 2) return d;
  const year = parts[0];
  const monthIdx = parseInt(parts[1], 10) - 1;
  const months = lang === "de" ? DE_MONTHS : EN_MONTHS;
  const monthName = months[monthIdx] ?? parts[1];
  return `${monthName} ${year}`;
}

function getNoteKey(id: number) {
  return `medpruef_notes_${id}`;
}

function getFavoritesKey() {
  return "medpruef_favorites";
}

function getFavorites(): number[] {
  if (typeof window === "undefined") return [];
  try {
    return JSON.parse(localStorage.getItem(getFavoritesKey()) || "[]");
  } catch {
    return [];
  }
}

function toggleFavorite(id: number): boolean {
  const favs = getFavorites();
  const idx = favs.indexOf(id);
  if (idx === -1) {
    favs.push(id);
    localStorage.setItem(getFavoritesKey(), JSON.stringify(favs));
    return true;
  } else {
    favs.splice(idx, 1);
    localStorage.setItem(getFavoritesKey(), JSON.stringify(favs));
    return false;
  }
}

export default function QuestionCard({
  question,
  questionNumber,
  totalQuestions,
  lang,
  onAnswer,
  imageUrl,
}: QuestionCardProps) {
  const config = getTopicConfig(question.topic);
  const [selectedIdxs, setSelectedIdxs] = useState<Set<number>>(new Set());
  const [submitted, setSubmitted] = useState(false);
  const [lightboxOpen, setLightboxOpen] = useState(false);
  const [note, setNote] = useState("");
  const [showNoteInput, setShowNoteInput] = useState(false);
  const [noteSaved, setNoteSaved] = useState(false);
  const [isFav, setIsFav] = useState(false);

  const [showAnswer, setShowAnswer] = useState(false);
  const [highlights, setHighlights] = useState<string[]>([]);
  const [showHighlightBtn, setShowHighlightBtn] = useState(false);
  const [highlightPos, setHighlightPos] = useState({ x: 0, y: 0 });
  const answered = submitted || showAnswer;
  const isOpenAnswer = !question.options || question.options.length < 2;
  const options: MCQOption[] = question.options || [];
  const nCorrect = question.n_correct ?? options.filter(o => o.correct).length;
  const isMulti = nCorrect >= 2;

  const highlightKey = (id: number) => `medpruef_highlights_${id}`;

  // Load persisted note, favorite, and highlight state on question change
  useEffect(() => {
    setSelectedIdxs(new Set());
    setSubmitted(false);
    setShowAnswer(false);
    setShowNoteInput(false);
    setNoteSaved(false);
    setShowHighlightBtn(false);
    if (typeof window !== "undefined") {
      const saved = localStorage.getItem(getNoteKey(question.id)) || "";
      setNote(saved);
      setShowNoteInput(!!saved);
      setIsFav(getFavorites().includes(question.id));
      try {
        const hl = JSON.parse(localStorage.getItem(highlightKey(question.id)) || "[]");
        setHighlights(Array.isArray(hl) ? hl : []);
      } catch { setHighlights([]); }
    }
  }, [question.id]);

  // Detect text selection on the question text for highlighting
  useEffect(() => {
    const handleMouseUp = () => {
      const sel = window.getSelection();
      if (!sel || sel.isCollapsed || !sel.toString().trim()) {
        setShowHighlightBtn(false);
        return;
      }
      const text = sel.toString().trim();
      if (text.length < 3 || text.length > 500) { setShowHighlightBtn(false); return; }
      // Check if selection is within the question text element
      const anchor = sel.anchorNode?.parentElement;
      if (!anchor?.closest("[data-question-text]")) { setShowHighlightBtn(false); return; }
      const range = sel.getRangeAt(0);
      const rect = range.getBoundingClientRect();
      setHighlightPos({ x: rect.left + rect.width / 2, y: rect.top - 8 });
      setShowHighlightBtn(true);
    };
    document.addEventListener("mouseup", handleMouseUp);
    return () => document.removeEventListener("mouseup", handleMouseUp);
  }, []);

  const handleHighlight = () => {
    const sel = window.getSelection();
    if (!sel || !sel.toString().trim()) return;
    const text = sel.toString().trim();
    const next = [...highlights, text];
    setHighlights(next);
    localStorage.setItem(highlightKey(question.id), JSON.stringify(next));
    sel.removeAllRanges();
    setShowHighlightBtn(false);
  };

  /** Render question text with highlights applied */
  const renderHighlightedText = (text: string) => {
    if (!highlights.length) return text;
    // Build a regex that matches any highlighted phrase (escaped)
    const escaped = highlights.map(h => h.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")).filter(Boolean);
    if (!escaped.length) return text;
    const regex = new RegExp(`(${escaped.join("|")})`, "gi");
    const parts = text.split(regex);
    return parts.map((part, i) => {
      const isHighlighted = highlights.some(h => h.toLowerCase() === part.toLowerCase());
      return isHighlighted ? (
        <mark key={i} className="rounded px-0.5" style={{ backgroundColor: 'rgba(250, 204, 21, 0.5)' }}>{part}</mark>
      ) : (
        <span key={i}>{part}</span>
      );
    });
  };

  // Keyboard shortcuts for answer selection
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      // Don't trigger when typing in an input/textarea
      if (e.target instanceof HTMLInputElement || e.target instanceof HTMLTextAreaElement) return;

      const key = e.key.toLowerCase();

      // A-E to select answer options
      if (!answered && options.length > 0) {
        const idx = key.charCodeAt(0) - 97; // 'a' = 0, 'b' = 1, etc.
        if (idx >= 0 && idx < options.length) {
          e.preventDefault();
          if (isMulti) {
            // Toggle checkbox selection
            setSelectedIdxs(prev => {
              const next = new Set(prev);
              if (next.has(idx)) next.delete(idx);
              else next.add(idx);
              return next;
            });
          } else {
            // Single select — immediately select and grade
            setSelectedIdxs(new Set([idx]));
            setSubmitted(true);
            onAnswer?.(options[idx].correct);
          }
        }
      }

      // F to toggle bookmark
      if (key === 'f' && !e.metaKey && !e.ctrlKey) {
        e.preventDefault();
        handleToggleFav();
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [answered, options, isMulti, onAnswer]);

  const handleSelect = (idx: number) => {
    if (answered) return;
    if (isMulti) {
      // Checkbox behavior: toggle the index
      setSelectedIdxs(prev => {
        const next = new Set(prev);
        if (next.has(idx)) next.delete(idx); else next.add(idx);
        return next;
      });
    } else {
      // Radio behavior: select + immediately grade
      setSelectedIdxs(new Set([idx]));
      setSubmitted(true);
      onAnswer?.(options[idx].correct);
    }
  };

  const handleSubmitMulti = () => {
    if (answered || selectedIdxs.size === 0) return;
    setSubmitted(true);
    // Strict grading: selected set must equal correct set exactly
    const correctIdxs = new Set(options.map((o, i) => o.correct ? i : -1).filter(i => i >= 0));
    const isCorrect = selectedIdxs.size === correctIdxs.size
      && [...selectedIdxs].every(i => correctIdxs.has(i));
    onAnswer?.(isCorrect);
  };

  const handleSaveNote = () => {
    localStorage.setItem(getNoteKey(question.id), note);
    setNoteSaved(true);
    setTimeout(() => setNoteSaved(false), 2000);
  };

  const handleToggleFav = () => {
    setIsFav(toggleFavorite(question.id));
    trackEvent("bookmark", { questionId: question.id, topic: question.topic });
  };

  const getOptionStyle = (idx: number, opt: MCQOption): string => {
    const base =
      "w-full text-left px-4 py-3 min-h-[56px] text-sm font-medium transition-all duration-200 flex items-center gap-3";
    const isSelected = selectedIdxs.has(idx);

    if (!answered) {
      return `${base} ${isSelected ? "bg-[#007B5F]/8 border border-[#007B5F]/60 text-[#1A2B3C] rounded-2xl" : "bg-[#F7F9FC] rounded-2xl border border-transparent hover:border-[#007B5F]/30 hover:bg-white hover:shadow-[var(--shadow-card)] text-[#1A2B3C]"} active:scale-[0.99]`;
    }

    if (isSelected) {
      if (opt.correct) {
        return `${base} bg-[#00A896]/12 border border-[#00A896] border-l-4 border-l-[#00A896] text-[#00A896] rounded-2xl animate-answer-correct`;
      } else {
        return `${base} bg-[#D64545]/12 border border-[#D64545] text-[#D64545] rounded-2xl animate-answer-wrong`;
      }
    }
    if (opt.correct) {
      return `${base} bg-[#00A896]/8 border border-[#00A896]/60 border-l-4 border-l-[#00A896] text-[#00A896]/80 rounded-2xl`;
    }
    return `${base} bg-[#FFFFFF] border border-[#E4E9F0]/40 text-[#A0AEC0] opacity-50 rounded-2xl`;
  };

  const getOptionIcon = (idx: number, opt: MCQOption): string => {
    const isSelected = selectedIdxs.has(idx);
    if (!answered) {
      return isSelected
        ? (isMulti ? "☑" : "●")
        : (isMulti ? "☐" : String.fromCharCode(65 + idx));
    }
    if (isSelected && opt.correct) return "✓";
    if (isSelected && !opt.correct) return "✗";
    if (opt.correct) return "✓";
    return String.fromCharCode(65 + idx);
  };

  const effectiveImageUrl = imageUrl ?? question.image_url;

  return (
    <>
      <div className="card rounded-2xl p-6 md:p-8 animate-slide-up">
        {/* Top row: topic badge + question counter + bookmark */}
        <div className="flex items-center justify-between mb-4">
          <span
            className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-xl text-xs font-medium"
            style={{ backgroundColor: `${config.color}18`, color: config.color }}
          >
            <TopicIcon name={config.icon} className="w-4 h-4" />
            <span className="max-w-[140px] truncate">{question.topic}</span>
          </span>
          <div className="flex items-center gap-2">
            <button
              onClick={handleToggleFav}
              title={isFav ? t("bookmarked", lang) : t("bookmark", lang)}
              className={`text-base transition-colors ${isFav ? "text-[#F4A261] animate-bookmark" : "text-[#E4E9F0] hover:text-[#F4A261]"}`}
            >
              {isFav ? "★" : "☆"}
            </button>
            <span className="text-xs text-[#A0AEC0] font-mono">
              {t("q", lang)}{questionNumber} / {totalQuestions}
            </span>
          </div>
        </div>

        {/* Tags — shown if available */}
        {question.tags && question.tags.length > 0 && (
          <div className="flex flex-wrap gap-1.5 mb-4">
            {question.tags.map((tag) => (
              <span
                key={tag}
                className="text-[10px] px-2 py-0.5 rounded-full border border-[#007B5F]/30 bg-[#007B5F]/8 text-[#007B5F] font-medium"
              >
                {tag}
              </span>
            ))}
          </div>
        )}

        {/* Optional image */}
        {effectiveImageUrl && (
          <button
            onClick={() => setLightboxOpen(true)}
            className="block w-full mb-4 rounded overflow-hidden border border-[#E4E9F0] hover:border-[#007B5F]/40 transition-colors group"
            aria-label="Bild vergrößern"
          >
            <img
              src={effectiveImageUrl}
              alt="Medizinische Abbildung"
              className="w-full max-h-64 object-contain bg-[#FFFFFF] rounded-sm"
            />
            <p className="text-[10px] text-[#A0AEC0] text-center py-1 bg-[#FFFFFF] group-hover:text-[#4A5568] transition-colors">
              {lang === "de" ? "Zum Vergrößern klicken" : "Click to enlarge"}
            </p>
          </button>
        )}

        {/* Question text (selectable for highlighting) */}
        <p className="text-lg md:text-xl leading-relaxed font-medium text-[#001B3D] mb-4" style={{ userSelect: 'text' }} data-question-text>
          {renderHighlightedText(question.question)}
        </p>

        {/* Floating highlight button — appears on text selection */}
        {showHighlightBtn && (
          <div
            className="fixed z-50 animate-scale-in"
            style={{ left: highlightPos.x, top: highlightPos.y, transform: "translate(-50%, -100%)" }}
          >
            <button
              onMouseDown={(e) => { e.preventDefault(); handleHighlight(); }}
              className="flex items-center gap-1.5 bg-[#001B3D] text-white text-xs font-medium px-3 py-1.5 rounded-lg shadow-lg hover:bg-[#003A8C] transition-colors"
            >
              <Highlighter className="w-3.5 h-3.5" />
              Highlight
            </button>
          </div>
        )}

        {/* Exam date chips */}
        {question.exam_dates && question.exam_dates.length > 0 && (
          <div className="mb-5 flex flex-wrap gap-1.5">
            {question.exam_dates.slice(0, 5).map((d) => (
              <span
                key={d}
                className="text-[10px] bg-[#F7F9FC] text-[#A0AEC0] px-2 py-0.5 rounded border border-[#E4E9F0] font-mono"
              >
                {formatExamDate(d, lang)}
              </span>
            ))}
          </div>
        )}

        {/* MCQ Options */}
        <div className="space-y-3">
          {isOpenAnswer && !showAnswer && (
            <button
              onClick={() => {
                setShowAnswer(true);
                onAnswer?.(true);
              }}
              className="w-full p-4 rounded-lg border border-[#007B5F]/30 bg-[#007B5F]/5 hover:bg-[#007B5F]/10 transition-all text-center"
            >
              <span className="text-[#007B5F] font-medium">
                {lang === "de" ? "Antwort anzeigen" : "Show Answer"}
              </span>
            </button>
          )}
          {isOpenAnswer && showAnswer && (
            <div className="p-4 rounded-lg border border-[#007B5F]/30 bg-[#007B5F]/10">
              <p className="text-xs text-[#007B5F] uppercase tracking-wider mb-1 font-medium">
                {lang === "de" ? "Richtige Antwort" : "Correct Answer"}
              </p>
              <p className="text-[#1A2B3C] text-sm leading-relaxed">{question.answer}</p>
            </div>
          )}
          {!isOpenAnswer && isMulti && !answered && (
            <p className="text-[11px] text-[#F4A261] font-semibold mb-1">
              ⓘ {lang === "de" ? `Mehrfachantwort (${nCorrect} richtig)` : `Multi-select (${nCorrect} correct)`}
            </p>
          )}
          {!isOpenAnswer && options.map((opt, idx) => {
            const isSelected = selectedIdxs.has(idx);
            return (
              <button
                key={idx}
                onClick={() => handleSelect(idx)}
                disabled={answered}
                className={getOptionStyle(idx, opt)}
              >
                <span
                  className={`w-9 h-9 rounded-xl flex-shrink-0 flex items-center justify-center text-sm font-bold border font-mono ${
                    !answered
                      ? isSelected
                        ? "bg-[#007B5F]/15 border-[#007B5F] text-[#007B5F]"
                        : "bg-[#F7F9FC] border-[#E4E9F0] text-[#4A5568]"
                      : isSelected && opt.correct
                      ? "bg-[#00A896]/20 border-[#00A896] text-[#00A896]"
                      : isSelected && !opt.correct
                      ? "bg-[#D64545]/20 border-[#D64545] text-[#D64545]"
                      : opt.correct
                      ? "bg-[#00A896]/10 border-[#00A896]/50 text-[#00A896]"
                      : "bg-[#F7F9FC] border-[#E4E9F0]/40 text-[#A0AEC0]"
                  }`}
                >
                  {getOptionIcon(idx, opt)}
                </span>
                <div className="flex-1 flex flex-col items-start gap-1.5">
                  {opt.image_url && (
                    <img src={opt.image_url} alt="" className="max-h-24 object-contain rounded border border-[#E4E9F0]" />
                  )}
                  <span>{opt.text}</span>
                </div>
              </button>
            );
          })}
          {!isOpenAnswer && isMulti && !answered && (
            <button
              onClick={handleSubmitMulti}
              disabled={selectedIdxs.size === 0}
              className="w-full mt-2 py-3 bg-[#F4A261] hover:bg-[#FFC97A] text-[#1A0E00] rounded font-bold text-sm transition-all active:scale-[0.98] disabled:opacity-40 disabled:cursor-not-allowed"
            >
              {lang === "de" ? "Antwort prüfen" : "Check Answer"}
            </button>
          )}
        </div>

        {/* Explanation — shown after answering */}
        {answered && question.explanation && (
          <div className="mt-4 bg-[#F4A261]/6 border border-[#F4A261]/25 border-l-4 border-l-[#007B5F] rounded p-4 animate-slide-reveal">
            <p className="text-[10px] uppercase tracking-wider text-[#F4A261] font-semibold mb-2">
              <Lightbulb className="w-4 h-4 inline" /> {t("explanation", lang)}
            </p>
            <p className="text-[#4A5568] leading-relaxed text-sm">{question.explanation}</p>
          </div>
        )}

        {/* Notes section — visible after answering */}
        {answered && (
          <div className="mt-3 animate-fade-in">
            {!showNoteInput ? (
              <button
                onClick={() => setShowNoteInput(true)}
                className="flex items-center gap-1.5 text-xs text-[#A0AEC0] hover:text-[#4A5568] transition-colors"
              >
                <FileText className="w-4 h-4" />
                <span>{t("add_note", lang)}</span>
              </button>
            ) : (
              <div className="bg-[#FFFFFF] border border-[#E4E9F0] rounded-xl shadow-[var(--shadow-xs)] p-3">
                <p className="text-[10px] uppercase tracking-wider text-[#A0AEC0] font-semibold mb-2">
                  <FileText className="w-3 h-3 inline" /> {t("add_note", lang)}
                </p>
                <textarea
                  value={note}
                  onChange={(e) => setNote(e.target.value)}
                  placeholder={t("note_placeholder", lang)}
                  rows={3}
                  className="w-full bg-[#F7F9FC] border border-[#E4E9F0] rounded px-3 py-2 text-sm text-[#1A2B3C] placeholder-[#A0AEC0] resize-none focus:outline-none focus:border-[#007B5F]/50 font-sans"
                />
                <div className="flex items-center justify-between mt-2">
                  <button
                    onClick={handleSaveNote}
                    className="px-3 py-1.5 bg-[#007B5F]/15 border border-[#007B5F]/30 text-[#007B5F] text-xs font-medium rounded hover:bg-[#007B5F]/25 transition-colors"
                  >
                    {noteSaved ? `✓ ${t("note_saved", lang)}` : t("save_note", lang)}
                  </button>
                  {note.length === 0 && (
                    <button
                      onClick={() => setShowNoteInput(false)}
                      className="text-xs text-[#A0AEC0] hover:text-[#4A5568] transition-colors"
                    >
                      {t("cancel", lang)}
                    </button>
                  )}
                </div>
              </div>
            )}
          </div>
        )}
      </div>

      {/* Lightbox */}
      {lightboxOpen && effectiveImageUrl && (
        <ImageLightbox
          src={effectiveImageUrl}
          alt="Medizinische Abbildung"
          onClose={() => setLightboxOpen(false)}
        />
      )}
    </>
  );
}
