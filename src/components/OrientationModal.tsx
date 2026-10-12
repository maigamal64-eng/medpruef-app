"use client";

/**
 * OrientationModal — second-session orientation for returning users.
 *
 * Replaces the earlier `SoftLaunchWelcomeModal` (post-soft-launch
 * sprint §1.4.3). Key differences from the v1 modal:
 *
 *   - Renamed: "Soft Launch" framing was internal scaffolding leaking
 *     into the user's experience. Dropped entirely.
 *   - Retrimmed: 4 items → 2 items. Only PUYP guarantee + 150Q free
 *     tier. The referral item and the cohort item are handled by
 *     dedicated surfaces at the right cadence, not crammed into the
 *     welcome screen.
 *   - Earned, not first-touch: the announcement gate elects this modal
 *     only in session 2+ when the user is genuinely returning. It does
 *     NOT fire on first touch.
 *   - CTAs stay on page: primary "Weiterlernen" closes the modal in-
 *     place. Secondary "Pläne später ansehen" also closes without any
 *     redirect. The earlier v1's "Pläne ansehen" → /pricing redirect
 *     was the main trust smell; that's gone now.
 *   - Storage key versioned `_v2` so anyone who saw the v1 copy gets
 *     re-shown with the new wording.
 *
 * The modal renders only when the central announcement gate elects it.
 * See `src/lib/announcements/useAnnouncementGate.ts` for the cadence.
 */

import Link from "next/link";
import { useEffect, useState } from "react";
import { Dialog } from "@/components/ui";
import { ShieldCheck, Gift } from "lucide-react";
import {
  useAnnouncementGate,
  type SurfaceKey,
} from "@/lib/announcements/useAnnouncementGate";
import { dismissSurface, useAnnouncementSlot } from "@/lib/announcements/queue";
import { t, useLang } from "@/lib/i18n";
import { getStoredExamSource, type ExamSourceId } from "@/lib/topics";
import { safeStorage } from "@/lib/safe-storage";

// Versioned key survives `v1` dismissals from the old SoftLaunchWelcomeModal.
const LEGACY_KEY = "medpruef_soft_launch_welcome_seen";
const STORAGE_KEY = "medpruef_orientation_modal_seen_v2";
const SURFACE: SurfaceKey = "orientation_modal";

/**
 * Rendered from `app/layout.tsx`. Delegates visibility to the shared
 * announcement gate — never self-elects. Silently no-ops for guests
 * or when the gate is still loading.
 */
export default function OrientationModal() {
  const { activeSurface, state, markSeen } = useAnnouncementGate();
  const lang = useLang();
  // Resolve the user's stored exam preference so the "Free 150" CTA in the
  // modal lands them in the right exam (not always pharma/Kenntnisprüfung
  // by accident). SSR-safe: getStoredExamSource() returns the default during
  // server render, then we re-read on mount.
  const [examSource, setExamSource] = useState<ExamSourceId>("kenntnispruefung");
  useEffect(() => {
    setExamSource(getStoredExamSource());
  }, []);
  const items = [
    {
      icon: <ShieldCheck className="w-5 h-5 text-[var(--mp-accent-teal)]" />,
      title: t("orient_item1_title", lang),
      description: t("orient_item1_body", lang),
      href: "/faq#puyp",
      hrefLabel: t("orient_item1_link", lang),
    },
    {
      icon: <Gift className="w-5 h-5 text-[var(--mp-cta-blue)]" />,
      title: t("orient_item2_title", lang),
      description: t("orient_item2_body", lang),
      href: `/quiz?exam=${examSource}&free=1`,
      hrefLabel: t("orient_item2_link", lang),
    },
  ];

  // Legacy carry-over: if the user saw the v1 modal in the soft launch,
  // we still want to show them the v2 retrim ONCE. The server-side gate
  // tracks this via `orientation_modal_seen_at` being null for users
  // who were created before the rewrite. No client flag read needed.

  // UX-GLOBAL-12: the gate decides the cadence, the queue decides "now".
  const open = useAnnouncementSlot("orientation", activeSurface === "orientation_modal" && Boolean(state));

  const dismiss = async () => {
    // Stamp the new localStorage key AND clear the legacy one so the
    // v1 modal doesn't ghost back if a user rolls back to an older
    // client bundle during the rollout window.
    try {
      safeStorage.setItem(STORAGE_KEY, "1");
      safeStorage.removeItem(LEGACY_KEY);
    } catch {
      /* noop */
    }
    dismissSurface("orientation", "no_interest");
    await markSeen(SURFACE);
  };

  if (!open || !state) return null;

  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        if (!next) void dismiss();
      }}
      title={t("orient_title", lang)}
      description={t("orient_subtitle", lang)}
      maxWidth="480px"
      footer={
        <div className="flex flex-col sm:flex-row gap-2 w-full">
          <button
            type="button"
            onClick={() => void dismiss()}
            className="mp-btn mp-btn--primary mp-btn--lg flex-1"
          >
            {t("orient_primary_cta", lang)}
          </button>
          <button
            type="button"
            onClick={() => void dismiss()}
            className="mp-btn mp-btn--secondary mp-btn--lg flex-1"
          >
            {t("orient_secondary_cta", lang)}
          </button>
        </div>
      }
    >
      <div className="space-y-4">
        {items.map((item, i) => (
          <div key={i} className="flex gap-3">
            <div className="w-10 h-10 rounded-[var(--mp-r-card)] bg-[var(--mp-surface-sunken)] flex items-center justify-center flex-shrink-0">
              {item.icon}
            </div>
            <div className="min-w-0">
              <p className="text-sm font-semibold text-[var(--mp-fg)]">
                {item.title}
              </p>
              <p className="text-xs text-[var(--mp-fg-subtle)] mt-0.5 leading-relaxed">
                {item.description}
              </p>
              {item.href && (
                <Link
                  href={item.href}
                  onClick={() => void dismiss()}
                  className="text-xs font-medium text-[var(--mp-cta-blue)] mt-1 inline-block hover:underline"
                >
                  {item.hrefLabel ?? t("orient_learn_more_link", lang)} →
                </Link>
              )}
            </div>
          </div>
        ))}
      </div>
    </Dialog>
  );
}
