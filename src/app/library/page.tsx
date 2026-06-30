"use client";

/**
 * Bibliothek / Library — the personal home for ALL revisable cards (Notes
 * feature Phase 4). Replaces the bottom-nav "Flashcards" slot.
 *
 * v1 (this surface):
 *   - one-time localStorage -> server import of legacy per-question notes,
 *   - the user's flash-notes as a searchable / sortable / filterable grid,
 *   - a focused study overlay (the shared <FlipCard>: recall prompt -> content),
 *   - an entry into question-flashcard review (the existing /flashcards ritual).
 *
 * The 3 "Turn into note" create flows + SM-2 note scheduling land next; this
 * surface stands the Library up and proves the read/study loop end to end.
 *
 * Strings are inlined (de/en) to match the flashcards page convention.
 */

import {
  useEffect,
  useState,
  useCallback,
  useMemo,
  useRef,
  Suspense,
} from "react";
import Link from "next/link";
import { BrandedLoader } from "@/components/Logo";
import { authFetch as fetch } from "@/lib/authFetch";
import { getLang, setLang } from "@/lib/i18n";
import { getStoredSession } from "@/lib/auth";
import { getTopicConfig } from "@/lib/topics";
import { readNotes } from "@/lib/notes-store";
import { AppLayout, EmptyState } from "@/components/ui";
import Sidebar from "@/components/Sidebar";
import BottomNav from "@/components/BottomNav";
import LanguageToggle from "@/components/LanguageToggle";
import ThemeToggle from "@/components/ThemeToggle";
import { FlipCard } from "@/components/FlashCard";
import TrialActivation from "@/components/TrialActivation";
import type { NoteContent, NoteBlock, NoteSourceType } from "@/lib/notes";
import {
  Layers,
  Search,
  X,
  ArrowLeft,
  ArrowRight,
  RotateCw,
  GraduationCap,
  Bookmark,
  StickyNote,
  Sparkles,
  PenLine,
  Lightbulb,
  AlertTriangle,
  Brain,
  BookOpen,
  Link2,
  ChevronDown,
  ImageIcon,
  Globe,
  Loader2,
  Lock,
  Flag,
  Download,
  Check,
  Compass,
} from "lucide-react";
import { useToast } from "@/components/ui";

type Lang = "de" | "en";

interface ServerNote {
  id: string;
  source_type: NoteSourceType;
  source_ref: {
    question_id?: number;
    message_id?: string;
    image_url?: string;
    question_excerpt?: string;
    message_excerpt?: string;
  } | null;
  title: string;
  content: NoteContent;
  tags: string[];
  exam_type: string | null;
  topic: string | null;
  visibility: "private" | "public";
  is_active: boolean;
  created_at: string;
  updated_at: string;
}

type SortKey = "recent" | "updated" | "source" | "exam";
type Confidence = "again" | "hard" | "good" | "easy";

/** Review rating buttons (same 4-level scale as the question flashcards). */
const RATE_BUTTONS: { key: Confidence; de: string; en: string; color: string }[] = [
  { key: "again", de: "Nochmal", en: "Again", color: "var(--mp-error)" },
  { key: "hard", de: "Schwer", en: "Hard", color: "var(--mp-status-warning)" },
  { key: "good", de: "Gut", en: "Good", color: "var(--mp-viridian)" },
  { key: "easy", de: "Einfach", en: "Easy", color: "var(--mp-accent-teal)" },
];

/* ─── Source-type presentation ───────────────────────────────────── */
const SOURCE_META: Record<
  NoteSourceType,
  { de: string; en: string; Icon: typeof Bookmark; color: string }
> = {
  bookmark: { de: "Frage", en: "Question", Icon: Bookmark, color: "var(--mp-cta-blue)" },
  user_note: { de: "Notiz", en: "Note", Icon: StickyNote, color: "var(--mp-viridian)" },
  ai_explanation: { de: "KI", en: "AI", Icon: Sparkles, color: "var(--mp-accent-teal)" },
  manual: { de: "Eigen", en: "Manual", Icon: PenLine, color: "var(--mp-spark)" },
};

/* ─── Block rendering (back of the card) ─────────────────────────── */
function BlockRow({ block, lang }: { block: NoteBlock; lang: Lang }) {
  if (block.type === "concept") {
    return (
      <div className="rounded-[var(--mp-r-card)] bg-[var(--mp-surface-sunken)] p-3">
        {block.front && (
          <p className="text-[11px] font-mono uppercase tracking-wider text-[var(--mp-fg-subtle)] mb-1">
            {block.front}
          </p>
        )}
        <p className="text-[var(--mp-viridian)] font-bold whitespace-pre-line leading-relaxed">
          {block.back}
        </p>
      </div>
    );
  }
  const meta =
    block.type === "keyfact"
      ? { Icon: Lightbulb, color: "var(--mp-viridian)", label: lang === "de" ? "Merksatz" : "Key fact" }
      : block.type === "pitfall"
        ? { Icon: AlertTriangle, color: "var(--mp-spark)", label: lang === "de" ? "Falle" : "Pitfall" }
        : { Icon: Brain, color: "var(--mp-accent-teal)", label: lang === "de" ? "Eselsbrücke" : "Mnemonic" };
  const Icon = meta.Icon;
  return (
    <div className="flex items-start gap-2.5">
      <span
        className="flex-shrink-0 mt-0.5 w-6 h-6 rounded-full flex items-center justify-center"
        style={{ backgroundColor: `color-mix(in srgb, ${meta.color} 16%, transparent)`, color: meta.color }}
      >
        <Icon className="w-3.5 h-3.5" />
      </span>
      <div className="min-w-0">
        <p className="text-[10px] font-mono uppercase tracking-wider text-[var(--mp-fg-subtle)]">
          {meta.label}
        </p>
        <p className="text-sm text-[var(--mp-fg)] leading-relaxed whitespace-pre-line">
          {block.text}
        </p>
      </div>
    </div>
  );
}

/* ─── Compact grid card ──────────────────────────────────────────── */
function NoteGridCard({
  note,
  lang,
  onOpen,
}: {
  note: ServerNote;
  lang: Lang;
  onOpen: () => void;
}) {
  const meta = SOURCE_META[note.source_type] ?? SOURCE_META.manual;
  const Icon = meta.Icon;
  const firstBlock = note.content?.blocks?.[0];
  const previewText = firstBlock
    ? firstBlock.type === "concept"
      ? firstBlock.back || firstBlock.front
      : firstBlock.text
    : "";
  const blockCount = note.content?.blocks?.length ?? 0;

  return (
    <button
      type="button"
      onClick={onOpen}
      className="group text-left rounded-[var(--mp-r-card)] bg-[var(--mp-surface)] border border-[var(--mp-border-soft)] hover:border-[var(--mp-border)] shadow-[var(--mp-shadow-card)] hover:shadow-[var(--mp-shadow-elev)] transition-all p-4 flex flex-col gap-2 min-h-[148px] focus-ring"
      style={{ ["--sc" as string]: meta.color }}
    >
      <div className="flex items-center justify-between gap-2">
        <span
          className="inline-flex items-center gap-1 text-[10px] font-bold uppercase tracking-wide px-2 py-0.5 rounded-full"
          style={{ backgroundColor: `color-mix(in srgb, ${meta.color} 14%, transparent)`, color: meta.color }}
        >
          <Icon className="w-3 h-3" />
          {lang === "de" ? meta.de : meta.en}
        </span>
        {note.exam_type && (
          <span className="text-[10px] font-mono text-[var(--mp-fg-subtle)] truncate max-w-[45%]">
            {note.exam_type}
          </span>
        )}
      </div>

      <p className="font-display font-bold text-[var(--mp-fg)] leading-snug line-clamp-2">
        {note.title || (lang === "de" ? "Ohne Titel" : "Untitled")}
      </p>
      {previewText && (
        <p className="text-[13px] text-[var(--mp-fg-muted)] leading-relaxed line-clamp-2 flex-1">
          {previewText}
        </p>
      )}

      <div className="flex items-center justify-between gap-2 mt-auto pt-1">
        <div className="flex items-center gap-1.5 flex-wrap min-w-0">
          {note.tags.slice(0, 2).map((tag) => (
            <span
              key={tag}
              className="text-[10px] text-[var(--mp-fg-subtle)] bg-[var(--mp-surface-sunken)] px-1.5 py-0.5 rounded truncate max-w-[88px]"
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

/* ─── Focused study overlay (the shared FlipCard) ────────────────── */
function StudyOverlay({
  notes,
  index,
  lang,
  onClose,
  onNavigate,
  onPatch,
  exploreEnabled,
}: {
  notes: ServerNote[];
  index: number;
  lang: Lang;
  onClose: () => void;
  onNavigate: (next: number) => void;
  onPatch: (id: string, patch: Partial<ServerNote>) => void;
  exploreEnabled: boolean;
}) {
  const [flipped, setFlipped] = useState(false);
  const [rating, setRating] = useState(false);
  const [showRefs, setShowRefs] = useState(false);
  const note = notes[index];

  // Reset to the front whenever the card changes.
  useEffect(() => {
    setFlipped(false);
    setRating(false);
    setShowRefs(false);
  }, [index]);

  // Record an SM-2 review, then advance (or close on the last card). Best-effort:
  // a failed schedule never traps the user mid-review.
  const rate = async (confidence: Confidence) => {
    if (rating || !note) return;
    setRating(true);
    try {
      await fetch(`/api/notes/${note.id}/review`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ confidence }),
      });
    } catch {
      /* non-blocking */
    }
    if (index < notes.length - 1) onNavigate(index + 1);
    else onClose();
  };

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
      else if (e.key === " " || e.key === "Enter") {
        e.preventDefault();
        setFlipped((f) => !f);
      } else if (e.key === "ArrowRight" && index < notes.length - 1)
        onNavigate(index + 1);
      else if (e.key === "ArrowLeft" && index > 0) onNavigate(index - 1);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [index, notes.length, onClose, onNavigate]);

  if (!note) return null;
  const meta = SOURCE_META[note.source_type] ?? SOURCE_META.manual;
  const topicCfg = note.topic ? getTopicConfig(note.topic) : null;
  const chipColor = topicCfg?.color || meta.color;
  const chipIcon = topicCfg?.icon || "Layers";
  const chipLabel = note.topic || (lang === "de" ? meta.de : meta.en);

  const conceptFront = note.content?.blocks?.find(
    (b) => b.type === "concept",
  ) as Extract<NoteBlock, { type: "concept" }> | undefined;
  const refs = note.content?.refs ?? [];
  const blocks = note.content?.blocks ?? [];
  const sr = note.source_ref ?? {};
  const hasSources = !!(
    sr.question_id ||
    sr.question_excerpt ||
    sr.message_excerpt ||
    sr.image_url
  );

  return (
    <div
      className="fixed inset-0 z-[60] flex flex-col bg-[var(--mp-bg)]/90 backdrop-blur-sm"
      onClick={onClose}
    >
      {/* Top bar */}
      <div
        className="flex items-center gap-3 px-4 lg:px-8 pt-4 pb-2 flex-shrink-0"
        onClick={(e) => e.stopPropagation()}
      >
        <button
          type="button"
          onClick={onClose}
          aria-label={lang === "de" ? "Schließen" : "Close"}
          className="w-9 h-9 rounded-[10px] border border-[var(--mp-border-soft)] bg-[var(--mp-surface)] flex items-center justify-center text-[var(--mp-fg-muted)] hover:text-[var(--mp-fg)] transition-colors"
        >
          <X className="w-[18px] h-[18px]" />
        </button>
        <div className="flex-1 text-center font-mono text-[12px] font-bold text-[var(--mp-fg-muted)] tabular-nums">
          {index + 1} / {notes.length}
        </div>
        <div className="w-9" />
      </div>

      {/* Card */}
      <div
        className="flex-1 flex items-center justify-center px-5 lg:px-8 py-2 min-h-0"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="w-full max-w-[340px] lg:max-w-[560px]">
          <div className="aspect-[3/4] lg:aspect-auto lg:h-[clamp(420px,62vh,620px)] w-full">
            <FlipCard
              flipped={flipped}
              animatingOut={false}
              onFlip={() => setFlipped(true)}
              chip={{ color: chipColor, icon: chipIcon, label: chipLabel }}
              frontLabel={lang === "de" ? "Notiz" : "Note"}
              backLabel={lang === "de" ? "Inhalt" : "Content"}
              front={
                <div className="flex-1 min-h-0 flex flex-col items-center justify-center text-center gap-4 px-1 overflow-y-auto">
                  <p className="font-display font-bold text-[var(--mp-fg)] text-[20px] sm:text-[22px] leading-[1.3] whitespace-pre-line">
                    {note.title || (lang === "de" ? "Ohne Titel" : "Untitled")}
                  </p>
                  {conceptFront?.front && (
                    <p className="text-[var(--mp-fg-muted)] text-base leading-relaxed whitespace-pre-line">
                      {conceptFront.front}
                    </p>
                  )}
                  <div className="flex items-center justify-center gap-2 text-xs text-[var(--mp-fg-subtle)] mt-1">
                    <RotateCw className="w-[15px] h-[15px]" />
                    {lang === "de" ? "Zum Umdrehen tippen" : "Tap to flip"}
                  </div>
                </div>
              }
              back={
                <div className="flex-1 flex flex-col gap-3 overflow-y-auto -mr-2 pr-2">
                  {blocks.map((b, i) => (
                    <BlockRow key={i} block={b} lang={lang} />
                  ))}
                  {refs.length > 0 && (
                    <div className="flex flex-wrap gap-1.5 pt-1">
                      {refs.map((r, i) => (
                        <span
                          key={i}
                          className="text-[10px] font-mono px-1.5 py-0.5 rounded bg-[var(--mp-surface-sunken)] text-[var(--mp-fg-subtle)]"
                        >
                          {r.label}
                        </span>
                      ))}
                    </div>
                  )}
                  {hasSources && (
                    <div className="border-t border-[var(--mp-border-soft)] pt-2 mt-1">
                      <button
                        type="button"
                        onClick={() => setShowRefs((s) => !s)}
                        aria-expanded={showRefs}
                        className="flex items-center gap-1.5 text-[11px] font-semibold text-[var(--mp-fg-subtle)] hover:text-[var(--mp-fg-muted)] transition-colors"
                      >
                        <Link2 className="w-3.5 h-3.5" />
                        {lang === "de" ? "Quellen" : "Sources"}
                        <ChevronDown
                          className={`w-3 h-3 transition-transform ${showRefs ? "rotate-180" : ""}`}
                        />
                      </button>
                      {showRefs && (
                        <div className="mt-2 space-y-2">
                          {(sr.question_id || sr.question_excerpt) && (
                            <div className="text-xs text-[var(--mp-fg-muted)] leading-relaxed">
                              <span className="font-semibold text-[var(--mp-fg-subtle)]">
                                {lang === "de" ? "Aus Frage" : "From question"}
                                {sr.question_id ? ` #${sr.question_id}` : ""}:
                              </span>{" "}
                              {sr.question_excerpt || ""}
                            </div>
                          )}
                          {sr.message_excerpt && (
                            <div className="text-xs text-[var(--mp-fg-muted)] leading-relaxed">
                              <span className="font-semibold text-[var(--mp-fg-subtle)]">
                                {lang === "de" ? "Aus KI-Erklärung" : "From AI explanation"}:
                              </span>{" "}
                              {sr.message_excerpt}
                            </div>
                          )}
                          {sr.image_url && (
                            <div>
                              <p className="text-[10px] font-semibold text-[var(--mp-fg-subtle)] mb-1 flex items-center gap-1">
                                <ImageIcon className="w-3 h-3" />{" "}
                                {lang === "de" ? "Bild aus der Frage" : "Question image"}
                              </p>
                              <img
                                src={sr.image_url}
                                alt=""
                                className="max-h-32 rounded-lg object-contain"
                              />
                            </div>
                          )}
                        </div>
                      )}
                    </div>
                  )}
                </div>
              }
            />
          </div>
        </div>
      </div>

      {/* Owner publish / unpublish (Explore). Hidden unless Explore is enabled. */}
      {exploreEnabled && (
        <div
          className="px-5 pb-1 flex justify-center flex-shrink-0"
          onClick={(e) => e.stopPropagation()}
        >
          <PublishButton note={note} lang={lang} onPatch={onPatch} />
        </div>
      )}

      {/* Controls: browse (front) → rate + auto-advance (back). */}
      <div
        className="px-5 pb-6 pt-3 flex-shrink-0"
        onClick={(e) => e.stopPropagation()}
      >
        {!flipped ? (
          <div className="flex items-center justify-center gap-3">
            <button
              type="button"
              disabled={index === 0}
              onClick={() => onNavigate(index - 1)}
              className="mp-btn mp-btn--ghost inline-flex items-center gap-1.5 disabled:opacity-40"
            >
              <ArrowLeft className="w-4 h-4" />
              {lang === "de" ? "Zurück" : "Prev"}
            </button>
            <button
              type="button"
              onClick={() => setFlipped(true)}
              className="mp-btn mp-btn--primary inline-flex items-center gap-1.5"
            >
              <RotateCw className="w-4 h-4" />
              {lang === "de" ? "Aufdecken" : "Reveal"}
            </button>
            <button
              type="button"
              disabled={index >= notes.length - 1}
              onClick={() => onNavigate(index + 1)}
              className="mp-btn mp-btn--ghost inline-flex items-center gap-1.5 disabled:opacity-40"
            >
              {lang === "de" ? "Weiter" : "Next"}
              <ArrowRight className="w-4 h-4" />
            </button>
          </div>
        ) : (
          <div className="max-w-[420px] mx-auto animate-fade-in">
            <p className="text-center text-xs font-semibold text-[var(--mp-fg-muted)] mb-2">
              {lang === "de"
                ? "Wie gut wusstest du es?"
                : "How well did you know it?"}
            </p>
            <div className="grid grid-cols-4 gap-2">
              {RATE_BUTTONS.map((r) => (
                <button
                  key={r.key}
                  type="button"
                  disabled={rating}
                  onClick={() => rate(r.key)}
                  className="flex items-center justify-center min-h-[52px] rounded-xl border text-xs font-semibold transition-colors disabled:opacity-50"
                  style={{
                    borderColor: `color-mix(in srgb, ${r.color} 40%, transparent)`,
                    color: r.color,
                    backgroundColor: `color-mix(in srgb, ${r.color} 10%, transparent)`,
                  }}
                >
                  {lang === "de" ? r.de : r.en}
                </button>
              ))}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

/* ─── Progressive onboarding tips (dismissible, localStorage-tracked) ─ */
const LIB_TIPS: { id: string; min: number; de: string; en: string }[] = [
  {
    id: "review-v1",
    min: 1,
    de: "Tippe eine Karte an, decke sie auf und bewerte dich — so plant die App deine nächste Wiederholung (Spaced Repetition).",
    en: "Tap a card, reveal it and rate yourself — the app schedules your next review (spaced repetition).",
  },
  {
    id: "customize-v1",
    min: 2,
    de: 'Beim Speichern kannst du über „Anpassen“ die Sprache der Notiz wählen und einen Fokus angeben.',
    en: 'When saving, use "Customize" to pick the note language and set a focus.',
  },
  {
    id: "sources-v1",
    min: 3,
    de: 'Öffne „Quellen“ auf einer Karte, um zur Ursprungsfrage, KI-Erklärung oder dem Bild zu springen.',
    en: 'Open "Sources" on a card to see the question, AI explanation or image it came from.',
  },
];

function LibraryTips({ count, lang }: { count: number; lang: Lang }) {
  const [dismissed, setDismissed] = useState<Set<string>>(new Set());
  const [loaded, setLoaded] = useState(false);
  useEffect(() => {
    const s = new Set<string>();
    for (const tp of LIB_TIPS) {
      try {
        if (localStorage.getItem(`medpruef_lib_tip_${tp.id}`)) s.add(tp.id);
      } catch {
        /* ignore */
      }
    }
    setDismissed(s);
    setLoaded(true);
  }, []);
  if (!loaded) return null;
  const tip = LIB_TIPS.find((tp) => count >= tp.min && !dismissed.has(tp.id));
  if (!tip) return null;
  const dismiss = () => {
    try {
      localStorage.setItem(`medpruef_lib_tip_${tip.id}`, "1");
    } catch {
      /* ignore */
    }
    setDismissed((d) => new Set(d).add(tip.id));
  };
  return (
    <div className="mb-3 flex items-start gap-2.5 rounded-[var(--mp-r-card)] bg-[var(--mp-cta-blue)]/8 border border-[var(--mp-cta-blue)]/20 p-3 animate-fade-in">
      <Lightbulb className="w-4 h-4 text-[var(--mp-cta-blue)] flex-shrink-0 mt-0.5" />
      <p className="text-[13px] text-[var(--mp-fg-muted)] flex-1 leading-relaxed">
        {lang === "de" ? tip.de : tip.en}
      </p>
      <button
        type="button"
        onClick={dismiss}
        aria-label={lang === "de" ? "Tipp schließen" : "Dismiss tip"}
        className="text-[var(--mp-fg-subtle)] hover:text-[var(--mp-fg-muted)] flex-shrink-0 transition-colors"
      >
        <X className="w-3.5 h-3.5" />
      </button>
    </div>
  );
}

/* ─── Public / Explore (P6-ii, gated on NOTES_EXPLORE_ENABLED) ───────── */
interface PublicNote {
  id: string;
  title: string;
  content: NoteContent;
  tags: string[];
  exam_type: string | null;
  topic: string | null;
  published_at: string | null;
}

const REPORT_REASONS: { key: string; de: string; en: string }[] = [
  { key: "pii", de: "Persönliche Daten", en: "Personal data" },
  { key: "wrong", de: "Medizinisch falsch", en: "Medically wrong" },
  { key: "spam", de: "Spam", en: "Spam" },
  { key: "copyright", de: "Urheberrecht", en: "Copyright" },
  { key: "other", de: "Sonstiges", en: "Other" },
];

/** Publish / unpublish an owned note (with the scan-confirm handshake). */
function PublishButton({
  note,
  lang,
  onPatch,
}: {
  note: ServerNote;
  lang: Lang;
  onPatch: (id: string, patch: Partial<ServerNote>) => void;
}) {
  const toast = useToast();
  const [phase, setPhase] = useState<
    "idle" | "working" | "confirm" | "blocked" | "error"
  >("idle");
  const [flags, setFlags] = useState<{ type: string; detail: string }[]>([]);
  const de = lang === "de";
  const isPublic = note.visibility === "public";

  const patch = async (visibility: "public" | "private", confirm = false) => {
    setPhase("working");
    try {
      const res = await fetch(`/api/notes/${note.id}/visibility`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ visibility, confirm }),
      });
      const d = await res.json().catch(() => ({}));
      if (res.ok) {
        onPatch(note.id, { visibility });
        setPhase("idle");
        setFlags([]);
        toast.success(
          visibility === "public"
            ? de
              ? "Veröffentlicht"
              : "Published"
            : de
              ? "Privat gemacht"
              : "Made private",
          visibility === "public"
            ? de
              ? "In Explore sichtbar."
              : "Visible in Explore."
            : undefined,
        );
        return;
      }
      if (res.status === 409 && d?.code === "NEEDS_CONFIRM") {
        setFlags(Array.isArray(d.flags) ? d.flags : []);
        setPhase("confirm");
        return;
      }
      if (res.status === 422) {
        setFlags(Array.isArray(d.flags) ? d.flags : []);
        setPhase("blocked");
        return;
      }
      if (res.status === 403) {
        toast.error(
          de
            ? "Nach 24 Std. nicht mehr änderbar"
            : "Can't be changed after 24h",
        );
        setPhase("idle");
        return;
      }
      setPhase("error");
    } catch {
      setPhase("error");
    }
  };

  if (isPublic) {
    return (
      <button
        type="button"
        onClick={() => patch("private")}
        disabled={phase === "working"}
        className="inline-flex items-center gap-1.5 text-xs font-semibold text-[var(--mp-fg-muted)] hover:text-[var(--mp-fg)] disabled:opacity-60"
      >
        {phase === "working" ? (
          <Loader2 className="w-3.5 h-3.5 animate-spin" />
        ) : (
          <Lock className="w-3.5 h-3.5" />
        )}
        {de ? "Privat machen" : "Make private"}
      </button>
    );
  }

  return (
    <div className="text-left">
      <button
        type="button"
        onClick={() => patch("public")}
        disabled={phase === "working"}
        className="inline-flex items-center gap-1.5 text-xs font-semibold text-[var(--mp-cta-blue)] hover:opacity-80 disabled:opacity-60"
      >
        {phase === "working" ? (
          <Loader2 className="w-3.5 h-3.5 animate-spin" />
        ) : (
          <Globe className="w-3.5 h-3.5" />
        )}
        {de ? "Öffentlich teilen" : "Share publicly"}
      </button>
      {(phase === "confirm" || phase === "blocked") && (
        <div className="mt-1.5 p-2 rounded-lg bg-[var(--mp-surface-sunken)] border border-[var(--mp-border-soft)] text-[11px]">
          <p className="font-semibold text-[var(--mp-fg-muted)] mb-1">
            {phase === "blocked"
              ? de
                ? "Kann nicht veröffentlicht werden:"
                : "Cannot be published:"
              : de
                ? "Bitte prüfen, was öffentlich geteilt wird:"
                : "Please review what will be shared publicly:"}
          </p>
          <ul className="list-disc pl-4 space-y-0.5 text-[var(--mp-fg-subtle)]">
            {flags.map((f, i) => (
              <li key={i}>{f.detail}</li>
            ))}
          </ul>
          {phase === "confirm" && (
            <button
              type="button"
              onClick={() => patch("public", true)}
              className="mt-1.5 text-[11px] font-semibold text-[var(--mp-cta-blue)]"
            >
              {de ? "Trotzdem veröffentlichen" : "Publish anyway"}
            </button>
          )}
        </div>
      )}
    </div>
  );
}

/** An Explore (public, anonymous) note card: save-to-library + report. */
function PublicNoteCard({ note, lang }: { note: PublicNote; lang: Lang }) {
  const toast = useToast();
  const [saved, setSaved] = useState(false);
  const [saving, setSaving] = useState(false);
  const [reportOpen, setReportOpen] = useState(false);
  const [reported, setReported] = useState(false);
  const de = lang === "de";
  const firstBlock = note.content?.blocks?.[0];
  const preview = firstBlock
    ? firstBlock.type === "concept"
      ? firstBlock.back || firstBlock.front
      : firstBlock.text
    : "";

  const save = async () => {
    setSaving(true);
    try {
      const res = await fetch(`/api/notes/${note.id}/clone`, { method: "POST" });
      if (res.ok) {
        setSaved(true);
        toast.success(
          de ? "Gespeichert" : "Saved",
          de ? "In deiner Bibliothek." : "In your Library.",
        );
      } else if (res.status === 402) {
        toast.error(
          de ? "Pro-Funktion" : "Pro feature",
          de
            ? "Community-Notizen speichern ist Teil von Pro."
            : "Saving community notes is part of Pro.",
        );
      } else {
        toast.error(de ? "Fehler" : "Error");
      }
    } catch {
      toast.error(de ? "Fehler" : "Error");
    } finally {
      setSaving(false);
    }
  };

  const report = async (reason: string) => {
    setReportOpen(false);
    try {
      await fetch(`/api/notes/${note.id}/report`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ reason }),
      });
      setReported(true);
      toast.success(
        de ? "Gemeldet" : "Reported",
        de ? "Danke, wir prüfen das." : "Thanks, we'll review it.",
      );
    } catch {
      toast.error(de ? "Fehler" : "Error");
    }
  };

  return (
    <div className="rounded-[var(--mp-r-card)] bg-[var(--mp-surface)] border border-[var(--mp-border-soft)] shadow-[var(--mp-shadow-card)] p-4 flex flex-col gap-2 min-h-[164px]">
      <span className="inline-flex items-center gap-1 text-[10px] font-bold uppercase tracking-wide px-2 py-0.5 rounded-full bg-[var(--mp-status-warning)]/12 text-[var(--mp-status-warning)] self-start">
        <AlertTriangle className="w-3 h-3" />
        {de ? "Community · nicht verifiziert" : "Community · not verified"}
      </span>
      <p className="font-display font-bold text-[var(--mp-fg)] leading-snug line-clamp-2">
        {note.title || (de ? "Ohne Titel" : "Untitled")}
      </p>
      {preview && (
        <p className="text-[13px] text-[var(--mp-fg-muted)] line-clamp-3 flex-1">
          {preview}
        </p>
      )}
      <div className="flex items-center gap-2 mt-auto pt-1 relative">
        <button
          type="button"
          onClick={save}
          disabled={saving || saved}
          className="inline-flex items-center gap-1 text-xs font-semibold text-[var(--mp-viridian)] disabled:opacity-50"
        >
          {saved ? (
            <Check className="w-3.5 h-3.5" />
          ) : (
            <Download className="w-3.5 h-3.5" />
          )}
          {saved ? (de ? "Gespeichert" : "Saved") : de ? "Speichern" : "Save"}
        </button>
        <span className="flex-1" />
        {reported ? (
          <span className="text-xs text-[var(--mp-fg-subtle)]">
            {de ? "Gemeldet" : "Reported"}
          </span>
        ) : (
          <button
            type="button"
            onClick={() => setReportOpen((r) => !r)}
            className="inline-flex items-center gap-1 text-xs text-[var(--mp-fg-subtle)] hover:text-[var(--mp-error)] transition-colors"
          >
            <Flag className="w-3.5 h-3.5" /> {de ? "Melden" : "Report"}
          </button>
        )}
        {reportOpen && (
          <div className="absolute bottom-full right-0 mb-1 w-44 rounded-lg bg-[var(--mp-surface-raised)] border border-[var(--mp-border)] shadow-[var(--mp-shadow-elev)] p-1 z-10">
            {REPORT_REASONS.map((r) => (
              <button
                key={r.key}
                type="button"
                onClick={() => report(r.key)}
                className="block w-full text-left text-xs px-2 py-1.5 rounded hover:bg-[var(--mp-surface-sunken)] text-[var(--mp-fg-muted)]"
              >
                {de ? r.de : r.en}
              </button>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

/* ─── Main content ───────────────────────────────────────────────── */
function LibraryContent() {
  const [lang, setLangState] = useState<Lang>("de");
  const [userId, setUserId] = useState("");
  const [userName, setUserName] = useState("");
  const [totalXp, setTotalXp] = useState(0);
  const [streak, setStreak] = useState(0);
  const [accuracy, setAccuracy] = useState(0);
  const [authResolved, setAuthResolved] = useState(false);

  const [notes, setNotes] = useState<ServerNote[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState("");
  const [sourceFilter, setSourceFilter] = useState<NoteSourceType | "">("");
  const [sort, setSort] = useState<SortKey>("recent");
  const [studyIndex, setStudyIndex] = useState<number | null>(null);
  const importStarted = useRef(false);
  // Explore (P6-ii) — all gated on NOTES_EXPLORE_ENABLED (server returns enabled).
  const [exploreEnabled, setExploreEnabled] = useState(false);
  const [view, setView] = useState<"mine" | "explore">("mine");
  const [exploreNotes, setExploreNotes] = useState<PublicNote[]>([]);
  const [exploreLoading, setExploreLoading] = useState(false);

  useEffect(() => {
    setLangState(getLang());
    const session = getStoredSession();
    if (session) {
      setUserId(session.user.id);
      setUserName(session.user.first_name);
      const gm = session.gamification ?? {};
      setTotalXp(gm.total_xp || 0);
      setStreak(gm.current_streak || 0);
      const ans = gm.total_questions_answered || 0;
      const cor = gm.total_correct || 0;
      setAccuracy(ans > 0 ? Math.round((cor / ans) * 100) : 0);
    }
    setAuthResolved(true);
  }, []);

  const switchLang = (l: Lang) => {
    setLang(l);
    setLangState(l);
  };

  const fetchNotes = useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetch("/api/notes?limit=200&sort=recent");
      const data = await res.json();
      setNotes(Array.isArray(data?.notes) ? data.notes : []);
    } catch (e) {
      console.error("[library] fetch", e);
      setNotes([]);
    } finally {
      setLoading(false);
    }
  }, []);

  // Optimistic local update (e.g. after publish/unpublish) so the overlay reflects
  // the new visibility without a refetch.
  const patchNote = useCallback((id: string, patch: Partial<ServerNote>) => {
    setNotes((ns) => ns.map((n) => (n.id === id ? { ...n, ...patch } : n)));
  }, []);

  const fetchExplore = useCallback(async (q: string) => {
    setExploreLoading(true);
    try {
      const params = new URLSearchParams({ limit: "60" });
      if (q.trim()) params.set("q", q.trim());
      const res = await fetch(`/api/notes/explore?${params}`);
      const data = await res.json();
      setExploreEnabled(!!data?.enabled);
      setExploreNotes(Array.isArray(data?.notes) ? data.notes : []);
    } catch {
      setExploreNotes([]);
    } finally {
      setExploreLoading(false);
    }
  }, []);

  // One-time localStorage -> server import, then load notes.
  useEffect(() => {
    if (!authResolved) return;
    if (!userId) {
      setLoading(false);
      return;
    }
    if (importStarted.current) return;
    importStarted.current = true;

    const run = async () => {
      try {
        const migrated = localStorage.getItem("medpruef_notes_migrated");
        if (!migrated) {
          const items: { question_id: number; entries: ReturnType<typeof readNotes> }[] = [];
          for (let i = 0; i < localStorage.length; i++) {
            const k = localStorage.key(i);
            const m = k?.match(/^medpruef_notes_(\d+)$/);
            if (!m) continue;
            const qid = parseInt(m[1], 10);
            const entries = readNotes(qid);
            if (entries.length) items.push({ question_id: qid, entries });
          }
          if (items.length > 0) {
            // Only mark migrated on a CONFIRMED import. The endpoint dedupes by
            // import_key, so retrying after a transient failure is safe and never
            // loses the user's localStorage notes.
            const res = await fetch("/api/notes/import", {
              method: "POST",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({ items }),
            }).catch(() => null);
            if (res && res.ok) localStorage.setItem("medpruef_notes_migrated", "1");
          } else {
            localStorage.setItem("medpruef_notes_migrated", "1");
          }
        }
      } finally {
        await fetchNotes();
      }
    };
    run();
  }, [authResolved, userId, fetchNotes]);

  // Client-side search / filter / sort over the loaded set (<=200).
  const visible = useMemo(() => {
    const q = search.trim().toLowerCase();
    let list = notes;
    if (sourceFilter) list = list.filter((n) => n.source_type === sourceFilter);
    if (q) {
      list = list.filter((n) => {
        if (n.title.toLowerCase().includes(q)) return true;
        if (n.tags.some((t) => t.includes(q))) return true;
        return (n.content?.blocks ?? []).some((b) =>
          (b.type === "concept" ? `${b.front} ${b.back}` : b.text)
            .toLowerCase()
            .includes(q),
        );
      });
    }
    const sorted = [...list];
    if (sort === "updated")
      sorted.sort((a, b) => b.updated_at.localeCompare(a.updated_at));
    else if (sort === "source")
      sorted.sort((a, b) => a.source_type.localeCompare(b.source_type));
    else if (sort === "exam")
      sorted.sort((a, b) => (a.exam_type || "").localeCompare(b.exam_type || ""));
    else sorted.sort((a, b) => b.created_at.localeCompare(a.created_at));
    return sorted;
  }, [notes, search, sourceFilter, sort]);

  // Is Explore on? A cheap probe; the whole Explore UI is hidden when off.
  useEffect(() => {
    if (!authResolved || !userId) return;
    fetch("/api/notes/explore?limit=1")
      .then((r) => (r.ok ? r.json() : null))
      .then((d) => {
        if (d) setExploreEnabled(!!d.enabled);
      })
      .catch(() => {});
  }, [authResolved, userId]);

  // Load Explore when the user switches to it (or refines the search there).
  useEffect(() => {
    if (view === "explore" && exploreEnabled) fetchExplore(search);
  }, [view, exploreEnabled, search, fetchExplore]);

  const sidebar = (
    <Sidebar
      lang={lang}
      userId={userId}
      userName={userName}
      totalXp={totalXp}
      streak={streak}
      accuracy={accuracy}
    />
  );

  // Not signed in → notes are account-bound.
  if (authResolved && !userId) {
    return (
      <AppLayout sidebar={sidebar} bottomNav={<BottomNav lang={lang} userId="" />}>
        <main className="main-content flex flex-col items-center justify-center min-h-screen px-4 bg-[var(--mp-bg)]">
          <div className="max-w-md w-full">
            <EmptyState
              icon={<Layers className="w-10 h-10" aria-hidden />}
              title={lang === "de" ? "Deine Bibliothek" : "Your library"}
              body={
                lang === "de"
                  ? "Melde dich an, um deine Lernkarten und Notizen geräteübergreifend zu speichern."
                  : "Sign in to keep your flash-notes and bookmarks synced across devices."
              }
              action={
                <Link href="/login" className="mp-btn mp-btn--primary mt-2">
                  {lang === "de" ? "Anmelden" : "Sign in"}
                </Link>
              }
            />
          </div>
        </main>
      </AppLayout>
    );
  }

  const SOURCE_FILTERS: { key: NoteSourceType | ""; de: string; en: string }[] = [
    { key: "", de: "Alle", en: "All" },
    { key: "bookmark", de: "Fragen", en: "Questions" },
    { key: "user_note", de: "Notizen", en: "Notes" },
    { key: "ai_explanation", de: "KI", en: "AI" },
    { key: "manual", de: "Eigene", en: "Manual" },
  ];

  return (
    <AppLayout sidebar={sidebar} bottomNav={<BottomNav lang={lang} userId={userId} />}>
      <main className="main-content safe-area-top safe-area-bottom min-h-screen bg-[var(--mp-bg)] pb-28">
        {/* Header */}
        <div className="px-4 lg:px-8 pt-5 pb-3 flex items-start justify-between gap-3">
          <div className="min-w-0">
            <h1 className="mp-h1 flex items-center gap-2">
              <Layers className="w-6 h-6 text-[var(--mp-viridian)]" />
              {lang === "de" ? "Bibliothek" : "Library"}
            </h1>
            <p className="text-sm text-[var(--mp-fg-muted)] mt-0.5">
              {lang === "de"
                ? "Deine Lernkarten, Notizen und gespeicherten Erklärungen."
                : "Your flash-notes, bookmarks and saved explanations."}
            </p>
          </div>
          <div className="hidden sm:flex items-center gap-2 flex-shrink-0">
            <ThemeToggle />
            <LanguageToggle lang={lang} onChange={switchLang} />
          </div>
        </div>

        {/* My notes / Explore toggle — only when Explore is enabled. */}
        {exploreEnabled && (
          <div className="px-4 lg:px-8 pb-3">
            <div className="inline-flex rounded-full bg-[var(--mp-surface-sunken)] p-0.5 border border-[var(--mp-border-soft)]">
              <button
                type="button"
                onClick={() => setView("mine")}
                className={`px-3.5 py-1.5 rounded-full text-xs font-semibold transition-colors ${
                  view === "mine"
                    ? "bg-[var(--mp-surface)] text-[var(--mp-fg)] shadow-sm"
                    : "text-[var(--mp-fg-muted)]"
                }`}
              >
                {lang === "de" ? "Meine Notizen" : "My notes"}
              </button>
              <button
                type="button"
                onClick={() => setView("explore")}
                className={`px-3.5 py-1.5 rounded-full text-xs font-semibold inline-flex items-center gap-1 transition-colors ${
                  view === "explore"
                    ? "bg-[var(--mp-surface)] text-[var(--mp-fg)] shadow-sm"
                    : "text-[var(--mp-fg-muted)]"
                }`}
              >
                <Compass className="w-3.5 h-3.5" />
                {lang === "de" ? "Entdecken" : "Explore"}
              </button>
            </div>
          </div>
        )}

        {/* Free → Pro: the Telegram-gated trial (renders only for eligible free users). */}
        {view === "mine" && (
          <TrialActivation lang={lang} className="mx-4 lg:mx-8 mb-3" />
        )}

        {/* Question-review entry (Library is the home for all revisable cards) */}
        <div className="px-4 lg:px-8 pb-3">
          <Link
            href="/flashcards"
            className="flex items-center gap-3 rounded-[var(--mp-r-card)] bg-[var(--mp-surface)] border border-[var(--mp-border-soft)] hover:border-[var(--mp-border)] shadow-[var(--mp-shadow-card)] transition-all p-3.5"
          >
            <span className="w-10 h-10 rounded-xl bg-[var(--mp-cta-blue)]/12 flex items-center justify-center text-[var(--mp-cta-blue)] flex-shrink-0">
              <GraduationCap className="w-5 h-5" />
            </span>
            <div className="min-w-0 flex-1">
              <p className="font-semibold text-[var(--mp-fg)]">
                {lang === "de" ? "Karteikarten üben" : "Practice flashcards"}
              </p>
              <p className="text-[13px] text-[var(--mp-fg-muted)] truncate">
                {lang === "de"
                  ? "Fällige Prüfungsfragen im Wiederholungsmodus."
                  : "Due exam questions in spaced-repetition review."}
              </p>
            </div>
            <ArrowRight className="w-4 h-4 text-[var(--mp-fg-subtle)] flex-shrink-0" />
          </Link>
        </div>

        {/* Controls */}
        <div className="px-4 lg:px-8 pb-3 flex flex-col gap-3">
          <div className="relative">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-[var(--mp-fg-subtle)]" />
            <input
              type="search"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder={lang === "de" ? "Notizen durchsuchen…" : "Search notes…"}
              className="w-full pl-9 pr-3 py-2.5 rounded-[var(--mp-r-card)] bg-[var(--mp-surface)] border border-[var(--mp-border-soft)] text-[var(--mp-fg)] text-sm focus:outline-none focus:border-[var(--mp-viridian)]"
            />
          </div>
          <div className="flex items-center gap-2 overflow-x-auto -mx-1 px-1 pb-0.5">
            {SOURCE_FILTERS.map((f) => (
              <button
                key={f.key || "all"}
                type="button"
                onClick={() => setSourceFilter(f.key)}
                className={`text-xs font-semibold px-3 py-1.5 rounded-full whitespace-nowrap transition-colors flex-shrink-0 ${
                  sourceFilter === f.key
                    ? "bg-[var(--mp-viridian)] text-white"
                    : "bg-[var(--mp-surface)] border border-[var(--mp-border-soft)] text-[var(--mp-fg-muted)] hover:text-[var(--mp-fg)]"
                }`}
              >
                {lang === "de" ? f.de : f.en}
              </button>
            ))}
            <div className="flex-1" />
            <select
              value={sort}
              onChange={(e) => setSort(e.target.value as SortKey)}
              className="text-xs font-semibold px-2.5 py-1.5 rounded-full bg-[var(--mp-surface)] border border-[var(--mp-border-soft)] text-[var(--mp-fg-muted)] flex-shrink-0 focus:outline-none"
              aria-label={lang === "de" ? "Sortieren" : "Sort"}
            >
              <option value="recent">{lang === "de" ? "Neueste" : "Recent"}</option>
              <option value="updated">{lang === "de" ? "Bearbeitet" : "Updated"}</option>
              <option value="source">{lang === "de" ? "Quelle" : "Source"}</option>
              <option value="exam">{lang === "de" ? "Prüfung" : "Exam"}</option>
            </select>
          </div>
        </div>

        {/* Grid */}
        <div className="px-4 lg:px-8">
          {view === "explore" ? (
            exploreLoading ? (
              <div className="flex items-center justify-center py-20">
                <BrandedLoader />
              </div>
            ) : exploreNotes.length === 0 ? (
              <div className="max-w-md mx-auto py-10">
                <EmptyState
                  icon={<Compass className="w-10 h-10" aria-hidden />}
                  title={lang === "de" ? "Explore ist noch leer" : "Explore is empty"}
                  body={
                    lang === "de"
                      ? "Teile eine eigene Lernkarte öffentlich, um den Anfang zu machen."
                      : "Share one of your flash-notes publicly to get it started."
                  }
                />
              </div>
            ) : (
              <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
                {exploreNotes.map((n) => (
                  <PublicNoteCard key={n.id} note={n} lang={lang} />
                ))}
              </div>
            )
          ) : loading ? (
            <div className="flex items-center justify-center py-20">
              <BrandedLoader />
            </div>
          ) : visible.length === 0 ? (
            <div className="max-w-md mx-auto py-10">
              <EmptyState
                icon={<BookOpen className="w-10 h-10" aria-hidden />}
                title={
                  notes.length === 0
                    ? lang === "de"
                      ? "Noch keine Notizen"
                      : "No notes yet"
                    : lang === "de"
                      ? "Nichts gefunden"
                      : "Nothing found"
                }
                body={
                  notes.length === 0
                    ? lang === "de"
                      ? "Speichere eine Frage als Lesezeichen oder notiere etwas beim Üben — daraus wird deine erste Lernkarte."
                      : "Bookmark a question or jot a note while practising — it becomes your first flash-note."
                    : lang === "de"
                      ? "Passe Suche oder Filter an."
                      : "Try a different search or filter."
                }
                action={
                  notes.length === 0 ? (
                    <Link href="/quiz" className="mp-btn mp-btn--primary mt-2">
                      {lang === "de" ? "Üben starten" : "Start practising"}
                    </Link>
                  ) : undefined
                }
              />
              {notes.length === 0 && (
                <div className="mt-6 grid gap-3">
                  {[
                    {
                      n: 1,
                      de: "Beantworte eine Übungsfrage",
                      en: "Answer a practice question",
                    },
                    {
                      n: 2,
                      de: '„Als Lernkarte speichern“ tippen — die KI macht daraus eine Karteikarte',
                      en: 'Tap "Save as flash-note" — the AI turns it into a card',
                    },
                    {
                      n: 3,
                      de: "Karten hier mit Spaced Repetition wiederholen",
                      en: "Review your cards here with spaced repetition",
                    },
                  ].map((s) => (
                    <div key={s.n} className="flex items-center gap-3 text-left">
                      <span className="w-7 h-7 rounded-full bg-[var(--mp-viridian)]/12 text-[var(--mp-viridian)] text-sm font-bold flex items-center justify-center flex-shrink-0">
                        {s.n}
                      </span>
                      <span className="text-sm text-[var(--mp-fg-muted)]">
                        {lang === "de" ? s.de : s.en}
                      </span>
                    </div>
                  ))}
                </div>
              )}
            </div>
          ) : (
            <>
              <LibraryTips count={notes.length} lang={lang} />
              <div className="flex items-center justify-between mb-3">
                <span className="text-[13px] text-[var(--mp-fg-subtle)] font-mono">
                  {visible.length}{" "}
                  {lang === "de"
                    ? visible.length === 1
                      ? "Notiz"
                      : "Notizen"
                    : visible.length === 1
                      ? "note"
                      : "notes"}
                </span>
              </div>
              <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
                {visible.map((note, i) => (
                  <NoteGridCard
                    key={note.id}
                    note={note}
                    lang={lang}
                    onOpen={() => setStudyIndex(i)}
                  />
                ))}
              </div>
            </>
          )}
        </div>
      </main>

      {studyIndex !== null && visible[studyIndex] && (
        <StudyOverlay
          notes={visible}
          index={studyIndex}
          lang={lang}
          onClose={() => setStudyIndex(null)}
          onNavigate={setStudyIndex}
          onPatch={patchNote}
          exploreEnabled={exploreEnabled}
        />
      )}
    </AppLayout>
  );
}

export default function LibraryPage() {
  return (
    <Suspense
      fallback={
        <div className="flex items-center justify-center min-h-screen bg-[var(--mp-bg)]">
          <BrandedLoader />
        </div>
      }
    >
      <LibraryContent />
    </Suspense>
  );
}
