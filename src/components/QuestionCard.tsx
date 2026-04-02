"use client";

import { useState, useEffect } from "react";
import { getTopicConfig } from "@/lib/topics";
import { t } from "@/lib/i18n";
import type { MCQOption } from "@/lib/mcq";
import ImageLightbox from "@/components/ImageLightbox";

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
  const [selectedIdx, setSelectedIdx] = useState<number | null>(null);
  const [lightboxOpen, setLightboxOpen] = useState(false);
  const [note, setNote] = useState("");
  const [showNoteInput, setShowNoteInput] = useState(false);
  const [noteSaved, setNoteSaved] = useState(false);
  const [isFav, setIsFav] = useState(false);

  const answered = selectedIdx !== null;

  const options: MCQOption[] = question.options || [
    { text: question.answer, correct: true },
  ];

  // Load persisted note and favorite state on question change
  useEffect(() => {
    setSelectedIdx(null);
    setShowNoteInput(false);
    setNoteSaved(false);
    if (typeof window !== "undefined") {
      const saved = localStorage.getItem(getNoteKey(question.id)) || "";
      setNote(saved);
      setShowNoteInput(!!saved);
      setIsFav(getFavorites().includes(question.id));
    }
  }, [question.id]);

  const handleSelect = (idx: number) => {
    if (answered) return;
    setSelectedIdx(idx);
    onAnswer?.(options[idx].correct);
  };

  const handleSaveNote = () => {
    localStorage.setItem(getNoteKey(question.id), note);
    setNoteSaved(true);
    setTimeout(() => setNoteSaved(false), 2000);
  };

  const handleToggleFav = () => {
    setIsFav(toggleFavorite(question.id));
  };

  const getOptionStyle = (idx: number, opt: MCQOption): string => {
    const base =
      "w-full text-left px-4 py-3 border text-sm font-medium transition-all duration-200 flex items-center gap-3 rounded";

    if (!answered) {
      return `${base} bg-[#151B2D] border-[#3D4947] text-[#DCE1FB] hover:border-[#6BD8CB]/50 hover:bg-[#191F31] active:scale-[0.99]`;
    }

    if (idx === selectedIdx) {
      if (opt.correct) {
        return `${base} bg-[#4EDEA3]/12 border-[#4EDEA3] text-[#4EDEA3]`;
      } else {
        return `${base} bg-[#FFB4AB]/12 border-[#FFB4AB] text-[#FFB4AB]`;
      }
    }
    if (opt.correct) {
      return `${base} bg-[#4EDEA3]/8 border-[#4EDEA3]/60 text-[#4EDEA3]/80`;
    }
    return `${base} bg-[#151B2D] border-[#3D4947]/40 text-[#879391] opacity-50`;
  };

  const getOptionIcon = (idx: number, opt: MCQOption): string => {
    if (!answered) return String.fromCharCode(65 + idx);
    if (idx === selectedIdx && opt.correct) return "✓";
    if (idx === selectedIdx && !opt.correct) return "✗";
    if (opt.correct) return "✓";
    return String.fromCharCode(65 + idx);
  };

  const effectiveImageUrl = imageUrl ?? question.image_url;

  return (
    <>
      <div className="bg-[#191F31] border border-[#3D4947] rounded p-5 md:p-6 animate-slide-up">
        {/* Top row: topic badge + question counter + bookmark */}
        <div className="flex items-center justify-between mb-4">
          <span
            className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded text-xs font-medium"
            style={{ backgroundColor: `${config.color}18`, color: config.color }}
          >
            <span>{config.icon}</span>
            <span className="max-w-[140px] truncate">{question.topic}</span>
          </span>
          <div className="flex items-center gap-2">
            <button
              onClick={handleToggleFav}
              title={isFav ? t("bookmarked", lang) : t("bookmark", lang)}
              className={`text-base transition-colors ${isFav ? "text-[#FFB95F]" : "text-[#3D4947] hover:text-[#FFB95F]"}`}
            >
              {isFav ? "★" : "☆"}
            </button>
            <span className="text-xs text-[#879391] font-mono">
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
                className="text-[10px] px-2 py-0.5 rounded-full border border-[#6BD8CB]/30 bg-[#6BD8CB]/8 text-[#6BD8CB] font-medium"
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
            className="block w-full mb-4 rounded overflow-hidden border border-[#3D4947] hover:border-[#6BD8CB]/40 transition-colors group"
            aria-label="Bild vergrößern"
          >
            <img
              src={effectiveImageUrl}
              alt="Medizinische Abbildung"
              className="w-full max-h-64 object-contain bg-[#151B2D] rounded-sm"
            />
            <p className="text-[10px] text-[#879391] text-center py-1 bg-[#151B2D] group-hover:text-[#BCC9C6] transition-colors">
              {lang === "de" ? "Zum Vergrößern klicken" : "Click to enlarge"}
            </p>
          </button>
        )}

        {/* Question text */}
        <p className="text-base md:text-lg leading-relaxed font-medium text-[#DCE1FB] mb-4">
          {question.question}
        </p>

        {/* Exam date chips */}
        {question.exam_dates && question.exam_dates.length > 0 && (
          <div className="mb-5 flex flex-wrap gap-1.5">
            {question.exam_dates.slice(0, 5).map((d) => (
              <span
                key={d}
                className="text-[10px] bg-[#23293C] text-[#879391] px-2 py-0.5 rounded border border-[#3D4947] font-mono"
              >
                {formatExamDate(d, lang)}
              </span>
            ))}
          </div>
        )}

        {/* MCQ Options */}
        <div className="space-y-2">
          {options.map((opt, idx) => (
            <button
              key={idx}
              onClick={() => handleSelect(idx)}
              disabled={answered}
              className={getOptionStyle(idx, opt)}
            >
              <span
                className={`w-6 h-6 rounded flex-shrink-0 flex items-center justify-center text-xs font-bold border font-mono ${
                  !answered
                    ? "bg-[#23293C] border-[#3D4947] text-[#BCC9C6]"
                    : idx === selectedIdx && opt.correct
                    ? "bg-[#4EDEA3]/20 border-[#4EDEA3] text-[#4EDEA3]"
                    : idx === selectedIdx && !opt.correct
                    ? "bg-[#FFB4AB]/20 border-[#FFB4AB] text-[#FFB4AB]"
                    : opt.correct
                    ? "bg-[#4EDEA3]/10 border-[#4EDEA3]/50 text-[#4EDEA3]"
                    : "bg-[#23293C] border-[#3D4947]/40 text-[#879391]"
                }`}
              >
                {getOptionIcon(idx, opt)}
              </span>
              <span className="flex-1">{opt.text}</span>
            </button>
          ))}
        </div>

        {/* Explanation — shown after answering */}
        {answered && question.explanation && (
          <div className="mt-4 bg-[#FFB95F]/6 border border-[#FFB95F]/25 rounded p-4 animate-fade-in">
            <p className="text-[10px] uppercase tracking-wider text-[#FFB95F] font-semibold mb-2">
              💡 {t("explanation", lang)}
            </p>
            <p className="text-[#BCC9C6] leading-relaxed text-sm">{question.explanation}</p>
          </div>
        )}

        {/* Notes section — visible after answering */}
        {answered && (
          <div className="mt-3 animate-fade-in">
            {!showNoteInput ? (
              <button
                onClick={() => setShowNoteInput(true)}
                className="flex items-center gap-1.5 text-xs text-[#879391] hover:text-[#BCC9C6] transition-colors"
              >
                <span>📝</span>
                <span>{t("add_note", lang)}</span>
              </button>
            ) : (
              <div className="bg-[#151B2D] border border-[#3D4947] rounded p-3">
                <p className="text-[10px] uppercase tracking-wider text-[#879391] font-semibold mb-2">
                  📝 {t("add_note", lang)}
                </p>
                <textarea
                  value={note}
                  onChange={(e) => setNote(e.target.value)}
                  placeholder={t("note_placeholder", lang)}
                  rows={3}
                  className="w-full bg-[#23293C] border border-[#3D4947] rounded px-3 py-2 text-sm text-[#DCE1FB] placeholder-[#879391] resize-none focus:outline-none focus:border-[#6BD8CB]/50 font-sans"
                />
                <div className="flex items-center justify-between mt-2">
                  <button
                    onClick={handleSaveNote}
                    className="px-3 py-1.5 bg-[#6BD8CB]/15 border border-[#6BD8CB]/30 text-[#6BD8CB] text-xs font-medium rounded hover:bg-[#6BD8CB]/25 transition-colors"
                  >
                    {noteSaved ? `✓ ${t("note_saved", lang)}` : t("save_note", lang)}
                  </button>
                  {note.length === 0 && (
                    <button
                      onClick={() => setShowNoteInput(false)}
                      className="text-xs text-[#879391] hover:text-[#BCC9C6] transition-colors"
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
