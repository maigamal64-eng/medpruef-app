"use client";

import Link from "next/link";
import { getTopicConfig } from "@/lib/topics";
import { t } from "@/lib/i18n";
import TopicIcon from "@/components/TopicIcon";

type Lang = "de" | "en";

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
  if (days === 0) return lang === "de" ? "Heute" : "Today";
  if (days === 1) return lang === "de" ? "Gestern" : "Yesterday";
  return lang === "de" ? `vor ${days} Tagen` : `${days} days ago`;
}

export default function TopicCard({ topic, count, userId, lang, accuracy, answered, delay = 0, examSource, lastStudied }: TopicCardProps) {
  const config = getTopicConfig(topic);
  const params = new URLSearchParams({ topic });
  if (userId) params.set('userId', userId);
  if (examSource) params.set('examSource', examSource);
  const href = `/quiz?${params.toString()}`;

  return (
    <Link
      href={href}
      className="card-interactive block rounded-2xl p-6 group"
      style={{ animationDelay: `${delay}ms` }}
    >
      {/* Icon — direct, no background */}
      <div className="flex items-start justify-between mb-3">
        <TopicIcon name={config.icon} className="w-7 h-7 transition-transform duration-200 group-hover:scale-110" style={{ color: config.color }} />
        {accuracy !== undefined && accuracy > 0 && (
          <div className="flex flex-col items-end gap-1">
            <span
              className={`text-[11px] font-semibold font-mono px-2 py-0.5 rounded-lg ${
                accuracy >= 70
                  ? "bg-[#00A896]/12 text-[#00A896]"
                  : accuracy >= 40
                  ? "bg-[#F4A261]/12 text-[#F4A261]"
                  : "bg-[#D64545]/12 text-[#D64545]"
              }`}
              title={`${lang === "de" ? "Dieses Thema zu verbessern erhöht deine Gesamtnote um" : "Improving this topic increases your overall score by"} ~${Math.round(100 / 10)}%`}
            >
              {Math.round(Math.min(accuracy, 100))}%
            </span>
            {/* Strength badge */}
            <div className="flex items-center gap-1.5">
              <span className={`w-2 h-2 rounded-full ${accuracy >= 80 ? 'bg-[#00A896]' : accuracy >= 40 ? 'bg-[#F4A261]' : 'bg-[#D64545]'}`} />
              <span className={`text-[10px] font-semibold ${accuracy >= 80 ? 'text-[#00A896]' : accuracy >= 40 ? 'text-[#F4A261]' : 'text-[#D64545]'}`}>
                {accuracy >= 80
                  ? (lang === "de" ? "Stark" : "Strong")
                  : accuracy >= 40
                  ? (lang === "de" ? "Schwach" : "Weak")
                  : (lang === "de" ? "Wiederholung" : "Needs Revision")}
              </span>
            </div>
          </div>
        )}
      </div>

      {/* Topic name — truncated with tooltip */}
      <h3 className="text-[15px] font-semibold leading-snug mb-1 text-[#1A2B3C] line-clamp-2 min-h-[2.5rem]" title={topic}>
        {topic}
      </h3>

      {/* Question count */}
      <p className="text-xs text-[#A0AEC0] mb-0.5 font-mono">
        {count.toLocaleString("de-DE")} {t("questions", lang)}
      </p>
      {lastStudied && (
        <p className="text-[10px] text-[#A0AEC0]/70 mb-0.5">{getRelativeTime(lastStudied, lang)}</p>
      )}
      {answered !== undefined && answered > 0 && (
        <p className="text-[10px] text-[#A0AEC0]/70 mb-0.5 font-mono">
          {answered}/{count} {lang === "de" ? "bearbeitet" : "practiced"}
        </p>
      )}

      {/* Fix now link for weak topics */}
      {accuracy !== undefined && accuracy > 0 && accuracy < 60 && (
        <p className="text-[11px] font-semibold text-[#D64545] mb-2 hover:underline">
          {lang === "de" ? "Jetzt verbessern" : "Fix now"} →
        </p>
      )}
      {(accuracy === undefined || accuracy === 0 || accuracy >= 60) && <div className="mb-3" />}

      {/* Progress bar — based on completion (answered/total), not accuracy */}
      <div className="h-1.5 bg-[#F7F9FC] rounded-full overflow-hidden">
        <div
          className="h-full rounded-full animate-progress"
          style={{
            width: `${count > 0 ? Math.min(((answered || 0) / count) * 100, 100) : 0}%`,
            background: `linear-gradient(to right, ${config.color}, ${config.color}60)`,
          }}
        />
      </div>
    </Link>
  );
}
