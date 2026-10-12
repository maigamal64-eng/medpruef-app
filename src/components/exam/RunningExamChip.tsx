"use client";

/**
 * Running-exam chip (UX-EXM-02): on Home, Quiz and Fortschritt, a calm in-flow
 * status line while a timed exam runs on this device: "Prüfung läuft, noch
 * 2:41. Fortsetzen". Read synchronously from the saved session (no network),
 * so it works offline and does not flash. Hidden for the browser session on
 * request; the /exam resume card is always there. At zero it offers the result.
 */
import { useEffect, useState } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { Clock, X } from "lucide-react";
import { getStoredSession } from "@/lib/auth";
import { loadExamSession, loadPendingExams, remainingSeconds } from "@/lib/examSession";
import { useLang } from "@/lib/i18n";
import { te } from "@/lib/i18n-exam";

const PATHS = new Set(["/", "/quiz", "/progress"]);
const HIDE_KEY = "medpruef_exam_chip_hidden";

function read(): { left: number | null; untimed: boolean } | null {
  const id = getStoredSession()?.user?.id;
  if (!id || id.startsWith("guest_")) return null;
  const saved = loadExamSession(id);
  if (!saved || saved.finishedAt) return null;
  // A submitted run waits in the pending outbox until History acknowledges it; it is not running.
  if (saved.attemptId && loadPendingExams(id).some((p) => p.attemptId === saved.attemptId)) return null;
  if (saved.untimed) return { left: null, untimed: true };
  return { left: remainingSeconds(saved.startedAt, saved.durationS), untimed: false };
}

export default function RunningExamChip() {
  const pathname = usePathname();
  const lang = useLang();
  const [state, setState] = useState<ReturnType<typeof read>>(null);
  const [hidden, setHidden] = useState(true);

  useEffect(() => {
    if (!PATHS.has(pathname)) { setState(null); return; }
    try { setHidden(sessionStorage.getItem(HIDE_KEY) === "1"); } catch { setHidden(false); }
    setState(read());
    const id = setInterval(() => setState(read()), 30_000);
    return () => clearInterval(id);
  }, [pathname]);

  if (!state || hidden) return null;
  const expired = !state.untimed && state.left !== null && state.left <= 0;
  const h = Math.floor((state.left ?? 0) / 3600);
  const m = Math.floor(((state.left ?? 0) % 3600) / 60);
  const text = expired ? te("chip_expired", lang) : state.untimed ? te("chip_untimed", lang) : te("chip_running", lang, { time: `${h}:${String(m).padStart(2, "0")}` });
  return (
    <div className="flex items-center gap-2 px-4 py-1.5 border-b border-[var(--mp-border)] bg-[var(--mp-surface-raised)] text-sm text-[var(--mp-fg)]" role="status" data-testid="running-exam-chip">
      <Clock className="w-4 h-4 shrink-0 text-[var(--mp-fg-muted)]" aria-hidden />
      <span className="min-w-0 flex-1">{text}</span>
      <Link href="/exam" className="mp-btn mp-btn--primary min-h-11 px-3">{expired ? te("resume_view_result", lang) : te("chip_resume", lang)}</Link>
      <button type="button" className="min-h-11 min-w-11 inline-flex items-center justify-center rounded-lg text-[var(--mp-fg-muted)] hover:text-[var(--mp-fg)]" aria-label={te("chip_hide", lang)}
        onClick={() => { setHidden(true); try { sessionStorage.setItem(HIDE_KEY, "1"); } catch { /* page state still hides it */ } }}>
        <X className="w-4 h-4" aria-hidden />
      </button>
    </div>
  );
}
