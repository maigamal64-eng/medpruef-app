"use client";

/**
 * RenewalOffCard (a-whop-cancel-signal): a Home card for a signed-in learner
 * who turned automatic renewal off at Whop while Pro access still runs. Says
 * when access ends and that progress stays, links the Whop manage page, and
 * links /pricing only when a plan can start at that end. Renders nothing
 * until GET /api/renewal-off says `eligible` (default off behind
 * RENEWAL_OFF_CARD_ENABLED) and the announcement queue grants the slot.
 */
import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { IconButton } from "@/components/ui/IconButton";
import { authFetch } from "@/lib/authFetch";
import { dismissSurface, useAnnouncementSlot } from "@/lib/announcements/queue";
import { useLang } from "@/lib/i18n";
import { trackEvent } from "@/lib/tracker";
import { safeWhopManageUrl } from "@/lib/whop-subscription-snapshot";
import { formatRenewalOffDate, renewalOffCopy, renewalOffLang } from "@/lib/renewal-off-copy";

interface Eligibility { eligible: boolean; accessEnd?: string; manageUrl?: string; pricing?: boolean }

export default function RenewalOffCard({ onVisibleChange }: { onVisibleChange?: (visible: boolean) => void } = {}) {
  const lang = useLang();
  const [state, setState] = useState<Eligibility | null>(null);
  const [dismissed, setDismissed] = useState(false);
  const shown = useRef(false);
  const manageUrl = state?.eligible ? safeWhopManageUrl(state.manageUrl) : null;
  const endOk = Boolean(state?.accessEnd && Number.isFinite(Date.parse(state.accessEnd)));
  const granted = useAnnouncementSlot("renewal_off", Boolean(manageUrl) && endOk && !dismissed);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const r = await authFetch("/api/renewal-off", { skipAuthRedirect: true, timeoutMs: 8_000 });
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
    if (granted && manageUrl && !shown.current) {
      shown.current = true;
      trackEvent("renewal_off_shown", { pricing: state?.pricing ? "yes" : "no" });
    }
  }, [granted, manageUrl, state]);

  if (!granted || !manageUrl || !state?.accessEnd) return null;
  const l = renewalOffLang(lang);
  const copy = renewalOffCopy(l);
  const body = copy.body.replace("{date}", formatRenewalOffDate(state.accessEnd, l));

  return (
    <section className="mp-card rounded-2xl p-4 mb-6 relative" aria-label={copy.title} data-testid="renewal-off">
      <IconButton
        label={copy.dismiss}
        onClick={() => { dismissSurface("renewal_off", "later"); setDismissed(true); }}
        className="absolute top-2 end-2"
      />
      <div className="pe-10">
        <p className="text-sm font-semibold text-[var(--mp-fg)] mb-1">{copy.title}</p>
        <p className="text-sm text-[var(--mp-fg-muted)] leading-relaxed">{body}</p>
        <div className="flex flex-wrap gap-2 mt-3">
          <a
            href={manageUrl}
            rel="noopener"
            onClick={() => trackEvent("renewal_off_click", { target: "manage" })}
            className="mp-btn mp-btn--secondary min-h-11"
          >
            {copy.manage}
          </a>
          {state.pricing && (
            <Link
              href="/pricing"
              onClick={() => trackEvent("renewal_off_click", { target: "pricing" })}
              className="mp-btn mp-btn--ghost min-h-11"
            >
              {copy.pricing}
            </Link>
          )}
        </div>
      </div>
    </section>
  );
}
