"use client";
/**
 * HomePracticeRow (UX-HOME-25, UX-HOME-29): one labelled group of links under
 * the hero, never tabs.
 *
 *  - "Anders üben": Neue Fragen, Fehler (open-mistake badge, Pro), Gespeichert (Pro).
 *    Open mistakes = distinct questions whose newest attempt was wrong, per
 *    active exam (server, topic-progress). The badge is hidden at zero or while
 *    unknown. Free accounts see the Pro pill on Pro modes (pick-free-features
 *    A), so no tap ends in a surprise paywall.
 *  - "Prüfungssimulation": timed mocks per part with the time limit in the link
 *    text and the line "Übung im Prüfungsformat, keine Vorhersage". Never
 *    promoted into the hero.
 */
import Link from "next/link";
import { ClipboardList, Bookmark, XCircle, Sparkles, Clock } from "lucide-react";
import { t, type Lang } from "@/lib/i18n";
import { buildQuizHref } from "@/lib/quiz-links";
import { canUse, type Audience } from "@/lib/entitlements";
import { gateSentence } from "@/lib/entitlement-copy";
import { ProPill } from "@/components/ui/ProPill";
import { formatNumber, formatNumberText } from "@/lib/master-locale/format";
import { renderedLanguage } from "@/lib/master-locale/render";

export type PracticeSlot = "other_modes" | "mistakes" | "saved" | "sip_tile";

const SEGMENT = "relative flex min-h-11 flex-1 min-w-[6.5rem] items-center justify-center gap-1.5 rounded-xl border border-[var(--mp-border-control)] bg-[var(--mp-surface-raised)] px-3 py-2 text-[14px] font-semibold text-[var(--mp-fg)] hover:border-[var(--mp-viridian)]/50 mp-focusable";

export function HomeOtherModes({ examSource, audience, openMistakes, lang, onSlot }: {
  examSource: string; audience: Audience; openMistakes: number | null; lang: Lang; onSlot?: (slot: PracticeSlot) => void;
}) {
  const fmt = renderedLanguage(lang).lang;
  const proMistakes = canUse("mistake_review", audience);
  const proSaved = canUse("bookmarks", audience);
  const showBadge = proMistakes && typeof openMistakes === "number" && openMistakes > 0;
  const mistakesName = showBadge
    ? t("a22_mode_mistakes_name", lang).replace("{n}", formatNumberText(openMistakes!, fmt))
    : t("a22_mode_mistakes", lang);
  const mistakesHref = proMistakes ? `/mistakes?examSource=${encodeURIComponent(examSource)}` : "/pricing?gate=mistakes";
  const savedHref = proSaved ? `/quiz?setup=1&examSource=${encodeURIComponent(examSource)}&filter=flagged` : "/pricing?gate=bookmarks";
  return (
    <nav aria-labelledby="home-other-modes" className="mt-4" data-testid="home-other-modes">
      <h2 id="home-other-modes" className="mb-2 text-[13px] font-semibold text-[var(--mp-fg-muted)]">{t("a22_other_modes", lang)}</h2>
      <ul className="flex flex-wrap gap-2" role="list">
        <li className="flex flex-1">
          <Link className={SEGMENT} href={buildQuizHref({ examSource, practiceMode: "unseen" })} onClick={() => onSlot?.("other_modes")}>
            <Sparkles className="w-4 h-4 flex-shrink-0 text-[var(--mp-viridian)]" aria-hidden />{t("a22_mode_new", lang)}
          </Link>
        </li>
        <li className="flex flex-1">
          <Link className={SEGMENT} href={mistakesHref} aria-label={proMistakes ? mistakesName : gateSentence("mistake_review", lang)} onClick={() => onSlot?.("mistakes")}>
            <XCircle className="w-4 h-4 flex-shrink-0 text-[var(--mp-fg-muted)]" aria-hidden />{t("a22_mode_mistakes", lang)}
            {showBadge && <span aria-hidden className="ml-0.5 inline-flex min-w-[1.5rem] justify-center rounded-full bg-[var(--mp-surface-sunken)] px-1.5 text-[12px] font-bold tabular-nums">{formatNumber(openMistakes!, fmt)}</span>}
            {!proMistakes && <span aria-hidden className="mp-pro-pill">Pro</span>}
          </Link>
        </li>
        <li className="flex flex-1">
          <Link className={SEGMENT} href={savedHref} aria-label={proSaved ? t("a22_mode_saved", lang) : gateSentence("bookmarks", lang)} onClick={() => onSlot?.("saved")}>
            <Bookmark className="w-4 h-4 flex-shrink-0 text-[var(--mp-fg-muted)]" aria-hidden />{t("a22_mode_saved", lang)}
            {!proSaved && <span aria-hidden className="mp-pro-pill">Pro</span>}
          </Link>
        </li>
      </ul>
    </nav>
  );
}

export function HomeSimulationEntry({ examSource, audience, lang, onSlot }: {
  examSource: string; audience: Audience; lang: Lang; onSlot?: (slot: PracticeSlot) => void;
}) {
  const pro = canUse("mock_exam", audience);
  const parts: { href: string; label: string }[] = examSource === "kenntnispruefung"
    ? [
        { href: "/exam?examSource=kenntnispruefung&part=sip4", label: t("a22_sim_sip4", lang) },
        { href: "/exam?examSource=kenntnispruefung&part=sip5", label: t("a22_sim_sip5", lang) },
      ]
    : [{ href: `/exam?examSource=${encodeURIComponent(examSource)}`, label: t("a22_sim_bank", lang) }];
  return (
    <section aria-labelledby="home-sim-title" className="mt-6" data-testid="home-simulation">
      <div className="mb-2 flex items-center gap-2">
        <h2 id="home-sim-title" className="text-[13px] font-semibold text-[var(--mp-fg-muted)]">{t("a22_sim_title", lang)}</h2>
        {!pro && <ProPill label={gateSentence("mock_exam", lang)} href="/pricing?gate=mock_exam" />}
      </div>
      <ul className="grid grid-cols-1 sm:grid-cols-2 gap-2" role="list">
        {parts.map((p) => (
          <li key={p.href}>
            <Link
              href={pro ? p.href : "/pricing?gate=mock_exam"}
              onClick={() => onSlot?.("sip_tile")}
              className="mp-card flex min-h-11 items-center gap-3 p-4 mp-focusable hover:border-[var(--mp-viridian)]/35"
              style={{ borderRadius: "var(--mp-r-card)" }}
            >
              <Clock className="w-5 h-5 flex-shrink-0 text-[var(--mp-fg-muted)]" aria-hidden />
              <span className="min-w-0 text-[14px] font-semibold text-[var(--mp-fg)]">{p.label}</span>
              <ClipboardList className="ml-auto w-4 h-4 flex-shrink-0 text-[var(--mp-fg-subtle)]" aria-hidden />
            </Link>
          </li>
        ))}
      </ul>
      <p className="mt-2 text-[13px] text-[var(--mp-fg-muted)]">{t("a22_sim_note", lang)}</p>
    </section>
  );
}
