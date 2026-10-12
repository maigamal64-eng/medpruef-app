"use client";
import { t, type Lang, renderLang } from "@/lib/i18n";
import { buildQuizHref } from "@/lib/quiz-links";

/**
 * SearchModal — MPDS command-palette-style quick search (Cmd+K / Ctrl+K).
 *
 * Grouped results:
 *   1. Fragen / Questions — live API match (top 10)
 *   2. Fachgebiete / Topics — specialty names (static list filtered by query)
 *   3. Seiten / Pages — navigation shortcuts
 *
 * Keyboard a11y:
 *   - ↑/↓ walks the flat item index
 *   - Enter activates the highlighted item
 *   - Esc closes (handled by <Dialog>)
 *   - Focus trap + aria-modal inherited from <Dialog>
 *
 * Fetch strategy:
 *   - 250ms debounce per keystroke
 *   - AbortController cancels in-flight requests on each new keystroke
 *   - Results capped at 10 questions
 */
import { useState, useEffect, useRef, useCallback, useMemo } from "react";
import {
  Search,
  ArrowRight,
  FileQuestion,
  Layers,
  Compass,
  CornerDownLeft,
} from "lucide-react";
import { useRouter } from "next/navigation";
import { TOPIC_CONFIG, getTopicConfig } from "@/lib/topics";
import TopicIcon from "@/components/TopicIcon";
import { authFetch as fetch } from "@/lib/authFetch";
import { trackEvent } from "@/lib/tracker";
import { Dialog, EmptyState } from "@/components/ui";



interface SearchQuestion {
  id: number;
  topic: string;
  question: string;
  source_file?: string;
  image_url?: string;
}

interface SearchModalProps {
  open: boolean;
  onClose: () => void;
  lang: Lang;
  examSource: string;
  userId?: string;
}

type FlatItem =
  | { kind: "question"; data: SearchQuestion }
  | { kind: "topic"; topic: string }
  | { kind: "page"; href: string; label: { de: string; en: string } };

const PAGES: Array<{ href: string; label: { de: string; en: string } }> = [
  { href: "/", label: { de: "Startseite", en: "Home" } },
  { href: "/quiz", label: { de: "Quiz", en: "Quiz" } },
  { href: "/exam", label: { de: "Prüfungssimulation", en: "Exam Simulation" } },
  { href: "/flashcards", label: { de: "Karteikarten", en: "Flashcards" } },
  { href: "/curriculum", label: { de: "Curriculum", en: "Curriculum" } },
  { href: "/study-plan", label: { de: "Lernplan", en: "Study Plan" } },
  { href: "/progress", label: { de: "Fortschritt", en: "Progress" } },
  { href: "/stats", label: { de: "Statistiken", en: "Stats" } },
  { href: "/materials", label: { de: "Materialien", en: "Materials" } },
  { href: "/pruefungskalender", label: { de: "Prüfungskalender", en: "Exam calendar" } },
  { href: "/exam-formats", label: { de: "Prüfungsformate und Regeln", en: "Exam formats and rules" } },
  { href: "/exam-formats/haeufige-fragen", label: { de: "Ergebnisse, Prüfungsraum und Wiederholungen", en: "Results, exam room and repeats" } },
  { href: "/wien-route", label: { de: "Prüfungsweg Wien", en: "Vienna exam pathway" } },
  { href: "/korrekturen", label: { de: "Korrekturen im Fragenpool", en: "Question-bank corrections" } },
  { href: "/umfang", label: { de: "Umfang und Grenzen", en: "Scope and limits" } },
  { href: "/faq", label: { de: "Häufige Fragen", en: "FAQ" } },
  { href: "/changelog", label: { de: "Neuigkeiten", en: "What's New" } },
  { href: "/settings", label: { de: "Einstellungen", en: "Settings" } },
  { href: "/pricing", label: { de: "Preise", en: "Pricing" } },
];

function truncate(text: string, max: number): string {
  return text.length > max ? text.slice(0, max).trimEnd() + "…" : text;
}

export default function SearchModal({
  open,
  onClose,
  lang,
  examSource,
}: SearchModalProps) {
  const [query, setQuery] = useState("");
  const [questions, setQuestions] = useState<SearchQuestion[]>([]);
  const [loading, setLoading] = useState(false);
  const [highlight, setHighlight] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const abortRef = useRef<AbortController | null>(null);
  const listRef = useRef<HTMLDivElement>(null);
  const router = useRouter();

  // All topic names for filtering. Topics across all exams — small set.
  const allTopics = useMemo(() => Object.keys(TOPIC_CONFIG), []);

  // Reset on open
  useEffect(() => {
    if (open) {
      setQuery("");
      setQuestions([]);
      setHighlight(0);
      setTimeout(() => inputRef.current?.focus(), 60);
    }
    return () => {
      if (debounceRef.current) clearTimeout(debounceRef.current);
      abortRef.current?.abort();
    };
  }, [open]);

  const fetchQuestions = useCallback(
    async (q: string) => {
      abortRef.current?.abort();
      if (!q.trim()) {
        setQuestions([]);
        setLoading(false);
        return;
      }
      const ctrl = new AbortController();
      abortRef.current = ctrl;
      setLoading(true);
      try {
        const params = new URLSearchParams({
          search: q,
          examSource,
          limit: "10",
        });
        const res = await fetch(`/api/questions?${params.toString()}`, {
          signal: ctrl.signal,
        });
        if (!res.ok) {
          setQuestions([]);
          return;
        }
        const data = await res.json();
        if (Array.isArray(data)) {
          setQuestions(data);
          trackEvent("search", { query: q, examSource, count: data.length });
        } else {
          setQuestions([]);
        }
      } catch (err) {
        if ((err as Error).name !== "AbortError") {
          setQuestions([]);
        }
      } finally {
        if (!ctrl.signal.aborted) setLoading(false);
      }
    },
    [examSource]
  );

  const handleChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const v = e.target.value;
    setQuery(v);
    setHighlight(0);
    if (debounceRef.current) clearTimeout(debounceRef.current);
    debounceRef.current = setTimeout(() => fetchQuestions(v.trim()), 250);
  };

  const topicMatches = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return [];
    return allTopics.filter((t) => t.toLowerCase().includes(q)).slice(0, 5);
  }, [query, allTopics]);

  const pageMatches = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return PAGES;
    return PAGES.filter(
      (p) =>
        p.label.de.toLowerCase().includes(q) ||
        p.label.en.toLowerCase().includes(q) ||
        p.href.toLowerCase().includes(q)
    );
  }, [query]);

  const flatItems = useMemo<FlatItem[]>(() => {
    const items: FlatItem[] = [];
    questions.forEach((q) => items.push({ kind: "question", data: q }));
    topicMatches.forEach((t) => items.push({ kind: "topic", topic: t }));
    pageMatches.forEach((p) =>
      items.push({ kind: "page", href: p.href, label: p.label })
    );
    return items;
  }, [questions, topicMatches, pageMatches]);

  useEffect(() => {
    if (highlight >= flatItems.length)
      setHighlight(Math.max(0, flatItems.length - 1));
  }, [flatItems.length, highlight]);

  const activate = useCallback(
    (item: FlatItem) => {
      let href = "";
      if (item.kind === "question") {
        const q = item.data;
        href = buildQuizHref({ topic: q.topic, questionId: q.id, examSource });
      } else if (item.kind === "topic") {
        href = buildQuizHref({ topic: item.topic, examSource, practiceMode: 'unseen' });
      } else {
        href = item.href;
      }
      onClose();
      router.push(href);
    },
    [router, onClose, examSource]
  );

  const handleKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === "ArrowDown") {
      e.preventDefault();
      setHighlight((i) => Math.min(flatItems.length - 1, i + 1));
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      setHighlight((i) => Math.max(0, i - 1));
    } else if (e.key === "Enter") {
      e.preventDefault();
      const item = flatItems[highlight];
      if (item) activate(item);
    }
  };

  useEffect(() => {
    if (!listRef.current) return;
    const el = listRef.current.querySelector<HTMLElement>(
      `[data-item-index="${highlight}"]`
    );
    if (el) el.scrollIntoView({ block: "nearest" });
  }, [highlight]);

  // Group-boundary bookkeeping (flat index → group slot)
  let cursor = 0;
  const qStart = cursor;
  cursor += questions.length;
  const topicStart = cursor;
  cursor += topicMatches.length;
  const pageStart = cursor;

  const showQuestionsGroup = questions.length > 0;
  const showTopicsGroup = topicMatches.length > 0;
  const showPagesGroup = pageMatches.length > 0;

  const hasQuery = query.trim().length > 0;
  const hasAnyResult = flatItems.length > 0;

  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        if (!next) onClose();
      }}
      title={t("home_quick_search", lang)}
      maxWidth="640px"
      hideCloseButton
    >
      <div
        className="-mx-5 -mb-5 flex min-h-0 flex-col overflow-hidden"
        style={{ maxHeight: "min(calc(85vh - 64px), 640px)" }}
      >
        {/* Input row */}
        <div className="flex items-center gap-3 px-4 sm:px-5 py-3.5 border-b border-[var(--mp-border)]">
          <Search
            className="w-5 h-5 text-[var(--mp-fg-subtle)] flex-shrink-0"
            aria-hidden
          />
          <input
            ref={inputRef}
            type="search"
            inputMode="search"
            enterKeyHint="search"
            autoCapitalize="off"
            value={query}
            onChange={handleChange}
            onKeyDown={handleKeyDown}
            placeholder={
              t("home_search_questions_topics_or_pages", lang)
            }
            autoComplete="off"
            autoCorrect="off"
            spellCheck={false}
            aria-label={
              t("home_search_questions_topics_or_pages_43", lang)
            }
            className="flex-1 text-base text-[var(--mp-fg)] placeholder-[var(--mp-fg-subtle)] bg-transparent border-none outline-none min-w-0"
          />
          {loading && (
            <span
              className="w-4 h-4 border-2 border-[var(--mp-viridian)] border-t-transparent rounded-full animate-spin flex-shrink-0"
              aria-label={t("home_searching", lang)}
            />
          )}
          <kbd className="hidden sm:inline-flex [@media(pointer:coarse)]:hidden items-center text-[10px] text-[var(--mp-fg-subtle)] bg-[var(--mp-surface-sunken)] border border-[var(--mp-border)] rounded px-1.5 py-0.5 font-mono">
            ESC
          </kbd>
          {/* UX-HOME-51: a visible way out on phones (the dialog's own close is hidden). */}
          <button type="button" onClick={onClose} className="sm:hidden min-h-11 px-2 text-sm font-semibold text-[var(--mp-cta-blue)] mp-focusable">
            {t("a12_cancel", lang)}
          </button>
        </div>
        <p className="sr-only" role="status" aria-live="polite">
          {query.trim().length >= 2 && !loading ? t("a22_search_count", lang).replace("{n}", String(questions.length + topicMatches.length + pageMatches.length)) : ""}
        </p>

        {/* Results body */}
        <div
          ref={listRef}
          className="min-h-0 flex-1 overflow-y-auto overscroll-contain"
          role="listbox"
          aria-label={t("home_search_results", lang)}
        >
          {/* Empty: no query */}
          {!hasQuery && (
            <div className="py-6 px-4">
              <EmptyState
                icon={<Search className="w-10 h-10" aria-hidden />}
                title={
                  t("home_start_typing_to_search", lang)
                }
                body={
                  t("home_find_questions_by_keyword_jump_to_a_specialty_or_navigate_quickly_to_a", lang)
                }
              />
              {showPagesGroup && (
                <div className="mt-2">
                  <GroupHeader
                    icon={<Compass className="w-3.5 h-3.5" aria-hidden />}
                    label={t("home_pages", lang)}
                  />
                  <ul className="mt-1">
                    {pageMatches.slice(0, 6).map((p, i) => {
                      const idx = pageStart + i;
                      return (
                        <PageRow
                          key={p.href}
                          href={p.href}
                          label={p.label[renderLang(lang)]}
                          isHighlighted={idx === highlight}
                          onHover={() => setHighlight(idx)}
                          onSelect={() =>
                            activate({ kind: "page", href: p.href, label: p.label })
                          }
                          index={idx}
                        />
                      );
                    })}
                  </ul>
                </div>
              )}
            </div>
          )}

          {/* No results */}
          {hasQuery && !loading && !hasAnyResult && (
            <div className="py-8 px-4">
              <EmptyState
                icon={<FileQuestion className="w-10 h-10" aria-hidden />}
                title={
                  t("home_no_results", lang).replace("{query}", query)
                }
                body={
                  t("home_try_another_keyword_or_pick_a_specialty", lang)
                }
              />
            </div>
          )}

          {/* Questions group */}
          {hasQuery && showQuestionsGroup && (
            <div>
              <GroupHeader
                icon={<FileQuestion className="w-3.5 h-3.5" aria-hidden />}
                label={t("home_questions", lang)}
                count={questions.length}
              />
              <ul>
                {questions.map((q, i) => {
                  const cfg = getTopicConfig(q.topic);
                  const idx = qStart + i;
                  const isHL = idx === highlight;
                  return (
                    <li
                      key={`q-${q.id}`}
                      data-item-index={idx}
                      role="option"
                      aria-selected={isHL}
                      className={`border-b border-[var(--mp-border)]/40 last:border-b-0 cursor-pointer transition-colors ${
                        isHL
                          ? "bg-[var(--mp-surface-sunken)]"
                          : "hover:bg-[var(--mp-surface-sunken)]/60"
                      }`}
                      onMouseEnter={() => setHighlight(idx)}
                      onClick={() => activate({ kind: "question", data: q })}
                    >
                      <div className="flex items-start gap-3 px-4 sm:px-5 py-3">
                        <span
                          className="mt-0.5 flex-shrink-0 w-8 h-8 rounded-lg flex items-center justify-center"
                          style={{
                            backgroundColor: `${cfg.color}15`,
                            color: cfg.color,
                          }}
                        >
                          <TopicIcon name={cfg.icon} className="w-4 h-4" />
                        </span>
                        <div className="flex-1 min-w-0">
                          <p className="text-sm text-[var(--mp-fg)] leading-snug">
                            {truncate(q.question, 110)}
                          </p>
                          <p className="mt-1">
                            <span
                              className="text-[10px] font-medium px-1.5 py-0.5 rounded"
                              style={{
                                backgroundColor: `${cfg.color}14`,
                                color: cfg.color,
                              }}
                            >
                              {q.topic}
                            </span>
                          </p>
                        </div>
                        <ArrowRight
                          className={`w-4 h-4 flex-shrink-0 mt-1 transition-colors ${
                            isHL
                              ? "text-[var(--mp-viridian)]"
                              : "text-[var(--mp-border)]"
                          }`}
                          aria-hidden
                        />
                      </div>
                    </li>
                  );
                })}
              </ul>
            </div>
          )}

          {/* Topics group */}
          {hasQuery && showTopicsGroup && (
            <div className="border-t border-[var(--mp-border)]/60">
              <GroupHeader
                icon={<Layers className="w-3.5 h-3.5" aria-hidden />}
                label={t("home_topics", lang)}
                count={topicMatches.length}
              />
              <ul>
                {topicMatches.map((topic, i) => {
                  const cfg = getTopicConfig(topic);
                  const idx = topicStart + i;
                  const isHL = idx === highlight;
                  return (
                    <li
                      key={`t-${topic}`}
                      data-item-index={idx}
                      role="option"
                      aria-selected={isHL}
                      className={`cursor-pointer transition-colors border-b border-[var(--mp-border)]/40 last:border-b-0 ${
                        isHL
                          ? "bg-[var(--mp-surface-sunken)]"
                          : "hover:bg-[var(--mp-surface-sunken)]/60"
                      }`}
                      onMouseEnter={() => setHighlight(idx)}
                      onClick={() => activate({ kind: "topic", topic })}
                    >
                      <div className="flex items-center gap-3 px-4 sm:px-5 py-2.5">
                        <span
                          className="flex-shrink-0 w-7 h-7 rounded-lg flex items-center justify-center"
                          style={{
                            backgroundColor: `${cfg.color}15`,
                            color: cfg.color,
                          }}
                        >
                          <TopicIcon name={cfg.icon} className="w-3.5 h-3.5" />
                        </span>
                        <span className="flex-1 text-sm text-[var(--mp-fg)] font-medium truncate">
                          {topic}
                        </span>
                        <span className="text-[10px] text-[var(--mp-fg-subtle)] uppercase tracking-wider font-semibold">
                          {t("home_practice", lang)}
                        </span>
                        <ArrowRight
                          className={`w-4 h-4 flex-shrink-0 transition-colors ${
                            isHL
                              ? "text-[var(--mp-viridian)]"
                              : "text-[var(--mp-border)]"
                          }`}
                          aria-hidden
                        />
                      </div>
                    </li>
                  );
                })}
              </ul>
            </div>
          )}

          {/* Pages group */}
          {hasQuery && showPagesGroup && (
            <div className="border-t border-[var(--mp-border)]/60">
              <GroupHeader
                icon={<Compass className="w-3.5 h-3.5" aria-hidden />}
                label={t("home_pages", lang)}
                count={pageMatches.length}
              />
              <ul>
                {pageMatches.map((p, i) => {
                  const idx = pageStart + i;
                  return (
                    <PageRow
                      key={p.href}
                      href={p.href}
                      label={p.label[renderLang(lang)]}
                      isHighlighted={idx === highlight}
                      onHover={() => setHighlight(idx)}
                      onSelect={() =>
                        activate({ kind: "page", href: p.href, label: p.label })
                      }
                      index={idx}
                    />
                  );
                })}
              </ul>
            </div>
          )}
        </div>

        {/* Footer hints */}
        <div className="flex items-center justify-between gap-3 px-4 sm:px-5 py-2.5 border-t border-[var(--mp-border)] bg-[var(--mp-surface-sunken)] [@media(pointer:coarse)]:hidden">
          <div className="flex items-center gap-3 text-[11px] text-[var(--mp-fg-subtle)] flex-wrap">
            <span className="flex items-center gap-1">
              <kbd className="inline-flex items-center justify-center min-w-[18px] h-[18px] px-1 bg-[var(--mp-surface-raised)] border border-[var(--mp-border)] rounded text-[10px] font-mono">
                <CornerDownLeft className="w-3 h-3" aria-hidden />
              </kbd>
              {t("home_select", lang)}
            </span>
            <span className="flex items-center gap-1">
              <kbd className="inline-flex items-center justify-center min-w-[18px] h-[18px] px-1 bg-[var(--mp-surface-raised)] border border-[var(--mp-border)] rounded text-[10px] font-mono">
                ↑
              </kbd>
              <kbd className="inline-flex items-center justify-center min-w-[18px] h-[18px] px-1 bg-[var(--mp-surface-raised)] border border-[var(--mp-border)] rounded text-[10px] font-mono">
                ↓
              </kbd>
              {t("home_navigate", lang)}
            </span>
            <span className="flex items-center gap-1">
              <kbd className="inline-flex items-center justify-center min-w-[22px] h-[18px] px-1 bg-[var(--mp-surface-raised)] border border-[var(--mp-border)] rounded text-[10px] font-mono">
                Esc
              </kbd>
              {t("home_close_55", lang)}
            </span>
          </div>
        </div>
      </div>
    </Dialog>
  );
}

function GroupHeader({
  icon,
  label,
  count,
}: {
  icon: React.ReactNode;
  label: string;
  count?: number;
}) {
  return (
    <div className="flex items-center gap-1.5 px-4 sm:px-5 pt-3 pb-1.5">
      <span className="text-[var(--mp-fg-subtle)]">{icon}</span>
      <span className="text-[10px] uppercase tracking-wider text-[var(--mp-fg-subtle)] font-semibold">
        {label}
      </span>
      {typeof count === "number" && (
        <span className="text-[10px] text-[var(--mp-fg-subtle)]/70 font-mono">
          · {count}
        </span>
      )}
    </div>
  );
}

function PageRow({
  href,
  label,
  isHighlighted,
  onHover,
  onSelect,
  index,
}: {
  href: string;
  label: string;
  isHighlighted: boolean;
  onHover: () => void;
  onSelect: () => void;
  index: number;
}) {
  return (
    <li
      data-item-index={index}
      role="option"
      aria-selected={isHighlighted}
      className={`cursor-pointer transition-colors border-b border-[var(--mp-border)]/40 last:border-b-0 ${
        isHighlighted
          ? "bg-[var(--mp-surface-sunken)]"
          : "hover:bg-[var(--mp-surface-sunken)]/60"
      }`}
      onMouseEnter={onHover}
      onClick={onSelect}
    >
      <div className="flex items-center gap-3 px-4 sm:px-5 py-2.5">
        <span className="flex-shrink-0 w-7 h-7 rounded-lg flex items-center justify-center bg-[var(--mp-surface-sunken)] text-[var(--mp-fg-muted)]">
          <Compass className="w-3.5 h-3.5" aria-hidden />
        </span>
        <span className="flex-1 text-sm text-[var(--mp-fg)] font-medium">
          {label}
        </span>
        <span className="text-[10px] text-[var(--mp-fg-subtle)] font-mono truncate max-w-[120px]">
          {href}
        </span>
        <ArrowRight
          className={`w-4 h-4 flex-shrink-0 transition-colors ${
            isHighlighted ? "text-[var(--mp-viridian)]" : "text-[var(--mp-border)]"
          }`}
          aria-hidden
        />
      </div>
    </li>
  );
}
