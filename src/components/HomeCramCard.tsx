"use client";

/**
 * HomeCramCard (a-cram-card, behind HOME_CRAM_CARD_ENABLED): the Home card for
 * the weeks before the learner's own sitting, beside HomeDeadlineLine.
 *
 *  - SIP4a / SIP5a: from 28 days before the sitting to the day before. A saved
 *    sitting gets the countdown and the dated body; a learner with only the
 *    saved bank gets the neutral review-phase variant plus one tap to name the
 *    sitting (same PATCH /api/user/exam-preference every date picker uses).
 *  - Rezeptierkunde / Gerichtsmedizin exam week: from 28 days before the week
 *    to its last day, state A (Rez) or B (Rez + GM, only while GM practice is
 *    available).
 * Show rules live in src/lib/home-cram-card/rules.ts; copy in
 * src/lib/i18n-cram.ts (Lektor-gated kits). One surface at a time through the
 * announcement queue ("home_cram"); "Ausblenden" hides it 7 days for this
 * account on this device. Never shows a date it did not read from
 * OFFICIAL_SITTINGS, never a medical line.
 */
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import { ExternalLink, Timer } from "lucide-react";
import { authFetch } from "@/lib/authFetch";
import { announce } from "@/lib/announce";
import { safeSessionStorage, safeStorage } from "@/lib/safe-storage";
import { trackEvent } from "@/lib/tracker";
import { dismissSurface, useAnnouncementSlot } from "@/lib/announcements/queue";
import { useUserTier } from "@/lib/hooks/useUserTier";
import { useMentorAvailability } from "@/components/mentor/useMentorAvailability";
import { PHARMA_INFO_URL, type OfficialSitting } from "@/lib/exam-dates";
import { formatOfficialDate, formatSittingWhen } from "@/lib/i18n-dates";
import { pricingV2Enabled } from "@/lib/pricing-v2/flag";
import { mockHrefFor } from "@/lib/journey/home";
import { t, type Lang } from "@/lib/i18n";
import { tc } from "@/lib/i18n-cram";
import {
  CRAM_DISMISS_MS,
  cramNeeds,
  isCramDismissed,
  planCramCard,
  rowLabel,
  type CramCredits,
  type CramPlan,
} from "@/lib/home-cram-card/rules";

export const CRAM_DISMISS_PREFIX = "medpruef_cram_dismissed_v1:";
const SHOWN_PREFIX = "medpruef_cram_shown_v1:";

type Target = "plan" | "pricing" | "part" | "simulation" | "official";

type CardRead = { enabled?: boolean; gm?: boolean; credits?: CramCredits | null };
const READ_TTL_MS = 2 * 60_000;
const reads = new Map<string, { at: number; promise: Promise<CardRead | null> }>();

/** One read per account and kind in two minutes, shared by every mount (Home re-mounts its regions while it loads). */
function readCard(userId: string, need: "credits" | "gm"): Promise<CardRead | null> {
  const key = `${userId}:${need}`;
  const hit = reads.get(key);
  if (hit && Date.now() - hit.at < READ_TTL_MS) return hit.promise;
  const promise = (async (): Promise<CardRead | null> => {
    try {
      const res = await authFetch(`/api/home/cram-card?need=${need}`, { cache: "no-store", timeoutMs: 8_000, skipAuthRedirect: true });
      return res.ok ? ((await res.json()) as CardRead) : null;
    } catch {
      return null;
    }
  })();
  reads.set(key, { at: Date.now(), promise });
  return promise;
}

function readDismissed(userId: string): boolean {
  try { return isCramDismissed(safeStorage.getItem(CRAM_DISMISS_PREFIX + userId), Date.now()); } catch { return false; }
}

export default function HomeCramCard({ userId, lang, bank, examDate, canMock, onSittingSet, className = "" }: {
  userId: string;
  lang: Lang;
  /** The saved bank from the server study snapshot (users.active_exam), null until known. */
  bank: string | null;
  /** The saved exam date from the same snapshot. */
  examDate: string | null;
  /** Mock exams are part of the learner's plan (entitlement); otherwise the simulation link opens the plan gate. */
  canMock: boolean;
  /** Called after a sitting was saved from the card, so Home reads the new date. */
  onSittingSet?: (date: string) => void;
  className?: string;
}) {
  const { homeCramCard, isPaid, isLoading: tierLoading } = useUserTier();
  const availability = useMentorAvailability();
  const isGuest = userId.startsWith("guest_");
  // null until storage was read: nothing is elected, shown or counted before the dismissal is known.
  const [dismissed, setDismissed] = useState<boolean | null>(null);
  const [credits, setCredits] = useState<CramCredits | null>(null);
  // Server reads: undefined = not asked / pending, resolved once answered or failed.
  const [gm, setGm] = useState<boolean | undefined>(undefined);
  // The window is read against the clock: re-planned every 5 minutes and on return to the tab (self-aging like HomeDeadlineLine).
  const [clock, setClock] = useState(0);
  const [savedDate, setSavedDate] = useState<string | null>(null);
  const [savedLabel, setSavedLabel] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [failed, setFailed] = useState(false);
  const busy = useRef(false);

  useEffect(() => {
    setDismissed(readDismissed(userId));
    // A different account on the same mount starts clean.
    setSavedDate(null); setSavedLabel(null); setCredits(null); setGm(undefined);
  }, [userId]);
  // Once the server snapshot carries the date that was saved here, it is the source again.
  useEffect(() => { if (savedDate && examDate === savedDate) setSavedDate(null); }, [examDate, savedDate]);
  useEffect(() => {
    const bump = () => setClock((n) => n + 1);
    const timer = window.setInterval(bump, 5 * 60_000);
    const onVisible = () => { if (document.visibilityState === "visible") bump(); };
    document.addEventListener("visibilitychange", onVisible);
    return () => { window.clearInterval(timer); document.removeEventListener("visibilitychange", onVisible); };
  }, []);

  const input = useMemo(() => ({
    now: new Date(),
    examSource: bank,
    examDate: savedDate ?? examDate,
    isPaid,
    pricingV2: pricingV2Enabled(),
    gmAvailable: gm === true,
    credits,
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }), [bank, examDate, savedDate, isPaid, gm, credits, clock]);

  const base = useMemo(() => (homeCramCard && !isGuest && bank ? planCramCard(input) : null), [homeCramCard, isGuest, bank, input]);
  const need = cramNeeds(base);

  // One read per kind, only while a card could show. Credits wait for the mentor to be available; the card never waits on them.
  useEffect(() => {
    if (!need || dismissed !== false) return;
    if (need === "credits" && availability !== "available") return;
    let cancelled = false;
    void readCard(userId, need).then((body) => {
      if (cancelled) return;
      if (need === "gm") setGm(body?.enabled === true && body.gm === true);
      else if (body?.enabled === true && body.credits && typeof body.credits.credits === "number" && typeof body.credits.expires_at === "string") setCredits(body.credits);
    });
    return () => { cancelled = true; };
  }, [need, dismissed, availability, userId]);

  const plan: CramPlan | null = base;
  // Rez/GM waits for the GM answer (A or B, no flicker); the SIP card never waits for credits.
  const ready = !tierLoading && (need !== "gm" || gm !== undefined);
  const wants = Boolean(plan && dismissed === false && ready);
  const granted = useAnnouncementSlot("home_cram", wants);

  const shown = useRef(false);
  useEffect(() => {
    if (!granted || !plan || shown.current) return;
    shown.current = true;
    const key = `${SHOWN_PREFIX}${userId}:${plan.variant}`;
    try {
      if (safeSessionStorage.getItem(key)) return;
      safeSessionStorage.setItem(key, "1");
    } catch { /* storage blocked: count it anyway */ }
    trackEvent("cram_card_shown", { variant: plan.variant, plan: plan.planLine ? "yes" : "no", credits: plan.credits ? "yes" : "no" });
  }, [granted, plan, userId]);

  const click = useCallback((target: Target) => {
    if (plan) trackEvent("cram_card_click", { variant: plan.variant, target });
  }, [plan]);

  const hide = () => {
    try { safeStorage.setItem(CRAM_DISMISS_PREFIX + userId, String(Date.now() + CRAM_DISMISS_MS)); } catch { /* blocked: the queue still holds it for this device */ }
    dismissSurface("home_cram", "later");
    setDismissed(true);
  };

  const nameSitting = async (row: OfficialSitting) => {
    if (busy.current) return;
    busy.current = true;
    setSaving(true);
    setFailed(false);
    click("part");
    try {
      const res = await authFetch("/api/user/exam-preference", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        // sitting_set is server-only (a-release-int-6): the route writes it for source cram_card.
        body: JSON.stringify({ examDate: row.date, source: "cram_card" }),
        timeoutMs: 15_000,
        skipAuthRedirect: true,
      });
      const body = (await res.json().catch(() => null)) as { ok?: boolean; persisted?: boolean } | null;
      if (!res.ok || body?.persisted !== true) throw new Error("not saved");
      const label = rowLabel(row, lang);
      setSavedDate(row.date);
      setSavedLabel(label);
      announce(tc("part_saved", lang, { sittingLabel: label }));
      onSittingSet?.(row.date);
    } catch {
      setFailed(true);
    } finally {
      busy.current = false;
      setSaving(false);
    }
  };

  if (!granted || !plan) return null;

  const sip = plan.variant === "sip_named" || plan.variant === "sip_bank";
  const row = plan.row;
  const keys: Array<"sip4a" | "sip5a"> = plan.variant === "sip_named" && row ? [row.exam_key as "sip4a" | "sip5a"] : ["sip4a", "sip5a"];
  const sittingLabel = row ? rowLabel(row, lang) : "";
  const vars = {
    sittingLabel,
    sittingDate: row ? formatOfficialDate(row.date, lang) : "",
    weekRange: row ? formatSittingWhen(row, lang) : "",
    daysLeft: plan.daysLeft ?? 0,
  };
  const title = sip
    ? plan.variant === "sip_bank" ? tc("m4_title_bank", lang)
      : tc(plan.daysLeft === 1 ? "m4_title_one" : "m4_title", lang, vars)
    : tc(plan.variant === "rezgm_b" ? "rezgm_b_title" : "rezgm_a_title", lang);
  const body = sip
    ? tc(plan.variant === "sip_bank" ? "m4_body_bank" : "m4_body", lang, vars)
    : tc(plan.variant === "rezgm_b" ? "rezgm_b_body" : "rezgm_a_body", lang, vars);
  const linkClass = "inline-flex items-center min-h-11 text-sm font-semibold text-[var(--mp-cta-blue)] underline underline-offset-2";

  return (
    <section
      data-testid="home-cram-card"
      data-variant={plan.variant}
      aria-label={tc("region", lang)}
      className={`rounded-[var(--mp-r-card)] border border-[var(--mp-border)] bg-[var(--mp-surface-raised)] px-4 py-3 ${className}`}
    >
      <div className="flex items-start gap-2.5">
        <Timer className="w-4 h-4 mt-0.5 flex-shrink-0 text-[var(--mp-cta-blue)]" aria-hidden />
        <div className="min-w-0 flex-1">
          <h2 className="text-sm font-semibold leading-snug text-[var(--mp-fg)]">{title}</h2>
          <p className="mt-0.5 text-sm leading-snug text-[var(--mp-fg)]">{body}</p>
          {!sip && plan.daysLeft !== null && (
            <p className="mt-1 text-sm leading-snug text-[var(--mp-fg-muted)]">
              {tc(plan.daysLeft === 1 ? "rezgm_a_countdown_one" : "rezgm_a_countdown", lang, vars)}
            </p>
          )}
          <p className="mt-1 text-sm leading-snug text-[var(--mp-fg-muted)]">{sip ? tc("m4_how", lang) : tc("rezgm_a_how", lang)}</p>
          {sip && <p className="mt-1 text-sm leading-snug text-[var(--mp-fg-muted)]">{tc("m4_format", lang)}</p>}
          {plan.variant === "rezgm_b" && <p className="mt-1 text-sm leading-snug text-[var(--mp-fg-muted)]">{tc("rezgm_b_gmnote", lang)}</p>}
          {plan.credits && (
            <p className="mt-1 text-sm leading-snug text-[var(--mp-fg-muted)]" data-testid="cram-credits">
              {tc("m4_credits", lang, { balance: plan.credits.credits, expiryDate: formatOfficialDate(plan.credits.expires_at, lang) })}
            </p>
          )}

          {plan.partChoices.length >= 2 && !savedLabel && (
            <div className="mt-2" role="group" aria-label={tc("part_prompt", lang)}>
              <p className="text-sm font-medium text-[var(--mp-fg)]">{tc("part_prompt", lang)}</p>
              <div className="mt-1 flex flex-wrap gap-2">
                {plan.partChoices.map((r) => (
                  <button
                    key={r.date}
                    type="button"
                    onClick={() => void nameSitting(r)}
                    aria-busy={saving || undefined}
                    aria-disabled={saving || undefined}
                    className="mp-btn mp-btn--secondary min-h-11"
                  >
                    {tc("part_option", lang, { sittingLabel: rowLabel(r, lang), sittingDate: formatOfficialDate(r.date, lang) })}
                  </button>
                ))}
              </div>
              {failed && <p role="alert" className="mt-1 text-xs text-[var(--mp-error-text)]">{tc("part_failed", lang)}</p>}
            </div>
          )}
          {savedLabel && <p role="status" className="mt-2 text-sm font-medium text-[var(--mp-viridian)]">{tc("part_saved", lang, { sittingLabel: savedLabel })}</p>}

          {plan.planLine && (
            <div className="mt-2 border-t border-[var(--mp-border)] pt-2" data-testid="cram-plan-line">
              <p className="text-sm leading-snug text-[var(--mp-fg)]">{tc("m4_plan", lang)}</p>
              <Link href="/pricing" onClick={() => click("pricing")} className={linkClass}>{tc("m4_plan_cta", lang)}</Link>
            </div>
          )}

          <div className="mt-2 flex flex-wrap items-center gap-x-4 gap-y-1">
            <Link href="/study-plan" onClick={() => click("plan")} className="mp-btn mp-btn--primary min-h-11 inline-flex items-center">
              {t("home_open_study_plan", lang)}
            </Link>
            {sip && (
              <Link href={mockHrefFor(keys, canMock)} onClick={() => click("simulation")} className={linkClass}>
                {tc("m4_cta_primary", lang)}
              </Link>
            )}
            {!sip && (
              <a href={PHARMA_INFO_URL} target="_blank" rel="noopener noreferrer" onClick={() => click("official")} className={`${linkClass} gap-1`}>
                {tc("rezgm_official", lang)}
                <ExternalLink className="w-3.5 h-3.5" aria-hidden />
              </a>
            )}
            <button
              type="button"
              onClick={hide}
              className="inline-flex items-center min-h-11 text-xs font-medium text-[var(--mp-fg-muted)] hover:text-[var(--mp-fg)]"
            >
              {tc("rezgm_dismiss", lang)}
            </button>
          </div>
        </div>
      </div>
    </section>
  );
}
