"use client";

/**
 * FlipCard — the shared 3D-flip card shell (MPDS "Clinical Nocturne").
 *
 * Extracted 2026-06-30 (Notes feature Phase 2) from the flashcards page so BOTH
 * a question-flashcard AND a flash-note card render through one identical shell.
 * It owns ONLY the chrome that is common to every card:
 *   - the flip container (`flip-card` / `flip-card-inner` / `.flipped`, the 3D
 *     Y-flip; reduced-motion crossfade is handled in globals.css),
 *   - the opacity fade on `animatingOut`,
 *   - each face's panel (surface + soft border + elevation + p-6 + clip),
 *   - the top accent bar (a gradient that reads flip-state at a glance),
 *   - the top row: a specialty/category chip + a side label (Vorderseite/Back).
 *
 * Everything BELOW the top row is the caller's `front` / `back` content, so the
 * question card keeps its stem + options + explanation and a note card supplies
 * its own block layout — the shell guarantees they look like one family.
 *
 * This is a pure presentational shell: it does not flip itself, fetch, or own
 * any review state. The parent owns `flipped` and calls `onFlip` (the shell
 * flips on click only when not yet flipped, matching the original behavior).
 */

import type { ReactNode } from "react";
import TopicIcon from "@/components/TopicIcon";

/** The category chip shown on both faces (specialty for questions, a tag/source
 *  for notes). `color` keys the chip tint + the `--sc`/`--topic-color` vars. */
export interface FlipChip {
  color: string;
  /** TopicIcon name. */
  icon: string;
  label: string;
}

/** Top-accent-bar gradient endpoints (CSS color / var refs). */
export interface FlipAccent {
  from: string;
  to: string;
}

/** Default accents preserve the original flashcards look exactly:
 *  viridian→spark on the front, CTA-blue→teal on the back. */
export const FLIP_ACCENT_FRONT: FlipAccent = {
  from: "var(--mp-viridian)",
  to: "var(--mp-spark)",
};
export const FLIP_ACCENT_BACK: FlipAccent = {
  from: "var(--mp-cta-blue)",
  to: "var(--mp-accent-teal)",
};

interface CardFaceProps {
  side: "front" | "back";
  flipped: boolean;
  chip: FlipChip;
  sideLabel: string;
  accent: FlipAccent;
  children: ReactNode;
}

function CardFace({
  side,
  flipped,
  chip,
  sideLabel,
  accent,
  children,
}: CardFaceProps) {
  const scTint = `color-mix(in srgb, ${chip.color} 14%, transparent)`;
  const isFront = side === "front";
  // Preserve the exact original panel classes per face (front is absolutely
  // positioned via the inline `inset-0`; the back's positioning comes from
  // `.flip-card-back` in globals.css).
  const panelClass = isFront
    ? "flip-card-front absolute inset-0 rounded-[var(--mp-r-modal)] bg-[var(--mp-surface)] border border-[var(--mp-border-soft)] shadow-[var(--mp-shadow-elev)] flex flex-col p-6 overflow-hidden"
    : "flip-card-back rounded-[var(--mp-r-modal)] bg-[var(--mp-surface)] border border-[var(--mp-border-soft)] shadow-[var(--mp-shadow-elev)] flex flex-col p-6 overflow-hidden";

  return (
    <div className={panelClass} aria-hidden={isFront ? flipped : !flipped}>
      {/* Top accent bar */}
      <span
        className="absolute left-0 top-0 right-0 h-1"
        style={{
          background: `linear-gradient(90deg, ${accent.from}, ${accent.to})`,
        }}
        aria-hidden
      />

      {/* Top row: category chip + side label. (front mb-2 / back mb-3 — kept.) */}
      <div
        className={`flex items-center justify-between ${isFront ? "mb-2" : "mb-3"}`}
      >
        <span
          className="topic-text inline-flex items-center gap-1.5 text-[11px] font-semibold px-2.5 py-1.5 rounded-full"
          style={{
            ["--topic-color" as string]: chip.color,
            backgroundColor: scTint,
          }}
        >
          <TopicIcon name={chip.icon} className="w-3.5 h-3.5" />
          {chip.label}
        </span>
        <span className="text-[10px] font-bold uppercase tracking-[0.08em] text-[var(--mp-fg-subtle)] font-mono">
          {sideLabel}
        </span>
      </div>

      {children}
    </div>
  );
}

export interface FlipCardProps {
  flipped: boolean;
  animatingOut: boolean;
  onFlip: () => void;
  chip: FlipChip;
  frontLabel: string;
  backLabel: string;
  /** Content BELOW the front top row (badge / recall cue / flip hint, etc.). */
  front: ReactNode;
  /** Content BELOW the back top row (answer / blocks / explanation, etc.). */
  back: ReactNode;
  frontAccent?: FlipAccent;
  backAccent?: FlipAccent;
  className?: string;
}

export function FlipCard({
  flipped,
  animatingOut,
  onFlip,
  chip,
  frontLabel,
  backLabel,
  front,
  back,
  frontAccent = FLIP_ACCENT_FRONT,
  backAccent = FLIP_ACCENT_BACK,
  className = "",
}: FlipCardProps) {
  return (
    <div
      className={`flip-card w-full h-full cursor-pointer transition-opacity duration-300 ${
        animatingOut ? "opacity-0" : "opacity-100"
      }${className ? ` ${className}` : ""}`}
      onClick={() => {
        if (!flipped) onFlip();
      }}
      style={{ ["--sc" as string]: chip.color }}
    >
      <div
        className={`flip-card-inner w-full h-full ${flipped ? "flipped" : ""}`}
      >
        <CardFace
          side="front"
          flipped={flipped}
          chip={chip}
          sideLabel={frontLabel}
          accent={frontAccent}
        >
          {front}
        </CardFace>
        <CardFace
          side="back"
          flipped={flipped}
          chip={chip}
          sideLabel={backLabel}
          accent={backAccent}
        >
          {back}
        </CardFace>
      </div>
    </div>
  );
}
