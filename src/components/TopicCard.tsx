"use client";
import { buildQuizHref } from "@/lib/quiz-links";

import Link from "next/link";
import { getTopicConfig } from "@/lib/topics";
import { t , type Lang } from "@/lib/i18n";
import TopicIcon from "@/components/TopicIcon";
import { formatCount, formatNumber, formatNumberText, formatPercent, formatRelativeDays } from "@/lib/master-locale/format";
import { renderedLanguage } from "@/lib/master-locale/render";
import { topicStatusText, type TopicStatus } from "@/lib/learning-metrics";

/**
 * TopicCard (UX-HOME-27, UX-HOME-28 B, UX-HOME-24, UX-HOME-25).
 *
 * One stretched primary link covers the card ("Neue Fragen lernen: <topic>");
 * for Pro accounts with open mistakes in this topic a separate "Fehler: N"
 * link sits above it in z-order (a sibling, never a link inside a link). The
 * card is a flex column with the footer pinned to the bottom so cards in a row
 * line up; titles wrap (German hyphenation) instead of being cut.
 */

interface TopicCardProps {
  topic: string;
  count: number;
  userId?: string;
  lang: Lang;
  /** Share of distinct answered questions whose newest attempt was right (server). */
  lastCorrectPct?: number;
  /** Server topic status (UX-GLOBAL-06). */
  status?: TopicStatus;
  answered?: number; // distinct questions seen in this topic
  delay?: number;
  examSource?: string;
  lastStudied?: string;
  /** Open mistakes in this topic (newest attempt wrong); shown only with `showMistakes`. */
  openMistakes?: number | null;
  /** Pro accounts only (mistake review is Pro, pick-free-features A). */
  showMistakes?: boolean;
  onOpen?: () => void;
}

function getRelativeTime(dateStr: string, lang: Lang): string {
  const diff = Date.now() - new Date(dateStr).getTime();
  const days = Math.floor(diff / 86400000);
  if (days === 0) return t("home_today", lang);
  if (days === 1) return t("home_yesterday", lang);
  return formatRelativeDays(-days, renderedLanguage(lang).lang);
}

export default function TopicCard({ topic, count, lang, lastCorrectPct, status, answered, delay = 0, examSource, lastStudied, openMistakes, showMistakes = false, onOpen }: TopicCardProps) {
  const config = getTopicConfig(topic);
  const fmtLang = renderedLanguage(lang).lang;
  const href = buildQuizHref({ topic, examSource, practiceMode: 'unseen' });
  const hasAnswers = answered !== undefined && answered > 0;
  const pctText = lastCorrectPct != null && hasAnswers
    ? `${formatPercent(Math.round(Math.min(lastCorrectPct, 100)), fmtLang)} ${t("home_accuracy_28", lang)}`
    : null;

  // Accessible name of the primary link: the action first, then the state.
  const statusText = topicStatusText(status ?? null, lang);
  const parts = [t("a22_topic_primary_name", lang).replace("{topic}", topic), formatCount(count, "question", fmtLang)];
  if (pctText) parts.push(pctText);
  if (hasAnswers) parts.push(`${formatNumber(answered!, fmtLang)} ${t("home_of", lang)} ${formatNumber(count, fmtLang)} ${t("home_practiced", lang)}`);
  if (statusText && hasAnswers) parts.push(statusText.label);
  const showChip = showMistakes && typeof openMistakes === "number" && openMistakes > 0;

  return (
    <div
      className="mp-card relative flex h-full flex-col rounded-2xl p-4 sm:p-5 group hover:border-[var(--mp-viridian)]/35 transition-colors focus-within:border-[var(--mp-viridian)]/50"
      style={{ animationDelay: `${delay}ms` }}
      data-testid="topic-card"
    >
      <div className="flex items-start justify-between gap-2 mb-3">
        <TopicIcon
          name={config.icon}
          className="w-7 h-7 flex-shrink-0 transition-transform duration-200 group-hover:scale-110"
          style={{ color: config.color }}
        />
        {pctText && (
          // UX-GLOBAL-06: "zuletzt richtig" from the server, never a colour alone.
          <span className="text-[12px] font-semibold tabular-nums px-2 py-0.5 rounded-full bg-[var(--mp-surface-sunken)] text-[var(--mp-fg)] text-right">
            {pctText}
          </span>
        )}
      </div>

      <h3
        lang="de"
        dir="ltr"
        className="text-[15px] font-semibold leading-snug mb-1 text-[var(--mp-fg)] line-clamp-3"
        style={{ overflowWrap: "anywhere", hyphens: "auto" }}
        title={topic}
      >
        {/* A zero-width break after slashes lets "Frauenheilkunde/Gynäkologie" wrap. */}
        {topic.split("/").map((part, i, all) => (
          <span key={i}>{part}{i < all.length - 1 && <>/<wbr /></>}</span>
        ))}
      </h3>

      <p className="text-[12px] text-[var(--mp-fg-subtle)] mb-0.5 tabular-nums">
        {formatCount(count, "question", fmtLang)}
      </p>
      {lastStudied && (
        <p className="text-[12px] text-[var(--mp-fg-subtle)] mb-0.5">{getRelativeTime(lastStudied, lang)}</p>
      )}
      {hasAnswers && (
        <p className="text-[12px] text-[var(--mp-fg-subtle)] mb-0.5 tabular-nums">
          <bdi dir="ltr">{formatNumber(answered!, fmtLang)}/{formatNumber(count, fmtLang)}</bdi> {t("home_active_questions_covered", lang)}
        </p>
      )}
      {statusText && hasAnswers && (
        <p className="text-[12px] font-semibold text-[var(--mp-fg)] mb-1" title={statusText.definition}>
          {statusText.label}
          <span className="block font-normal text-[var(--mp-fg-subtle)]">{statusText.definition}</span>
        </p>
      )}

      {/* Footer pinned to the bottom: progress (seen / total), then the actions. */}
      <div className="mt-auto pt-3">
        <div className="h-1.5 bg-[var(--mp-surface-sunken)] rounded-full overflow-hidden" aria-hidden>
          <div
            className="h-full rounded-full animate-progress"
            style={{
              width: `${count > 0 ? Math.min(((answered || 0) / count) * 100, 100) : 0}%`,
              background: `linear-gradient(to right, ${config.color}, ${config.color}60)`,
            }}
          />
        </div>
        <div className="mt-2 flex flex-wrap items-center justify-between gap-2">
          <Link
            href={href}
            onClick={onOpen}
            aria-label={parts.join(", ")}
            className="inline-flex min-h-11 items-center text-[13px] font-semibold text-[var(--mp-viridian)] mp-focusable after:absolute after:inset-0 after:rounded-2xl after:content-['']"
          >
            <span>{t("a22_topic_cta", lang)}&nbsp;<span aria-hidden className="inline-block rtl:rotate-180">→</span></span>
          </Link>
          {showChip && (
            <Link
              href={`/mistakes?examSource=${encodeURIComponent(examSource || "kenntnispruefung")}&topic=${encodeURIComponent(topic)}`}
              className="relative z-10 inline-flex min-h-11 items-center rounded-full border border-[var(--mp-border-control)] bg-[var(--mp-surface-sunken)] px-3 text-[12px] font-semibold text-[var(--mp-fg)] mp-focusable"
              aria-label={t("a22_topic_mistakes_name", lang).replace("{topic}", topic).replace("{n}", formatNumberText(openMistakes!, fmtLang))}
            >
              {t("a22_topic_mistakes_chip", lang).replace("{n}", formatNumberText(openMistakes!, fmtLang))}
            </Link>
          )}
        </div>
      </div>
    </div>
  );
}
