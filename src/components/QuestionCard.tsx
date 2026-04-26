"use client";

import { useState, useEffect, useRef, type KeyboardEvent as ReactKeyboardEvent } from "react";
import { authFetch as fetch } from "@/lib/authFetch";
import { getTopicConfig } from "@/lib/topics";
import { t } from "@/lib/i18n";
import { shouldIgnoreGlobalKey } from "@/lib/keyboard-guard";
import type { MCQOption } from "@/lib/mcq";
import ImageLightbox from "@/components/ImageLightbox";
import { trackEvent } from "@/lib/tracker";
import TopicIcon from "@/components/TopicIcon";
import { cleanExplanation } from "@/lib/explanation";
import { Lightbulb, FileText, Bot, Flag, CheckCircle2, BookOpen, Languages, Info } from "lucide-react";
import AIChatAssistant from "@/components/AIChatAssistant";
import TranslateButton from "@/components/TranslateButton";
import QuestionReportForm from "@/components/question/QuestionReportForm";
import QuestionNotesPanel, { getNoteKey, saveNoteToStorage } from "@/components/question/QuestionNotesPanel";
import QuestionExplanation from "@/components/question/QuestionExplanation";
import {
  useQuestionHighlights,
  HighlightSelectionButton,
} from "@/components/question/QuestionHighlightLayer";

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
  image_urls?: string[];
  tags?: string[];
}

interface QuestionCardProps {
  question: Question;
  questionNumber: number;
  totalQuestions: number;
  lang: Lang;
  onAnswer?: (isCorrect: boolean) => void;
  imageUrl?: string;
  /** Hide inline explanation (used when split-view shows explanation separately) */
  hideExplanation?: boolean;
  /** User tier for feature gating */
  userTier?: string;
  /** Session `user.role` — must be passed alongside `userTier` so admins
   * whose tier is `'free'` / `null` still get Pro-level feature access
   * (bookmarks, AI chat, translate). Added 2026-04-24. */
  userRole?: string;
  /** Hide inline favorite/flag/note/report/AI buttons — used when an external QuestionActions rail is rendered */
  hideActions?: boolean;
  /** Controlled-mode: pre-populate selection on (re)mount or question change. */
  initialSelected?: number[];
  /** Controlled-mode: render in answered/result state from the start (used for review). */
  initiallyAnswered?: boolean;
  /** Controlled-mode: fired alongside onAnswer when the user finalizes a selection — gives the parent the actual indices so external state (e.g. an exam answers dict) can be updated. */
  onCommit?: (selected: number[], isCorrect: boolean) => void;
  /** Hide the "+10 XP · Correct!" feedback strip (used by exam mode where there is no XP per-question). */
  hideFeedbackStrip?: boolean;
  /** Exam simulation mode: selections are tracked but never graded.
   *  Hides "Antwort prüfen" button, auto-commits on every toggle,
   *  and never reveals correct/wrong coloring. */
  examMode?: boolean;
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
  hideExplanation = false,
  userTier = "free",
  userRole = "user",
  hideActions = false,
  initialSelected,
  initiallyAnswered = false,
  onCommit,
  hideFeedbackStrip = false,
  examMode = false,
}: QuestionCardProps) {
  const config = getTopicConfig(question.topic);
  const [selectedIdxs, setSelectedIdxs] = useState<Set<number>>(
    () => new Set(initialSelected ?? [])
  );
  const [submitted, setSubmitted] = useState(initiallyAnswered);
  const [lightboxSrc, setLightboxSrc] = useState<string | null>(null);
  const [note, setNote] = useState("");
  const [noteSaved, setNoteSaved] = useState(false);
  const [isFav, setIsFav] = useState(false);

  const [showAnswer, setShowAnswer] = useState(false);
  const [showAIChat, setShowAIChat] = useState(false);
  // Flag/edit report modal
  const [showReportForm, setShowReportForm] = useState(false);
  const [suggestionSubmitted, setSuggestionSubmitted] = useState(false);
  const [explanationRating, setExplanationRating] = useState<1 | -1 | null>(null);

  // Text-selection → highlight layer (extracted to its own hook).
  const highlightApi = useQuestionHighlights(question.id);

  // Quiz-B tabbed post-answer context. Tabs: erklaerung | ki | notizen | uebersetzen | quelle
  type PostAnswerTab = "erklaerung" | "ki" | "notizen" | "uebersetzen" | "quelle";
  const [activeTab, setActiveTab] = useState<PostAnswerTab>("erklaerung");
  const tabRefs = useRef<Partial<Record<PostAnswerTab, HTMLButtonElement | null>>>({});
  const answered = submitted || showAnswer;
  const isOpenAnswer = !question.options || question.options.length < 2;
  const options: MCQOption[] = question.options || [];
  const nCorrect = question.n_correct ?? options.filter(o => o.correct).length;
  const isMulti = nCorrect >= 2;

  // Load persisted note + favorite state on question change
  useEffect(() => {
    setSelectedIdxs(new Set(initialSelected ?? []));
    setSubmitted(initiallyAnswered);
    setShowAnswer(false);
    setShowAIChat(false);
    setNoteSaved(false);
    setShowReportForm(false);
    setSuggestionSubmitted(false);
    setExplanationRating(null);
    setActiveTab("erklaerung");
    if (typeof window !== "undefined") {
      const saved = localStorage.getItem(getNoteKey(question.id)) || "";
      setNote(saved);
      setIsFav(getFavorites().includes(question.id));
    }
    // initialSelected/initiallyAnswered are intentionally read at render time but
    // only re-applied on question change — adding them as deps would wipe user
    // interactions on every parent re-render.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [question.id]);

  // Keyboard shortcuts for answer selection
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      // Don't trigger when typing in an input/textarea OR anywhere
      // inside a dialog overlay (FeedbackWidget, Flag modal, trust
      // dialog, etc.). The previous narrow `instanceof` check missed
      // portaled inputs and let typing in the FeedbackWidget close
      // the dialog by accidentally selecting an answer (review-
      // 2026-04-26-A1). The shared helper walks the DOM tree so a
      // portaled input whose event target is a slot wrapper still
      // resolves correctly.
      if (shouldIgnoreGlobalKey(e)) return;

      const key = e.key.toLowerCase();

      // A-E to select answer options
      if (!answered && options.length > 0) {
        const idx = key.charCodeAt(0) - 97; // 'a' = 0, 'b' = 1, etc.
        if (idx >= 0 && idx < options.length) {
          e.preventDefault();
          if (examMode) {
            // Exam mode: select/toggle without grading
            if (isMulti) {
              setSelectedIdxs(prev => {
                const next = new Set(prev);
                if (next.has(idx)) next.delete(idx); else next.add(idx);
                onCommit?.([...next].sort((a, b) => a - b), false);
                return next;
              });
            } else {
              setSelectedIdxs(new Set([idx]));
              onCommit?.([idx], false);
            }
          } else if (isMulti) {
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
            onCommit?.([idx], options[idx].correct);
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
  }, [answered, options, isMulti, onAnswer, onCommit]);

  const handleSelect = (idx: number) => {
    if (answered) return;
    if (examMode) {
      // Exam mode: select/toggle without grading, auto-commit
      if (isMulti) {
        setSelectedIdxs(prev => {
          const next = new Set(prev);
          if (next.has(idx)) next.delete(idx); else next.add(idx);
          onCommit?.([...next].sort((a, b) => a - b), false);
          return next;
        });
      } else {
        setSelectedIdxs(new Set([idx]));
        onCommit?.([idx], false);
      }
      return;
    }
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
      onCommit?.([idx], options[idx].correct);
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
    onCommit?.([...selectedIdxs].sort((a, b) => a - b), isCorrect);
  };

  const handleSaveNote = () => {
    saveNoteToStorage(question.id, note);
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
      return `${base} ${isSelected ? "bg-[var(--mp-viridian)]/8 border border-[var(--mp-viridian)]/60 text-[var(--mp-fg)] rounded-2xl" : "bg-[var(--mp-surface-sunken)] rounded-2xl border border-transparent hover:border-[var(--mp-viridian)]/30 hover:bg-white hover:shadow-[var(--shadow-card)] text-[var(--mp-fg)]"} active:scale-[0.99]`;
    }

    if (isSelected) {
      if (opt.correct) {
        return `${base} bg-[var(--mp-accent-teal)]/12 border border-[var(--mp-accent-teal)] border-l-4 border-l-[var(--mp-accent-teal)] text-[var(--mp-accent-teal)] rounded-2xl animate-answer-correct`;
      } else {
        return `${base} bg-[var(--mp-error)]/12 border border-[var(--mp-error)] text-[var(--mp-error)] rounded-2xl animate-answer-wrong`;
      }
    }
    if (opt.correct) {
      return `${base} bg-[var(--mp-accent-teal)]/8 border border-[var(--mp-accent-teal)]/60 border-l-4 border-l-[var(--mp-accent-teal)] text-[var(--mp-accent-teal)]/80 rounded-2xl`;
    }
    return `${base} bg-[var(--mp-surface-raised)] border border-[var(--mp-border)]/40 text-[var(--mp-fg-subtle)] opacity-50 rounded-2xl`;
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

  // Per Mohamed: explanation images currently appear together with the question
  // image — they should only show up AFTER answering. The Anki importer dumps
  // question, explanation, and choice images all into `image_urls`, so the
  // best heuristic without a schema change is:
  //   - image_urls[0] = the question image (always shown)
  //   - the rest, minus any URL that is already a choice image, are extras
  //     that we treat as explanation images.
  const choiceImageUrls = new Set(
    options.map((o) => o.image_url).filter((u): u is string => !!u)
  );
  const extraImages = (question.image_urls ?? [])
    .slice(1)
    .filter((u) => !!u && u !== effectiveImageUrl && !choiceImageUrls.has(u));

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
            {!hideActions && !suggestionSubmitted && (
              <button
                onClick={() => setShowReportForm(true)}
                title={lang === "de" ? "Problem melden" : "Report issue"}
                className={`transition-colors ${showReportForm ? "text-[var(--mp-error)]" : "text-[var(--mp-border)] hover:text-[var(--mp-error)]"}`}
              >
                <Flag className="w-4 h-4" />
              </button>
            )}
            {!hideActions && suggestionSubmitted && (
              <CheckCircle2 className="w-4 h-4 text-[var(--mp-accent-teal)]" />
            )}
            {!hideActions && (
              <button
                onClick={handleToggleFav}
                title={isFav ? t("bookmarked", lang) : t("bookmark", lang)}
                className={`text-base transition-colors ${isFav ? "text-[var(--mp-status-warning)] animate-bookmark" : "text-[var(--mp-border)] hover:text-[var(--mp-status-warning)]"}`}
              >
                {isFav ? "★" : "☆"}
              </button>
            )}
            <span className="text-xs text-[var(--mp-fg-subtle)] font-mono">
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
                className="text-[10px] px-2 py-0.5 rounded-full border border-[var(--mp-viridian)]/30 bg-[var(--mp-viridian)]/8 text-[var(--mp-viridian)] font-medium"
              >
                {tag}
              </span>
            ))}
          </div>
        )}

        {/* Optional image */}
        {effectiveImageUrl && (
          <button
            onClick={() => setLightboxSrc(effectiveImageUrl)}
            className="block w-full mb-4 rounded overflow-hidden border border-[var(--mp-border)] hover:border-[var(--mp-viridian)]/40 transition-colors group"
            aria-label={lang === "de" ? "Bild vergrößern" : "Enlarge image"}
          >
            <img
              src={effectiveImageUrl}
              alt={lang === "de" ? "Medizinische Abbildung" : "Medical illustration"}
              className="w-full max-h-64 object-contain bg-[var(--mp-surface-raised)] rounded-sm"
            />
            <p className="text-[10px] text-[var(--mp-fg-subtle)] text-center py-1 bg-[var(--mp-surface-raised)] group-hover:text-[var(--mp-fg-muted)] transition-colors">
              {lang === "de" ? "Zum Vergrößern klicken" : "Click to enlarge"}
            </p>
          </button>
        )}

        {/* Question text (selectable for highlighting) */}
        <p className="text-lg md:text-xl leading-relaxed font-medium text-[var(--mp-fg)] mb-4" style={{ userSelect: 'text' }} data-question-text>
          {highlightApi.renderHighlightedText(question.question)}
        </p>

        {/* Floating highlight button — appears on text selection */}
        <HighlightSelectionButton
          visible={highlightApi.showButton}
          position={highlightApi.buttonPos}
          onCommit={highlightApi.commitSelection}
        />

        {/* Exam date chips */}
        {question.exam_dates && question.exam_dates.length > 0 && (
          <div className="mb-5 flex flex-wrap gap-1.5">
            {question.exam_dates.slice(0, 5).map((d) => (
              <span
                key={d}
                className="text-[10px] bg-[var(--mp-surface-sunken)] text-[var(--mp-fg-subtle)] px-2 py-0.5 rounded border border-[var(--mp-border)] font-mono"
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
              className="w-full p-4 rounded-lg border border-[var(--mp-viridian)]/30 bg-[var(--mp-viridian)]/5 hover:bg-[var(--mp-viridian)]/10 transition-all text-center"
            >
              <span className="text-[var(--mp-viridian)] font-medium">
                {lang === "de" ? "Antwort anzeigen" : "Show Answer"}
              </span>
            </button>
          )}
          {isOpenAnswer && showAnswer && (
            <div className="p-4 rounded-lg border border-[var(--mp-viridian)]/30 bg-[var(--mp-viridian)]/10">
              <p className="text-xs text-[var(--mp-viridian)] uppercase tracking-wider mb-1 font-medium">
                {lang === "de" ? "Richtige Antwort" : "Correct Answer"}
              </p>
              <p className="text-[var(--mp-fg)] text-sm leading-relaxed">{question.answer}</p>
            </div>
          )}
          {!isOpenAnswer && isMulti && !answered && (
            <p className="text-[11px] text-[var(--mp-status-warning)] font-semibold mb-1">
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
                        ? "bg-[var(--mp-viridian)]/15 border-[var(--mp-viridian)] text-[var(--mp-viridian)]"
                        : "bg-[var(--mp-surface-sunken)] border-[var(--mp-border)] text-[var(--mp-fg-muted)]"
                      : isSelected && opt.correct
                      ? "bg-[var(--mp-accent-teal)]/20 border-[var(--mp-accent-teal)] text-[var(--mp-accent-teal)]"
                      : isSelected && !opt.correct
                      ? "bg-[var(--mp-error)]/20 border-[var(--mp-error)] text-[var(--mp-error)]"
                      : opt.correct
                      ? "bg-[var(--mp-accent-teal)]/10 border-[var(--mp-accent-teal)]/50 text-[var(--mp-accent-teal)]"
                      : "bg-[var(--mp-surface-sunken)] border-[var(--mp-border)]/40 text-[var(--mp-fg-subtle)]"
                  }`}
                >
                  {getOptionIcon(idx, opt)}
                </span>
                <div className="flex-1 flex flex-col items-start gap-1.5">
                  {opt.image_url && (
                    <img src={opt.image_url} alt="" className="max-h-24 object-contain rounded border border-[var(--mp-border)]" />
                  )}
                  <span>{opt.text}</span>
                </div>
              </button>
            );
          })}
          {!isOpenAnswer && isMulti && !answered && !examMode && (
            <button
              onClick={handleSubmitMulti}
              disabled={selectedIdxs.size === 0}
              className="w-full mt-2 py-3 bg-[var(--mp-status-warning)] hover:bg-[#FFC97A] text-[#1A0E00] rounded font-bold text-sm transition-all active:scale-[0.98] disabled:opacity-40 disabled:cursor-not-allowed"
            >
              {lang === "de" ? "Antwort prüfen" : "Check Answer"}
            </button>
          )}
        </div>

        {/* Post-answer feedback strip */}
        {answered && !hideFeedbackStrip && (
          <div className="mt-3 flex items-center justify-between bg-[var(--mp-surface-sunken)] rounded-xl px-4 py-2.5 text-sm animate-fade-in">
            <div className="flex items-center gap-3">
              <span className="font-semibold text-[var(--mp-viridian)]">+10 XP</span>
              <span className="text-[var(--mp-fg-subtle)]">&middot;</span>
              <span className="text-[var(--mp-fg-muted)]">
                {nCorrect > 0 && selectedIdxs.size > 0 && [...selectedIdxs].some(i => options[i]?.correct)
                  ? (lang === "de" ? "Richtig!" : "Correct!")
                  : (lang === "de" ? "Netter Versuch!" : "Nice try!")}
              </span>
            </div>
            <span className="text-xs text-[var(--mp-fg-subtle)]">
              N &rarr; {lang === "de" ? "Nächste" : "Next"}
            </span>
          </div>
        )}

        {/* ──────────────────────────────────────────────────────────
            Quiz-B: Tabbed post-answer context
            Shown only when answered && !hideExplanation. Re-organises
            the legacy [explanation] → [translate] → [notes] vertical
            scroll into sibling tabs. Tabs: Erklärung / KI-Chat /
            Notizen / Übersetzen / Quelle.
            KI-Chat is an action-style tab that opens the existing
            AIChatAssistant modal (kept as modal — not inlined).
            ────────────────────────────────────────────────────────── */}
        {answered && !hideExplanation && (() => {
          const hasExplanation = !!cleanExplanation(question.explanation);
          type TabDef = { id: PostAnswerTab; label: string; icon: React.ReactNode; isAction?: boolean; hint?: string };
          const tabs: TabDef[] = [
            { id: "erklaerung", label: lang === "de" ? "Erklärung" : "Explanation", icon: <Lightbulb className="w-3.5 h-3.5" /> },
            {
              id: "ki",
              // Renamed from "KI-Chat" → "KI-Erklärung" (DE) / "AI Chat" → "AI Explanation" (EN)
              // so free users don't mistake this for a Pro-locked chat. The surface IS an
              // explanation; the Pro gate only applies to interactive follow-up questions.
              label: lang === "de" ? "KI-Erklärung" : "AI Explanation",
              icon: <Bot className="w-3.5 h-3.5" />,
              isAction: true,
              hint: lang === "de"
                ? "Jede Frage hat eine KI-Erklärung — kostenlos. Pro-Nutzer:innen können zusätzlich eigene Rückfragen stellen."
                : "Every question has an AI explanation — free for everyone. Pro users can additionally ask their own follow-up questions.",
            },
            { id: "notizen", label: lang === "de" ? "Notizen" : "Notes", icon: <FileText className="w-3.5 h-3.5" /> },
            { id: "uebersetzen", label: lang === "de" ? "Übersetzen" : "Translate", icon: <Languages className="w-3.5 h-3.5" /> },
            { id: "quelle", label: lang === "de" ? "Quelle" : "Source", icon: <BookOpen className="w-3.5 h-3.5" /> },
          ];
          // Hide the Translate tab when there is nothing to translate
          const visibleTabs = tabs.filter((tab) => (tab.id === "uebersetzen" ? hasExplanation : true));
          // If the current active tab is no longer visible, fall back to notizen
          const activeVisible: PostAnswerTab = visibleTabs.find((tb) => tb.id === activeTab)
            ? activeTab
            : "notizen";

          const handleTabKeyDown = (e: ReactKeyboardEvent<HTMLButtonElement>, idx: number) => {
            if (e.key !== "ArrowRight" && e.key !== "ArrowLeft" && e.key !== "Home" && e.key !== "End") return;
            e.preventDefault();
            let nextIdx = idx;
            if (e.key === "ArrowRight") nextIdx = (idx + 1) % visibleTabs.length;
            else if (e.key === "ArrowLeft") nextIdx = (idx - 1 + visibleTabs.length) % visibleTabs.length;
            else if (e.key === "Home") nextIdx = 0;
            else if (e.key === "End") nextIdx = visibleTabs.length - 1;
            const nextTab = visibleTabs[nextIdx];
            if (!nextTab) return;
            if (!nextTab.isAction) setActiveTab(nextTab.id);
            tabRefs.current[nextTab.id]?.focus();
          };

          const activateTab = (tab: TabDef) => {
            if (tab.isAction && tab.id === "ki") {
              // KI-Chat tab opens the AI chat modal rather than switching panes.
              setShowAIChat(true);
              trackEvent("feature_use", { feature: "ai_chat_open", source: "tab", questionId: question.id });
              return;
            }
            setActiveTab(tab.id);
          };

          return (
            <div className="mt-4 animate-slide-reveal">
              {/* Tab bar — horizontally scrollable on mobile */}
              <div
                role="tablist"
                aria-label={lang === "de" ? "Zusatzinformationen" : "Additional information"}
                className="flex items-stretch gap-1 overflow-x-auto border-b border-[var(--mp-border)] -mx-1 px-1"
                style={{ scrollbarWidth: "thin" }}
              >
                {visibleTabs.map((tab, idx) => {
                  const isActive = !tab.isAction && activeVisible === tab.id;
                  return (
                    <button
                      key={tab.id}
                      ref={(el) => { tabRefs.current[tab.id] = el; }}
                      role="tab"
                      type="button"
                      id={`qc-tab-${tab.id}`}
                      aria-selected={isActive}
                      aria-controls={tab.isAction ? undefined : `qc-tabpanel-${tab.id}`}
                      tabIndex={isActive || (idx === 0 && !visibleTabs.some(tb => !tb.isAction && tb.id === activeVisible)) ? 0 : -1}
                      onClick={() => activateTab(tab)}
                      onKeyDown={(e) => handleTabKeyDown(e, idx)}
                      className={`flex items-center gap-1.5 px-3 py-2.5 text-xs font-semibold whitespace-nowrap border-b-2 transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-[var(--mp-viridian)]/40 focus-visible:rounded-t ${
                        isActive
                          ? "text-[var(--mp-fg)] border-b-[var(--mp-viridian)]"
                          : "text-[var(--mp-fg-subtle)] border-b-transparent hover:text-[var(--mp-fg-muted)]"
                      }`}
                    >
                      {tab.icon}
                      <span>{tab.label}</span>
                      {tab.hint && (
                        <span
                          className="inline-flex items-center text-[var(--mp-fg-subtle)]"
                          title={tab.hint}
                          aria-label={tab.hint}
                        >
                          <Info className="w-3 h-3" />
                        </span>
                      )}
                    </button>
                  );
                })}
              </div>

              {/* Erklärung pane */}
              {activeVisible === "erklaerung" && (
                <div
                  role="tabpanel"
                  id="qc-tabpanel-erklaerung"
                  aria-labelledby="qc-tab-erklaerung"
                  className="pt-4 animate-fade-in"
                >
                  <QuestionExplanation
                    questionId={question.id}
                    explanation={question.explanation}
                    lang={lang}
                    extraImages={extraImages}
                    onImageClick={setLightboxSrc}
                    rating={explanationRating}
                    onRate={setExplanationRating}
                  />
                </div>
              )}

              {/* Notizen pane */}
              {activeVisible === "notizen" && (
                <div
                  role="tabpanel"
                  id="qc-tabpanel-notizen"
                  aria-labelledby="qc-tab-notizen"
                  className="pt-4 animate-fade-in"
                >
                  <QuestionNotesPanel
                    lang={lang}
                    value={note}
                    onChange={setNote}
                    saved={noteSaved}
                    onSave={handleSaveNote}
                  />
                </div>
              )}

              {/* Übersetzen pane */}
              {activeVisible === "uebersetzen" && (
                <div
                  role="tabpanel"
                  id="qc-tabpanel-uebersetzen"
                  aria-labelledby="qc-tab-uebersetzen"
                  className="pt-4 animate-fade-in"
                >
                  <p className="text-xs text-[var(--mp-fg-muted)] mb-3">
                    {lang === "de"
                      ? "Übersetze die Erklärung in deine Sprache."
                      : "Translate the explanation into your language."}
                  </p>
                  <TranslateButton
                    questionId={question.id}
                    lang={lang}
                    userTier={userTier}
                    field="explanation"
                  />
                </div>
              )}

              {/* Quelle pane — placeholder until guideline refs are parsed */}
              {activeVisible === "quelle" && (
                <div
                  role="tabpanel"
                  id="qc-tabpanel-quelle"
                  aria-labelledby="qc-tab-quelle"
                  className="pt-4 animate-fade-in"
                >
                  <div className="bg-[var(--mp-surface-sunken)] border border-dashed border-[var(--mp-border)] rounded-xl p-5 text-center">
                    <BookOpen className="w-5 h-5 mx-auto mb-2 text-[var(--mp-fg-subtle)]" />
                    <p className="text-sm text-[var(--mp-fg-muted)] mb-1">
                      {lang === "de" ? "Noch keine Quellenangaben." : "No source references yet."}
                    </p>
                    <p className="text-xs text-[var(--mp-fg-subtle)]">
                      {lang === "de"
                        ? "Wir arbeiten daran, Leitlinien-Referenzen anzuhängen."
                        : "We\u2019re working on attaching guideline references."}
                    </p>
                  </div>
                </div>
              )}
            </div>
          );
        })()}
      </div>

      {/* Report / flag / edit form — now a Dialog (focus trap, escape, aria-modal). */}
      {!hideActions && (
        <QuestionReportForm
          open={showReportForm}
          questionId={question.id}
          lang={lang}
          initialQuestion={question.question}
          initialExplanation={question.explanation || ""}
          initialTopic={question.topic}
          onClose={() => setShowReportForm(false)}
          onSubmitted={() => setSuggestionSubmitted(true)}
        />
      )}

      {/* AI Chat Assistant */}
      {!hideActions && (
        <AIChatAssistant
          open={showAIChat}
          onClose={() => setShowAIChat(false)}
          lang={lang}
          questionId={question.id}
          questionText={question.question}
          answerText={question.answer}
          explanation={question.explanation}
          topic={question.topic}
          options={options.map(o => ({ text: o.text, correct: o.correct }))}
          userTier={userTier}
          userRole={userRole}
        />
      )}

      {/* Lightbox — opens for whichever image was clicked (question or extra) */}
      {lightboxSrc && (
        <ImageLightbox
          src={lightboxSrc}
          alt={lang === "de" ? "Medizinische Abbildung" : "Medical illustration"}
          onClose={() => setLightboxSrc(null)}
        />
      )}
    </>
  );
}
