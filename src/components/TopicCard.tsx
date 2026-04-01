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
      className="topic-card-border bg-[#191F31] border border-[#3D4947] rounded p-4 card-hover block animate-fade-in"
      style={{
        borderLeftColor: config.color,
        animationDelay: `${delay}ms`,
      }}
    >
      <div className="flex items-start justify-between mb-2">
        <span className="text-2xl">{config.icon}</span>
        {accuracy !== undefined && accuracy > 0 && (
          <span
            className={`text-xs font-medium font-mono px-1.5 py-0.5 rounded border ${
              accuracy >= 70
                ? "bg-[#4EDEA3]/10 text-[#4EDEA3] border-[#4EDEA3]/20"
                : accuracy >= 40
                ? "bg-[#FFB95F]/10 text-[#FFB95F] border-[#FFB95F]/20"
                : "bg-[#FFB4AB]/10 text-[#FFB4AB] border-[#FFB4AB]/20"
            }`}
          >
            {accuracy}%
          </span>
        )}
      </div>
      <h3 className="text-sm font-semibold leading-tight mb-1 text-[#DCE1FB]">{topic}</h3>
      <p className="text-xs text-[#879391] mb-2 font-mono">
        {count} {t("questions", lang)}
      </p>
      {/* Progress bar */}
      <div className="h-0.5 bg-[#23293C] rounded-full overflow-hidden">
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
