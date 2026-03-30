"use client";

import Link from "next/link";
import { getTopicConfig } from "@/lib/topics";
import { t } from "@/lib/i18n";

type Lang = "de" | "en";

interface TopicCardProps {
  topic: string;
  count: number;
  userId?: string;
  lang: Lang;
  accuracy?: number;
  delay?: number;
}

export default function TopicCard({ topic, count, userId, lang, accuracy, delay = 0 }: TopicCardProps) {
  const config = getTopicConfig(topic);
  const href = userId ? `/quiz?topic=${encodeURIComponent(topic)}&userId=${userId}` : "#";

  return (
    <Link
      href={href}
      className="topic-card-border bg-[#1E293B]/50 border border-[#334155]/40 rounded-xl p-4 card-hover block animate-fade-in"
      style={{
        borderLeftColor: config.color,
        animationDelay: `${delay}ms`,
      }}
    >
      <div className="flex items-start justify-between mb-2">
        <span className="text-2xl">{config.icon}</span>
        {accuracy !== undefined && accuracy > 0 && (
          <span className={`text-xs font-medium px-1.5 py-0.5 rounded-md ${
            accuracy >= 70 ? "bg-[#10B981]/15 text-[#10B981]" :
            accuracy >= 40 ? "bg-[#F59E0B]/15 text-[#F59E0B]" :
            "bg-[#EF4444]/15 text-[#EF4444]"
          }`}>
            {accuracy}%
          </span>
        )}
      </div>
      <h3 className="text-sm font-semibold leading-tight mb-1 text-[#F1F5F9]">
        {topic}
      </h3>
      <p className="text-xs text-[#64748B] mb-2">
        {count} {t("questions", lang)}
      </p>
      {/* Progress bar */}
      <div className="h-1 bg-[#334155]/60 rounded-full overflow-hidden">
        <div
          className="h-full rounded-full animate-progress"
          style={{
            width: `${accuracy || 0}%`,
            backgroundColor: config.color,
            opacity: 0.7,
          }}
        />
      </div>
    </Link>
  );
}
