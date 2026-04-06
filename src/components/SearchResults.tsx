"use client";

import Link from "next/link";
import { getTopicConfig } from "@/lib/topics";
import TopicIcon from "@/components/TopicIcon";

type Lang = "de" | "en";

interface SearchQuestion {
  id: number;
  topic: string;
  question: string;
  source_file?: string;
}

interface SearchResultsProps {
  results: SearchQuestion[];
  query: string;
  loading: boolean;
  lang: Lang;
  examSource: string;
}

function truncate(text: string, max: number): string {
  return text.length > max ? text.slice(0, max) + "…" : text;
}

function sourceBadge(source_file?: string): string {
  if (!source_file) return "SIP";
  if (source_file.startsWith("KMP")) return source_file;
  return "SIP";
}

export default function SearchResults({
  results,
  query,
  loading,
  lang,
  examSource,
}: SearchResultsProps) {
  if (!query) return null;

  if (loading) {
    return (
      <div className="mt-2 card p-4 text-center">
        <div className="w-5 h-5 border-2 border-[#007B5F] border-t-transparent rounded-full animate-spin mx-auto" />
      </div>
    );
  }

  if (results.length === 0) {
    return (
      <div className="mt-2 card p-4 text-center">
        <p className="text-sm text-[#A0AEC0]">
          {lang === "de" ? "Keine Ergebnisse gefunden" : "No results found"}
        </p>
      </div>
    );
  }

  return (
    <div className="mt-2 card overflow-hidden">
      <div className="px-3 py-2 border-b border-[#E4E9F0]">
        <p className="text-[10px] uppercase tracking-wider text-[#A0AEC0] font-semibold">
          {lang === "de" ? "Suchergebnisse" : "Search Results"} ({results.length})
        </p>
      </div>

      <ul>
        {results.map((q, i) => {
          const cfg = getTopicConfig(q.topic);
          return (
            <li
              key={q.id}
              className={`border-b border-[#E4E9F0]/50 last:border-b-0 ${i % 2 === 0 ? "" : "bg-[#FFFFFF]/30"}`}
            >
              <Link
                href={`/quiz?topic=${encodeURIComponent(q.topic)}&questionId=${q.id}&examSource=${examSource}`}
                className="flex items-start gap-3 px-3 py-3 hover:bg-[#F7F9FC] transition-colors group"
              >
                {/* Topic badge */}
                <span
                  className="mt-0.5 flex-shrink-0 w-6 h-6 rounded flex items-center justify-center text-xs"
                  style={{ backgroundColor: `${cfg.color}20`, color: cfg.color }}
                >
                  <TopicIcon name={cfg.icon} className="w-4 h-4" />
                </span>

                {/* Question text */}
                <span className="flex-1 min-w-0">
                  <span className="text-sm text-[#1A2B3C] group-hover:text-[#1A2B3C] transition-colors leading-snug">
                    {truncate(q.question, 120)}
                  </span>
                  <span className="mt-1 flex items-center gap-2">
                    <span
                      className="text-[10px] font-medium truncate max-w-[100px]"
                      style={{ color: cfg.color }}
                    >
                      {q.topic}
                    </span>
                    <span className="text-[10px] bg-[#F7F9FC] text-[#A0AEC0] px-1.5 py-0.5 rounded font-mono">
                      {sourceBadge(q.source_file)}
                    </span>
                  </span>
                </span>

                <span className="text-[#E4E9F0] group-hover:text-[#007B5F] transition-colors text-xs flex-shrink-0">
                  →
                </span>
              </Link>
            </li>
          );
        })}
      </ul>
    </div>
  );
}
