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

import { useEffect, useMemo, useState } from "react";
import { usePathname } from "next/navigation";
import { CalendarClock } from "lucide-react";
import {
  useAnnouncementGate,
  type SurfaceKey,
} from "@/lib/announcements/useAnnouncementGate";
import {
  OFFICIAL_KEYS_BY_BANK,
  asPuypExamType,
  getNextOfficialDeadlineGroup,
  getUpcomingOfficialFor,
  type PuypExamType,
} from "@/lib/exam-dates";
import {
  describeDeadlineGroup,
  describeStpSitting,
  describeUpcomingGroup,
  td,
} from "@/lib/i18n-dates";
import { useLang } from "@/lib/i18n";
import { getStoredSession } from "@/lib/auth";
import { EXAM_SOURCE_KEY } from "@/lib/topics";
import { useUserTier } from "@/lib/hooks/useUserTier";

const SURFACE: SurfaceKey = "cohort_banner";

/**
 * [name] decision (needs_owner, W1-CAL): false keeps the old gate exactly
 * (free users, once, never after a dismissal). true also shows the deadline
 * to paid users and to free users after a dismissal, whenever no other gate
 * surface is active.
 */
const SHOW_OUTSIDE_GATE = false;

const DISMISS_PREFIX = "medpruef_deadline_dismissed:";

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

/** The learner's bank: the exam they picked in this browser, else the server's active_exam. */
function readActiveBank(): PuypExamType | null {
  if (typeof window === "undefined") return null;
  try {
    const local = asPuypExamType(localStorage.getItem(EXAM_SOURCE_KEY));
    if (local) return local;
  } catch {
    /* storage blocked */
  }
  const user = getStoredSession()?.user as { active_exam?: string | null } | undefined;
  return asPuypExamType(user?.active_exam ?? null);
}

function readDismissed(key: string): boolean {
  try {
    return localStorage.getItem(DISMISS_PREFIX + key) === "1";
  } catch {
    return false;
  }
}

export default function CohortCountdownBanner() {
  const pathname = usePathname();
  const lang = useLang();
  const { activeSurface, markSeen } = useAnnouncementGate();
  const { isPaid, isLoading: tierLoading } = useUserTier();
  const [bank, setBank] = useState<PuypExamType | null>(null);
  const [now, setNow] = useState<Date | null>(null);
  const [dismissedKey, setDismissedKey] = useState<string | null>(null);

  // Client-only: the bank lives in localStorage / the stored session, and
  // the deadline maths needs the real clock (no SSR mismatch).
  useEffect(() => {
    setBank(readActiveBank());
    setNow(new Date());
    const onExam = () => setBank(readActiveBank());
    window.addEventListener("medpruef:examChanged", onExam);
    return () => window.removeEventListener("medpruef:examChanged", onExam);
  }, []);

  const content = useMemo(() => {
    if (!bank || !now) return null;
    const exams = OFFICIAL_KEYS_BY_BANK[bank];
    if (bank === "kmp_innsbruck") {
      // Next Stichprobentest sitting with any open deadline, all publishers.
      const open = getNextOfficialDeadlineGroup({ exams, now });
      if (!open) return null;
      const date = open.rows[0].date;
      const rows = getUpcomingOfficialFor({ exams, now }).filter((r) => r.date === date);
      return {
        key: `${bank}:${date}`,
        text: describeStpSitting(rows, lang),
        href: open.rows[0].source_url,
      };
    }
    const g = getNextOfficialDeadlineGroup({ exams, now });
    if (!g) return null;
    return {
      key: `${bank}:${g.registration_closes}`,
      text: g.started ? describeDeadlineGroup(g, lang, now) : describeUpcomingGroup(g, lang),
      href: g.rows[0].source_url,
    };
  }, [bank, now, lang]);

  useEffect(() => {
    if (content && readDismissed(content.key)) setDismissedKey(content.key);
  }, [content]);

  const hideOnPath = HIDE_PATHS.some((p) => pathname?.startsWith(p));
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
          <button
            type="button"
            onClick={handleDismiss}
            className="text-white/70 hover:text-white text-xs px-2 py-1 min-w-[44px] min-h-[24px]"
            aria-label={td("dismiss", lang)}
            title={td("dismiss", lang)}
          >
            ✕
          </button>
        </div>
      </div>
    </div>
  );
}
