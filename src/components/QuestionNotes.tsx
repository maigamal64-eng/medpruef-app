"use client";

import { useEffect, useState } from "react";
import { StickyNote, ChevronDown, ChevronUp, BadgeCheck } from "lucide-react";
import { authFetch } from "@/lib/authFetch";
import { t, type Lang } from "@/lib/i18n";
import { noteReviewLabel, reviewLang, type NoteReview } from "@/lib/notes-review";

/**
 * Public (curated + community) flash-notes attached to the current question
 * (2026-07-03). Rendered in the answered state of QuestionCard, fed by
 * GET /api/notes/for-question (flag-gated by NOTES_EXPLORE_ENABLED; renders
 * nothing while the flag is off or when no notes exist). Curated notes are
 * badged "MedPrüf Team"; the projection is otherwise anonymous. TR-08: an
 * unreviewed AI-generated note also says "KI-Entwurf, ungeprüft" and drops
 * the check icon; a reviewed note names the reviewer role and date.
 */

interface NoteBlock {
  type: "concept" | "keyfact" | "pitfall" | "mnemonic";
  front?: string;
  back?: string;
  text?: string;
}
interface QNote {
  id: string;
  title: string;
  content: { title: string; blocks: NoteBlock[] };
  curated: boolean;
  review?: NoteReview | null;
}

export default function QuestionNotes({
  questionId,
  lang,
}: {
  questionId: number;
  lang: Lang;
}) {
  const [notes, setNotes] = useState<QNote[] | null>(null);
  const [open, setOpen] = useState(false);

  useEffect(() => {
    let cancelled = false;
    setNotes(null);
    setOpen(false);
    authFetch(`/api/notes/for-question?question_id=${questionId}`)
      .then((r) => (r.ok ? r.json() : null))
      .then((j) => {
        if (!cancelled && j?.enabled && Array.isArray(j.notes)) setNotes(j.notes);
      })
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, [questionId]);

  if (!notes || notes.length === 0) return null;

  return (
    <div className="mt-4 rounded-[var(--mp-r-card)] border border-[var(--mp-border)] bg-[var(--mp-surface-raised)] overflow-hidden">
      <button
        onClick={() => setOpen((o) => !o)}
        className="w-full flex items-center justify-between px-4 py-3 text-sm font-medium text-[var(--mp-fg)] hover:bg-[var(--mp-surface)] transition-colors"
      >
        <span className="flex items-center gap-2">
          <StickyNote className="w-4 h-4 text-[var(--mp-viridian)]" />
          {t("qnotes_heading", lang)}
          <span className="text-xs text-[var(--mp-fg-subtle)]">({notes.length})</span>
        </span>
        {open ? <ChevronUp className="w-4 h-4" /> : <ChevronDown className="w-4 h-4" />}
      </button>

      {open && (
        <div className="px-4 pb-4 space-y-4">
          {notes.map((n) => (
            <div key={n.id} className="rounded-[var(--mp-r-input)] border border-[var(--mp-border)] p-3">
              <div className="flex flex-wrap items-center gap-2 mb-2">
                <span className="text-sm font-semibold text-[var(--mp-fg)]">{n.title}</span>
                {n.curated && (
                  <span className="inline-flex items-center gap-1 text-[10px] font-medium text-[var(--mp-viridian)] bg-[var(--mp-viridian)]/10 rounded-full px-2 py-0.5">
                    {n.review?.status !== "ai_draft" && <BadgeCheck className="w-3 h-3" aria-hidden />}
                    {t("qnotes_curated", lang)}
                  </span>
                )}
                {(() => {
                  const label = noteReviewLabel(n.review, reviewLang(lang));
                  return label ? (
                    <span className="inline-flex items-center text-[10px] font-semibold text-[var(--mp-fg)] border border-[var(--mp-border)] rounded-full px-2 py-0.5" title={label.hint ?? undefined} data-review={n.review?.status}>
                      {label.text}
                    </span>
                  ) : null;
                })()}
              </div>
              <div className="space-y-2">
                {(n.content?.blocks ?? []).map((b, i) => {
                  if (b.type === "concept") {
                    return (
                      <div key={i} className="text-sm">
                        <p className="font-medium text-[var(--mp-fg)]">{b.front}</p>
                        <p className="text-[var(--mp-fg-muted)] mt-0.5">{b.back}</p>
                      </div>
                    );
                  }
                  const label =
                    b.type === "pitfall"
                      ? t("qnotes_pitfall", lang)
                      : b.type === "mnemonic"
                        ? t("qnotes_mnemonic", lang)
                        : t("qnotes_merke", lang);
                  const tone =
                    b.type === "pitfall"
                      ? "text-[var(--mp-status-warning)]"
                      : "text-[var(--mp-viridian)]";
                  return (
                    <p key={i} className="text-sm text-[var(--mp-fg-muted)]">
                      <span className={`font-semibold ${tone}`}>{label}: </span>
                      {b.text}
                    </p>
                  );
                })}
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
