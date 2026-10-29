"use client";

/**
 * Home referral prompt for paying learners (a-referral-prompt-1029,
 * REFERRAL_PROMPT_ENABLED). Asks GET /api/referrals/prompt only for a paying
 * account in the referral program while the flag is on (useUserTier
 * referralPrompt). The server decides the moment (a strong session or fixed
 * mistakes in the latest session, ended 10+ minutes ago) and the cadence (once
 * per 14 days on any device, never again after "Nicht mehr fragen"). Home only,
 * so never during a quiz. It asks the queue for the session's Home inline slot
 * ("referral_prompt") and, once granted, is elected by the one-surface gate
 * (useAnnouncementGate "referral_prompt"), which keeps the weekly referral card
 * and the code card away for the rest of the session. The showing is stored
 * (POST action "shown") before the card renders.
 */
import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { Users } from "lucide-react";
import { IconButton } from "@/components/ui/IconButton";
import ReferralShareActions from "@/components/referrals/ReferralShareActions";
import { isReferralDismissalCooldownActive, useAnnouncementGate } from "@/lib/announcements/useAnnouncementGate";
import { dismissSurface, isSurfaceDismissed, useAnnouncementSlot } from "@/lib/announcements/queue";
import { holdReferralPrompt, setReferralPromptEligible } from "@/lib/announcements/referral-prompt-signal";
import { authFetch } from "@/lib/authFetch";
import { useUserTier } from "@/lib/hooks/useUserTier";
import { userScopedKey } from "@/lib/master-locale/storage-keys";
import type { ReferralMoment } from "@/lib/referral-prompt";
import { referralPromptLang, referralPromptTitle, rpT } from "@/lib/referral-prompt-copy";
import { safeSessionStorage, safeStorage } from "@/lib/safe-storage";
import { trackEvent } from "@/lib/tracker";

const SESSION_KEY = "medpruef_referral_prompt_v1";
/** A "no moment yet" answer is reused this long in the tab before Home asks again. */
const RECHECK_MS = 15 * 60_000;

export interface ReferralPromptOffer {
  moment: ReferralMoment;
  link: string;
  mentorCredits: number | null;
}

/** Shape check of GET /api/referrals/prompt; anything else reads as "no offer". */
export function parseReferralPrompt(body: unknown): { offer: ReferralPromptOffer | null; reason: string | null; nextAt?: number } {
  if (!body || typeof body !== "object") return { offer: null, reason: null };
  const b = body as Record<string, unknown>;
  const reason = typeof b.reason === "string" ? b.reason : null;
  const next = typeof b.nextAt === "string" ? Date.parse(b.nextAt) : NaN;
  if (b.enabled !== true || b.show !== true) return { offer: null, reason, ...(Number.isFinite(next) ? { nextAt: next } : {}) };
  if (b.moment !== "strong_session" && b.moment !== "fixed_mistakes") return { offer: null, reason: null };
  if (typeof b.link !== "string" || !/^https?:\/\//.test(b.link)) return { offer: null, reason: null };
  const credits = typeof b.mentorCredits === "number" && b.mentorCredits > 0 ? b.mentorCredits : null;
  return { offer: { moment: b.moment, link: b.link, mentorCredits: credits }, reason: null };
}

function readSessionOffer(key: string): ReferralPromptOffer | null {
  try {
    const raw = safeSessionStorage.getItem(key);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as unknown;
    return parseReferralPrompt({ enabled: true, show: true, ...(parsed as object) }).offer;
  } catch {
    return null;
  }
}

export default function ReferralPromptCard({ userId, lang, className = "" }: { userId: string; lang: string; className?: string }) {
  const l = referralPromptLang(lang);
  const { referralPrompt, isPaid } = useUserTier();
  const guest = !userId || userId.startsWith("guest_");
  const base = userScopedKey(SESSION_KEY, userId);
  const shownKey = `${base}:shown`;
  const checkedKey = `${base}:checked_at`;
  // Shown in the last 14 days on any device: no read on this device until the server's next time.
  const quietKey = `${base}:quiet_until`;
  const active = referralPrompt && isPaid && !guest;

  const [offer, setOffer] = useState<ReferralPromptOffer | null>(null);
  const [confirmed, setConfirmed] = useState(false);
  const posting = useRef(false);
  const [hidden, setHidden] = useState(false);

  // Shown earlier in this browser session: keep it, no new read and no second stamp.
  useEffect(() => {
    if (!active) return;
    const kept = readSessionOffer(shownKey);
    if (kept) {
      setOffer(kept);
      setConfirmed(true);
      return;
    }
    if (isSurfaceDismissed("referral_prompt")) return;
    if (Number(safeStorage.getItem(quietKey)) > Date.now()) return;
    const checkedAt = Number(safeSessionStorage.getItem(checkedKey));
    if (Number.isFinite(checkedAt) && checkedAt > 0 && Date.now() - checkedAt < RECHECK_MS) return;
    let cancelled = false;
    authFetch("/api/referrals/prompt", { skipAuthRedirect: true })
      .then(async (r) => (r.ok ? parseReferralPrompt(await r.json().catch(() => null)) : { offer: null, reason: null }))
      .catch(() => ({ offer: null, reason: null }) as ReturnType<typeof parseReferralPrompt>)
      .then(({ offer: next, reason, nextAt }) => {
        if (cancelled) return;
        if (reason === "dismissed") dismissSurface("referral_prompt", "no_interest");
        else if (reason === "shown_recently" && nextAt) safeStorage.setItem(quietKey, String(nextAt));
        else if (!next) safeSessionStorage.setItem(checkedKey, String(Date.now()));
        setOffer(next);
      });
    return () => { cancelled = true; };
  }, [active, shownKey, checkedKey, quietKey]);

  const { activeSurface, state: gateState } = useAnnouncementGate();
  const coolingDown = gateState ? isReferralDismissalCooldownActive(gateState.referralFloaterDismissedAt) : true;
  const eligible = active && Boolean(offer) && !hidden && !coolingDown;
  const granted = useAnnouncementSlot("referral_prompt", eligible);

  // Publish to the gate only once the queue granted the slot.
  useEffect(() => { setReferralPromptEligible(granted); }, [granted]);
  useEffect(() => () => setReferralPromptEligible(false), []);

  const elected = granted && activeSurface === "referral_prompt";

  // Store the showing on the server before the card renders (14-day cadence on every device).
  useEffect(() => {
    if (!elected || !offer || confirmed || posting.current) return;
    // A ref, not state: a second run of this effect (StrictMode, a re-render) never posts twice.
    posting.current = true;
    authFetch("/api/referrals/prompt", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ action: "shown", moment: offer.moment }),
      skipAuthRedirect: true,
    })
      .then(async (r) => (r.ok ? ((await r.json().catch(() => null)) as { show?: unknown } | null) : null))
      .catch(() => null)
      .then((body) => {
        if (body?.show === true) {
          safeSessionStorage.setItem(shownKey, JSON.stringify(offer));
          holdReferralPrompt();
          setConfirmed(true);
          trackEvent("referral_surface_shown", { surface: "referral_prompt", moment: offer.moment });
        } else {
          setHidden(true);
        }
      })
      .finally(() => { posting.current = false; });
  }, [elected, offer, confirmed, shownKey]);

  if (!elected || !confirmed || !offer || hidden) return null;

  const close = (forever: boolean) => {
    // The election stays held this session, so no other referral pitch follows.
    holdReferralPrompt();
    setHidden(true);
    safeSessionStorage.removeItem(shownKey);
    dismissSurface("referral_prompt", forever ? "no_interest" : "later");
    trackEvent("banner_dismissed", { surface: "referral_prompt", forever });
    if (forever) {
      void authFetch("/api/referrals/prompt", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ action: "dismissed" }),
        skipAuthRedirect: true,
      }).catch(() => {});
    }
  };

  return (
    <section data-testid="referral-prompt-card" aria-labelledby="referral-prompt-title" className={`mp-card relative rounded-2xl p-4 pe-12 ${className}`}>
      <IconButton label={rpT("close_aria", l)} onClick={() => close(false)} className="absolute top-1 end-1" />
      <div className="flex items-start gap-3">
        <span className="mt-0.5 flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-[var(--mp-viridian)]/10" aria-hidden>
          <Users className="h-5 w-5 text-[var(--mp-viridian)]" />
        </span>
        <div className="min-w-0 flex-1">
          <h2 id="referral-prompt-title" className="text-[15px] font-semibold leading-snug text-[var(--mp-fg)]">{referralPromptTitle(offer.moment, l)}</h2>
          <p className="mt-1 text-[13px] leading-relaxed text-[var(--mp-fg-muted)]">{rpT("body", l)}</p>
        </div>
      </div>
      <div className="mt-2">
        <ReferralShareActions link={offer.link} mentorCredits={offer.mentorCredits} lang={l} surface="referral_prompt" showLink={false} />
      </div>
      <div className="mt-1 flex flex-wrap items-center gap-x-4">
        <Link
          href="/referrals?utm_source=referral_prompt&utm_medium=home_card"
          className="inline-flex min-h-11 items-center text-[13px] font-semibold text-[var(--mp-cta-blue)] underline underline-offset-2"
        >
          {rpT("terms_link", l)}
        </Link>
        <button
          type="button"
          onClick={() => close(true)}
          className="inline-flex min-h-11 items-center text-[13px] text-[var(--mp-fg-subtle)] hover:text-[var(--mp-fg)]"
        >
          {rpT("dismiss_forever", l)}
        </button>
      </div>
    </section>
  );
}
