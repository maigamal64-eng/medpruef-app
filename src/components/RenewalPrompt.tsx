"use client";

/**
 * RenewalPrompt — a small, non-blocking banner telling a Pro user that
 * their access ends (or just ended) on a specific date, with one button
 * to the standard 3-month plan and one to dismiss.
 *
 * Where it lives: the shared fixed banner stack in the ROOT layout, so
 * it reaches the user on whatever page they happen to open, not only on
 * /pricing. It never blocks the quiz — it is a 44px strip at the top of
 * the same flex column as the guest-migration and cohort banners, and
 * the quiz keeps its own scroll and focus.
 *
 * Why it is NOT routed through useAnnouncementGate: that gate exists to
 * suppress marketing surfaces for paying users (computeActiveSurface
 * returns null when isPaid). This banner's entire audience is paying
 * users, so the gate would silence it permanently. Frequency is capped
 * locally instead: one appearance per calendar day per browser, via a
 * localStorage date stamp.
 *
 * Decision logic lives in `@/lib/renewal-prompt` (pure, unit-tested,
 * including the production account whose access ends 2026-09-08).
 *
 * Language: `useLang()` + `t()`, so the banner speaks de/en plus the
 * ru/uk/tr overlay, exactly like the rest of the app chrome. Arabic is
 * deliberately not authored (standing rule: [name] signs off on all
 * Arabic before it goes live); `t()` falls back to English for `ar`.
 *
 * Checkout: POST /api/whop/checkout { tier } then follow the returned
 * purchaseUrl, mirroring the proven /pricing call site. No whop.com URL
 * is ever constructed here.
 *
 * Auto-renewing plans (i-MP-TRUTH-19, 2026-10-10): before showing, the
 * banner asks /api/user/subscription whether the user already holds a plan
 * that renews by itself (rule in `@/lib/billing-cadence`). It stays hidden
 * while that check loads, when it fails, and when the answer is "suppress",
 * so nobody is sold a second plan on top of one that auto-renews.
 */

import { IconButton } from "@/components/ui/IconButton";
import { useCallback, useEffect, useState } from "react";
import { dismissSurface, useAnnouncementSlot } from "@/lib/announcements/queue";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { CalendarClock } from "lucide-react";
import { useUserTier } from "@/lib/hooks/useUserTier";
import { useLang, t } from "@/lib/i18n";
import { accessEndLineFor, continueAfterLabelFor, moneyCopyLang, moneyLocale, type MoneyCopyLang } from "@/lib/billing-copy-i18n";
import { authFetch } from "@/lib/authFetch";
import {
  evaluateRenewalPrompt,
  type RenewalPromptDecision,
} from "@/lib/renewal-prompt";

/** One appearance per calendar day per browser. Value is a YYYY-MM-DD stamp. */
const SEEN_KEY = "medpruef_renewal_prompt_seen_on";

/**
 * Paths where a payment nudge would be noise or actively unhelpful:
 * the auth screens, the checkout return page, and /pricing (which is
 * already a wall of plans). It stays visible on /quiz on purpose — that
 * is where the lapsing user actually is.
 */
const HIDE_PATHS = ["/login", "/checkout", "/pricing", "/privacy", "/terms", "/impressum"];


function todayStamp(): string {
  return new Date().toISOString().slice(0, 10);
}

/**
 * Local-calendar date label, so the day never shifts by time zone. Formatted
 * in the money language (a29): an English sentence never carries a Russian
 * month name for a learner whose Russian copy is not reviewed yet.
 */
function formatDate(iso: string, lang: MoneyCopyLang): string {
  const [y, m, d] = iso.split("-").map(Number);
  return new Date(y, (m ?? 1) - 1, d ?? 1).toLocaleDateString(
    lang === "de" ? "de-AT" : lang === "en" ? "en-GB" : moneyLocale(lang),
    { day: "numeric", month: "long" }
  );
}

export default function RenewalPrompt() {
  const pathname = usePathname();
  const lang = useLang();
  const { tier, tierExpiresAt, role, isLoading } = useUserTier();

  // `null` until the localStorage read has run on the client, so the
  // banner never flashes during hydration.
  const [allowedToday, setAllowedToday] = useState<boolean | null>(null);
  const [dismissed, setDismissed] = useState(false);
  // null = not checked yet; true only when the server confirmed no active
  // plan renews by itself. Anything else keeps the banner hidden.
  const [offerAllowed, setOfferAllowed] = useState<boolean | null>(null);

  useEffect(() => {
    try {
      setAllowedToday(localStorage.getItem(SEEN_KEY) !== todayStamp());
    } catch {
      // localStorage disabled (private mode, blocked site data). Showing
      // the banner is the safe failure: the user can still dismiss it
      // for this page view.
      setAllowedToday(true);
    }
  }, []);

  const stampSeen = useCallback(() => {
    try {
      localStorage.setItem(SEEN_KEY, todayStamp());
    } catch {
      /* non-fatal */
    }
  }, []);

  const decision: RenewalPromptDecision | null = evaluateRenewalPrompt({
    tier,
    tierExpiresAt,
    role,
  });

  const inWindow = decision !== null;
  useEffect(() => {
    // Only users inside the renewal window trigger the cadence check.
    if (isLoading || !inWindow) return;
    let cancelled = false;
    (async () => {
      try {
        const r = await authFetch("/api/user/subscription", { skipAuthRedirect: true });
        const body = (await r.json().catch(() => ({}))) as {
          renewal_offer_suppressed?: boolean;
        };
        if (!cancelled) setOfferAllowed(r.ok && body.renewal_offer_suppressed === false);
      } catch {
        if (!cancelled) setOfferAllowed(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [isLoading, inWindow, tier, tierExpiresAt]);

  const wantsShow = !(
    isLoading ||
    dismissed ||
    allowedToday !== true ||
    decision === null ||
    offerAllowed !== true ||
    HIDE_PATHS.some((p) => pathname?.startsWith(p)));
  // UX-GLOBAL-12: access and renewal hold the highest queue priority.
  const granted = useAnnouncementSlot("renewal", wantsShow);
  const hidden = !granted;

  // Stamp the day the FIRST time the banner is actually rendered, so a
  // user who simply navigates away still only sees it once per day.
  useEffect(() => {
    if (!hidden) stampSeen();
  }, [hidden, stampSeen]);

  if (hidden || !decision) return null;

  const handleDismiss = () => {
    dismissSurface("renewal", "later");
    stampSeen();
    setDismissed(true);
  };

  const money = moneyCopyLang(lang);
  const date = formatDate(decision.endsOn, money);
  return (
    <section
      aria-label={t("a22_renewal_region", lang)}
      className="bg-[var(--mp-surface-raised)] border-b border-[var(--mp-border-subtle)] px-4 py-2.5 shadow-sm"
      style={{ minHeight: "44px" }}
    >
      {/* UX-HOME-45: a static region (no live region, no focus); on phones the sentence wraps
          and the action takes a full-width row, with the dismiss beside it. */}
      <div className="max-w-5xl mx-auto flex flex-wrap items-center justify-between gap-x-3 gap-y-2">
        <div className="flex items-start gap-2 min-w-0 basis-full sm:basis-auto sm:flex-1">
          <CalendarClock
            className="w-4 h-4 flex-shrink-0 text-[var(--mp-cta-blue)]"
            aria-hidden
          />
          <p className="text-[14px] text-[var(--mp-fg)]">
            {accessEndLineFor(money, date, decision.lapsed)}
          </p>
        </div>
        <div className="flex items-center gap-2 flex-1 sm:flex-none">
          <Link href="/pricing?action=renew#plans" className="mp-btn mp-btn--secondary min-h-11 text-[14px] flex-1 justify-center sm:flex-none">
            {continueAfterLabelFor(money, date)}
          </Link>
          <IconButton label={t("renewal_dismiss", lang)} onClick={handleDismiss} />
        </div>
      </div>
    </section>
  );
}
