"use client";
import { billingAmount, billingTrialLine } from "@/lib/billing-copy";

/**
 * TrialRibbon, the anonymous top-of-funnel Pro-Test announcement (2026-07-01).
 *
 * A slim, dismissible bar pinned at the very top of the landing for logged-out
 * visitors. Self-gating: it fetches the PUBLIC /api/trial/status and renders
 * nothing unless a card trial is on (CARD_TRIAL_ENABLED, or the dormant
 * NOTES_TRIAL_ENABLED), so switching it off makes it
 * vanish (no stale promo). Terms come from the status payload (trial days,
 * price after the trial, first charge date) through billing-copy.
 *
 * FB-01/FB-02 fix (2026-07-01): the bar is `fixed` and publishes its rendered
 * height to the CSS var --mp-ribbon-h on the document root (0 when hidden or
 * dismissed). The landing Nav offsets its `top` off that var so it sits BELOW
 * the ribbon instead of overlapping it, and the page pads its top by the same
 * var, all driven by ONE source of truth.
 *
 * UX-ACC-27 (2026-10-12): phones get one line ("Pro 7 Tage testen, heute 0 €")
 * with the full terms behind a focusable Details button. The bar appears only
 * after the cookie choice (the head script marks a pending choice with
 * `mp-consent-pending`; the landing hides and un-reserves the desktop bar for
 * that state, and this component waits for the stored choice or the
 * `medpruef-consent` event). Closing snoozes it for 3 days, never forever.
 * The trial link carries intent=trial through the auth-entry helpers.
 */

import { authFetch } from "@/lib/authFetch";
import { safeStorage } from "@/lib/safe-storage";
import { CONSENT_STORAGE_KEY, consentFromCookie } from "@/lib/consent-copy";
import { useEffect, useId, useRef, useState } from "react";
import PublicStudyLink from "@/components/PublicStudyLink";
import { buildAuthHref } from "@/lib/auth-entry";
import { Sparkles, X } from "lucide-react";
import { trackCardTrialClick, trackCardTrialView } from "@/lib/card-trial-events";

const SNOOZE_KEY = "mp_trial_ribbon_snoozed_until_v2";
const LEGACY_DISMISS_KEY = "mp_trial_ribbon_dismissed_v1";
export const RIBBON_SNOOZE_MS = 3 * 24 * 60 * 60 * 1000;
const RIBBON_H_VAR = "--mp-ribbon-h";
const TRIAL_HREF = buildAuthHref({ intent: "trial", next: "/pricing#pro-test" });

type Terms = { trial_days: number; price_after_cents: number; charge_at: string | null; tier: string | null };

const COPY = {
  loading: { de: "Lädt", en: "Loading" },
  details: { de: "Details", en: "Details" },
  close: { de: "Für 3 Tage ausblenden", en: "Hide for 3 days" },
} as const;

function setRibbonH(px: number) {
  try {
    document.documentElement.style.setProperty(RIBBON_H_VAR, `${px}px`);
  } catch {
    /* no document (SSR) */
  }
}

/** True while a 3-day snooze is running. Storage failures never hide the bar. */
export function ribbonSnoozed(now: number = Date.now()): boolean {
  try {
    const until = Number(safeStorage.getItem(SNOOZE_KEY));
    return Number.isFinite(until) && until > now;
  } catch {
    return false;
  }
}

/** The visitor has made a cookie choice (stored value or the mirror cookie). */
function consentChosen(): boolean {
  try {
    const stored = safeStorage.getItem(CONSENT_STORAGE_KEY);
    if (stored === "accepted" || stored === "declined" || stored === "acknowledged") return true;
    return consentFromCookie(document.cookie) !== null;
  } catch {
    return false;
  }
}

/** Button label from the live trial days (glossary: "Pro 3 Tage testen"). */
export function ribbonCta(lang: "de" | "en", trialDays: number): string {
  return lang === "de" ? `Pro ${trialDays} Tage testen` : `Try Pro for ${trialDays} days`;
}

/** Phone line, composed from the live terms: "Pro 3 Tage testen, heute 0 €". */
export function ribbonPhoneLine(lang: "de" | "en", trialDays: number): string {
  const zero = billingAmount(0, lang);
  return { de: `Pro ${trialDays} Tage testen, heute ${zero}`, en: `Try Pro for ${trialDays} days, ${zero} today` }[lang];
}

export default function TrialRibbon({ lang, initiallyEnabled = false }: { lang: "de" | "en"; initiallyEnabled?: boolean }) {
  const [terms, setTerms] = useState<Terms | null>(null);
  const [show, setShow] = useState(initiallyEnabled);
  const [consent, setConsent] = useState(false);
  const [open, setOpen] = useState(false);
  const [hydrated, setHydrated] = useState(false);
  const ref = useRef<HTMLDivElement | null>(null);
  const closed = useRef(false);
  const detailsId = useId();

  useEffect(() => {
    setHydrated(true);
    try {
      safeStorage.removeItem(LEGACY_DISMISS_KEY);
    } catch {
      /* ignore */
    }
    if (ribbonSnoozed()) { setShow(false); return; }
    setConsent(consentChosen());
    const onConsent = () => setConsent(true);
    window.addEventListener("medpruef-consent", onConsent);
    const controller = new AbortController();
    let cancelled = false;
    authFetch("/api/trial/status", { signal: controller.signal, timeoutMs: 8_000, skipAuthRedirect: true })
      .then((r) => (r.ok ? r.json() : null))
      .then((d: { enabled?: boolean; trial_days?: number; price_after_cents?: number; charge_at?: string; tier?: string | null } | null) => {
        if (cancelled || closed.current) return;
        if (d?.enabled && typeof d.trial_days === "number" && typeof d.price_after_cents === "number") {
          setTerms({ trial_days: d.trial_days, price_after_cents: d.price_after_cents, charge_at: typeof d.charge_at === "string" ? d.charge_at : null, tier: typeof d.tier === "string" ? d.tier : null });
          setShow(true);
        } else setShow(false);
      })
      .catch(() => { if (!cancelled && !closed.current) setShow(false); });
    return () => { cancelled = true; controller.abort(); window.removeEventListener("medpruef-consent", onConsent); };
  }, []);

  // Server HTML keeps the reserved desktop skeleton (hidden by the landing's
  // consent-pending rule); once hydrated, nothing renders before the choice.
  const visible = show && (!hydrated || consent);
  // a-card-trial-build-1024: impression once the CTA is on screen (cookie choice made, terms loaded).
  const ctaTier = terms?.tier ?? null;
  useEffect(() => { if (visible && consent && ctaTier) trackCardTrialView("ribbon", ctaTier); }, [visible, consent, ctaTier]);

  // Publish the rendered height so the fixed nav can offset below it and the
  // page can pad for it. Reset to 0 when not shown or on unmount.
  useEffect(() => {
    if (!visible || !hydrated) {
      if (hydrated) setRibbonH(0);
      return;
    }
    const el = ref.current;
    const measure = () => setRibbonH(el?.offsetHeight ?? 0);
    measure();
    const observer = typeof ResizeObserver !== "undefined" && el ? new ResizeObserver(measure) : null;
    if (observer && el) observer.observe(el);
    window.addEventListener("resize", measure);
    return () => {
      observer?.disconnect();
      window.removeEventListener("resize", measure);
      setRibbonH(0);
    };
  }, [visible, hydrated, terms]);

  if (!visible) return null;

  const dismiss = () => {
    closed.current = true;
    try {
      safeStorage.setItem(SNOOZE_KEY, String(Date.now() + RIBBON_SNOOZE_MS));
    } catch {
      /* ignore */
    }
    setRibbonH(0);
    setShow(false);
  };
  const fullTerms = terms
    ? billingTrialLine(lang, { trialDays: terms.trial_days, priceAfterCents: terms.price_after_cents, chargeAt: terms.charge_at })
    : null;

  return (
    <div
      ref={ref}
      className="mp-trial-ribbon fixed top-0 left-0 right-0 z-[60] bg-[var(--mp-viridian)] text-[var(--mp-fg-on-viridian)]"
    >
      {/* Desktop: the full terms on one bar (server-reserved 64 px). */}
      <div className="hidden md:block min-h-16">
        <div className="max-w-6xl min-h-16 mx-auto flex items-center gap-3 px-4 py-2 text-sm">
          <Sparkles className="w-4 h-4 flex-shrink-0" aria-hidden="true" />
          <p className="min-w-0 flex-1 leading-snug">
            {fullTerms ?? <span aria-label={COPY.loading[lang]} className="block h-5 max-w-md rounded bg-current opacity-15 animate-pulse" />}
          </p>
          {consent && terms && (
            <PublicStudyLink
              href={TRIAL_HREF}
              onClick={() => trackCardTrialClick("ribbon", terms.tier)}
              className="inline-flex flex-shrink-0 items-center rounded-lg border border-current px-3 py-1.5 min-h-11 font-semibold transition whitespace-nowrap hover:opacity-90 focus:outline-none focus-visible:ring-2 focus-visible:ring-current"
            >
              {ribbonCta(lang, terms.trial_days)}
            </PublicStudyLink>
          )}
          <button
            type="button"
            onClick={dismiss}
            aria-label={COPY.close[lang]}
            className="flex-shrink-0 inline-flex items-center justify-center min-h-11 min-w-11 p-1 opacity-80 hover:opacity-100 transition"
          >
            <X className="w-4 h-4" aria-hidden="true" />
          </button>
        </div>
      </div>

      {/* Phone: one line, terms behind Details. Client-only, after the cookie choice. */}
      {consent && terms && (
        <div className="md:hidden">
          <div className="flex items-center gap-1 px-3 text-sm">
            <PublicStudyLink
              href={TRIAL_HREF}
              onClick={() => trackCardTrialClick("ribbon", terms.tier)}
              className="min-w-0 flex-1 inline-flex min-h-11 items-center gap-2 font-semibold underline underline-offset-2"
            >
              <Sparkles className="w-4 h-4 flex-shrink-0" aria-hidden="true" />
              <span className="truncate">{ribbonPhoneLine(lang, terms.trial_days)}</span>
            </PublicStudyLink>
            <button
              type="button"
              aria-expanded={open}
              aria-controls={detailsId}
              onClick={() => setOpen((v) => !v)}
              className="flex-shrink-0 inline-flex min-h-11 items-center rounded-lg px-2 font-semibold underline underline-offset-2"
            >
              {COPY.details[lang]}
            </button>
            <button
              type="button"
              onClick={dismiss}
              aria-label={COPY.close[lang]}
              className="flex-shrink-0 inline-flex items-center justify-center min-h-11 min-w-11 opacity-80 hover:opacity-100 transition"
            >
              <X className="w-4 h-4" aria-hidden="true" />
            </button>
          </div>
          <p id={detailsId} hidden={!open} className="px-3 pb-3 text-[13px] leading-snug">
            {fullTerms}
          </p>
        </div>
      )}
    </div>
  );
}
