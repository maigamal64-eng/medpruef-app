"use client";
import { buildQuizHref } from "@/lib/quiz-links";

import Link from "next/link";
import { getTopicConfig } from "@/lib/topics";
import { t , type Lang } from "@/lib/i18n";
import TopicIcon from "@/components/TopicIcon";
import { formatCount, formatNumber, formatPercent, formatRelativeDays } from "@/lib/master-locale/format";
import { renderedLanguage } from "@/lib/master-locale/render";
import { topicStatusText, type TopicStatus } from "@/lib/learning-metrics";



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
}

function getRelativeTime(dateStr: string, lang: Lang): string {
  const diff = Date.now() - new Date(dateStr).getTime();
  const days = Math.floor(diff / 86400000);
  if (days === 0) return t("home_today", lang);
  if (days === 1) return t("home_yesterday", lang);
  return formatRelativeDays(-days, renderedLanguage(lang).lang);
}

export default function TopicCard({ topic, count, lang, lastCorrectPct, status, answered, delay = 0, examSource, lastStudied }: TopicCardProps) {
  const config = getTopicConfig(topic);
  const fmtLang = renderedLanguage(lang).lang;
  const href = buildQuizHref({ topic, examSource, practiceMode: 'unseen' });

  // Compose an accessible label — screen readers get topic + count + accuracy at once.
  const accuracyPart =
    lastCorrectPct != null && answered !== undefined && answered > 0
      ? `, ${formatPercent(Math.round(Math.min(lastCorrectPct, 100)), fmtLang)} ${t("home_accuracy_28", lang)}`
      : "";
  const statusText = topicStatusText(status ?? null, lang);
  const answeredPart =
    answered !== undefined && answered > 0
      ? `, ${formatNumber(answered, fmtLang)} ${t("home_of", lang)} ${formatNumber(count, fmtLang)} ${t("home_practiced", lang)}`
      : "";
  const ariaLabel = `${topic}, ${formatCount(count, "question", fmtLang)}${accuracyPart}${answeredPart}${statusText && answered ? `, ${statusText.label}` : ""}`;

  return (
    <div className="relative">
    <Link
      href={href}
      className="mp-card rounded-2xl p-5 block group cursor-pointer mp-focusable hover:border-[var(--mp-viridian)]/35 transition-colors"
      style={{ animationDelay: `${delay}ms` }}
      aria-label={ariaLabel}
    >
      {/* Icon — direct, no background */}
      <div className="flex items-start justify-between mb-3">
        <TopicIcon
          name={config.icon}
          className="w-7 h-7 transition-transform duration-200 group-hover:scale-110"
          style={{ color: config.color }}
        />
        {lastCorrectPct != null && answered !== undefined && answered > 0 && (
          <div className="flex flex-col items-end gap-1">
            {/* UX-GLOBAL-06: "zuletzt richtig" from the server, never a colour alone. */}
            <span className="text-[11px] font-semibold font-mono px-2 py-0.5 rounded-full bg-[var(--mp-surface-sunken)] text-[var(--mp-fg)]">
              {formatPercent(Math.round(Math.min(lastCorrectPct, 100)), fmtLang)} {t("home_accuracy_28", lang)}
            </span>
          </div>
        )}
      </div>

      {/* Topic name — truncated with tooltip */}
      <h3 lang="de" dir="ltr" className="text-[15px] font-semibold leading-snug mb-1 text-[var(--mp-fg)] line-clamp-2 min-h-[2.5rem]" title={topic}>
        {topic}
      </h3>

      {/* Question count */}
      <p className="text-xs text-[var(--mp-fg-subtle)] mb-0.5 font-mono">
        {formatCount(count, "question", fmtLang)}
      </p>
      {lastStudied && (
        <p className="text-[10px] text-[var(--mp-fg-subtle)]/70 mb-0.5">{getRelativeTime(lastStudied, lang)}</p>
      )}
      {answered !== undefined && answered > 0 && (
        <p className="text-[10px] text-[var(--mp-fg-subtle)]/70 mb-0.5 font-mono">
          <bdi dir="ltr">{formatNumber(answered, fmtLang)}/{formatNumber(count, fmtLang)}</bdi> {t("home_active_questions_covered", lang)}
        </p>
      )}

      {/* Topic status: label plus definition, shared thresholds (UX-GLOBAL-06). */}
      {statusText && answered !== undefined && answered > 0 ? (
        <p className="text-[11px] font-semibold text-[var(--mp-fg)] mb-2" title={statusText.definition}>
          {statusText.label}
          <span className="block font-normal text-[var(--mp-fg-subtle)]">{statusText.definition}</span>
        </p>
      ) : <div className="mb-3" />}

      {/* Progress bar — based on completion (answered/total), not accuracy */}
      <div className="h-1.5 bg-[var(--mp-surface-sunken)] rounded-full overflow-hidden">
        <div
          className="h-full rounded-full animate-progress"
          style={{
            width: `${count > 0 ? Math.min(((answered || 0) / count) * 100, 100) : 0}%`,
            background: `linear-gradient(to right, ${config.color}, ${config.color}60)`,
          }}
        />
      </div>
      <p className="text-xs font-semibold mt-3">{t("home_study_new_questions", lang)} →</p>
    </Link>
    <Link href={`/mistakes?examSource=${encodeURIComponent(examSource || "kenntnispruefung")}&topic=${encodeURIComponent(topic)}`} className="block text-xs underline px-5 py-3" aria-label={t("home_mistake_label", lang).replace("{topic}", topic)}>
      {t("home_view_mistake_list", lang)}
    </Link>
    </div>
  );
}
