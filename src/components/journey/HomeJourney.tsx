"use client";

/**
 * HomeJourney (a-journey-engine): the learner's exam moments on Home, under
 * the hero, in the slot of the deadline line. While MOMENTS_ENABLED is off
 * (/api/journey answers {enabled:false}), or before the read lands, it is
 * exactly the plain HomeDeadlineLine.
 *
 *  - M2/M3: the deadline line shows the learner's own sitting (official link
 *    included); "Ich habe mich angemeldet" sits under it and turns into the
 *    confirmation once saved.
 *  - M4: from 28 days before the sitting, one card for timed practice (and
 *    the KAF mode where it is live and the learner sits SIP4a).
 *  - M5: on the exam day one line, nothing to buy. In the sitting week the
 *    announcement queue holds every promotion surface.
 *  - M6: after the sitting, a link to the results question on the Settings
 *    exam report card (a-results-route), only while that route is on.
 *  - No named exam: "Wann ist Ihre Prüfung?" opens the sitting picker.
 * Dates are shown only by the deadline line; nothing here formats a date.
 */

import { useCallback, useEffect, useRef, useState } from "react";
import Link from "next/link";
import { CalendarCheck, Timer } from "lucide-react";
import HomeDeadlineLine from "@/components/HomeDeadlineLine";
import { authFetch } from "@/lib/authFetch";
import { safeSessionStorage } from "@/lib/safe-storage";
import { trackEvent } from "@/lib/tracker";
import { dismissSurface, setAnnouncementContext, useAnnouncementSlot } from "@/lib/announcements/queue";
import { useUserTier } from "@/lib/hooks/useUserTier";
import { jt } from "@/lib/journey/copy";
import type { JourneyView } from "@/lib/journey/view";
import { mockHrefFor, type MomentCode } from "@/lib/journey/home";

type Loaded = JourneyView & { enabled: true };

const SHOWN_PREFIX = "medpruef_moment_shown:";

/** One moment_shown per moment and sitting per browser session. */
function trackShown(code: MomentCode, view: JourneyView) {
  const key = `${SHOWN_PREFIX}${code}:${view.named?.key ?? "none"}`;
  try {
    if (safeSessionStorage.getItem(key)) return;
    safeSessionStorage.setItem(key, "1");
  } catch {
    /* storage blocked: count it anyway */
  }
  trackEvent("moment_shown", { moment: code, exam: view.named?.segment ?? "unknown", surface: "home" });
}

export default function HomeJourney({ className = "", userId, lang, canMock }: {
  className?: string;
  userId: string | null;
  lang: string;
  /** The learner may start a mock exam (entitlement mock_exam); otherwise the button opens the plan gate. */
  canMock: boolean;
}) {
  const [view, setView] = useState<Loaded | null>(null);
  const [lineShown, setLineShown] = useState(false);
  const [saving, setSaving] = useState(false);
  const [failed, setFailed] = useState(false);
  const busy = useRef(false);

  const load = useCallback(async () => {
    if (!userId || userId.startsWith("guest_")) return;
    try {
      const r = await authFetch("/api/journey", { timeoutMs: 8_000, skipAuthRedirect: true });
      if (!r.ok) return;
      const body = (await r.json()) as { enabled?: boolean } & Partial<JourneyView>;
      setView(body.enabled === true && typeof body.phase === "string" ? (body as Loaded) : null);
    } catch {
      /* the plain deadline line stays */
    }
  }, [userId]);

  useEffect(() => {
    void load();
    const onExam = () => void load();
    window.addEventListener("medpruef:examChanged", onExam);
    return () => window.removeEventListener("medpruef:examChanged", onExam);
  }, [load]);

  // Sitting week: promotion surfaces wait (journey M5).
  const paused = Boolean(view?.sittingWeek);
  useEffect(() => {
    setAnnouncementContext({ marketingPaused: paused });
  }, [paused]);
  useEffect(() => () => setAnnouncementContext({ marketingPaused: false }), []);

  const registration = view?.phase === "registration" && view.named ? view : null;
  const restrict = registration?.named
    ? { key: registration.named.key, exams: registration.named.exam_keys, date: registration.named.date }
    : null;

  // a-cram-card: with the Home cram card on, it owns M4 for SIP and Rez/GM sittings (Lektor-gated copy);
  // this older card stays for any other named sitting.
  const { homeCramCard } = useUserTier();
  const cramCardOwnsM4 = homeCramCard && Boolean(view?.named) && view?.named?.segment !== "stichprobentest";
  const wantsCram = Boolean(view?.inCram && view.phase !== "exam_day" && (canMock || !view.sittingWeek) && !cramCardOwnsM4);
  const wantsAsk = view?.phase === "ask";
  const cramSlot = useAnnouncementSlot("journey_cram", wantsCram);
  const askSlot = useAnnouncementSlot("journey_sitting_prompt", wantsAsk);
  const showHandoff = view?.phase === "results" && view.resultsRoute;
  const showExamDay = view?.phase === "exam_day";

  useEffect(() => {
    if (!view) return;
    if (registration && lineShown) trackShown(view.closingSoon ? "m3" : "m2", view);
    if (cramSlot) trackShown("m4", view);
    if (showExamDay) trackShown("m5", view);
    if (showHandoff) trackShown("m6", view);
    if (askSlot) trackShown("ask", view);
  }, [view, registration, lineShown, cramSlot, showExamDay, showHandoff, askSlot]);

  const confirm = async () => {
    if (!view?.named || busy.current) return;
    busy.current = true;
    setSaving(true);
    setFailed(false);
    try {
      const r = await authFetch("/api/journey", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "registered", sitting_key: view.named.key }),
        timeoutMs: 15_000,
        skipAuthRedirect: true,
      });
      const body = (await r.json().catch(() => null)) as (Partial<JourneyView> & { ok?: boolean }) | null;
      if (!r.ok || body?.ok !== true || typeof body.phase !== "string") throw new Error("not saved");
      setView({ ...(body as JourneyView), enabled: true });
    } catch {
      setFailed(true);
    } finally {
      busy.current = false;
      setSaving(false);
    }
  };

  const action = registration?.canConfirm ? (
    <div className="mt-1 border-t border-[var(--mp-border)] pt-2">
      {registration.registered ? (
        <p role="status" className="flex items-start gap-2 text-sm leading-snug text-[var(--mp-fg)]">
          <CalendarCheck className="w-4 h-4 mt-0.5 flex-shrink-0 text-[var(--mp-viridian)]" aria-hidden />
          {jt("registered_confirmation", lang)}
        </p>
      ) : (
        <>
          <button
            type="button"
            onClick={confirm}
            aria-busy={saving || undefined}
            aria-disabled={saving || undefined}
            className="mp-btn mp-btn--secondary min-h-11"
          >
            {saving ? jt("registered_saving", lang) : jt("registered_button", lang)}
          </button>
          {failed && (
            <p role="alert" className="mt-1 text-xs text-[var(--mp-error-text)]">
              {jt("registered_failed", lang)}
            </p>
          )}
        </>
      )}
    </div>
  ) : null;

  const named = view?.named ?? null;

  return (
    <div className={className}>
      <HomeDeadlineLine restrict={restrict} action={action} onContent={setLineShown} />

      {showExamDay && (
        <p data-moment="m5" className="mt-3 rounded-[var(--mp-r-card)] border border-[var(--mp-border)] bg-[var(--mp-surface-raised)] px-4 py-3 text-sm leading-snug text-[var(--mp-fg)]">
          {jt("exam_day", lang)}
        </p>
      )}

      {cramSlot && named && (
        <section
          data-moment="m4"
          aria-label={jt("region", lang)}
          className="mt-3 rounded-[var(--mp-r-card)] border border-[var(--mp-border)] bg-[var(--mp-surface-raised)] px-4 py-3"
        >
          <div className="flex items-start gap-2.5">
            <Timer className="w-4 h-4 mt-0.5 flex-shrink-0 text-[var(--mp-cta-blue)]" aria-hidden />
            <div className="min-w-0 flex-1">
              <p className="text-sm leading-snug text-[var(--mp-fg)]">{jt("cram_body", lang)}</p>
              <div className="mt-2 flex flex-wrap items-center gap-x-4 gap-y-1">
                <Link href={mockHrefFor(named.exam_keys, canMock)} className="mp-btn mp-btn--secondary min-h-11">
                  {jt("cram_mock", lang)}
                </Link>
                {view?.kaf && canMock && (
                  <Link href="/exam/kaf" className="inline-flex items-center min-h-11 text-sm font-semibold text-[var(--mp-cta-blue)] underline underline-offset-2">
                    {jt("cram_kaf", lang)}
                  </Link>
                )}
                <button
                  type="button"
                  onClick={() => dismissSurface("journey_cram", "later")}
                  className="inline-flex items-center min-h-11 text-xs font-medium text-[var(--mp-fg-muted)] hover:text-[var(--mp-fg)]"
                >
                  {jt("later", lang)}
                </button>
              </div>
            </div>
          </div>
        </section>
      )}

      {showHandoff && (
        <Link
          href="/settings#pruefungsbericht"
          data-moment="m6"
          className="mt-3 flex items-center min-h-11 rounded-[var(--mp-r-card)] border border-[var(--mp-border)] bg-[var(--mp-surface-raised)] px-4 py-3 text-sm font-semibold text-[var(--mp-cta-blue)] underline underline-offset-2"
        >
          {jt("results_handoff", lang)}
        </Link>
      )}

      {askSlot && (
        <section
          data-moment="ask"
          aria-labelledby="journey-ask-title"
          className="mt-3 rounded-[var(--mp-r-card)] border border-[var(--mp-border)] bg-[var(--mp-surface-raised)] px-4 py-3"
        >
          <h2 id="journey-ask-title" className="text-sm font-semibold text-[var(--mp-fg)]">{jt("ask_title", lang)}</h2>
          <p className="mt-0.5 text-sm leading-snug text-[var(--mp-fg-muted)]">{jt("ask_body", lang)}</p>
          <div className="mt-2 flex flex-wrap items-center gap-x-4 gap-y-1">
            <Link href="/settings#exam-date" className="mp-btn mp-btn--secondary min-h-11">
              {jt("ask_button", lang)}
            </Link>
            <button
              type="button"
              onClick={() => dismissSurface("journey_sitting_prompt", "later")}
              className="inline-flex items-center min-h-11 text-xs font-medium text-[var(--mp-fg-muted)] hover:text-[var(--mp-fg)]"
            >
              {jt("later", lang)}
            </button>
          </div>
        </section>
      )}
    </div>
  );
}
