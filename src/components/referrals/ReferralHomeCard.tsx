"use client";

/**
 * Home referral card (a-referral-surface, REFERRAL_SURFACE_ENABLED). For
 * learners in the referral program who answered on 3+ Vienna days in the last
 * 14 days, while the mentor credit program is on; at most once a week per
 * device and account; the close control quiets it for a week. It asks the
 * queue for the session's Home inline slot ("referral_card") and, once
 * granted, is elected by the one-surface announcement gate
 * (useAnnouncementGate "referral_card"), which then keeps the floater and the
 * code card away for the rest of the session.
 */
import { useEffect, useMemo, useState } from "react";
import { Gift } from "lucide-react";
import { IconButton } from "@/components/ui/IconButton";
import ReferralShareActions from "@/components/referrals/ReferralShareActions";
import { isReferralDismissalCooldownActive, useAnnouncementGate } from "@/lib/announcements/useAnnouncementGate";
import { dismissSurface, isSurfaceDismissed, useAnnouncementSlot } from "@/lib/announcements/queue";
import { holdReferralCard, setReferralCardEligible } from "@/lib/announcements/referral-card-signal";
import { useUserTier } from "@/lib/hooks/useUserTier";
import { useReferralInvite } from "@/lib/hooks/useReferralInvite";
import { userScopedKey } from "@/lib/master-locale/storage-keys";
import { referralMentorCreditsCopy } from "@/lib/referral-copy";
import { REFERRAL_CARD_STAMP_KEY, parseReferralCardStamp, referralCardDue } from "@/lib/referral-surface";
import { referralSurfaceLang, rsT } from "@/lib/referral-surface-copy";
import { viennaDay } from "@/lib/home-study-core";
import { safeSessionStorage, safeStorage } from "@/lib/safe-storage";
import { trackEvent } from "@/lib/tracker";

export default function ReferralHomeCard({ userId, lang, className = "" }: { userId: string; lang: string; className?: string }) {
  const l = referralSurfaceLang(lang);
  const { referralSurface } = useUserTier();
  const guest = !userId || userId.startsWith("guest_");
  const stampKey = userScopedKey(REFERRAL_CARD_STAMP_KEY, userId);
  const sessionKey = `${stampKey}:session`;
  // Not eligible today (fewer than 3 active days): no second read until tomorrow (Vienna).
  const notTodayKey = `${stampKey}:not_eligible_day`;
  const [hidden, setHidden] = useState(false);
  const [due, setDue] = useState(false);

  // Device-local weekly slot, read after mount (storage is not available on the server).
  useEffect(() => {
    if (guest) { setDue(false); return; }
    const shownThisSession = safeSessionStorage.getItem(sessionKey) === "1";
    const notToday = safeStorage.getItem(notTodayKey) === viennaDay(new Date());
    setDue(!notToday && !isSurfaceDismissed("referral_card") && referralCardDue(parseReferralCardStamp(safeStorage.getItem(stampKey)), Date.now(), shownThisSession));
  }, [guest, sessionKey, stampKey, notTodayKey]);

  const invite = useReferralInvite(referralSurface && !guest && due && !hidden, true);
  useEffect(() => {
    if (invite?.enabled && invite.card && !invite.card.eligible) safeStorage.setItem(notTodayKey, viennaDay(new Date()));
  }, [invite, notTodayKey]);

  const { activeSurface, state: gateState } = useAnnouncementGate();
  const coolingDown = gateState ? isReferralDismissalCooldownActive(gateState.referralFloaterDismissedAt) : true;
  const eligible = Boolean(invite?.enabled && invite.link && invite.mentorCredits && invite.card?.eligible) && !hidden && !coolingDown;
  const granted = useAnnouncementSlot("referral_card", eligible);

  // Publish to the gate only once the queue granted the slot.
  useEffect(() => { setReferralCardEligible(granted); }, [granted]);
  useEffect(() => () => setReferralCardEligible(false), []);

  const visible = granted && activeSurface === "referral_card";
  useEffect(() => {
    if (!visible) return;
    holdReferralCard();
    if (safeSessionStorage.getItem(sessionKey) === "1") return;
    safeStorage.setItem(stampKey, String(Date.now()));
    safeSessionStorage.setItem(sessionKey, "1");
    trackEvent("referral_surface_shown", { surface: "home_card" });
  }, [visible, sessionKey, stampKey]);

  const terms = useMemo(() => referralMentorCreditsCopy(l, invite?.mentorCredits ?? null), [l, invite?.mentorCredits]);
  if (!visible || !invite?.link || !invite.mentorCredits || !terms) return null;

  const dismiss = () => {
    // The election stays held this session, so no other referral pitch follows.
    holdReferralCard();
    setHidden(true);
    safeSessionStorage.removeItem(sessionKey);
    dismissSurface("referral_card", "later");
    trackEvent("banner_dismissed", { surface: "referral_card" });
  };

  return (
    <section data-testid="referral-home-card" aria-labelledby="referral-card-title" className={`mp-card relative rounded-2xl p-4 pe-12 ${className}`}>
      <IconButton label={rsT("card_dismiss_aria", l)} onClick={dismiss} className="absolute top-1 end-1" />
      <div className="flex items-start gap-3">
        <span className="mt-0.5 flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-[var(--mp-viridian)]/10" aria-hidden>
          <Gift className="h-5 w-5 text-[var(--mp-viridian)]" />
        </span>
        <div className="min-w-0 flex-1">
          <h2 id="referral-card-title" className="text-[15px] font-semibold leading-snug text-[var(--mp-fg)]">{rsT("card_title", l)}</h2>
          <p className="mt-1 text-[13px] leading-relaxed text-[var(--mp-fg-muted)]">{rsT("card_body", l, { credits: invite.mentorCredits })}</p>
          <p className="mt-1 text-[13px] leading-relaxed text-[var(--mp-fg-muted)]">{rsT("card_trial_note", l)}</p>
          <details className="mt-1 text-[13px] text-[var(--mp-fg-muted)]">
            <summary className="inline-flex min-h-11 cursor-pointer items-center font-semibold text-[var(--mp-cta-blue)] underline underline-offset-2">{rsT("terms_link", l)}</summary>
            <p className="pb-1 leading-relaxed">{terms.terms}</p>
          </details>
        </div>
      </div>
      <div className="mt-2">
        <ReferralShareActions link={invite.link} mentorCredits={invite.mentorCredits} lang={l} surface="home_card" showLink={false} />
      </div>
    </section>
  );
}
