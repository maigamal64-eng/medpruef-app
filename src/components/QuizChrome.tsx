"use client";

/**
 * QuizChrome — the distraction-free quiz surface furniture for /quiz.
 *
 * Reimplementation v3 (Clinical Nocturne, 2026-06-26). Built to the
 * approved `reviews/reimplementation-2026-06-26/design/02-quiz.html`:
 *
 *   • QuizTopBar — a close (X → home) button, a mono progress counter
 *     with the teal current-index spark, an optional timer, and a flag
 *     toggle. Replaces the old generic header + theme/lang toggles, which
 *     do not belong on a focus surface.
 *   • QuizProgress — a slim track whose fill is the viridian→spark
 *     gradient with a soft spark-glow (the ONE blessed decorative spark on
 *     this surface besides active/focus rings).
 *   • QuizFooterAction — the single, full-width, state-swapping primary
 *     action: a disabled "Antwort prüfen" → armed viridian "prüfen" →
 *     CTA-blue "Nächste Frage". Always one action, always full width, with
 *     a top gradient-fade so it reads over scrolling content.
 *
 * Spark discipline (per SPECS.md §"spark discipline"): teal = active /
 * focus / progress / live ONLY. Here it touches exactly two things — the
 * progress fill and the current-index numeral. Nothing else.
 *
 * These are presentational; the page owns all quiz state + the data layer.
 * No data-layer code, no API calls, no globals.css edits, no shared-primitive
 * edits live here.
 */

import { X, Clock, Bookmark } from "lucide-react";

type Lang = "de" | "en";

// ───────────────────────────────────────────────────────────
// Top bar — close · progress counter (teal current) · timer · flag
// ───────────────────────────────────────────────────────────
export function QuizTopBar({
  lang,
  current,
  total,
  progressPct,
  timeLabel,
  timeUrgent = false,
  flagged = false,
  onClose,
  onToggleFlag,
}: {
  lang: Lang;
  /** 1-based index of the question currently shown. */
  current: number;
  /** Total questions in this run (pool size or target). */
  total: number | null;
  /** 0–100 progress fill. */
  progressPct: number;
  /** Pre-formatted "MM:SS" (countdown) or "MM:SS" elapsed. Omit to hide. */
  timeLabel?: string | null;
  /** Turns the timer error-red + pulses (≤60s left). Calm, never red otherwise. */
  timeUrgent?: boolean;
  /** Whether this question is in the bookmark/"gemerkt" set (medpruef_favorites). */
  flagged?: boolean;
  onClose: () => void;
  /** Toggle the question's bookmark ("merken") state. */
  onToggleFlag?: () => void;
}) {
  return (
    <div className="flex items-center gap-3 px-4 lg:px-8 pt-3 pb-3 flex-shrink-0">
      {/* Close → home. Square, quiet, no label. */}
      <button
        onClick={onClose}
        aria-label={lang === "de" ? "Quiz verlassen" : "Leave quiz"}
        className="w-9 h-9 rounded-[var(--mp-r-input)] border border-[var(--mp-border-soft)] bg-[var(--mp-surface)] flex items-center justify-center text-[var(--mp-fg-muted)] hover:text-[var(--mp-fg)] hover:border-[var(--mp-border-strong)] transition-colors flex-shrink-0"
      >
        <X className="w-[18px] h-[18px]" />
      </button>

      {/* Progress block — counter row + slim track */}
      <div className="flex-1 min-w-0">
        <div className="flex items-center justify-between mb-1.5">
          <span className="font-mono text-xs font-bold text-[var(--mp-fg)] tabular-nums">
            {/* Current index is the teal spark — "you are here, live". */}
            {total === null ? (
              <span className="text-[var(--mp-accent-teal)]">{lang === "de" ? `Frage ${current}` : `Q${current}`}</span>
            ) : (
              <>
                <span className="text-[var(--mp-accent-teal)]">{current}</span>
                <span className="text-[var(--mp-fg-subtle)]"> / {total}</span>
              </>
            )}
          </span>
          {timeLabel && (
            <span
              className={`flex items-center gap-1 font-mono text-xs font-semibold tabular-nums ${
                timeUrgent
                  ? "text-[var(--mp-error)] animate-pulse"
                  : "text-[var(--mp-fg-subtle)]"
              }`}
            >
              <Clock className="w-[13px] h-[13px]" />
              {timeLabel}
            </span>
          )}
        </div>
        <div className="h-1.5 rounded-full bg-[var(--mp-surface-sunken)] overflow-hidden">
          <div
            className="h-full rounded-full transition-[width] duration-500 ease-out"
            style={{
              width: `${Math.max(0, Math.min(100, progressPct))}%`,
              background:
                "linear-gradient(90deg, var(--mp-viridian), var(--mp-spark))",
              boxShadow: "0 0 8px var(--mp-spark-glow)",
            }}
          />
        </div>
      </div>

      {/* Bookmark ("merken") — quiet by default, amber when set (calm, never
          red). Writes the shared medpruef_favorites set, which the quiz
          "Gemerkte" filter reads. Distinct from QuestionActions' Flag =
          "report a problem". */}
      {onToggleFlag && (
        <button
          onClick={onToggleFlag}
          aria-pressed={flagged}
          aria-label={
            flagged
              ? lang === "de"
                ? "Aus Merkliste entfernen"
                : "Remove bookmark"
              : lang === "de"
                ? "Frage merken"
                : "Bookmark question"
          }
          className={`w-9 h-9 rounded-[var(--mp-r-input)] border flex items-center justify-center transition-colors flex-shrink-0 ${
            flagged
              ? "border-[var(--mp-status-warning)] bg-[var(--mp-warning-bg)] text-[var(--mp-status-warning)]"
              : "border-[var(--mp-border-soft)] bg-[var(--mp-surface)] text-[var(--mp-fg-subtle)] hover:text-[var(--mp-fg-muted)] hover:border-[var(--mp-border-strong)]"
          }`}
        >
          <Bookmark className="w-[17px] h-[17px]" fill={flagged ? "currentColor" : "none"} />
        </button>
      )}
    </div>
  );
}

// ───────────────────────────────────────────────────────────
// Footer action — one full-width action, state-swapping
// ───────────────────────────────────────────────────────────
export type QuizFooterMode = "locked" | "armed" | "next" | "finish";

export function QuizFooterAction({
  lang,
  mode,
  onPress,
}: {
  lang: Lang;
  /**
   *  locked → disabled "Antwort prüfen" (nothing selected yet; multi-select)
   *  armed  → viridian "Antwort prüfen" (a selection is staged; multi-select)
   *  next   → CTA-blue "Nächste Frage" (graded, more to come)
   *  finish → CTA-blue "Quiz beenden" (graded, this was the last)
   */
  mode: QuizFooterMode;
  onPress: () => void;
}) {
  const base =
    "w-full h-[52px] rounded-[var(--mp-r-button)] font-bold text-[15px] flex items-center justify-center gap-2.5 transition-all active:scale-[0.99]";

  if (mode === "locked" || mode === "armed") {
    const armed = mode === "armed";
    return (
      <button
        onClick={onPress}
        disabled={!armed}
        className={`${base} ${
          armed
            ? "text-white bg-[var(--mp-viridian)] shadow-[0_6px_16px_rgba(0,123,95,0.28)]"
            : "text-[var(--mp-fg-subtle)] bg-[var(--mp-surface-sunken)] border border-[var(--mp-border)] cursor-not-allowed"
        }`}
      >
        {/* check glyph mirrors the approved design's leading icon */}
        <svg width="19" height="19" viewBox="0 0 24 24" fill="none" aria-hidden>
          <path
            d="M20 6L9 17l-5-5"
            stroke="currentColor"
            strokeWidth="2.5"
            strokeLinecap="round"
            strokeLinejoin="round"
          />
        </svg>
        {lang === "de" ? "Antwort prüfen" : "Check answer"}
      </button>
    );
  }

  // next / finish — the forward action in CTA-blue
  const label =
    mode === "finish"
      ? lang === "de"
        ? "Quiz beenden"
        : "Finish quiz"
      : lang === "de"
        ? "Nächste Frage"
        : "Next question";
  return (
    <button
      onClick={onPress}
      className={`${base} text-white bg-[var(--mp-cta-blue)] shadow-[0_6px_16px_rgba(0,58,140,0.3)] dark:shadow-[0_6px_18px_rgba(0,0,0,0.5)]`}
    >
      {label}
      <svg width="19" height="19" viewBox="0 0 24 24" fill="none" aria-hidden>
        <path
          d="M5 12h14M13 6l6 6-6 6"
          stroke="currentColor"
          strokeWidth="2.5"
          strokeLinecap="round"
          strokeLinejoin="round"
        />
      </svg>
    </button>
  );
}
