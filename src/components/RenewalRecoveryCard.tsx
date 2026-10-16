"use client";

/**
 * RenewalRecoveryCard (a-renewal-recovery-card): a Home card for a signed-in
 * learner whose renewal charge was declined (or needs a bank step) in the last
 * 14 days and who has not paid since. The button opens the stored Whop
 * recovery link, which resumes that exact charge. Renders nothing until
 * GET /api/renewal-recovery says `eligible` (server decision, default off
 * behind RENEWAL_RECOVERY_CARD_ENABLED) and the announcement queue grants the
 * slot. Transactional: it is about a payment for access already bought.
 */
import { useEffect, useRef, useState } from "react";
import { IconButton } from "@/components/ui/IconButton";
import { authFetch } from "@/lib/authFetch";
import { dismissSurface, useAnnouncementSlot } from "@/lib/announcements/queue";
import { useLang } from "@/lib/i18n";
import { trackEvent } from "@/lib/tracker";
import { recoveryCopy, recoveryLang } from "@/lib/renewal-recovery-copy";
import { safeRecoveryUrl, type RecoveryKind } from "@/lib/renewal-recovery";

interface Eligibility { eligible: boolean; url?: string; kind?: RecoveryKind }

export default function RenewalRecoveryCard({ onVisibleChange }: { onVisibleChange?: (visible: boolean) => void } = {}) {
  const lang = useLang();
  const [state, setState] = useState<Eligibility | null>(null);
  const [dismissed, setDismissed] = useState(false);
  const shown = useRef(false);
  const url = state?.eligible ? safeRecoveryUrl(state.url) : null;
  const granted = useAnnouncementSlot("renewal_recovery", Boolean(url) && !dismissed);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const r = await authFetch("/api/renewal-recovery", { skipAuthRedirect: true, timeoutMs: 8_000 });
        if (!r.ok) return;
        const data = (await r.json()) as Eligibility;
        if (!cancelled && data?.eligible) setState(data);
      } catch {
        /* non-critical: the card stays hidden */
      }
    })();
    return () => { cancelled = true; };
  }, []);

  useEffect(() => { onVisibleChange?.(granted); }, [granted, onVisibleChange]);
  useEffect(() => {
    if (granted && url && !shown.current) {
      shown.current = true;
      trackEvent("renewal_recovery_shown", { kind: state?.kind ?? "failed" });
    }
  }, [granted, url, state]);

  if (!granted || !url) return null;
  const copy = recoveryCopy(recoveryLang(lang));

  return (
    <section className="mp-card rounded-2xl p-4 mb-6 relative" aria-label={copy.title} data-testid="renewal-recovery">
      <IconButton
        label={copy.dismiss}
        onClick={() => { dismissSurface("renewal_recovery", "later"); setDismissed(true); }}
        className="absolute top-2 end-2"
      />
      <div className="pe-10">
        <p className="text-sm font-semibold text-[var(--mp-fg)] mb-1">{copy.title}</p>
        <p className="text-sm text-[var(--mp-fg-muted)] mb-2 leading-relaxed">{copy.body}</p>
        <div className="flex flex-wrap gap-2 mt-3">
          <a
            href={url}
            rel="noopener"
            onClick={() => trackEvent("renewal_recovery_click", { kind: state?.kind ?? "failed" })}
            className="mp-btn mp-btn--primary min-h-11"
          >
            {copy.button}
          </a>
        </div>
      </div>
    </section>
  );
}
