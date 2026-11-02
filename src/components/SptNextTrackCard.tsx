"use client";

/**
 * Home pointer from the Stichprobentest to Rezeptierkunde (a-growth-lines-1102,
 * A2, SPT_NEXT_TRACK_ENABLED, default OFF). For a learner whose Stichprobentest
 * sitting has passed it says the route continues and opens the Rezeptierkunde
 * bank through the one exam-switch write (so active_exam flips and the start
 * counts). One marketing surface at a time through the announcement queue
 * ("spt_next_track"), never in a Rezeptierkunde or Gerichtsmedizin exam week;
 * "Ausblenden" quiets it for 14 days. Show rule: src/lib/spt-next-track/rules.ts;
 * copy: src/lib/spt-next-track/copy.ts (Lektor APPROVE, byte-exact).
 */
import { useEffect, useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { Route } from "lucide-react";
import { useUserTier } from "@/lib/hooks/useUserTier";
import { dismissSurface, isSurfaceDismissed, useAnnouncementSlot } from "@/lib/announcements/queue";
import { switchActiveExam } from "@/lib/exam-switch";
import { buildQuizHref } from "@/lib/quiz-links";
import { tc } from "@/lib/i18n-cram";
import { trackEvent } from "@/lib/tracker";
import { A2_POINTER, sptLang } from "@/lib/spt-next-track/copy";
import { planSptNextTrack } from "@/lib/spt-next-track/rules";

export default function SptNextTrackCard({
  userId,
  lang,
  bank,
  examDate,
  className = "",
}: {
  userId: string;
  lang: string;
  /** The saved bank (users.active_exam). */
  bank: string | null;
  /** users.exam_date. */
  examDate: string | null;
  className?: string;
}) {
  const { sptNextTrack, sptNextTrackSample, isPaid, isLoading } = useUserTier();
  const router = useRouter();
  const l = sptLang(lang);
  const c = A2_POINTER[l];
  const isGuest = !userId || userId.startsWith("guest_");
  const [hidden, setHidden] = useState(false);
  const [busy, setBusy] = useState(false);
  const [failed, setFailed] = useState(false);
  const working = useRef(false);

  // The rule reads the clock: re-planned every 5 minutes and on return to the tab, so a tab left open across midnight into an exam week drops the card.
  const [clock, setClock] = useState(0);
  useEffect(() => {
    const bump = () => setClock((n) => n + 1);
    const timer = window.setInterval(bump, 5 * 60_000);
    const onVisible = () => { if (document.visibilityState === "visible") bump(); };
    document.addEventListener("visibilitychange", onVisible);
    return () => { window.clearInterval(timer); document.removeEventListener("visibilitychange", onVisible); };
  }, []);
  const plan = useMemo(
    () => (sptNextTrack && !isGuest && !isLoading
      ? planSptNextTrack({ now: new Date(), examSource: bank, examDate, isPaid, pharmaFreeSample: sptNextTrackSample })
      : null),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [sptNextTrack, sptNextTrackSample, isGuest, isLoading, bank, examDate, isPaid, clock],
  );
  const wants = Boolean(plan) && !hidden && !isSurfaceDismissed("spt_next_track");
  const granted = useAnnouncementSlot("spt_next_track", wants);
  if (!granted || !plan || hidden) return null;

  const open = async () => {
    if (working.current) return;
    working.current = true;
    setBusy(true);
    setFailed(false);
    trackEvent("cta_click", { surface: "spt_next_track", cta: "practise_pharma", exam: "pharma" });
    const result = await switchActiveExam("pharma", "kmp_innsbruck");
    if (result === "saved") {
      // The guard stays set: the card unmounts on navigation, and a second tap must not switch again.
      router.push(buildQuizHref({ examSource: "pharma" }));
      return;
    }
    working.current = false;
    setBusy(false);
    setFailed(true);
  };

  return (
    <section
      data-testid="spt-next-track-card"
      aria-labelledby="spt-next-track-title"
      className={`rounded-[var(--mp-r-card)] border border-[var(--mp-border)] bg-[var(--mp-surface-raised)] px-4 py-3 ${className}`}
    >
      <div className="flex items-start gap-2.5">
        <Route className="w-4 h-4 mt-0.5 flex-shrink-0 text-[var(--mp-cta-blue)]" aria-hidden />
        <div className="min-w-0 flex-1">
          <h2 id="spt-next-track-title" className="text-sm font-semibold leading-snug text-[var(--mp-fg)]">{c.title}</h2>
          <p className="mt-0.5 text-sm leading-snug text-[var(--mp-fg)]">{c.body}</p>
          {plan.sampleLine && <p className="mt-1 text-sm leading-snug text-[var(--mp-fg-muted)]" data-testid="spt-next-track-sample">{c.sampleLine}</p>}
          <div className="mt-2 flex flex-wrap items-center gap-x-4 gap-y-1">
            <button
              type="button"
              onClick={() => void open()}
              disabled={busy}
              aria-busy={busy || undefined}
              className="mp-btn mp-btn--secondary min-h-11 disabled:opacity-60"
            >
              {c.cta}
            </button>
            <button
              type="button"
              onClick={() => { setHidden(true); dismissSurface("spt_next_track", "later"); }}
              className="inline-flex items-center min-h-11 text-xs font-medium text-[var(--mp-fg-muted)] hover:text-[var(--mp-fg)]"
            >
              {tc("rezgm_dismiss", lang)}
            </button>
          </div>
          {failed && <p role="alert" className="mt-1 text-xs text-[var(--mp-error-text)]">{tc("part_failed", lang)}</p>}
        </div>
      </div>
    </section>
  );
}
