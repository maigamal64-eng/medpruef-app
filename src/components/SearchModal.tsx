"use client";

import { useState, useEffect, useRef, useCallback } from "react";
import { Search, X, ArrowRight, Loader2, FileText } from "lucide-react";
import { getTopicConfig } from "@/lib/topics";
import TopicIcon from "@/components/TopicIcon";
import Link from "next/link";
import { trackEvent } from "@/lib/tracker";

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

  // Focus input when modal opens
  useEffect(() => {
    if (open) {
      setTimeout(() => inputRef.current?.focus(), 100);
      // Reset state
      setQuery("");
      setResults([]);
      setTotalCount(0);
    }
  }, [open]);

  // Close on Escape
  useEffect(() => {
    if (!open) return;
    const handleKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", handleKey);
    return () => window.removeEventListener("keydown", handleKey);
  }, [open, onClose]);

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

  if (!open) return null;

  return (
    <div className="fixed inset-0 z-[100] flex items-start justify-center pt-[10vh]" onClick={onClose}>
      {/* Backdrop */}
      <div className="absolute inset-0 bg-black/40 backdrop-blur-sm" />

      {/* Modal */}
      <div
        className="relative w-full max-w-2xl mx-4 bg-white rounded-2xl shadow-[var(--shadow-modal)] overflow-hidden animate-scale-in max-h-[70vh] flex flex-col"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Search input */}
        <div className="flex items-center gap-3 px-5 py-4 border-b border-[#E4E9F0]">
          <Search className="w-5 h-5 text-[#A0AEC0] flex-shrink-0" />
          <input
            ref={inputRef}
            type="text"
            value={query}
            onChange={handleChange}
            placeholder={lang === "de" ? "Frage suchen..." : "Search questions..."}
            className="flex-1 text-base text-[#1A2B3C] placeholder-[#A0AEC0] bg-transparent border-none outline-none"
          />
          {query && (
            <button onClick={() => { setQuery(""); setResults([]); setTotalCount(0); inputRef.current?.focus(); }} className="text-[#A0AEC0] hover:text-[#4A5568]">
              <X className="w-4 h-4" />
            </button>
          )}
          <kbd className="hidden sm:inline-flex items-center text-[10px] text-[#A0AEC0] bg-[#F7F9FC] border border-[#E4E9F0] rounded px-1.5 py-0.5 font-mono">
            ESC
          </kbd>
        </div>

        {/* Results */}
        <div className="flex-1 overflow-y-auto">
          {loading && (
            <div className="flex items-center justify-center py-8">
              <Loader2 className="w-5 h-5 text-[#007B5F] animate-spin" />
            </div>
          )}

          {!loading && query && results.length === 0 && (
            <div className="py-8 text-center">
              <FileText className="w-8 h-8 text-[#E4E9F0] mx-auto mb-2" />
              <p className="text-sm text-[#A0AEC0]">
                {lang === "de" ? "Keine Ergebnisse gefunden" : "No results found"}
              </p>
            </div>
          )}

          {!loading && results.length > 0 && (
            <>
              {/* Count header */}
              <div className="px-5 py-2 border-b border-[#E4E9F0] bg-[#F7F9FC]">
                <p className="text-xs text-[#A0AEC0] font-medium">
                  {totalCount > 0 ? totalCount : results.length} {lang === "de" ? "Ergebnisse" : "results"}
                  {totalCount > results.length && (
                    <span> ({lang === "de" ? `zeige ${results.length}` : `showing ${results.length}`})</span>
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
                    <li key={q.id} className="border-b border-[#E4E9F0]/50 last:border-b-0">
                      <Link
                        href={href}
                        onClick={onClose}
                        className="flex items-start gap-3 px-5 py-3.5 hover:bg-[#F7F9FC] transition-colors group"
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
                          <p className="text-sm text-[#1A2B3C] leading-relaxed mb-1.5">
                            {q.question}
                          </p>
                          <div className="flex items-center gap-2 flex-wrap">
                            <span className="text-[10px] font-medium px-2 py-0.5 rounded-full" style={{ backgroundColor: `${cfg.color}12`, color: cfg.color }}>
                              {q.topic}
                            </span>
                            {q.exam_dates && q.exam_dates.length > 0 && (
                              <span className="text-[10px] text-[#A0AEC0] font-mono bg-[#F7F9FC] px-1.5 py-0.5 rounded">
                                {q.exam_dates[0]}
                              </span>
                            )}
                            {q.tags && q.tags.slice(0, 2).map((tag) => (
                              <span key={tag} className="text-[10px] text-[#007B5F] bg-[#007B5F]/8 px-1.5 py-0.5 rounded-full">
                                {tag}
                              </span>
                            ))}
                            {q.image_url && (
                              <span className="text-[10px] text-[#3A7CA5] bg-[#3A7CA5]/10 px-1.5 py-0.5 rounded-full">
                                {lang === "de" ? "Bild" : "Image"}
                              </span>
                            )}
                          </div>
                        </div>

                        <ArrowRight className="w-4 h-4 text-[#E4E9F0] group-hover:text-[#007B5F] transition-colors flex-shrink-0 mt-1" />
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
              <Search className="w-8 h-8 text-[#E4E9F0] mx-auto mb-2" />
              <p className="text-sm text-[#A0AEC0]">
                {lang === "de" ? "Tippe, um nach Fragen zu suchen" : "Type to search questions"}
              </p>
              <p className="text-xs text-[#A0AEC0]/60 mt-1">
                {lang === "de" ? "Suche nach Krankheit, Symptom oder Stichwort" : "Search by disease, symptom, or keyword"}
              </p>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
