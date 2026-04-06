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
      className="topic-card-border bg-[#FFFFFF] border border-[#E4E9F0] rounded p-4 card-hover block animate-fade-in"
      style={{
        borderLeftColor: config.color,
        animationDelay: `${delay}ms`,
      }}
    >
      <div className="flex items-start justify-between mb-2">
        <TopicIcon name={config.icon} className="w-6 h-6" />
        {accuracy !== undefined && accuracy > 0 && (
          <span
            className={`text-xs font-medium font-mono px-1.5 py-0.5 rounded border ${
              accuracy >= 70
                ? "bg-[#00A896]/10 text-[#00A896] border-[#00A896]/20"
                : accuracy >= 40
                ? "bg-[#F4A261]/10 text-[#F4A261] border-[#F4A261]/20"
                : "bg-[#D64545]/10 text-[#D64545] border-[#D64545]/20"
            }`}
          >
            {accuracy}%
          </span>
        )}
      </div>
      <h3 className="text-sm font-semibold leading-tight mb-1 text-[#1A2B3C]">{topic}</h3>
      <p className="text-xs text-[#A0AEC0] mb-2 font-mono">
        {count} {t("questions", lang)}
      </p>
      {/* Progress bar */}
      <div className="h-0.5 bg-[#F7F9FC] rounded-full overflow-hidden">
        <div
          className="h-full rounded-full animate-progress"
          style={{
            width: `${accuracy || 0}%`,
            backgroundColor: config.color,
          }}
        />
      </div>
    </Link>
  );
}
