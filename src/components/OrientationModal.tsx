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
import { Dialog } from "@/components/ui";
import { ShieldCheck, Gift } from "lucide-react";
import {
  useAnnouncementGate,
  type SurfaceKey,
} from "@/lib/announcements/useAnnouncementGate";

// Versioned key survives `v1` dismissals from the old SoftLaunchWelcomeModal.
const LEGACY_KEY = "medpruef_soft_launch_welcome_seen";
const STORAGE_KEY = "medpruef_orientation_modal_seen_v2";
const SURFACE: SurfaceKey = "orientation_modal";

interface Item {
  icon: React.ReactNode;
  title: string;
  description: string;
  href?: string;
  hrefLabel?: string;
}

// Exactly two items — PUYP and free tier. Everything else was dropped
// in the rewrite. Links go to FAQ + /practice, NEVER to /pricing.
const ITEMS: Item[] = [
  {
    icon: <ShieldCheck className="w-5 h-5 text-[var(--mp-accent-teal)]" />,
    title: "Bestehe beim ersten Versuch — oder lerne kostenlos weiter, bis du bestehst.",
    description:
      "Wenn du in der Juni-26-Kohorte oder im Jahresabo nicht bestehst, verlängern wir deinen Zugang kostenlos bis zum nächsten Prüfungszyklus.",
    href: "/faq#puyp",
    hrefLabel: "So funktioniert's",
  },
  {
    icon: <Gift className="w-5 h-5 text-[var(--mp-cta-blue)]" />,
    title: "150 kostenlose Fragen pro Prüfungstyp.",
    description:
      "Keine Zahlungsmittel nötig. Voller Zugriff auf Erklärungen. Kein Zeitlimit — lerne in deinem Tempo.",
    href: "/quiz?free=1",
    hrefLabel: "Jetzt üben",
  },
];

/**
 * Rendered from `app/layout.tsx`. Delegates visibility to the shared
 * announcement gate — never self-elects. Silently no-ops for guests
 * or when the gate is still loading.
 */
export default function OrientationModal() {
  const { activeSurface, state, markSeen } = useAnnouncementGate();

  // Legacy carry-over: if the user saw the v1 modal in the soft launch,
  // we still want to show them the v2 retrim ONCE. The server-side gate
  // tracks this via `orientation_modal_seen_at` being null for users
  // who were created before the rewrite. No client flag read needed.

  const open = activeSurface === "orientation_modal";

  const dismiss = async () => {
    // Stamp the new localStorage key AND clear the legacy one so the
    // v1 modal doesn't ghost back if a user rolls back to an older
    // client bundle during the rollout window.
    try {
      localStorage.setItem(STORAGE_KEY, "1");
      localStorage.removeItem(LEGACY_KEY);
    } catch {
      /* noop */
    }
    await markSeen(SURFACE);
  };

  if (!open || !state) return null;

  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        if (!next) void dismiss();
      }}
      title="Willkommen bei MedPrüf"
      description="Zwei Dinge, die du wissen solltest, bevor du loslegst."
      maxWidth="480px"
      footer={
        <div className="flex flex-col sm:flex-row gap-2 w-full">
          <button
            type="button"
            onClick={() => void dismiss()}
            className="mp-btn mp-btn--primary mp-btn--lg flex-1"
          >
            Weiterlernen
          </button>
          <button
            type="button"
            onClick={() => void dismiss()}
            className="mp-btn mp-btn--secondary mp-btn--lg flex-1"
          >
            Pläne später ansehen
          </button>
        </div>
      }
    >
      <div className="space-y-4">
        {ITEMS.map((item, i) => (
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
                  {item.hrefLabel ?? "Mehr erfahren"} →
                </Link>
              )}
            </div>
          </div>
        ))}
      </div>
    </Dialog>
  );
}
