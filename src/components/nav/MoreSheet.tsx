"use client";

/**
 * MoreSheet — the phone "Mehr" sheet (UX-GLOBAL-09, HOME-49 option B).
 *
 * Lists every destination that is not in the bottom bar, in the shared
 * group order (src/lib/nav-destinations.ts), with Lernplan and Meine Fehler
 * on top so they are visible without scrolling. Holds the theme control
 * (HOME-40). Opened by the Mehr slot and by the header avatar, so theme,
 * feedback and account entries live in one place.
 *
 * Built on ui/Dialog placement "sheet": focus trap, Escape, visible Close,
 * swipe on the handle, Android Back closes it, focus returns to Mehr.
 */

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useId, useState } from "react";
import { Dialog } from "@/components/ui/Dialog";
import { t, type Lang, type TranslationKey } from "@/lib/i18n";
import { mentorT } from "@/lib/i18n-mentor";
import { trackMentorNavClick } from "@/components/mentor/telemetry";
import { useUserTier } from "@/lib/hooks/useUserTier";
import { GROUP_LABEL_KEYS, groupMoreSheet, isDestinationActive, type Destination } from "@/lib/nav-destinations";
import { getThemeChoice, setThemeChoice, type ThemeChoice } from "@/components/ThemeProvider";
import { DestinationIcon } from "./DestinationIcon";

export const OPEN_MORE_EVENT = "medpruef:open-more";
export const OPEN_FEEDBACK_EVENT = "medpruef:open-feedback";
export const OPEN_SEARCH_EVENT = "medpruef:open-search";

export function destinationLabel(destination: Destination, lang: Lang): string {
  return destination.key === "mentor" ? mentorT("nav_label", lang) : t(destination.labelKey, lang);
}

interface MoreSheetProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  lang: Lang;
  mentorAvailable: boolean;
}

export default function MoreSheet({ open, onOpenChange, lang, mentorAvailable }: MoreSheetProps) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange} title={t("nav_more_title", lang)} placement="sheet" maxWidth="480px">
      {open && <MoreSheetBody lang={lang} mentorAvailable={mentorAvailable} onClose={() => onOpenChange(false)} />}
    </Dialog>
  );
}

function MoreSheetBody({ lang, mentorAvailable, onClose }: { lang: Lang; mentorAvailable: boolean; onClose: () => void }) {
  const pathname = usePathname() ?? "/";
  const { referralsEnabled } = useUserTier();
  const groups = groupMoreSheet({ mentor: mentorAvailable, referrals: referralsEnabled });
  const baseId = useId();

  const runAction = (action: NonNullable<Destination["action"]>) => {
    onClose();
    // Let the sheet close (and its history entry settle) before the next overlay opens.
    window.setTimeout(() => {
      window.dispatchEvent(new CustomEvent(action === "open-feedback" ? OPEN_FEEDBACK_EVENT : OPEN_SEARCH_EVENT));
    }, 250);
  };

  return (
    <div className="flex flex-col gap-4 pb-2">
      {groups.map(({ group, items }) => {
        const headingId = `${baseId}-${group}`;
        return (
          <section key={group} aria-labelledby={group === "top" ? undefined : headingId} aria-label={group === "top" ? t("nav_more_quick", lang) : undefined}>
            {group !== "top" && (
              <h3 id={headingId} className="text-[13px] font-semibold text-[var(--mp-fg-muted)] mb-1 px-1">
                {t(GROUP_LABEL_KEYS[group], lang)}
              </h3>
            )}
            <ul className="flex flex-col">
              {items.map((destination) => {
                const label = destinationLabel(destination, lang);
                const active = isDestinationActive(destination, pathname);
                const rowClass = `mp-more-row ${active ? "mp-more-row--active" : ""}`;
                return (
                  <li key={destination.key}>
                    {destination.href ? (
                      <Link href={destination.href} onClick={destination.key === "mentor" ? trackMentorNavClick : undefined} className={rowClass} aria-current={active ? "page" : undefined}>
                        <DestinationIcon name={destination.key} />
                        <span className="flex-1 min-w-0">{label}</span>
                      </Link>
                    ) : (
                      <button type="button" className={rowClass} onClick={() => destination.action && runAction(destination.action)}>
                        <DestinationIcon name={destination.key} />
                        <span className="flex-1 min-w-0 text-left">{label}</span>
                      </button>
                    )}
                  </li>
                );
              })}
            </ul>
          </section>
        );
      })}
      <ThemeChoiceGroup lang={lang} />
    </div>
  );
}

/** Native radio group: a persistent single choice (UX-GLOBAL-23). */
export function ThemeChoiceGroup({ lang }: { lang: Lang }) {
  const [choice, setChoice] = useState<ThemeChoice>("system");
  const name = useId();
  useEffect(() => { setChoice(getThemeChoice()); }, []);
  const options: Array<{ value: ThemeChoice; labelKey: TranslationKey }> = [
    { value: "light", labelKey: "theme_light" },
    { value: "dark", labelKey: "theme_dark" },
    { value: "system", labelKey: "theme_system" },
  ];
  return (
    <fieldset className="mp-theme-choice">
      <legend className="text-[13px] font-semibold text-[var(--mp-fg-muted)] mb-2 px-1">{t("nav_theme", lang)}</legend>
      <div className="grid grid-cols-3 gap-2">
        {options.map((option) => (
          <label key={option.value} className="mp-theme-choice__option">
            <input
              type="radio"
              name={name}
              value={option.value}
              checked={choice === option.value}
              onChange={() => { setChoice(option.value); setThemeChoice(option.value); }}
            />
            <span>{t(option.labelKey, lang)}</span>
          </label>
        ))}
      </div>
    </fieldset>
  );
}
