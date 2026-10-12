"use client";

/**
 * CohortCountdownBanner: the in-app OFFICIAL DEADLINE strip (W1-CAL,
 * 2026-10-10). Until this change it counted down to the next postgraduate
 * ÖÄK Kenntnisprüfung sitting, a date the Vienna-bank learner (who sits
 * SIP4a/SIP5a at MedUni Wien) never sits. It now shows the next official
 * registration close for the learner's OWN bank, read from the C7 export
 * (`OFFICIAL_SITTINGS` in src/lib/exam-dates.ts):
 *
 *   - Vienna bank (kenntnispruefung): SIP4a/SIP5a registration close.
 *   - Pharma bank: Rezeptierkunde/Gerichtsmedizin week, closes Tue 12:00.
 *   - Stichprobentest bank: the next sitting with BOTH published deadlines,
 *     each labelled by its publisher (never one picked for the learner).
 *
 * No ÖÄK postgraduate fact is ever shown here. The strip hides itself when
 * no official window is open (self-aging, Vienna wall-clock time).
 *
 * Visibility: still elected by the shared announcement gate for free users
 * (never stacks with OrientationModal or ReferralShareFloater; see
 * `src/lib/announcements/useAnnouncementGate.ts`). Showing the strip to
 * paid users, or after the old banner was dismissed once, is a stacking
 * decision for [name]: flip SHOW_OUTSIDE_GATE below. With it on, the strip
 * shows whenever no other gate surface is active, and dismissal is stored
 * per deadline in this browser.
 *
 * Strings: src/lib/i18n-dates.ts (DE + EN, other languages fall back to EN).
 * Hide-on-path list preserved.
 */

import { IconButton } from "@/components/ui/IconButton";
import { useEffect, useState } from "react";
import { usePathname } from "next/navigation";
import { CalendarClock } from "lucide-react";
import {
  useAnnouncementGate,
  type SurfaceKey,
} from "@/lib/announcements/useAnnouncementGate";
import { td } from "@/lib/i18n-dates";
import {
  DEADLINE_DISMISS_PREFIX,
  readDeadlineDismissed,
  useOfficialDeadline,
} from "@/lib/hooks/useOfficialDeadline";
import { useUserTier } from "@/lib/hooks/useUserTier";

const SURFACE: SurfaceKey = "cohort_banner";

/**
 * [name] decision (needs_owner, W1-CAL): false keeps the old gate exactly
 * (free users, once, never after a dismissal). true also shows the deadline
 * to paid users and to free users after a dismissal, whenever no other gate
 * surface is active.
 */
const SHOW_OUTSIDE_GATE = false;

const DISMISS_PREFIX = DEADLINE_DISMISS_PREFIX;

const HIDE_PATHS = [
  "/login",
  "/landing",
  "/privacy",
  "/terms",
  "/impressum",
  "/onboarding",
  "/pricing",
  "/faq",
];

export default function CohortCountdownBanner() {
  const pathname = usePathname();
  const { activeSurface, markSeen } = useAnnouncementGate();
  const { isPaid, isLoading: tierLoading } = useUserTier();
  const { content, lang } = useOfficialDeadline();
  const [dismissedKey, setDismissedKey] = useState<string | null>(null);
  useEffect(() => {
    if (content && readDeadlineDismissed(content.key)) setDismissedKey(content.key);
  }, [content]);

  // Home renders the same deadline as a calm line for every tier
  // (HomeDeadlineLine, UX-HOME-17), so the strip never doubles it there.
  const hideOnPath = pathname === "/" || HIDE_PATHS.some((p) => pathname?.startsWith(p));
  if (hideOnPath || tierLoading || !content) return null;
  if (dismissedKey === content.key) return null;

  const electedByGate = !isPaid && activeSurface === SURFACE;
  const outsideGate = SHOW_OUTSIDE_GATE && activeSurface === null;
  if (!electedByGate && !outsideGate) return null;

  const handleDismiss = () => {
    try {
      localStorage.setItem(DISMISS_PREFIX + content.key, "1");
    } catch {
      /* storage blocked: the gate dismissal below still applies */
    }
    setDismissedKey(content.key);
    if (electedByGate) void markSeen(SURFACE);
  };

  return (
    <div
      role="status"
      className="bg-gradient-to-r from-[var(--mp-cta-blue)] to-[var(--mp-accent-teal)] text-white px-4 py-2.5 shadow-lg"
      // Reserve the height so the content below doesn't jump when the
      // banner mounts (soft-launch CLS fix).
      style={{ minHeight: "44px" }}
    >
      <div className="max-w-5xl mx-auto flex items-center justify-between gap-3">
        <div className="flex items-start gap-2 min-w-0">
          <CalendarClock className="w-4 h-4 flex-shrink-0 mt-0.5" aria-hidden />
          <p className="text-xs sm:text-sm font-medium leading-snug">{content.text}</p>
        </div>
        <div className="flex items-center gap-2 flex-shrink-0">
          <a
            href={content.href}
            target="_blank"
            rel="noopener noreferrer"
            className="text-xs font-medium text-white/90 hover:text-white underline-offset-2 hover:underline hidden sm:inline"
          >
            {td("banner_link", lang)}
          </a>
          <IconButton label={td("dismiss", lang)} onClick={handleDismiss} tone="inverse" />
        </div>
      </div>
    </div>
  );
}
