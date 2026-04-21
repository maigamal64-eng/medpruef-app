"use client";

/**
 * QuestionHighlightLayer — encapsulates the text-selection → highlight
 * workflow for a question stem.
 *
 * Extracted from QuestionCard.tsx (DD-15 burndown). Provides:
 *   - `useQuestionHighlights(questionId)` — hook that owns the
 *     highlights array + a stable `renderHighlightedText` helper.
 *   - `<HighlightSelectionButton>` — the floating "Highlight" button
 *     that appears on text selection inside a `[data-question-text]`
 *     element.
 *
 * Persistence is localStorage-only (same key shape as the legacy
 * QuestionCard code) so nothing on the server side changes.
 */

import { useEffect, useState, useCallback } from "react";
import { Highlighter } from "lucide-react";

const HIGHLIGHT_BG_COLOR = "rgba(250, 204, 21, 0.5)";

function highlightKey(id: number) {
  return `medpruef_highlights_${id}`;
}

export interface HighlightLayerApi {
  /** Ordered list of already-saved highlight phrases. */
  highlights: string[];
  /** Should the floating Highlight button be visible? */
  showButton: boolean;
  /** Viewport-absolute position of the floating button. */
  buttonPos: { x: number; y: number };
  /** Commit the current window selection as a new highlight. */
  commitSelection: () => void;
  /** Render `text` with all highlighted substrings wrapped in <mark>. */
  renderHighlightedText: (text: string) => React.ReactNode;
}

/**
 * Manage text-selection → highlight state for a single question.
 * Reload on question change via the `questionId` dependency.
 */
export function useQuestionHighlights(questionId: number): HighlightLayerApi {
  const [highlights, setHighlights] = useState<string[]>([]);
  const [showButton, setShowButton] = useState(false);
  const [buttonPos, setButtonPos] = useState({ x: 0, y: 0 });

  // Load persisted highlights on question change
  useEffect(() => {
    setShowButton(false);
    if (typeof window === "undefined") {
      setHighlights([]);
      return;
    }
    try {
      const hl = JSON.parse(localStorage.getItem(highlightKey(questionId)) || "[]");
      setHighlights(Array.isArray(hl) ? hl : []);
    } catch {
      setHighlights([]);
    }
  }, [questionId]);

  // Detect selection inside `[data-question-text]` elements
  useEffect(() => {
    const handleMouseUp = () => {
      const sel = window.getSelection();
      if (!sel || sel.isCollapsed || !sel.toString().trim()) {
        setShowButton(false);
        return;
      }
      const text = sel.toString().trim();
      if (text.length < 3 || text.length > 500) {
        setShowButton(false);
        return;
      }
      const anchor = sel.anchorNode?.parentElement;
      if (!anchor?.closest("[data-question-text]")) {
        setShowButton(false);
        return;
      }
      const range = sel.getRangeAt(0);
      const rect = range.getBoundingClientRect();
      setButtonPos({ x: rect.left + rect.width / 2, y: rect.top - 8 });
      setShowButton(true);
    };
    document.addEventListener("mouseup", handleMouseUp);
    return () => document.removeEventListener("mouseup", handleMouseUp);
  }, []);

  const commitSelection = useCallback(() => {
    const sel = window.getSelection();
    if (!sel || !sel.toString().trim()) return;
    const text = sel.toString().trim();
    const next = [...highlights, text];
    setHighlights(next);
    if (typeof window !== "undefined") {
      localStorage.setItem(highlightKey(questionId), JSON.stringify(next));
    }
    sel.removeAllRanges();
    setShowButton(false);
  }, [highlights, questionId]);

  const renderHighlightedText = useCallback(
    (text: string): React.ReactNode => {
      if (!highlights.length) return text;
      const escaped = highlights
        .map((h) => h.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"))
        .filter(Boolean);
      if (!escaped.length) return text;
      const regex = new RegExp(`(${escaped.join("|")})`, "gi");
      const parts = text.split(regex);
      return parts.map((part, i) => {
        const isHighlighted = highlights.some(
          (h) => h.toLowerCase() === part.toLowerCase()
        );
        return isHighlighted ? (
          <mark
            key={i}
            className="rounded px-0.5"
            style={{ backgroundColor: HIGHLIGHT_BG_COLOR }}
          >
            {part}
          </mark>
        ) : (
          <span key={i}>{part}</span>
        );
      });
    },
    [highlights]
  );

  return { highlights, showButton, buttonPos, commitSelection, renderHighlightedText };
}

/**
 * Floating "Highlight" button — visible while the user has text
 * selected inside a question-text element. Rendered positional
 * (fixed) relative to the viewport.
 */
export function HighlightSelectionButton({
  visible,
  position,
  onCommit,
}: {
  visible: boolean;
  position: { x: number; y: number };
  onCommit: () => void;
}) {
  if (!visible) return null;
  return (
    <div
      className="fixed z-50 animate-scale-in"
      style={{ left: position.x, top: position.y, transform: "translate(-50%, -100%)" }}
    >
      <button
        onMouseDown={(e) => {
          e.preventDefault();
          onCommit();
        }}
        className="flex items-center gap-1.5 bg-[var(--mp-oxford-blue)] text-white text-xs font-medium px-3 py-1.5 rounded-lg shadow-lg hover:bg-[var(--mp-cta-blue)] transition-colors"
      >
        <Highlighter className="w-3.5 h-3.5" />
        Highlight
      </button>
    </div>
  );
}
