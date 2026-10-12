"use client";

/**
 * ExamMinimap: question navigator grid for the running exam and the review
 * (UX-EXM-08/09/32). Cells live at module scope behind React.memo with
 * primitive props, so a clock tick or an answer elsewhere never replaces a
 * focused cell. States are composed, never colour alone: answered = fill and
 * bold numeral, partial = lower-half fill, flagged = corner flag glyph,
 * current = ring. Review cells add a check, cross or dash glyph.
 */
import { memo, useCallback, useRef } from "react";
import { Check, Flag, Minus, X } from "lucide-react";
import { te } from "@/lib/i18n-exam";

export type CellState = "open" | "answered" | "partial";
export type CellVerdict = "right" | "wrong" | "open";

interface CellProps {
  idx: number;
  pos: number;
  state: CellState;
  verdict: CellVerdict | null;
  flagged: boolean;
  current: boolean;
  dimmed: boolean;
  label: string;
  onJump: (idx: number) => void;
  onKey: (e: React.KeyboardEvent<HTMLButtonElement>, pos: number) => void;
}

const VERDICT_ICON = { right: Check, wrong: X, open: Minus } as const;

const MinimapCell = memo(function MinimapCell({ idx, pos, state, verdict, flagged, current, dimmed, label, onJump, onKey }: CellProps) {
  const VerdictIcon = verdict ? VERDICT_ICON[verdict] : null;
  const base = "relative aspect-square min-h-11 w-full rounded-md font-mono text-[13px] flex items-center justify-center gap-0.5 transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-[var(--mp-focus-color,var(--mp-cta-blue))] focus-visible:ring-offset-2";
  const fill = verdict
    ? verdict === "right" ? "bg-[var(--mp-success-bg,var(--mp-surface-sunken))] text-[var(--mp-success-text,var(--mp-fg))] border border-[var(--mp-border)] font-bold"
      : verdict === "wrong" ? "bg-[var(--mp-error-bg)] text-[var(--mp-error-text)] border border-[var(--mp-border)] font-bold"
        : "bg-[var(--mp-surface-sunken)] text-[var(--mp-fg-muted)] border border-[var(--mp-border)]"
    : state === "answered" ? "bg-[var(--mp-oxford-blue)] text-white border border-transparent font-bold"
      : state === "partial" ? "mp-exam-cell-partial text-[var(--mp-fg)] border border-[var(--mp-border)] font-bold"
        : "bg-[var(--mp-surface-sunken)] text-[var(--mp-fg-muted)] border border-[var(--mp-border)]";
  const ring = current ? " ring-2 ring-[var(--mp-viridian)] ring-offset-2 ring-offset-[var(--mp-surface-raised)]" : "";
  return (
    <button
      type="button"
      data-cell-idx={idx}
      onClick={() => onJump(idx)}
      onKeyDown={(e) => onKey(e, pos)}
      className={`${base} ${fill}${ring}${dimmed ? " opacity-40" : ""}`}
      aria-label={label}
      aria-current={current ? "true" : undefined}
    >
      <span>{idx + 1}</span>
      {VerdictIcon && <VerdictIcon className="w-3 h-3" aria-hidden />}
      {flagged && <Flag className="absolute top-0.5 end-0.5 w-3 h-3 text-[var(--mp-status-warning)] fill-current" aria-hidden />}
    </button>
  );
});

export interface ExamMinimapProps {
  count: number;
  states: readonly CellState[];
  verdicts?: readonly (CellVerdict | null)[];
  flagged: ReadonlySet<number>;
  currentIdx: number;
  onlyFlagged: boolean;
  lang: string;
  onJump: (idx: number) => void;
}

export function ExamMinimap({ count, states, verdicts, flagged, currentIdx, onlyFlagged, lang, onJump }: ExamMinimapProps) {
  const ref = useRef<HTMLDivElement>(null);
  const jumpRef = useRef(onJump);
  jumpRef.current = onJump;
  const jump = useCallback((idx: number) => jumpRef.current(idx), []);
  const onKey = useCallback((e: React.KeyboardEvent<HTMLButtonElement>, pos: number) => {
    const cells = ref.current ? [...ref.current.querySelectorAll<HTMLButtonElement>("[data-cell-idx]")] : [];
    if (cells.length === 0) return;
    let cols = 0;
    const top = cells[0].offsetTop;
    for (const c of cells) { if (c.offsetTop === top) cols++; else break; }
    cols = Math.max(1, cols);
    const rtl = getComputedStyle(ref.current!).direction === "rtl";
    let next = pos;
    if (e.key === "ArrowRight") next = Math.min(cells.length - 1, pos + (rtl ? -1 : 1));
    else if (e.key === "ArrowLeft") next = Math.max(0, pos + (rtl ? 1 : -1));
    else if (e.key === "ArrowDown") next = Math.min(cells.length - 1, pos + cols);
    else if (e.key === "ArrowUp") next = Math.max(0, pos - cols);
    else return;
    e.preventDefault();
    next = Math.max(0, Math.min(cells.length - 1, next));
    cells[next]?.focus();
  }, []);

  const label = (i: number) => {
    const parts = [te("question_label", lang, { n: i + 1 })];
    const v = verdicts?.[i];
    if (v) parts.push(te(v === "right" ? "review_status_right" : v === "wrong" ? "review_status_wrong" : "review_status_open", lang));
    else if (states[i] === "answered") parts.push(te("legend_answered", lang));
    else if (states[i] === "partial") parts.push(te("legend_partial", lang));
    else parts.push(te("legend_open", lang));
    if (flagged.has(i)) parts.push(te("legend_flagged", lang));
    return parts.join(", ");
  };

  return (
    <div>
      <div ref={ref} role="group" aria-label={te("drawer_title", lang)} className="grid gap-2" style={{ gridTemplateColumns: "repeat(auto-fill, minmax(44px, 1fr))" }}>
        {Array.from({ length: count }, (_, i) => (
          <MinimapCell
            key={i}
            idx={i}
            pos={i}
            state={states[i] ?? "open"}
            verdict={verdicts?.[i] ?? null}
            flagged={flagged.has(i)}
            current={i === currentIdx}
            dimmed={onlyFlagged && !flagged.has(i)}
            label={label(i)}
            onJump={jump}
            onKey={onKey}
          />
        ))}
      </div>
      <div className="mt-3 flex flex-wrap gap-x-3 gap-y-1 text-[13px] text-[var(--mp-fg-muted)]">
        {!verdicts && <span className="inline-flex items-center gap-1.5"><span className="w-3 h-3 rounded-sm bg-[var(--mp-oxford-blue)]" />{te("legend_answered", lang)}</span>}
        {!verdicts && <span className="inline-flex items-center gap-1.5"><span className="w-3 h-3 rounded-sm mp-exam-cell-partial border border-[var(--mp-border)]" />{te("legend_partial", lang)}</span>}
        {verdicts && <span className="inline-flex items-center gap-1"><Check className="w-3 h-3" aria-hidden />{te("review_status_right", lang)}</span>}
        {verdicts && <span className="inline-flex items-center gap-1"><X className="w-3 h-3" aria-hidden />{te("review_status_wrong", lang)}</span>}
        {verdicts && <span className="inline-flex items-center gap-1"><Minus className="w-3 h-3" aria-hidden />{te("review_status_open", lang)}</span>}
        <span className="inline-flex items-center gap-1"><Flag className="w-3 h-3 text-[var(--mp-status-warning)] fill-current" aria-hidden />{te("legend_flagged", lang)}</span>
        <span className="inline-flex items-center gap-1.5"><span className="w-3 h-3 rounded-sm ring-2 ring-[var(--mp-viridian)]" />{te("legend_current", lang)}</span>
      </div>
    </div>
  );
}
