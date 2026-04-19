"use client";

import { useState, useEffect, useRef, useCallback } from "react";
import { Search, X, ArrowRight, Loader2, FileText } from "lucide-react";
import { getTopicConfig } from "@/lib/topics";
import TopicIcon from "@/components/TopicIcon";
import Link from "next/link";
import { trackEvent } from "@/lib/tracker";
import { Dialog } from "@/components/ui";

type Lang = "de" | "en";

interface SearchQuestion {
  id: number;
  topic: string;
  question: string;
  exam_dates?: string[];
  source_file?: string;
  image_url?: string;
  tags?: string[];
}

interface SearchModalProps {
  open: boolean;
  onClose: () => void;
  lang: Lang;
  examSource: string;
  userId?: string;
}

export default function SearchModal({ open, onClose, lang, examSource, userId }: SearchModalProps) {
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<SearchQuestion[]>([]);
  const [loading, setLoading] = useState(false);
  const [totalCount, setTotalCount] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Focus input when modal opens + reset state
  useEffect(() => {
    if (open) {
      setTimeout(() => inputRef.current?.focus(), 100);
      setQuery("");
      setResults([]);
      setTotalCount(0);
    }
  }, [open]);

  const doSearch = useCallback(
    async (q: string) => {
      if (!q.trim()) {
        setResults([]);
        setTotalCount(0);
        return;
      }
      setLoading(true);
      try {
        // Get count first
        const countParams = new URLSearchParams({ search: q, examSource, countOnly: "1" });
        const countRes = await fetch(`/api/questions?${countParams}`);
        const countData = await countRes.json();
        setTotalCount(countData.count || 0);

        // Get results (up to 50)
        trackEvent("search", { query: q, examSource });
        const params = new URLSearchParams({ search: q, examSource, limit: "50" });
        const res = await fetch(`/api/questions?${params}`);
        const data = await res.json();
        setResults(Array.isArray(data) ? data : []);
      } catch {
        setResults([]);
      } finally {
        setLoading(false);
      }
    },
    [examSource]
  );

  const handleChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const v = e.target.value;
    setQuery(v);
    if (timerRef.current) clearTimeout(timerRef.current);
    timerRef.current = setTimeout(() => doSearch(v.trim()), 300);
  };

  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        if (!next) onClose();
      }}
      title={lang === "de" ? "Fragen suchen" : "Search questions"}
      maxWidth="680px"
      hideCloseButton
    >
      <div className="flex flex-col max-h-[70vh] -mx-5 -mb-5">
        {/* Search input */}
        <div className="flex items-center gap-3 px-5 py-4 border-b border-[var(--mp-border)]">
          <Search className="w-5 h-5 text-[var(--mp-fg-subtle)] flex-shrink-0" aria-hidden />
          <input
            ref={inputRef}
            type="text"
            value={query}
            onChange={handleChange}
            placeholder={lang === "de" ? "Frage suchen..." : "Search questions..."}
            className="flex-1 text-base text-[var(--mp-fg)] placeholder-[var(--mp-fg-subtle)] bg-transparent border-none outline-none"
          />
          {query && (
            <button
              onClick={() => {
                setQuery("");
                setResults([]);
                setTotalCount(0);
                inputRef.current?.focus();
              }}
              className="text-[var(--mp-fg-subtle)] hover:text-[var(--mp-fg-muted)]"
              aria-label={lang === "de" ? "Suchfeld leeren" : "Clear search"}
            >
              <X className="w-4 h-4" />
            </button>
          )}
          <kbd className="hidden sm:inline-flex items-center text-[10px] text-[var(--mp-fg-subtle)] bg-[var(--mp-surface-sunken)] border border-[var(--mp-border)] rounded px-1.5 py-0.5 font-mono">
            ESC
          </kbd>
        </div>

        {/* Results */}
        <div className="flex-1 overflow-y-auto">
          {loading && (
            <div className="flex items-center justify-center py-8">
              <Loader2 className="w-5 h-5 text-[var(--mp-viridian)] animate-spin" aria-hidden />
            </div>
          )}

          {!loading && query && results.length === 0 && (
            <div className="py-8 text-center">
              <FileText className="w-8 h-8 text-[var(--mp-border)] mx-auto mb-2" aria-hidden />
              <p className="text-sm text-[var(--mp-fg-subtle)]">
                {lang === "de" ? "Keine Ergebnisse gefunden" : "No results found"}
              </p>
            </div>
          )}

          {!loading && results.length > 0 && (
            <>
              {/* Count header */}
              <div className="px-5 py-2 border-b border-[var(--mp-border)] bg-[var(--mp-surface-sunken)]">
                <p className="text-xs text-[var(--mp-fg-subtle)] font-medium">
                  {totalCount > 0 ? totalCount : results.length}{" "}
                  {lang === "de" ? "Ergebnisse" : "results"}
                  {totalCount > results.length && (
                    <span>
                      {" "}
                      (
                      {lang === "de"
                        ? `zeige ${results.length}`
                        : `showing ${results.length}`}
                      )
                    </span>
                  )}
                </p>
              </div>

              {/* Results list */}
              <ul>
                {results.map((q) => {
                  const cfg = getTopicConfig(q.topic);
                  const href = userId
                    ? `/quiz?topic=${encodeURIComponent(q.topic)}&questionId=${q.id}&userId=${userId}&examSource=${examSource}`
                    : `/quiz?topic=${encodeURIComponent(q.topic)}&questionId=${q.id}&examSource=${examSource}`;
                  return (
                    <li
                      key={q.id}
                      className="border-b border-[var(--mp-border)]/50 last:border-b-0"
                    >
                      <Link
                        href={href}
                        onClick={onClose}
                        className="flex items-start gap-3 px-5 py-3.5 hover:bg-[var(--mp-surface-sunken)] transition-colors group"
                      >
                        {/* Topic icon */}
                        <span
                          className="mt-0.5 flex-shrink-0 w-8 h-8 rounded-lg flex items-center justify-center"
                          style={{ backgroundColor: `${cfg.color}15`, color: cfg.color }}
                        >
                          <TopicIcon name={cfg.icon} className="w-4 h-4" />
                        </span>

                        {/* Question content */}
                        <div className="flex-1 min-w-0">
                          <p className="text-sm text-[var(--mp-fg)] leading-relaxed mb-1.5">
                            {q.question}
                          </p>
                          <div className="flex items-center gap-2 flex-wrap">
                            <span
                              className="text-[10px] font-medium px-2 py-0.5 rounded-full"
                              style={{ backgroundColor: `${cfg.color}12`, color: cfg.color }}
                            >
                              {q.topic}
                            </span>
                            {q.exam_dates && q.exam_dates.length > 0 && (
                              <span className="text-[10px] text-[var(--mp-fg-subtle)] font-mono bg-[var(--mp-surface-sunken)] px-1.5 py-0.5 rounded">
                                {q.exam_dates[0]}
                              </span>
                            )}
                            {q.tags &&
                              q.tags.slice(0, 2).map((tag) => (
                                <span
                                  key={tag}
                                  className="text-[10px] text-[var(--mp-viridian)] bg-[var(--mp-viridian)]/10 px-1.5 py-0.5 rounded-full"
                                >
                                  {tag}
                                </span>
                              ))}
                            {q.image_url && (
                              <span className="text-[10px] text-[var(--mp-info)] bg-[var(--mp-info)]/10 px-1.5 py-0.5 rounded-full">
                                {lang === "de" ? "Bild" : "Image"}
                              </span>
                            )}
                          </div>
                        </div>

                        <ArrowRight
                          className="w-4 h-4 text-[var(--mp-border)] group-hover:text-[var(--mp-viridian)] transition-colors flex-shrink-0 mt-1"
                          aria-hidden
                        />
                      </Link>
                    </li>
                  );
                })}
              </ul>
            </>
          )}

          {/* Empty state */}
          {!loading && !query && (
            <div className="py-8 text-center">
              <Search className="w-8 h-8 text-[var(--mp-border)] mx-auto mb-2" aria-hidden />
              <p className="text-sm text-[var(--mp-fg-subtle)]">
                {lang === "de" ? "Tippe, um nach Fragen zu suchen" : "Type to search questions"}
              </p>
              <p className="text-xs text-[var(--mp-fg-subtle)]/60 mt-1">
                {lang === "de"
                  ? "Suche nach Krankheit, Symptom oder Stichwort"
                  : "Search by disease, symptom, or keyword"}
              </p>
            </div>
          )}
        </div>
      </div>
    </Dialog>
  );
}
