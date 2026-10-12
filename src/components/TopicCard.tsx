"use client";
import { buildQuizHref } from "@/lib/quiz-links";

import Link from "next/link";
import { getTopicConfig } from "@/lib/topics";
import { t , type Lang } from "@/lib/i18n";
import TopicIcon from "@/components/TopicIcon";



interface TopicCardProps {
  topic: string;
  count: number;
  userId?: string;
  lang: Lang;
  accuracy?: number;
  answered?: number; // how many questions answered in this topic
  delay?: number;
  examSource?: string;
  lastStudied?: string;
}

function getRelativeTime(dateStr: string, lang: Lang): string {
  const diff = Date.now() - new Date(dateStr).getTime();
  const days = Math.floor(diff / 86400000);
  if (days === 0) return t("home_today", lang);
  if (days === 1) return t("home_yesterday", lang);
  return t("home_days_ago", lang).replace("{n}", String(days));
}

export default function TopicCard({ topic, count, lang, accuracy, answered, delay = 0, examSource, lastStudied }: TopicCardProps) {
  const config = getTopicConfig(topic);
  const href = buildQuizHref({ topic, examSource, practiceMode: 'unseen' });

  // Compose an accessible label — screen readers get topic + count + accuracy at once.
  const accuracyPart =
    accuracy !== undefined && answered !== undefined && answered > 0
      ? `, ${Math.round(Math.min(accuracy, 100))}% ${t("home_accuracy_28", lang)}`
      : "";
  const answeredPart =
    answered !== undefined && answered > 0
      ? `, ${answered} ${t("home_of", lang)} ${count} ${t("home_practiced", lang)}`
      : "";
  const ariaLabel = `${topic}, ${count.toLocaleString(lang === "de" ? "de-DE" : "en-US")} ${t("questions", lang)}${accuracyPart}${answeredPart}`;

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
        {accuracy !== undefined && answered !== undefined && answered > 0 && (
          <div className="flex flex-col items-end gap-1">
            <span
              className="text-[11px] font-semibold font-mono px-2 py-0.5 rounded-full"
              style={{
                background:
                  accuracy >= 70
                    ? "rgba(0,123,95,0.12)"
                    : accuracy >= 40
                    ? "rgba(244,162,97,0.14)"
                    : "rgba(214,69,69,0.12)",
                color:
                  accuracy >= 70
                    ? "var(--mp-viridian)"
                    : accuracy >= 40
                    ? "var(--mp-warning-dk)"
                    : "var(--mp-error)",
              }}
              title={`${t("home_improving_this_topic_increases_your_overall_score_by", lang)} ~${Math.round(100 / 10)}%`}
            >
              {Math.round(Math.min(accuracy, 100))}%
            </span>
            {/* Strength badge */}
            <div className="flex items-center gap-1.5">
              <span
                className="w-2 h-2 rounded-full"
                style={{
                  background:
                    accuracy >= 80
                      ? "var(--mp-viridian)"
                      : accuracy >= 40
                      ? "var(--mp-warning-dk)"
                      : "var(--mp-error)",
                }}
              />
              <span
                className="text-[10px] font-semibold"
                style={{
                  color:
                    accuracy >= 80
                      ? "var(--mp-viridian)"
                      : accuracy >= 40
                      ? "var(--mp-warning-dk)"
                      : "var(--mp-error)",
                }}
              >
                {accuracy >= 80
                  ? (t("home_strong", lang))
                  : accuracy >= 40
                  ? (t("home_weak", lang))
                  : (t("home_needs_revision", lang))}
              </span>
            </div>
          </div>
        )}
      </div>

      {/* Topic name — truncated with tooltip */}
      <h3 lang="de" dir="ltr" className="text-[15px] font-semibold leading-snug mb-1 text-[var(--mp-fg)] line-clamp-2 min-h-[2.5rem]" title={topic}>
        {topic}
      </h3>

      {/* Question count */}
      <p className="text-xs text-[var(--mp-fg-subtle)] mb-0.5 font-mono">
        {count.toLocaleString(lang === "de" ? "de-DE" : "en-US")} {t("questions", lang)}
      </p>
      {lastStudied && (
        <p className="text-[10px] text-[var(--mp-fg-subtle)]/70 mb-0.5">{getRelativeTime(lastStudied, lang)}</p>
      )}
      {answered !== undefined && answered > 0 && (
        <p className="text-[10px] text-[var(--mp-fg-subtle)]/70 mb-0.5 font-mono">
          <bdi dir="ltr">{answered}/{count}</bdi> {t("home_active_questions_covered", lang)}
        </p>
      )}

      {/* Fix now link for weak topics */}
      {accuracy !== undefined && answered !== undefined && answered > 0 && accuracy < 60 && (
        <p className="text-[11px] font-semibold text-[var(--mp-error)] mb-2 hover:underline">
          {t("home_fix_now", lang)} →
        </p>
      )}
      {(accuracy === undefined || accuracy === 0 || accuracy >= 60) && <div className="mb-3" />}

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
