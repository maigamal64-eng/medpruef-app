"use client";

/**
 * ExamClock: the one ticking element of a running exam (UX-EXM-08). It owns the
 * per-second state so the page, the minimap and the question card do not
 * re-render every second. Wall-clock based (UX-EXM-04): the remaining time is
 * derived from the absolute start, resynced on visibility, pageshow and focus,
 * and never moves backwards.
 */
import { memo, useEffect, useRef, useState } from "react";
import { Clock } from "lucide-react";
import { wallClockRemaining } from "@/lib/practice-exam-state";
import { remainingSeconds } from "@/lib/examSession";
import { te } from "@/lib/i18n-exam";

export function formatClock(seconds: number): string {
  const s = Math.max(0, Math.floor(seconds));
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  return `${String(h).padStart(2, "0")}:${String(m).padStart(2, "0")}:${String(s % 60).padStart(2, "0")}`;
}

export interface ExamClockProps {
  startedAt: number;
  durationS: number;
  untimed: boolean;
  lang: string;
  /** Called once when the remaining time reaches zero. */
  onExpire: () => void;
  /** 30, 10 and 5 minute milestones (once each) and resyncs after a gap. */
  onMilestone: (minutes: number) => void;
  onResync: (secondsLeft: number) => void;
}

function ExamClockImpl({ startedAt, durationS, untimed, lang, onExpire, onMilestone, onResync }: ExamClockProps) {
  const [left, setLeft] = useState(() => (untimed ? 0 : remainingSeconds(startedAt, durationS)));
  const prev = useRef(left);
  const fired = useRef(new Set<number>());
  const expired = useRef(false);
  const handlers = useRef({ onExpire, onMilestone, onResync });
  handlers.current = { onExpire, onMilestone, onResync };

  useEffect(() => {
    if (untimed) return;
    prev.current = remainingSeconds(startedAt, durationS);
    // Milestones already passed before a resume do not fire again.
    for (const m of [30, 10, 5]) if (prev.current <= m * 60) fired.current.add(m);
    expired.current = false;
    const tick = (resync = false) => {
      const next = wallClockRemaining(startedAt, durationS, Date.now(), prev.current);
      const jumped = prev.current - next > 2;
      prev.current = next;
      setLeft(next);
      if (resync && jumped && document.visibilityState === "visible") handlers.current.onResync(next);
      for (const m of [30, 10, 5]) {
        if (next > 0 && next <= m * 60 && !fired.current.has(m)) {
          fired.current.add(m);
          handlers.current.onMilestone(m);
        }
      }
      if (next === 0 && !expired.current) {
        expired.current = true;
        handlers.current.onExpire();
      }
    };
    tick();
    const id = setInterval(() => tick(), 1000);
    const resync = () => tick(true);
    document.addEventListener("visibilitychange", resync);
    window.addEventListener("pageshow", resync);
    window.addEventListener("focus", resync);
    return () => {
      clearInterval(id);
      document.removeEventListener("visibilitychange", resync);
      window.removeEventListener("pageshow", resync);
      window.removeEventListener("focus", resync);
    };
  }, [startedAt, durationS, untimed]);

  if (untimed) {
    return <span className="inline-flex gap-1 items-center text-sm font-semibold text-[var(--mp-fg)]"><Clock className="w-4 h-4" aria-hidden />{te("untimed_clock", lang)}</span>;
  }
  const urgent = left <= 300;
  return (
    <span dir="ltr" className={`inline-flex gap-1 items-center font-mono tabular-nums font-bold ${urgent ? "text-[var(--mp-error-text)]" : "text-[var(--mp-fg)]"}`}>
      <Clock className="w-4 h-4" aria-hidden />
      <span>{formatClock(left)}</span>
    </span>
  );
}

export const ExamClock = memo(ExamClockImpl);
