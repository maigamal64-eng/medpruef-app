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
  image_url?: string;
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
  if (!source_file) return "KP";
  if (source_file.startsWith("KMP")) return "KMP";
  if (source_file.startsWith("VIENNA_2026")) return "2026";
  if (source_file.startsWith("PHARMA")) return "Pharma";
  return "KP";
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
        <div className="w-5 h-5 border-2 border-[var(--mp-viridian)] border-t-transparent rounded-full animate-spin mx-auto" />
      </div>
    );
  }

  if (results.length === 0) {
    return (
      <div className="mt-2 card p-4 text-center">
        <p className="text-sm text-[var(--mp-fg-subtle)]">
          {lang === "de" ? "Keine Ergebnisse gefunden" : "No results found"}
        </p>
      </div>
    );
  }

  return (
    <div className="mt-2 card overflow-hidden">
      <div className="px-3 py-2 border-b border-[var(--mp-border)]">
        <p className="text-[10px] uppercase tracking-wider text-[var(--mp-fg-subtle)] font-semibold">
          {lang === "de" ? "Suchergebnisse" : "Search Results"} ({results.length})
        </p>
      </div>

      <ul>
        {results.map((q, i) => {
          const cfg = getTopicConfig(q.topic);
          return (
            <li
              key={q.id}
              className={`border-b border-[var(--mp-border)]/50 last:border-b-0 ${i % 2 === 0 ? "" : "bg-[var(--mp-surface-raised)]/30"}`}
            >
              <Link
                href={`/quiz?topic=${encodeURIComponent(q.topic)}&questionId=${q.id}&examSource=${examSource}`}
                className="flex items-start gap-3 px-3 py-3 hover:bg-[var(--mp-surface-sunken)] transition-colors group"
              >
                {/* Topic badge */}
                <span
                  className="mt-0.5 flex-shrink-0 w-6 h-6 rounded flex items-center justify-center text-xs"
                  style={{ backgroundColor: `${cfg.color}20`, color: cfg.color }}
                >
                  <TopicIcon name={cfg.icon} className="w-4 h-4" />
                </span>

                {/* Image thumbnail if available */}
                {q.image_url && (
                  <img src={q.image_url} alt="" className="w-10 h-10 rounded object-cover flex-shrink-0 border border-[var(--mp-border)]" />
                )}

                {/* Question text */}
                <span className="flex-1 min-w-0">
                  <span className="text-sm text-[var(--mp-fg)] group-hover:text-[var(--mp-fg)] transition-colors leading-snug">
                    {truncate(q.question, 120)}
                  </span>
                  <span className="mt-1 flex items-center gap-2">
                    <span
                      className="text-[10px] font-medium truncate max-w-[100px]"
                      style={{ color: cfg.color }}
                    >
                      {q.topic}
                    </span>
                    <span className="text-[10px] bg-[var(--mp-surface-sunken)] text-[var(--mp-fg-subtle)] px-1.5 py-0.5 rounded font-mono">
                      {sourceBadge(q.source_file)}
                    </span>
                  </span>
                </span>

                <span className="text-[var(--mp-border)] group-hover:text-[var(--mp-viridian)] transition-colors text-xs flex-shrink-0">
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
