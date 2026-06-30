"use client";

/**
 * TurnIntoNoteButton — the ONE "Turn into note" control (Notes feature Phase 4b).
 *
 * Dropped onto the three create surfaces (a bookmarked question, a per-question
 * note, an AI explanation) so each can become a structured flash-note via
 * POST /api/notes/transform (Haiku). Self-contained async state so it slots into
 * any surface without the parent tracking it:
 *   idle → loading → done (links to the Library) | cap (links to /pricing) | error (retry)
 *
 * The 10-note free cap is enforced SERVER-SIDE (a 402 → the `cap` state surfaces
 * the upgrade), so this button is never client-gated by tier — that is the
 * conversion hook working as designed.
 *
 * Two variants: `full` (a labelled pill, for panels) and `icon` (a square icon,
 * for the question-actions toolbar — the parent passes the toolbar button class).
 */

import { useState } from "react";
import Link from "next/link";
import { authFetch as fetch } from "@/lib/authFetch";
import { Sparkles, Loader2, Check, Crown, RotateCcw } from "lucide-react";

type Lang = "de" | "en";
type TransformKind = "question" | "user_note" | "ai_explanation";
type State = "idle" | "loading" | "done" | "cap" | "error";

interface Props {
  kind: TransformKind;
  lang: Lang;
  sourceRef?: { question_id?: number; message_id?: string };
  text?: string;
  examType?: string;
  topic?: string;
  variant?: "full" | "icon";
  className?: string;
}

export default function TurnIntoNoteButton({
  kind,
  lang,
  sourceRef,
  text,
  examType,
  topic,
  variant = "full",
  className = "",
}: Props) {
  const [state, setState] = useState<State>("idle");

  const run = async () => {
    if (state === "loading") return;
    setState("loading");
    try {
      const res = await fetch("/api/notes/transform", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          kind,
          source_ref: sourceRef,
          text,
          exam_type: examType,
          topic,
        }),
      });
      if (res.ok) setState("done");
      else if (res.status === 402) setState("cap");
      else setState("error");
    } catch {
      setState("error");
    }
  };

  const L = {
    idle: lang === "de" ? "Als Lernkarte speichern" : "Save as flash-note",
    loading: lang === "de" ? "Erstelle…" : "Creating…",
    done: lang === "de" ? "In Bibliothek" : "In Library",
    cap: lang === "de" ? "Notiz-Limit erreicht" : "Note limit reached",
    error: lang === "de" ? "Erneut versuchen" : "Try again",
  };

  // ── icon variant (toolbar) ──────────────────────────────────────────────
  if (variant === "icon") {
    if (state === "done") {
      return (
        <Link href="/library" title={L.done} aria-label={L.done} className={className}>
          <Check className="w-5 h-5 text-[var(--mp-viridian)]" />
        </Link>
      );
    }
    if (state === "cap") {
      return (
        <Link
          href="/pricing?gate=notes"
          title={L.cap}
          aria-label={L.cap}
          className={className}
        >
          <Crown className="w-5 h-5 text-[var(--mp-status-warning)]" />
        </Link>
      );
    }
    return (
      <button
        type="button"
        onClick={run}
        disabled={state === "loading"}
        title={state === "error" ? L.error : L.idle}
        aria-label={L.idle}
        className={className}
      >
        {state === "loading" ? (
          <Loader2 className="w-5 h-5 animate-spin" />
        ) : (
          <Sparkles className="w-5 h-5" />
        )}
      </button>
    );
  }

  // ── full variant (panels) ───────────────────────────────────────────────
  if (state === "done") {
    return (
      <Link
        href="/library"
        className={`inline-flex items-center gap-1.5 text-xs font-semibold text-[var(--mp-viridian)] ${className}`}
      >
        <Check className="w-3.5 h-3.5" /> {L.done} →
      </Link>
    );
  }
  if (state === "cap") {
    return (
      <Link
        href="/pricing?gate=notes"
        className={`inline-flex items-center gap-1.5 text-xs font-semibold text-[var(--mp-status-warning)] ${className}`}
      >
        <Crown className="w-3.5 h-3.5" /> {L.cap} →
      </Link>
    );
  }
  return (
    <button
      type="button"
      onClick={run}
      disabled={state === "loading"}
      className={`inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-semibold border transition-colors disabled:opacity-60 ${
        state === "error"
          ? "border-[var(--mp-error)]/40 text-[var(--mp-error)] hover:bg-[var(--mp-error)]/10"
          : "border-[var(--mp-viridian)]/30 bg-[var(--mp-viridian)]/10 text-[var(--mp-viridian)] hover:bg-[var(--mp-viridian)]/20"
      } ${className}`}
    >
      {state === "loading" ? (
        <Loader2 className="w-3.5 h-3.5 animate-spin" />
      ) : state === "error" ? (
        <RotateCcw className="w-3.5 h-3.5" />
      ) : (
        <Sparkles className="w-3.5 h-3.5" />
      )}
      {state === "loading" ? L.loading : state === "error" ? L.error : L.idle}
    </button>
  );
}
