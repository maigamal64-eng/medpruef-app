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
  delay?: number;
  examSource?: string;
}

export default function TopicCard({ topic, count, userId, lang, accuracy, delay = 0, examSource }: TopicCardProps) {
  const config = getTopicConfig(topic);
  const params = new URLSearchParams({ topic });
  if (userId) params.set('userId', userId);
  if (examSource) params.set('examSource', examSource);
  const href = `/quiz?${params.toString()}`;

  return (
    <Link
      href={href}
      className="card-interactive block rounded-2xl p-5 overflow-hidden relative group"
      style={{ animationDelay: `${delay}ms` }}
    >
      {/* Colored top accent bar */}
      <div className="absolute top-0 left-0 right-0 h-1 rounded-t-2xl" style={{ backgroundColor: config.color }} />

      {/* Icon in colored circle */}
      <div className="flex items-start justify-between mb-3">
        <span
          className="w-11 h-11 rounded-xl flex items-center justify-center transition-transform duration-200 group-hover:scale-110"
          style={{ backgroundColor: `${config.color}18` }}
        >
          <TopicIcon name={config.icon} className="w-6 h-6" style={{ color: config.color }} />
        </span>
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
            >
              {Math.min(accuracy, 100)}%
            </span>
            {/* Strength badge */}
            <div className="flex items-center gap-1.5">
              <span className={`w-2 h-2 rounded-full ${accuracy >= 80 ? 'bg-[#00A896]' : accuracy >= 40 ? 'bg-[#F4A261]' : 'bg-[#D64545]'}`} />
              <span className={`text-[10px] font-semibold ${accuracy >= 80 ? 'text-[#00A896]' : accuracy >= 40 ? 'text-[#F4A261]' : 'text-[#D64545]'}`}>
                {accuracy >= 80 ? 'Strong' : accuracy >= 40 ? 'Weak' : 'Needs Revision'}
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
      <p className="text-xs text-[#A0AEC0] mb-1 font-mono">
        {count.toLocaleString("de-DE")} {t("questions", lang)}
      </p>

      {/* Fix now link for weak topics */}
      {accuracy !== undefined && accuracy > 0 && accuracy < 60 && (
        <p className="text-[11px] font-semibold text-[#D64545] mb-2 hover:underline">
          {lang === "de" ? "Jetzt verbessern" : "Fix now"} →
        </p>
      )}
      {(accuracy === undefined || accuracy === 0 || accuracy >= 60) && <div className="mb-3" />}

      {/* Progress bar */}
      <div className="h-1.5 bg-[#F7F9FC] rounded-full overflow-hidden">
        <div
          className="h-full rounded-full animate-progress"
          style={{
            width: `${Math.min(accuracy || 0, 100)}%`,
            background: `linear-gradient(to right, ${config.color}, ${config.color}60)`,
          }}
        />
      </div>
    </Link>
  );
}
