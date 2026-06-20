"use client";

/**
 * CohortCountdownBanner — informational strip counting down to the
 * next in-market Kenntnisprüfung Wien exam date (Mon 2026-09-28),
 * per MEDPRUF-SOT.md §1. (Was the stale 2026-06-26 Pharma date.)
 *
 * Post-soft-launch sprint §1.4.5 rewrite:
 *
 *   - Visibility is elected by the shared announcement gate. Never
 *     stacks with OrientationModal or ReferralShareFloater. See
 *     `src/lib/announcements/useAnnouncementGate.ts`.
 *   - Tone is utilitarian, not salesy. No "Pläne ansehen" CTA racing
 *     the close button; the user can click the label to navigate to
 *     pricing if they want, but nothing is shouting at them.
 *   - German only. The earlier mixed-language "Pass first try — or
 *     study free until you do" English tagline on a DE banner was
 *     jarring; the English headline lives on the landing hero where it
 *     earns its drama. Here we just say the date in German.
 *   - Dismissal writes to the server (not sessionStorage) so a user on
 *     three devices doesn't see the banner again after dismissing.
 *
 * Hide-on-path list preserved — the banner hides on /pricing (the
 * pricing page already communicates the cohort), /landing, /login,
 * etc. so authenticated legal surfaces stay clean.
 */

import { useState, useEffect } from "react";
import { usePathname } from "next/navigation";
import Link from "next/link";
import { Timer } from "lucide-react";
import {
  useAnnouncementGate,
  type SurfaceKey,
} from "@/lib/announcements/useAnnouncementGate";

const COHORT_EXAM_ISO = "2026-09-28T09:00:00+02:00"; // Kenntnisprüfung Wien, Vienna time (SoT §1)
const SURFACE: SurfaceKey = "cohort_banner";
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

function getDaysUntil(targetIso: string): number {
  const now = Date.now();
  const then = new Date(targetIso).getTime();
  const ms = then - now;
  if (ms <= 0) return 0;
  return Math.ceil(ms / (1000 * 60 * 60 * 24));
}

export default function CohortCountdownBanner() {
  const pathname = usePathname();
  const { activeSurface, markSeen } = useAnnouncementGate();
  const [daysLeft, setDaysLeft] = useState<number | null>(null);

  // Compute days-until once per mount — banner doesn't need a live tick
  // (countdown is day-granularity, not seconds) and the tick animation
  // was flagged by prefers-reduced-motion.
  useEffect(() => {
    const d = getDaysUntil(COHORT_EXAM_ISO);
    setDaysLeft(d > 0 ? d : null);
  }, []);

  const hideOnPath = HIDE_PATHS.some((p) => pathname?.startsWith(p));
  if (hideOnPath) return null;
  if (daysLeft === null) return null;
  if (activeSurface !== SURFACE) return null;

  const handleDismiss = () => {
    void markSeen(SURFACE);
  };

  const dayWord = daysLeft === 1 ? "Tag" : "Tage";

  return (
    <div
      role="status"
      className="fixed top-0 left-0 right-0 z-[60] bg-gradient-to-r from-[var(--mp-cta-blue)] to-[var(--mp-accent-teal)] text-white px-4 py-2.5 shadow-lg"
      // Reserve the height so the hero below doesn't jump when the
      // banner mounts — fixes the soft-launch CLS issue.
      style={{ minHeight: "44px" }}
    >
      <div className="max-w-5xl mx-auto flex items-center justify-between gap-3">
        <div className="flex items-center gap-2 min-w-0">
          <Timer className="w-4 h-4 flex-shrink-0" aria-hidden />
          <p className="text-xs sm:text-sm font-medium truncate">
            <span className="font-bold">Kenntnisprüfung-Kohorte:</span>{" "}
            {`Noch ${daysLeft} ${dayWord} bis zur Kenntnisprüfung Wien am 28. September.`}
          </p>
        </div>
        <div className="flex items-center gap-2 flex-shrink-0">
          <Link
            href="/faq#puyp"
            className="text-xs font-medium text-white/90 hover:text-white underline-offset-2 hover:underline hidden sm:inline"
          >
            Mehr erfahren
          </Link>
          <button
            type="button"
            onClick={handleDismiss}
            className="text-white/70 hover:text-white text-xs px-2 py-1 min-w-[44px] min-h-[24px]"
            aria-label="Banner schließen"
            title="Dismiss"
          >
            ✕
          </button>
        </div>
      </div>
    </div>
  );
}
