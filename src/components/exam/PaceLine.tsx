"use client";

/**
 * Pace line (SIM-11, pick-exam-pace A): an optional line in the exam overview,
 * OFF by default, comparing answered questions with the per-question target.
 * It reads the elapsed time of the one exam clock and re-renders every 15 s;
 * it never runs a second visible clock.
 */
import { useEffect, useState } from "react";
import { paceSnapshot } from "@/lib/master-exam";
import { formatMinSec } from "@/lib/exam-run";
import { te } from "@/lib/i18n-exam";
import { safeStorage } from "@/lib/safe-storage";
import { Switch } from "@/components/ui/Switch";

const PACE_KEY = "medpruef_exam_pace_on";

export function usePacePreference(): [boolean, (on: boolean) => void] {
  const [on, setOn] = useState(false);
  useEffect(() => { setOn(safeStorage.getItem(PACE_KEY) === "1"); }, []);
  return [on, (next: boolean) => { setOn(next); safeStorage.setItem(PACE_KEY, next ? "1" : "0"); }];
}

export function PaceLine({ startedAt, answered, total, targetS, lang, on, onToggle }: {
  startedAt: number; answered: number; total: number; targetS: number; lang: string; on: boolean; onToggle: (on: boolean) => void;
}) {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    if (!on) return;
    setNow(Date.now());
    const id = setInterval(() => setNow(Date.now()), 15_000);
    return () => clearInterval(id);
  }, [on]);
  const snap = paceSnapshot((now - startedAt) / 1000, answered, total, targetS);
  const key = snap.state === "ahead" ? "pace_ahead" : snap.state === "behind" ? "pace_behind" : "pace_on_track";
  return (
    <div className="space-y-1">
      <Switch checked={on} onChange={onToggle} label={te("pace_toggle", lang)} />
      {on && (
        <p className="text-[13px] text-[var(--mp-fg-muted)]" role="status">
          {te(key, lang, { answered: snap.answered, expected: snap.expected })}
          <span className="block">{te("pace_target", lang, { target: formatMinSec(targetS) })}</span>
        </p>
      )}
    </div>
  );
}
