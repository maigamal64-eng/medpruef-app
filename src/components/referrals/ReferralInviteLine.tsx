"use client";

/**
 * One invite line after a result (a-referral-surface): a recorded passed exam
 * on /stats, or a mock exam above its own threshold. Neutral line, no reward
 * promise and no pass word (UX-STU-41); the share controls carry the
 * disclosure. Renders nothing unless the learner is in the referral program
 * and GET /api/referrals/invite answers enabled (REFERRAL_SURFACE_ENABLED).
 */
import { useEffect, useState } from "react";
import { Users } from "lucide-react";
import ReferralShareActions from "@/components/referrals/ReferralShareActions";
import { useUserTier } from "@/lib/hooks/useUserTier";
import { useReferralInvite } from "@/lib/hooks/useReferralInvite";
import type { ReferralSurface } from "@/lib/referral-surface";
import { referralSurfaceLang, rsT } from "@/lib/referral-surface-copy";
import { trackEvent } from "@/lib/tracker";

export default function ReferralInviteLine({ lang, surface, className = "" }: { lang: string; surface: Extract<ReferralSurface, "exam_pass" | "mock_exam">; className?: string }) {
  const l = referralSurfaceLang(lang);
  const { referralSurface } = useUserTier();
  const invite = useReferralInvite(referralSurface);
  const [open, setOpen] = useState(false);
  const link = invite?.enabled && invite.link ? invite.link : null;
  useEffect(() => {
    if (link) trackEvent("referral_surface_shown", { surface });
  }, [link, surface]);
  if (!link) return null;
  return (
    <div data-testid={`referral-line-${surface}`} className={`min-w-0 ${className}`}>
      <p className="flex items-start gap-2 text-[13px] leading-snug text-[var(--mp-fg-muted)]">
        <Users className="mt-0.5 h-4 w-4 shrink-0 text-[var(--mp-viridian)]" aria-hidden />
        <span>{rsT("after_result_line", l)}</span>
      </p>
      {open
        ? <div className="mt-2"><ReferralShareActions link={link} mentorCredits={invite?.mentorCredits ?? null} lang={l} surface={surface} /></div>
        : <button type="button" onClick={() => setOpen(true)} className="mp-btn mp-btn--secondary mt-2 min-h-11 text-[13px]">{rsT("after_result_cta", l)}</button>}
    </div>
  );
}
