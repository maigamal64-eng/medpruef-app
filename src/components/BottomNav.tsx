"use client";

/**
 * BottomNav — the phone navigation bar (UX-GLOBAL-09/11, HOME-49 option B).
 *
 * Five items maximum: Start, Simulation, Üben (raised centre), Lernplan (or
 * the mentor when it is switched on for this learner), Mehr. Every other
 * destination is one tap away in the Mehr sheet, which renders the same
 * grouped list as the desktop Sidebar (src/lib/nav-destinations.ts).
 *
 * Opaque surface with a top border, no blur (HOME-48, PRA-31 option B), on
 * the named nav layer. Not mounted in focus mode (AppLayout) or on public
 * routes.
 */

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useRef, useState } from "react";
import { MoreHorizontal } from "lucide-react";
import { t, type Lang } from "@/lib/i18n";
import { NavItem } from "@/components/ui";
import { useMentorAvailability } from "@/components/mentor/useMentorAvailability";
import { DESTINATIONS, RAISED_SLOT, bottomSlots, isDestinationActive, isMoreActive, type Destination } from "@/lib/nav-destinations";
import MoreSheet, { OPEN_MORE_EVENT, destinationLabel } from "@/components/nav/MoreSheet";
import { DestinationIcon } from "@/components/nav/DestinationIcon";

interface BottomNavProps {
  lang: Lang;
  userId?: string;
}

export default function BottomNav({ lang }: BottomNavProps) {
  const pathname = usePathname() ?? "/";
  // Mentor entry (ships dark): shown only when the server says this learner may use it.
  const mentorAvailability = useMentorAvailability();
  const mentorAvailable = mentorAvailability === "available" || mentorAvailability === "resting";
  const gates = { mentor: mentorAvailable, referrals: false };
  const [moreOpen, setMoreOpen] = useState(false);
  const moreRef = useRef<HTMLButtonElement>(null);

  // The header avatar opens the same sheet.
  useEffect(() => {
    const open = () => setMoreOpen(true);
    window.addEventListener(OPEN_MORE_EVENT, open);
    return () => window.removeEventListener(OPEN_MORE_EVENT, open);
  }, []);

  // Close the sheet when a destination navigates.
  useEffect(() => { setMoreOpen(false); }, [pathname]);

  const slots = bottomSlots(gates)
    .map((key) => DESTINATIONS.find((d) => d.key === key))
    .filter((d): d is Destination => !!d);
  const moreActive = isMoreActive(pathname, gates);
  const slotLabel = (d: Destination) => (d.slotLabelKey ? t(d.slotLabelKey, lang) : destinationLabel(d, lang));

  return (
    <nav className="bottom-nav mp-bottom-nav fixed bottom-0 left-0 right-0 mp-layer-nav" aria-label={t("nav_main", lang)}>
      <ul className="flex items-end justify-around px-1 pt-1.5 pb-1 max-w-[560px] mx-auto">
        {slots.map((destination) => {
          const active = isDestinationActive(destination, pathname);
          const label = slotLabel(destination);
          if (destination.key === RAISED_SLOT) {
            return (
              <li key={destination.key} className="flex-1 flex justify-center">
                <Link
                  href={destination.href ?? "/"}
                  aria-current={active ? "page" : undefined}
                  className="mp-bottom-nav__raised group flex flex-col items-center -mt-3 min-w-[64px] rounded-2xl"
                >
                  <span className={`w-12 h-12 rounded-2xl flex items-center justify-center transition-colors ${active ? "bg-[var(--mp-action-primary-hover)] ring-4 ring-[var(--mp-focus-color)]/25" : "bg-[var(--mp-action-primary)]"} text-[var(--mp-fg-on-cta-blue)] shadow-[var(--mp-shadow-card)]`}>
                    <DestinationIcon name={destination.key} className="w-6 h-6" />
                  </span>
                  <span className={`mp-bottom-nav__label mt-0.5 ${active ? "font-bold text-[var(--mp-fg)]" : "text-[var(--mp-fg-muted)]"}`}>{label}</span>
                </Link>
              </li>
            );
          }
          return (
            <li key={destination.key} className="flex-1 flex justify-center">
              <NavItem
                context="bottom"
                href={destination.href ?? "/"}
                icon={<DestinationIcon name={destination.key} />}
                label={label}
                active={active}
                className="mp-bottom-nav__item"
              />
            </li>
          );
        })}
        <li className="flex-1 flex justify-center">
          <button
            ref={moreRef}
            type="button"
            onClick={() => setMoreOpen(true)}
            aria-haspopup="dialog"
            aria-expanded={moreOpen}
            aria-current={moreActive ? "page" : undefined}
            className={`mp-bottom-nav__item mp-nav-bottom-item ${moreActive ? "mp-nav-bottom-item--active" : ""}`}
          >
            <MoreHorizontal className="w-5 h-5" aria-hidden />
            <span className="mp-bottom-nav__label">{t("nav_more", lang)}</span>
          </button>
        </li>
      </ul>
      <MoreSheet open={moreOpen} onOpenChange={setMoreOpen} lang={lang} mentorAvailable={mentorAvailable} />
    </nav>
  );
}
