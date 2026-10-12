"use client";

/**
 * NoteExplore — the real browse/sort/filter/search surface for the Library's
 * "Explore" tab (EXP-1 §3). Replaces the flat, mislabeled, un-openable list.
 *
 * Browse:   grid of public notes, load-more pagination (was capped at 60).
 * Search:   full-text via the explore route's `q` (search_tsv), debounced.
 * Filter:   kind (guide / card / community), exam_type, topic, tag — populated
 *           from /api/notes/explore/facets (real values, not guesses).
 * Sort:     recency | title (popularity intentionally omitted — no signal).
 * Open:     any card opens the shared <NoteReader> in place (no import wall).
 * Label:    curated → "MedPrüf Team" (verified); community → "Community".
 *           NEVER "unverified".
 *
 * Strings inlined de/en to match the Library page convention. No em dashes.
 */

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { authFetch as fetch } from "@/lib/authFetch";
import { BrandedLoader, EmptyState } from "@/components/ui";
import { getExamSource } from "@/lib/topics";
import NoteReader, { SourceBadge, type ReaderNote } from "@/components/NoteReader";
import type { NoteReview } from "@/lib/notes-review";
import type { NoteContent } from "@/lib/notes";
import {
  Compass,
  Search,
  SlidersHorizontal,
  X,
  Loader2,
  Layers,
  BookOpen,
} from "lucide-react";

type Lang = "de" | "en";
type Kind = "guide" | "card" | "community";
type Sort = "recent" | "title";

interface PublicNote {
  id: string;
  title: string;
  content: NoteContent;
  tags: string[];
  exam_type: string | null;
  topic: string | null;
  source_type: string | null;
  published_at: string | null;
  curated: boolean;
  guide: boolean;
  kind: Kind;
  review?: NoteReview | null;
}

interface Facets {
  exam_types: { value: string; count: number }[];
  topics: { value: string; count: number }[];
  tags: { tag: string; count: number }[];
  kinds: { kind: Kind; count: number }[];
  total: number;
}

const PAGE = 30;

const KIND_LABELS: Record<Kind, { de: string; en: string }> = {
  guide: { de: "Leitfäden", en: "Guides" },
  card: { de: "Merke-Karten", en: "Merke cards" },
  community: { de: "Community", en: "Community" },
};

function examLabel(id: string | null): string {
  if (!id) return "";
  const src = getExamSource(id);
  // EXAM_SOURCES.label is a single display label (not de/en-split), used as-is.
  return src ? src.label : id;
}

/* ─── A single Explore note card (open-in-place, correct label) ─────── */
function ExploreCard({
  note,
  lang,
  onOpen,
}: {
  note: PublicNote;
  lang: Lang;
  onOpen: () => void;
}) {
  const de = lang === "de";
  const firstBlock = note.content?.blocks?.[0];
  const preview = firstBlock
    ? firstBlock.type === "concept"
      ? firstBlock.back || firstBlock.front
      : firstBlock.text
    : "";
  const blockCount = note.content?.blocks?.length ?? 0;
  const visibleTags = (note.tags ?? []).filter((t) => t !== "kuratiert" && t !== "guide");

  return (
    <button
      type="button"
      onClick={onOpen}
      className="group text-left rounded-[var(--mp-r-card)] bg-[var(--mp-surface)] border border-[var(--mp-border-soft)] hover:border-[var(--mp-border)] shadow-[var(--mp-shadow-card)] hover:shadow-[var(--mp-shadow-elev)] transition-all p-4 flex flex-col gap-2 min-h-[168px] focus-ring"
    >
      <div className="flex items-center justify-between gap-2">
        <SourceBadge curated={note.curated} kind={note.kind} lang={lang} review={note.review} />
        {note.exam_type && (
          <span className="text-[10px] font-mono text-[var(--mp-fg-subtle)] truncate max-w-[45%]">
            {examLabel(note.exam_type)}
          </span>
        )}
      </div>

      <p dir="auto" className="font-display font-bold text-[var(--mp-fg)] leading-snug line-clamp-2">
        {note.title || (de ? "Ohne Titel" : "Untitled")}
      </p>
      {preview && (
        <p dir="auto" className="text-[13px] text-[var(--mp-fg-muted)] leading-relaxed line-clamp-2 flex-1">
          {preview}
        </p>
      )}

      <div className="flex items-center justify-between gap-2 mt-auto pt-1">
        <div className="flex items-center gap-1.5 flex-wrap min-w-0">
          {visibleTags.slice(0, 2).map((tag) => (
            <span
              key={tag}
              className="text-[10px] text-[var(--mp-fg-subtle)] bg-[var(--mp-surface-sunken)] px-1.5 py-0.5 rounded truncate max-w-[92px]"
            >
              #{tag}
            </span>
          ))}
        </div>
        <span className="inline-flex items-center gap-1 text-[11px] font-semibold text-[var(--mp-viridian)] flex-shrink-0">
          <Layers className="w-3.5 h-3.5" />
          {blockCount}
        </span>
      </div>
    </button>
  );
}

export default function NoteExplore({ lang }: { lang: Lang }) {
  const de = lang === "de";
  const [search, setSearch] = useState("");
  const [debounced, setDebounced] = useState("");
  const [kind, setKind] = useState<Kind | "">("");
  const [examType, setExamType] = useState("");
  const [topic, setTopic] = useState("");
  const [tag, setTag] = useState("");
  const [sort, setSort] = useState<Sort>("recent");
  const [showFilters, setShowFilters] = useState(false);

  const [notes, setNotes] = useState<PublicNote[]>([]);
  const [count, setCount] = useState(0);
  const [loading, setLoading] = useState(true);
  const [loadingMore, setLoadingMore] = useState(false);
  const [facets, setFacets] = useState<Facets | null>(null);

  const [readerNote, setReaderNote] = useState<ReaderNote | null>(null);
  const [readerOpen, setReaderOpen] = useState(false);

  // Debounce the search box.
  useEffect(() => {
    const h = setTimeout(() => setDebounced(search.trim()), 300);
    return () => clearTimeout(h);
  }, [search]);

  // Load facets once.
  useEffect(() => {
    fetch("/api/notes/explore/facets")
      .then((r) => (r.ok ? r.json() : null))
      .then((d) => {
        if (d?.enabled) setFacets(d);
      })
      .catch(() => {});
  }, []);

  const buildParams = useCallback(
    (nextOffset: number) => {
      const p = new URLSearchParams({ limit: String(PAGE), offset: String(nextOffset) });
      if (debounced) p.set("q", debounced);
      if (kind) p.set("kind", kind);
      if (examType) p.set("exam_type", examType);
      if (topic) p.set("topic", topic);
      if (tag) p.set("tag", tag);
      if (sort) p.set("sort", sort);
      return p;
    },
    [debounced, kind, examType, topic, tag, sort],
  );

  // Reset + fetch first page whenever a filter/search/sort changes.
  const reqIdRef = useRef(0);
  useEffect(() => {
    const reqId = ++reqIdRef.current;
    setLoading(true);
    fetch(`/api/notes/explore?${buildParams(0)}`)
      .then((r) => (r.ok ? r.json() : null))
      .then((d) => {
        if (reqId !== reqIdRef.current) return; // stale
        setNotes(Array.isArray(d?.notes) ? d.notes : []);
        setCount(typeof d?.count === "number" ? d.count : 0);
      })
      .catch(() => {
        if (reqId === reqIdRef.current) {
          setNotes([]);
          setCount(0);
        }
      })
      .finally(() => {
        if (reqId === reqIdRef.current) setLoading(false);
      });
  }, [buildParams]);

  const loadMore = async () => {
    if (loadingMore || notes.length >= count) return;
    // Guard against a stale append: if a filter/search/sort change bumps reqId
    // while this page is in flight, drop the result so page-2 of the OLD query
    // never appends onto the NEW list.
    const reqId = reqIdRef.current;
    setLoadingMore(true);
    const nextOffset = notes.length;
    try {
      const res = await fetch(`/api/notes/explore?${buildParams(nextOffset)}`);
      const d = res.ok ? await res.json() : null;
      if (reqId === reqIdRef.current && Array.isArray(d?.notes)) {
        setNotes((prev) => [...prev, ...d.notes]);
      }
    } catch {
      /* ignore */
    } finally {
      if (reqId === reqIdRef.current) setLoadingMore(false);
    }
  };

  const openReader = (n: PublicNote) => {
    setReaderNote({
      id: n.id,
      title: n.title,
      content: n.content,
      tags: n.tags,
      exam_type: n.exam_type,
      topic: n.topic,
      curated: n.curated,
      kind: n.kind,
      review: n.review ?? null,
      is_owner: false,
    });
    setReaderOpen(true);
  };

  const activeFilters = [kind, examType, topic, tag].filter(Boolean).length;
  const clearFilters = () => {
    setKind("");
    setExamType("");
    setTopic("");
    setTag("");
  };

  const kindChips = useMemo(() => {
    const present = facets?.kinds ?? [];
    // Only show a kind chip if that kind actually has notes.
    return (["guide", "card", "community"] as Kind[]).filter((k) =>
      present.some((p) => p.kind === k && p.count > 0),
    );
  }, [facets]);

  return (
    <div>
      {/* Search + sort + filter toggle */}
      <div className="flex flex-col gap-3 mb-3">
        <div className="relative">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-[var(--mp-fg-subtle)]" />
          <input
            type="search"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder={de ? "Explore durchsuchen…" : "Search Explore…"}
            className="w-full pl-9 pr-3 py-2.5 rounded-[var(--mp-r-card)] bg-[var(--mp-surface)] border border-[var(--mp-border-soft)] text-[var(--mp-fg)] text-sm focus:outline-none focus:border-[var(--mp-viridian)]"
          />
        </div>

        <div className="flex items-center gap-2 overflow-x-auto -mx-1 px-1 pb-0.5">
          {/* Kind chips (primary facet) */}
          {kindChips.map((k) => (
            <button
              key={k}
              type="button"
              onClick={() => setKind((cur) => (cur === k ? "" : k))}
              className={`text-xs font-semibold px-3 py-1.5 rounded-full whitespace-nowrap transition-colors flex-shrink-0 ${
                kind === k
                  ? "bg-[var(--mp-viridian)] text-white"
                  : "bg-[var(--mp-surface)] border border-[var(--mp-border-soft)] text-[var(--mp-fg-muted)] hover:text-[var(--mp-fg)]"
              }`}
            >
              {de ? KIND_LABELS[k].de : KIND_LABELS[k].en}
            </button>
          ))}

          <button
            type="button"
            onClick={() => setShowFilters((s) => !s)}
            className={`inline-flex items-center gap-1 text-xs font-semibold px-3 py-1.5 rounded-full whitespace-nowrap transition-colors flex-shrink-0 ${
              activeFilters > 0 || showFilters
                ? "bg-[var(--mp-cta-blue)]/12 text-[var(--mp-cta-blue)] border border-[var(--mp-cta-blue)]/30"
                : "bg-[var(--mp-surface)] border border-[var(--mp-border-soft)] text-[var(--mp-fg-muted)]"
            }`}
          >
            <SlidersHorizontal className="w-3.5 h-3.5" />
            {de ? "Filter" : "Filter"}
            {activeFilters > 0 && (
              <span className="ml-0.5 inline-flex items-center justify-center min-w-[16px] h-4 px-1 rounded-full bg-[var(--mp-cta-blue)] text-white text-[10px] font-bold">
                {activeFilters}
              </span>
            )}
          </button>

          <div className="flex-1" />
          <select
            value={sort}
            onChange={(e) => setSort(e.target.value as Sort)}
            className="text-xs font-semibold px-2.5 py-1.5 rounded-full bg-[var(--mp-surface)] border border-[var(--mp-border-soft)] text-[var(--mp-fg-muted)] flex-shrink-0 focus:outline-none"
            aria-label={de ? "Sortieren" : "Sort"}
          >
            <option value="recent">{de ? "Neueste" : "Recent"}</option>
            <option value="title">{de ? "A–Z" : "A–Z"}</option>
          </select>
        </div>

        {/* Expandable filter panel (exam / topic / tag) */}
        {showFilters && facets && (
          <div className="rounded-[var(--mp-r-card)] border border-[var(--mp-border-soft)] bg-[var(--mp-surface-sunken)] p-3 space-y-3 animate-fade-in">
            {facets.exam_types.length > 0 && (
              <div>
                <p className="text-[11px] font-semibold text-[var(--mp-fg-muted)] mb-1.5">
                  {de ? "Prüfung" : "Exam"}
                </p>
                <div className="flex flex-wrap gap-1.5">
                  {facets.exam_types.map((e) => (
                    <button
                      key={e.value}
                      type="button"
                      onClick={() => setExamType((cur) => (cur === e.value ? "" : e.value))}
                      className={`text-xs px-2.5 py-1 rounded-full transition-colors ${
                        examType === e.value
                          ? "bg-[var(--mp-cta-blue)] text-white"
                          : "bg-[var(--mp-surface)] border border-[var(--mp-border-soft)] text-[var(--mp-fg-muted)]"
                      }`}
                    >
                      {examLabel(e.value)}{" "}
                      <span className="opacity-60">{e.count}</span>
                    </button>
                  ))}
                </div>
              </div>
            )}

            {facets.topics.length > 0 && (
              <div>
                <p className="text-[11px] font-semibold text-[var(--mp-fg-muted)] mb-1.5">
                  {de ? "Fachgebiet" : "Topic"}
                </p>
                <div className="flex flex-wrap gap-1.5 max-h-24 overflow-y-auto">
                  {facets.topics.slice(0, 24).map((tp) => (
                    <button
                      key={tp.value}
                      type="button"
                      onClick={() => setTopic((cur) => (cur === tp.value ? "" : tp.value))}
                      className={`text-xs px-2.5 py-1 rounded-full transition-colors ${
                        topic === tp.value
                          ? "bg-[var(--mp-viridian)] text-white"
                          : "bg-[var(--mp-surface)] border border-[var(--mp-border-soft)] text-[var(--mp-fg-muted)]"
                      }`}
                    >
                      {tp.value} <span className="opacity-60">{tp.count}</span>
                    </button>
                  ))}
                </div>
              </div>
            )}

            {facets.tags.length > 0 && (
              <div>
                <p className="text-[11px] font-semibold text-[var(--mp-fg-muted)] mb-1.5">
                  {de ? "Tag" : "Tag"}
                </p>
                <div className="flex flex-wrap gap-1.5 max-h-24 overflow-y-auto">
                  {facets.tags.slice(0, 24).map((tg) => (
                    <button
                      key={tg.tag}
                      type="button"
                      onClick={() => setTag((cur) => (cur === tg.tag ? "" : tg.tag))}
                      className={`text-xs px-2.5 py-1 rounded-full transition-colors ${
                        tag === tg.tag
                          ? "bg-[var(--mp-accent-teal)] text-white"
                          : "bg-[var(--mp-surface)] border border-[var(--mp-border-soft)] text-[var(--mp-fg-muted)]"
                      }`}
                    >
                      #{tg.tag} <span className="opacity-60">{tg.count}</span>
                    </button>
                  ))}
                </div>
              </div>
            )}

            {activeFilters > 0 && (
              <button
                type="button"
                onClick={clearFilters}
                className="inline-flex items-center gap-1 text-xs font-semibold text-[var(--mp-fg-subtle)] hover:text-[var(--mp-error)]"
              >
                <X className="w-3.5 h-3.5" />
                {de ? "Filter zurücksetzen" : "Clear filters"}
              </button>
            )}
          </div>
        )}
      </div>

      {/* Results */}
      {loading ? (
        <div className="flex items-center justify-center py-20">
          <BrandedLoader />
        </div>
      ) : notes.length === 0 ? (
        <div className="max-w-md mx-auto py-10">
          <EmptyState
            icon={<Compass className="w-10 h-10" aria-hidden />}
            title={
              debounced || activeFilters > 0
                ? de ? "Nichts gefunden" : "Nothing found"
                : de ? "Explore ist noch leer" : "Explore is empty"
            }
            body={
              debounced || activeFilters > 0
                ? de ? "Passe Suche oder Filter an." : "Try a different search or filter."
                : de
                  ? "Bald findest du hier geprüfte Lernkarten des MedPrüf-Teams und der Community."
                  : "Soon you'll find verified MedPrüf Team cards and community notes here."
            }
            action={
              debounced || activeFilters > 0 ? (
                <button
                  type="button"
                  onClick={() => {
                    setSearch("");
                    clearFilters();
                  }}
                  className="mp-btn mp-btn--secondary mt-2"
                >
                  {de ? "Zurücksetzen" : "Reset"}
                </button>
              ) : undefined
            }
          />
        </div>
      ) : (
        <>
          <div className="flex items-center justify-between mb-3">
            <span className="text-[13px] text-[var(--mp-fg-subtle)] font-mono">
              {count} {de ? (count === 1 ? "Notiz" : "Notizen") : count === 1 ? "note" : "notes"}
            </span>
          </div>
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
            {notes.map((n) => (
              <ExploreCard key={n.id} note={n} lang={lang} onOpen={() => openReader(n)} />
            ))}
          </div>

          {notes.length < count && (
            <div className="flex justify-center mt-5">
              <button
                type="button"
                onClick={loadMore}
                disabled={loadingMore}
                className="mp-btn mp-btn--secondary inline-flex items-center gap-2 disabled:opacity-60"
              >
                {loadingMore ? (
                  <Loader2 className="w-4 h-4 animate-spin" />
                ) : (
                  <BookOpen className="w-4 h-4" />
                )}
                {de ? "Mehr laden" : "Load more"}
                <span className="text-xs opacity-60">
                  ({notes.length}/{count})
                </span>
              </button>
            </div>
          )}
        </>
      )}

      <NoteReader
        note={readerNote}
        lang={lang}
        open={readerOpen}
        onOpenChange={setReaderOpen}
      />
    </div>
  );
}
