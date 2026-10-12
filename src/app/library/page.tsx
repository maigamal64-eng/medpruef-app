"use client";
import { buildAuthHref } from "@/lib/auth-entry";
import PartialTranslationNote from "@/components/PartialTranslationNote";
import { Alert, Dialog, IconButton, RatingRow, Textarea } from "@/components/ui";
import { tl, noteCount, sectionCount, legacyNoteCount } from "@/lib/i18n-library";
import { parseNoteAllowance, type NoteAllowance } from "@/lib/notes-cap";
import { getExamLabel, isExamLabelKey } from "@/lib/master-locale/exam-label";
import { useActiveExam } from "@/lib/hooks/useActiveExam";
import { OPEN_FEEDBACK_EVENT } from "@/components/nav/MoreSheet";
import { NoteActionsMenu, EditNoteDialog, DeleteNoteConfirm, NoteAllowanceMeter, deleteOutcome } from "./_parts/NoteActions";
import { checkedJson, DataResponseError } from "@/lib/async-data";
import { libraryP0Copy as copy, libraryMigrationHintKey } from "@/lib/library-p0-copy";
import { LIBRARY_PAGE_SIZE, checkedLibraryReview, isLibraryPage, mergeLibraryPage, libraryReadFailure } from "@/lib/library-p0-state";
import { useLang as useGlobalLang, renderLang, t as i18nT } from "@/lib/i18n";

/**
 * Bibliothek / Library — the personal home for ALL revisable cards (Notes
 * feature Phase 4). Replaces the bottom-nav "Flashcards" slot.
 *
 * v1 (this surface):
 *   - one-time localStorage -> server import of legacy per-question notes,
 *   - the user's flash-notes as a searchable / sortable / filterable grid,
 *   - shared NoteReader for reading, separate accessible review dialog,
 *   - an entry into question-flashcard review (the existing /flashcards ritual).
 *
 * Saved note schedules feed the due entry; reading and browsing never rate.
 *
 * Existing copy uses DE/EN; P0 copy follows the shared rendering fallback.
 * a25 (UX-STU-48..56): strings in src/lib/i18n-library.ts (Sie, glossary
 * nouns), own-note menu (edit / delete / report), the free allowance meter
 * (lifetime, pick-ux-stu-51 B), card metadata, phone controls, composer and
 * list practice.
 */

import {
  useEffect,
  useState,
  useCallback,
  useMemo,
  useRef,
  Suspense,
  type MouseEvent,
  type ReactNode,
} from "react";
import Link from "next/link";
import { BrandedLoader } from "@/components/Logo";
import { authFetch as fetch } from "@/lib/authFetch";
import { getLang } from "@/lib/i18n";
import { formatDate } from "@/lib/master-locale/format";
import { getStoredSession } from "@/lib/auth";
import { trackEvent } from "@/lib/tracker";
import { listNoteQuestionIds, readLegacyNotes, readNotes } from "@/lib/notes-store";
import { AppLayout, EmptyState } from "@/components/ui";
import Sidebar from "@/components/Sidebar";
import BottomNav from "@/components/BottomNav";
import LanguageToggle from "@/components/LanguageToggle";
import ThemeToggle from "@/components/ThemeToggle";
import TrialActivation from "@/components/TrialActivation";
import NoteExplore from "@/components/NoteExplore";
import CollectionsPanel from "@/components/CollectionsPanel";
import TurnIntoNoteButton from "@/components/TurnIntoNoteButton";
import NoteReader, { AddToListControl } from "@/components/NoteReader";
import type { NoteContent, NoteBlock, NoteSourceType } from "@/lib/notes";
import {
  ArrowUpDown,
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
  Globe,
  Loader2,
  Lock,
  Compass,
  FolderHeart,
} from "lucide-react";
import { useToast } from "@/components/ui";
import { filterAndSortLibraryNotes } from "@/lib/libraryNotes";

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
/** UX-STU-54 chips: Alle, Aus Fragen, Eigene (own text + manual), KI. */
type FilterKey = "" | "questions" | "own" | "ai";
const FILTER_SOURCES: Record<Exclude<FilterKey, "">, NoteSourceType[]> = {
  questions: ["bookmark"],
  own: ["user_note", "manual"],
  ai: ["ai_explanation"],
};

/** What the review dialog needs; list items carry is_owner (UX-STU-56). */
type ReviewNote = Pick<ServerNote, "id" | "title" | "content"> & {
  visibility?: ServerNote["visibility"];
  is_owner?: boolean;
};

/* ─── Source-type presentation ───────────────────────────────────── */
const SOURCE_META: Record<
  NoteSourceType,
  { label: "source_question" | "source_own" | "source_ai"; Icon: typeof Bookmark; color: string }
> = {
  bookmark: { label: "source_question", Icon: Bookmark, color: "var(--mp-cta-blue)" },
  user_note: { label: "source_own", Icon: StickyNote, color: "var(--mp-viridian)" },
  ai_explanation: { label: "source_ai", Icon: Sparkles, color: "var(--mp-accent-teal)" },
  manual: { label: "source_own", Icon: PenLine, color: "var(--mp-spark)" },
};

/** UX-STU-53: canonical short exam label, omitted when unknown or the active exam. */
function noteExamLabel(examType: string | null, activeExam: string | null): string | null {
  if (!examType || !isExamLabelKey(examType) || examType === activeExam) return null;
  return getExamLabel(examType, "short");
}

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
      ? { Icon: Lightbulb, color: "var(--mp-viridian)", label: tl("block_keyfact", lang) }
      : block.type === "pitfall"
        ? { Icon: AlertTriangle, color: "var(--mp-spark)", label: tl("block_pitfall", lang) }
        : { Icon: Brain, color: "var(--mp-accent-teal)", label: tl("block_mnemonic", lang) };
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
/**
 * UX-STU-53: the whole card opens the reader; its accessible name is the
 * title. Metadata: source chip, short exam label (omitted for the active
 * exam), tags at 12 px, a pluralised section count. The three-dot menu sits
 * beside the card button (a button never nests in a button).
 */
function NoteGridCard({
  note,
  lang,
  activeExam,
  highlighted,
  menu,
  onOpen,
}: {
  note: ServerNote;
  lang: Lang;
  activeExam: string | null;
  highlighted: boolean;
  menu: ReactNode;
  onOpen: (event: MouseEvent<HTMLButtonElement>) => void;
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
  const exam = noteExamLabel(note.exam_type, activeExam);
  const titleId = `note-title-${note.id}`;

  return (
    <div
      id={`note-${note.id}`}
      className={`relative rounded-[var(--mp-r-card)] bg-[var(--mp-surface)] border shadow-[var(--mp-shadow-card)] hover:shadow-[var(--mp-shadow-elev)] transition-all ${
        highlighted ? "border-[var(--mp-viridian)] ring-2 ring-[var(--mp-viridian)]/40" : "border-[var(--mp-border-soft)] hover:border-[var(--mp-border)]"
      }`}
    >
      <button
        type="button"
        onClick={onOpen}
        aria-labelledby={titleId}
        data-note-id={note.id}
        className="w-full text-left p-4 pr-14 flex flex-col gap-2 rounded-[var(--mp-r-card)] focus-ring"
      >
        <span className="flex flex-wrap items-center gap-2">
          <span
            className="inline-flex items-center gap-1 text-xs font-semibold px-2 py-0.5 rounded-full"
            style={{ backgroundColor: `color-mix(in srgb, ${meta.color} 14%, transparent)`, color: "var(--mp-fg)" }}
          >
            <Icon className="w-3 h-3" style={{ color: meta.color }} aria-hidden />
            {tl(meta.label, lang)}
          </span>
          {exam && <span className="text-xs text-[var(--mp-fg-muted)]">{exam}</span>}
          {highlighted && <span className="text-xs font-semibold text-[var(--mp-viridian)]">{tl("new_badge", lang)}</span>}
        </span>

        <span id={titleId} dir="auto" className="font-display font-bold text-[var(--mp-fg)] leading-snug line-clamp-2">
          {note.title || tl("untitled", lang)}
        </span>
        {previewText && (
          <span dir="auto" className="text-[13px] text-[var(--mp-fg-muted)] leading-relaxed line-clamp-2">
            {previewText}
          </span>
        )}

        <span className="flex items-center justify-between gap-2 pt-1">
          <span className="flex items-center gap-1.5 flex-wrap min-w-0">
            {note.tags.slice(0, 2).map((tag) => (
              <span
                key={tag}
                className="text-xs text-[var(--mp-fg-muted)] bg-[var(--mp-surface-sunken)] px-1.5 py-0.5 rounded truncate max-w-[120px]"
              >
                #{tag}
              </span>
            ))}
          </span>
          <span className="inline-flex items-center gap-1 text-xs font-semibold text-[var(--mp-fg-muted)] flex-shrink-0">
            <Layers className="w-3.5 h-3.5 text-[var(--mp-viridian)]" aria-hidden />
            {sectionCount(blockCount, lang)}
          </span>
        </span>
      </button>
      <div className="absolute right-1 top-1">{menu}</div>
    </div>
  );
}

/** Review is a deliberate mode; reading and navigation never submit ratings. */
function StudyOverlay({ notes, index, lang, onClose, onNavigate, onPatch, exploreEnabled }: {
  notes: ReviewNote[]; index: number; lang: Lang; onClose: () => void;
  onNavigate: (next: number) => void; onPatch: (id: string, patch: Partial<ServerNote>) => void;
  exploreEnabled: boolean;
}) {
  const [flipped, setFlipped] = useState(false);
  const [rating, setRating] = useState<Confidence | null>(null);
  const [ratingError, setRatingError] = useState(false);
  const [nextReview, setNextReview] = useState<string | null>(null);
  const saving = useRef(false);
  const frontRef = useRef<HTMLButtonElement>(null);
  const note = notes[index];
  useEffect(() => {
    setFlipped(false); setRatingError(false); setNextReview(null);
  }, [note?.id]);
  useEffect(() => {
    if (!flipped) frontRef.current?.focus({ preventScroll: true });
  }, [note?.id, flipped]);

  const rate = async (confidence: Confidence) => {
    if (saving.current || !note || !flipped || nextReview) return;
    saving.current = true; setRating(confidence); setRatingError(false);
    try {
      const response = await fetch(`/api/notes/${note.id}/review`, {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ confidence }), signal: AbortSignal.timeout(15_000),
      });
      const result = await checkedLibraryReview(response);
      setNextReview(result.next_review_at);
    } catch { setRatingError(true); }
    finally { saving.current = false; setRating(null); }
  };
  if (!note) return null;
  const concept = note.content.blocks.find(block => block.type === "concept") as Extract<NoteBlock, { type: "concept" }> | undefined;
  const advance = () => { if (saving.current) return; if (index < notes.length - 1) onNavigate(index + 1); else onClose(); };
  return <Dialog open onOpenChange={open => { if (!open && !saving.current) onClose(); }}
    title={tl('review_title', lang)} maxWidth="840px" closeOnBackdrop={!rating} closeOnEscape={!rating} hideCloseButton={!!rating}>
    <p className="mb-3 text-center text-sm text-[var(--mp-fg-muted)]" aria-live="polite">
      {tl('review_position', lang, { i: index + 1, n: notes.length })}
    </p>
    <div className="rounded-[var(--mp-r-card)] border border-[var(--mp-border-soft)] bg-[var(--mp-surface)] p-4 sm:p-6">
      {!flipped ? <button ref={frontRef} type="button" onClick={() => setFlipped(true)}
        className="w-full text-start focus-ring rounded-[var(--mp-r-button)]" aria-label={copy('reveal', lang)}>
        <p dir="auto" className="font-display text-xl font-bold text-[var(--mp-fg)] whitespace-pre-line">{note.title}</p>
        {concept?.front && <p dir="auto" className="mt-3 text-[var(--mp-fg-muted)] whitespace-pre-line">{concept.front}</p>}
        <p className="mt-4 text-sm text-[var(--mp-fg-muted)] inline-flex items-center gap-2"><RotateCw className="h-4 w-4" aria-hidden />{copy('revealHint', lang)}</p>
      </button> : <div dir="auto" className="space-y-4" role="region" aria-label={tl('review_content', lang)}>
        <h2 className="text-lg font-bold text-[var(--mp-fg)]">{note.title}</h2>
        {note.content.blocks.map((block, i) => <BlockRow key={i} block={block} lang={lang} />)}
        {!!note.content.refs?.length && <p className="text-sm text-[var(--mp-fg-muted)]">{note.content.refs.map(ref => ref.label).join(' · ')}</p>}
      </div>}
    </div>
    <div className="my-4 flex flex-wrap items-center justify-center gap-3">
      <AddToListControl noteId={note.id} lang={lang} />
      {exploreEnabled && note.is_owner !== false && note.visibility && <PublishButton note={{ id: note.id, visibility: note.visibility }} lang={lang} onPatch={onPatch} />}
    </div>
    {flipped && !nextReview && <RatingRow id="library-rating-label" lang={lang} scheduled busy={rating} onRate={name => void rate(name)} />}
    {ratingError && <Alert variant="error" className="mt-3">{copy('ratingError', lang)}</Alert>}
    {nextReview && <p role="status" className="mt-3 text-sm text-[var(--mp-fg)]">
      {tl('review_next_date', lang, { date: formatDate(nextReview, lang, 'long', { withYear: true }) ?? '' })}
    </p>}
    <div className="mt-4 flex flex-wrap items-center justify-center gap-2">
      <button type="button" disabled={!!rating || index === 0} onClick={() => onNavigate(index - 1)} className="mp-btn mp-btn--secondary min-h-11 focus-ring"><ArrowLeft className="h-4 w-4" aria-hidden />{copy('previous', lang)}</button>
      <button type="button" disabled={!!rating || index >= notes.length - 1} onClick={() => onNavigate(index + 1)} className="mp-btn mp-btn--secondary min-h-11 focus-ring">{copy('next', lang)}<ArrowRight className="h-4 w-4" aria-hidden /></button>
      <button type="button" disabled={!!rating} onClick={advance} className="mp-btn mp-btn--ghost min-h-11 focus-ring">{copy(nextReview ? (index < notes.length - 1 ? 'next' : 'finish') : 'skip', lang)}</button>
    </div>
  </Dialog>;
}

function LibraryTips({ count, lang, userId }: { count: number; lang: Lang; userId: string }) {
  const [show, setShow] = useState(false);
  useEffect(() => {
    try { setShow(!!userId && count > 0 && localStorage.getItem(libraryMigrationHintKey(userId)) !== '1'); }
    catch { setShow(!!userId && count > 0); }
  }, [count, userId]);
  if (!show) return null;
  return <div className="mb-3 flex items-start gap-2 rounded-[var(--mp-r-card)] bg-[var(--mp-surface-sunken)] border border-[var(--mp-border-soft)] p-3">
    <Lightbulb className="h-5 w-5 shrink-0 text-[var(--mp-cta-blue)]" aria-hidden />
    <p className="flex-1 text-sm text-[var(--mp-fg-muted)]">{tl('migration_hint', lang)}</p>
    <button type="button" className="mp-btn mp-btn--ghost min-h-11 min-w-11 focus-ring" aria-label={copy('dismissHint', lang)} onClick={() => {
      try { localStorage.setItem(libraryMigrationHintKey(userId), '1'); } catch { /* in-memory acknowledgement still works */ }
      setShow(false);
    }}><X className="h-4 w-4" aria-hidden /></button>
  </div>;
}

/* ─── Owner publish control (P6-ii, gated on NOTES_EXPLORE_ENABLED) ───── */
/** Publish / unpublish an owned note (with the scan-confirm handshake). */
function PublishButton({
  note,
  lang,
  onPatch,
}: {
  note: Pick<ServerNote, "id" | "visibility">;
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

/* ─── New-note entry card + composer (UX-STU-54, 55) ─────────────────── */
function NewNoteEntry({ lang, open, hasDraft, onToggle }: { lang: Lang; open: boolean; hasDraft: boolean; onToggle: () => void }) {
  return (
    <button
      type="button"
      onClick={onToggle}
      aria-expanded={open}
      aria-controls="library-composer"
      className="w-full flex items-center gap-3 text-left rounded-[var(--mp-r-card)] bg-[var(--mp-surface)] border border-[var(--mp-border-soft)] hover:border-[var(--mp-border)] shadow-[var(--mp-shadow-card)] p-3.5 min-h-11 focus-ring"
    >
      <span className="w-10 h-10 rounded-xl bg-[var(--mp-viridian)]/12 flex items-center justify-center text-[var(--mp-viridian)] flex-shrink-0">
        <PenLine className="w-5 h-5" aria-hidden />
      </span>
      <span className="min-w-0 flex-1">
        <span className="block font-semibold text-[var(--mp-fg)]">{tl("new_title", lang)}</span>
        <span className="block text-[13px] text-[var(--mp-fg-muted)] line-clamp-2">
          {hasDraft && !open ? tl("new_draft_sub", lang) : tl("new_sub", lang)}
        </span>
      </span>
      <Sparkles className="w-4 h-4 text-[var(--mp-fg-subtle)] flex-shrink-0" aria-hidden />
    </button>
  );
}

function NewNoteComposer({
  lang,
  text,
  onText,
  onClose,
  onCreated,
}: {
  lang: Lang;
  text: string;
  onText: (value: string) => void;
  onClose: () => void;
  onCreated: (notes: { id: string }[]) => void;
}) {
  return (
    <section id="library-composer" aria-label={tl("new_title", lang)} className="rounded-[var(--mp-r-card)] bg-[var(--mp-surface)] border border-[var(--mp-border-soft)] shadow-[var(--mp-shadow-card)] p-3.5 space-y-2">
      <div className="flex items-center gap-2">
        <PenLine className="w-4 h-4 text-[var(--mp-viridian)]" aria-hidden />
        <h2 className="font-semibold text-[var(--mp-fg)] text-sm flex-1">{tl("new_title", lang)}</h2>
        <IconButton label={tl("new_close", lang)} onClick={onClose} />
      </div>
      <Textarea
        label={tl("new_field", lang)}
        hideLabel
        value={text}
        onChange={(e) => onText(e.target.value)}
        rows={3}
        maxLength={4000}
        autoFocus
        dir="auto"
        placeholder={tl("new_placeholder", lang)}
      />
      <TurnIntoNoteButton
        kind="user_note"
        lang={lang}
        text={text.trim()}
        allowCustomize
        size="sm"
        embedded
        disabled={text.trim().length === 0}
        label={tl("new_create", lang)}
        onCreated={onCreated}
      />
    </section>
  );
}

/* ─── Main content ───────────────────────────────────────────────── */
function LibraryContent() {
  const [lang, setLangState] = useState<Lang>("de");
  const preferredLang = useGlobalLang();
  useEffect(() => { setLangState(renderLang(preferredLang)); }, [preferredLang]);
  const [userId, setUserId] = useState("");
  const [userName, setUserName] = useState("");
  const [totalXp, setTotalXp] = useState(0);
  const [streak, setStreak] = useState(0);
  const [accuracy, setAccuracy] = useState(0);
  const [authResolved, setAuthResolved] = useState(false);

  const [notes, setNotes] = useState<ServerNote[]>([]);
  const [legacyNotesCount, setLegacyNotesCount] = useState(0);
  const [legacyImporting, setLegacyImporting] = useState(false);
  const [legacyConfirmOpen, setLegacyConfirmOpen] = useState(false);
  const [legacyImportDone, setLegacyImportDone] = useState(false);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState("");
  const [sourceFilter, setSourceFilter] = useState<FilterKey>("");
  const [sort, setSort] = useState<SortKey>("recent");
  const [studyIndex, setStudyIndex] = useState<number | null>(null);
  const [reviewNotes, setReviewNotes] = useState<ReviewNote[]>([]);
  const [readNote, setReadNote] = useState<ServerNote | null>(null);
  const [dueNotes, setDueNotes] = useState<ServerNote[]>([]);
  const [dueCount, setDueCount] = useState<number | null>(null);
  const [dueError, setDueError] = useState(false);
  const [dueLoading, setDueLoading] = useState(false);
  const [notesCount, setNotesCount] = useState(0);
  const [nextOffset, setNextOffset] = useState(0);
  const [loadingMore, setLoadingMore] = useState(false);
  const [failedAppend, setFailedAppend] = useState(false);
  const [weakConnection, setWeakConnection] = useState(false);
  const requestBusy = useRef(false);
  const openerRef = useRef<HTMLElement | null>(null);
  const importStarted = useRef(false);
  // a25 (UX-STU-51): the free allowance from GET /api/notes. null = paid (or
  // not loaded); capUnknown = free but the allowance read failed, so delete
  // stays hidden.
  const [cap, setCap] = useState<NoteAllowance | null>(null);
  const [capUnknown, setCapUnknown] = useState(true);
  const [editing, setEditing] = useState<ServerNote | null>(null);
  const [deleteTarget, setDeleteTarget] = useState<ServerNote | null>(null);
  const [deletePending, setDeletePending] = useState(false);
  const [highlightId, setHighlightId] = useState<string | null>(null);
  const [composerOpen, setComposerOpen] = useState(false);
  const [draft, setDraft] = useState("");
  const toast = useToast();
  const notesRef = useRef<ServerNote[]>([]);
  useEffect(() => { notesRef.current = notes; }, [notes]);
  const { resolution: examResolution } = useActiveExam(null);
  const activeExam = examResolution.status === "ready" ? examResolution.exam : null;
  // Explore (P6-ii) — all gated on NOTES_EXPLORE_ENABLED (server returns enabled).
  // "lists" (collections) is always available for a signed-in user.
  const [exploreEnabled, setExploreEnabled] = useState(false);
  const [view, setView] = useState<"mine" | "explore" | "lists">("mine");

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
    setLangState(l);
  };

  const [notesError, setNotesError] = useState(false);
  const loadDueNotes = useCallback(async () => {
    setDueLoading(true); setDueError(false);
    try {
      const res = await fetch('/api/notes?due=true&limit=20&sort=recent', { signal: AbortSignal.timeout(10_000) });
      const data = await checkedJson(res, isLibraryPage<ServerNote>);
      setDueNotes(data.notes); setDueCount(data.count);
    } catch (error) { setDueError(true); trackEvent('error_state_shown', { page: '/library/due', status: libraryReadFailure(error).status }); }
    finally { setDueLoading(false); }
  }, []);
  const fetchNotes = useCallback(async (append = false, offset = 0) => {
    if (requestBusy.current) return;
    requestBusy.current = true;
    if (append) setLoadingMore(true); else setLoading(true);
    setNotesError(false); setFailedAppend(append);
    try {
      const res = await fetch(`/api/notes?limit=${LIBRARY_PAGE_SIZE}&offset=${offset}&sort=recent`, { signal: AbortSignal.timeout(10_000) });
      const data = await checkedJson(res, isLibraryPage<ServerNote>);
      if (data.offset !== offset || (data.notes.length === 0 && data.count > offset)) throw new DataResponseError(502);
      setNotes(previous => mergeLibraryPage(previous, data.notes, append));
      setNotesCount(data.count); setNextOffset(data.offset + data.notes.length);
      const raw = data as unknown as { cap?: unknown; cap_unknown?: unknown };
      setCap(parseNoteAllowance(raw.cap)); setCapUnknown(raw.cap_unknown === true);
    } catch (error) {
      const failure = libraryReadFailure(error);
      setWeakConnection(failure.weakConnection); setNotesError(true);
      trackEvent('error_state_shown', { page: '/library', status: failure.status });
    } finally {
      requestBusy.current = false; setLoading(false); setLoadingMore(false);
    }
    if (!append) void loadDueNotes();
  }, [loadDueNotes]);

  // Optimistic local update (e.g. after publish/unpublish) so the overlay reflects
  // the new visibility without a refetch.
  const patchNote = useCallback((id: string, patch: Partial<ServerNote>) => {
    setNotes((ns) => ns.map((n) => (n.id === id ? { ...n, ...patch } : n)));
  }, []);

  // Migrate only notes already scoped to this authenticated account. Global
  // legacy keys are never auto-imported because a shared browser cannot tell
  // which account created them.
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
        const migratedKey = `medpruef_notes_account_migrated_${encodeURIComponent(userId)}`;
        const migrated = localStorage.getItem(migratedKey);
        if (!migrated) {
          const items: { question_id: number; entries: ReturnType<typeof readNotes> }[] = [];
          for (const qid of listNoteQuestionIds(userId)) {
            const entries = readNotes(qid, userId);
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
            if (res && res.ok) localStorage.setItem(migratedKey, "1");
          } else {
            localStorage.setItem(migratedKey, "1");
          }
        }
        setLegacyNotesCount(readLegacyNotes().reduce((sum, item) => sum + item.entries.length, 0));
        setLegacyImportDone(!!localStorage.getItem(`medpruef_notes_legacy_imported_${encodeURIComponent(userId)}`));
      } finally {
        await fetchNotes();
      }
    };
    run();
  }, [authResolved, userId, fetchNotes]);

  const importLegacyNotes = async () => {
    if (!userId || legacyImporting || legacyImportDone) return;
    // STU-56 / UX-GLOBAL-14: confirmed in a ui/Dialog, never window.confirm.
    setLegacyConfirmOpen(false);
    const items = readLegacyNotes();
    if (!items.length) {
      setLegacyNotesCount(0);
      return;
    }
    setLegacyImporting(true);
    try {
      const response = await fetch("/api/notes/import", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ items }),
      }).catch(() => null);
      if (!response?.ok) return;
      localStorage.setItem(`medpruef_notes_legacy_imported_${encodeURIComponent(userId)}`, "1");
      setLegacyImportDone(true);
      setLegacyNotesCount(0);
      await fetchNotes();
    } finally {
      setLegacyImporting(false);
    }
  };

  // Search / filter / sort the loaded pages, with explicit paging beyond 200.
  const visible = useMemo(() => {
    const pool = sourceFilter ? notes.filter((note) => FILTER_SOURCES[sourceFilter].includes(note.source_type)) : notes;
    return filterAndSortLibraryNotes(pool, search, "", sort);
  }, [notes, search, sourceFilter, sort]);

  // ── Own-note actions (UX-STU-51) ──────────────────────────────────────
  // Free accounts may delete only while lifetime counting is live; paid
  // accounts (cap null, read ok) always may.
  const canDelete = cap ? cap.lifetime : !capUnknown;

  const confirmDelete = async () => {
    const target = deleteTarget;
    if (!target || deletePending) return;
    setDeletePending(true);
    const res = await fetch(`/api/notes/${target.id}`, { method: "DELETE", signal: AbortSignal.timeout(15_000) }).catch(() => null);
    const outcome = await deleteOutcome(res);
    setDeletePending(false);
    if (outcome === "deleted") {
      setDeleteTarget(null);
      if (readNote?.id === target.id) setReadNote(null);
      setNotes((list) => list.filter((n) => n.id !== target.id));
      setNotesCount((n) => Math.max(0, n - 1));
      setNextOffset((n) => Math.max(0, n - 1));
      toast.success(tl("deleted", lang));
      void loadDueNotes();
    } else if (outcome === "unavailable") {
      setDeleteTarget(null);
      setCap((current) => (current ? { ...current, lifetime: false } : current));
      toast.error(tl("delete_unavailable", lang));
    } else {
      toast.error(tl("delete_error", lang));
    }
  };

  // "Fehlerhafte Lernnotiz melden": the note report route only takes public
  // notes, so an own note is reported through the existing feedback form.
  const reportOwnNote = (note: ServerNote) => {
    setReadNote(null);
    toast.info(tl("menu_report", lang), tl("report_hint", lang, { title: note.title || tl("untitled", lang) }));
    window.dispatchEvent(new CustomEvent(OPEN_FEEDBACK_EVENT));
  };

  const noteMenu = (note: ServerNote) => (
    <NoteActionsMenu
      title={note.title}
      lang={lang}
      canDelete={canDelete}
      onEdit={() => setEditing(note)}
      onDelete={() => setDeleteTarget(note)}
      onReport={() => reportOwnNote(note)}
    />
  );

  // Composer success (UX-STU-55): clear and collapse, refresh in place, then
  // scroll to and mark the new card, with an "Öffnen" toast action.
  const onComposerCreated = async (created: { id: string }[]) => {
    setDraft("");
    setComposerOpen(false);
    setSourceFilter("");
    setSearch("");
    await fetchNotes();
    const firstId = created[0]?.id;
    if (!firstId) return;
    setHighlightId(firstId);
    requestAnimationFrame(() => {
      document.getElementById(`note-${firstId}`)?.scrollIntoView({ behavior: "smooth", block: "center" });
    });
    toast.show({
      variant: "success",
      title: tl("new_created", lang),
      action: {
        label: tl("new_open", lang),
        onClick: () => {
          const found = notesRef.current.find((n) => n.id === firstId);
          if (found) setReadNote(found);
        },
      },
    });
  };

  const closeComposer = () => {
    setComposerOpen(false);
    if (draft.trim()) {
      toast.show({
        variant: "info",
        title: tl("new_draft_kept", lang),
        action: { label: tl("new_draft_reopen", lang), onClick: () => setComposerOpen(true) },
      });
    }
  };

  // Is Explore on? A cheap probe; the Explore tab is hidden when off.
  useEffect(() => {
    if (!authResolved || !userId) return;
    fetch("/api/notes/explore?limit=1")
      .then((r) => (r.ok ? r.json() : null))
      .then((d) => {
        if (d) setExploreEnabled(!!d.enabled);
      })
      .catch(() => {});
  }, [authResolved, userId]);

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
              title={tl("signin_title", lang)}
              body={tl("signin_body", lang)}
              action={
                <Link href={buildAuthHref({ next: "/library" }, "signin_required")} className="mp-btn mp-btn--primary mt-2">
                  {tl("signin_action", lang)}
                </Link>
              }
            />
          </div>
        </main>
      </AppLayout>
    );
  }

  const SOURCE_FILTERS: { key: FilterKey; label: "filter_all" | "filter_questions" | "filter_own" | "filter_ai" }[] = [
    { key: "", label: "filter_all" },
    { key: "questions", label: "filter_questions" },
    { key: "own", label: "filter_own" },
    { key: "ai", label: "filter_ai" },
  ];
  const SORTS: { key: SortKey; label: "sort_recent" | "sort_updated" | "sort_source" | "sort_exam" }[] = [
    { key: "recent", label: "sort_recent" },
    { key: "updated", label: "sort_updated" },
    { key: "source", label: "sort_source" },
    { key: "exam", label: "sort_exam" },
  ];
  const tabClass = (active: boolean) =>
    `min-h-11 px-3.5 rounded-full text-sm font-semibold inline-flex items-center gap-1 transition-colors focus-ring ${
      active ? "bg-[var(--mp-surface)] text-[var(--mp-fg)] shadow-sm" : "text-[var(--mp-fg-muted)]"
    }`;

  return (
    <AppLayout sidebar={sidebar} bottomNav={<BottomNav lang={lang} userId={userId} />}>
      <main className="main-content safe-area-top safe-area-bottom min-h-screen bg-[var(--mp-bg)] pb-28">
        <PartialTranslationNote />
        {view === 'mine' && notesError && <Alert variant="error" title={tl('load_error', lang)} className="mx-4 lg:mx-8 my-4">
          <p>{tl('load_error_body', lang)}</p>
          {(weakConnection || (typeof navigator !== 'undefined' && navigator.onLine === false)) && <p>{tl('weak_connection', lang)}</p>}
          <button type="button" className="mp-btn mp-btn--secondary min-h-11 mt-2 focus-ring" disabled={loading || loadingMore} onClick={() => void fetchNotes(failedAppend, failedAppend ? nextOffset : 0)}>{copy('retry', lang)}</button>
        </Alert>}
        {/* Header */}
        <div className="px-4 lg:px-8 pt-5 pb-3 flex items-start justify-between gap-3">
          <div className="min-w-0">
            <h1 className="mp-h1 flex items-center gap-2">
              <Layers className="w-6 h-6 text-[var(--mp-viridian)]" aria-hidden />
              {tl("title", lang)}
            </h1>
            <p className="text-sm text-[var(--mp-fg-muted)] mt-0.5">{tl("subtitle", lang)}</p>
            {/* UX-STU-51: free allowance meter (lifetime), neutral, quiet warning from 8. */}
            {view === "mine" && <NoteAllowanceMeter cap={cap} lang={lang} className="mt-2" />}
          </div>
          <div className="hidden sm:flex items-center gap-2 flex-shrink-0">
            <ThemeToggle />
            <LanguageToggle lang={lang} onChange={switchLang} />
          </div>
        </div>

        {/* My notes / Explore / Lists. Explore appears only when NOTES_EXPLORE_ENABLED. */}
        <div className="px-4 lg:px-8 pb-3">
          <div role="group" aria-label={tl("tabs_label", lang)} className="inline-flex flex-wrap rounded-full bg-[var(--mp-surface-sunken)] p-0.5 border border-[var(--mp-border-soft)]">
            <button type="button" onClick={() => setView("mine")} aria-pressed={view === "mine"} className={tabClass(view === "mine")}>
              {tl("tab_mine", lang)}
            </button>
            {exploreEnabled && (
              <button type="button" onClick={() => setView("explore")} aria-pressed={view === "explore"} className={tabClass(view === "explore")}>
                <Compass className="w-3.5 h-3.5" aria-hidden />
                {tl("tab_explore", lang)}
              </button>
            )}
            <button type="button" onClick={() => setView("lists")} aria-pressed={view === "lists"} className={tabClass(view === "lists")}>
              <FolderHeart className="w-3.5 h-3.5" aria-hidden />
              {tl("tab_lists", lang)}
            </button>
          </div>
        </div>

        {/* Free → Pro: the card-on-file trial (renders only for eligible free users). */}
        {view === "mine" && (
          <TrialActivation lang={lang} className="mx-4 lg:mx-8 mb-3" />
        )}

        {view === "mine" && legacyNotesCount > 0 && !legacyImportDone && (
          <section className="mx-4 lg:mx-8 mb-3 rounded-[var(--mp-r-card)] border border-[var(--mp-status-warning)]/35 bg-[var(--mp-status-warning)]/8 p-3.5">
            <div className="flex items-start gap-3">
              <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-[var(--mp-status-warning)]" aria-hidden />
              <div className="min-w-0 flex-1">
                <p className="text-sm font-semibold text-[var(--mp-fg)]">{tl("legacy_title", lang)}</p>
                <p className="mt-1 text-xs leading-relaxed text-[var(--mp-fg-muted)]">
                  {tl("legacy_body", lang, { n: legacyNoteCount(legacyNotesCount, lang) })}
                </p>
                <button
                  type="button"
                  onClick={() => setLegacyConfirmOpen(true)}
                  disabled={legacyImporting}
                  className="mt-2 min-h-11 text-sm font-semibold text-[var(--mp-cta-blue)] underline underline-offset-2 disabled:opacity-60"
                >
                  {legacyImporting ? tl("legacy_importing", lang) : tl("legacy_import", lang)}
                </button>
              </div>
            </div>
            <Dialog
              open={legacyConfirmOpen}
              onOpenChange={setLegacyConfirmOpen}
              kind="confirm"
              busy={legacyImporting}
              title={i18nT("library_legacy_confirm_title", lang)}
              description={i18nT("library_legacy_confirm_body", lang)}
              footer={
                <>
                  <button type="button" data-dialog-safe className="mp-btn mp-btn--secondary" onClick={() => setLegacyConfirmOpen(false)}>
                    {i18nT("library_legacy_confirm_cancel", lang)}
                  </button>
                  <button type="button" data-dialog-primary className="mp-btn mp-btn--primary" onClick={() => void importLegacyNotes()}>
                    {i18nT("library_legacy_confirm_ok", lang)}
                  </button>
                </>
              }
            />
          </section>
        )}

        {/* Entries (UX-STU-54): new study note + flashcards review. The
            composer opens full width below both (UX-STU-55). */}
        {view === "mine" && (
        <div className="px-4 lg:px-8 pb-3 space-y-3">
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-3">
            <NewNoteEntry lang={lang} open={composerOpen} hasDraft={draft.trim().length > 0} onToggle={() => (composerOpen ? closeComposer() : setComposerOpen(true))} />
            <Link
              href="/flashcards"
              className="flex items-center gap-3 rounded-[var(--mp-r-card)] bg-[var(--mp-surface)] border border-[var(--mp-border-soft)] hover:border-[var(--mp-border)] shadow-[var(--mp-shadow-card)] transition-all p-3.5 min-h-11 focus-ring"
            >
              <span className="w-10 h-10 rounded-xl bg-[var(--mp-cta-blue)]/12 flex items-center justify-center text-[var(--mp-cta-blue)] flex-shrink-0">
                <GraduationCap className="w-5 h-5" aria-hidden />
              </span>
              <span className="min-w-0 flex-1">
                <span className="block font-semibold text-[var(--mp-fg)]">{tl("flashcards_title", lang)}</span>
                <span className="block text-[13px] text-[var(--mp-fg-muted)] line-clamp-2">{tl("flashcards_sub", lang)}</span>
              </span>
              <ArrowRight className="w-4 h-4 text-[var(--mp-fg-subtle)] flex-shrink-0" aria-hidden />
            </Link>
          </div>
          {composerOpen && (
            <NewNoteComposer lang={lang} text={draft} onText={setDraft} onClose={closeComposer} onCreated={(created) => void onComposerCreated(created)} />
          )}
        </div>
        )}

        {view === 'mine' && <section className="px-4 lg:px-8 pb-3" aria-busy={dueLoading}>
          {dueError ? <Alert variant="error" title={tl('due_error', lang)}>
            <button type="button" className="mp-btn mp-btn--secondary min-h-11 mt-2 focus-ring" disabled={dueLoading} onClick={() => void loadDueNotes()}>{copy('retry', lang)}</button>
          </Alert> : null}
          {dueCount !== null && (dueNotes.length > 0 ? <button type="button" disabled={dueLoading} className="mp-btn mp-btn--secondary min-h-11 focus-ring" onClick={event => {
            openerRef.current = event.currentTarget; setReviewNotes(dueNotes); setStudyIndex(0);
          }}>{tl('due_entry', lang)}: {dueCount}{dueCount > 20 ? ` · ${tl('due_round', lang)}` : ''}</button> : <p className="text-sm text-[var(--mp-fg-muted)]">{tl('no_due', lang)}</p>)}
        </section>}

        {/* Controls (UX-STU-54): search, chip row with right-edge fade, and one
            trailing sort control that shows its value as text. */}
        {view === "mine" && (
        <div className="px-4 lg:px-8 pb-3 flex flex-col gap-3">
          <div className="relative">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-[var(--mp-fg-subtle)]" aria-hidden />
            <input
              type="search"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              aria-label={tl("search_label", lang)}
              placeholder={tl("search_placeholder", lang)}
              className="w-full min-h-11 pl-9 pr-3 py-2.5 rounded-[var(--mp-r-card)] bg-[var(--mp-surface)] border border-[var(--mp-border-soft)] text-[var(--mp-fg)] text-sm focus:outline-none focus:border-[var(--mp-viridian)]"
            />
          </div>
          <div className="flex items-center gap-2 min-w-0">
            <div className="relative min-w-0 flex-1">
              <div role="group" aria-label={tl("filter_label", lang)} className="flex items-center gap-2 overflow-x-auto pr-8 -mx-1 px-1 py-0.5">
                {SOURCE_FILTERS.map((f) => (
                  <button
                    key={f.key || "all"}
                    type="button"
                    onClick={() => setSourceFilter(f.key)}
                    aria-pressed={sourceFilter === f.key}
                    className={`min-h-11 text-sm font-semibold px-3.5 rounded-full whitespace-nowrap transition-colors flex-shrink-0 focus-ring ${
                      sourceFilter === f.key
                        ? "bg-[var(--mp-viridian)] text-white"
                        : "bg-[var(--mp-surface)] border border-[var(--mp-border-soft)] text-[var(--mp-fg-muted)] hover:text-[var(--mp-fg)]"
                    }`}
                  >
                    {tl(f.label, lang)}
                  </button>
                ))}
              </div>
              <span aria-hidden className="pointer-events-none absolute inset-y-0 right-0 w-8 bg-gradient-to-l from-[var(--mp-bg)] to-transparent" />
            </div>
            <label className="relative inline-flex min-h-11 flex-shrink-0 items-center gap-1.5 rounded-full border border-[var(--mp-border-soft)] bg-[var(--mp-surface)] pl-3 pr-2 text-sm font-semibold text-[var(--mp-fg-muted)] focus-within:border-[var(--mp-viridian)]">
              <ArrowUpDown className="h-4 w-4" aria-hidden />
              <span className="hidden sm:inline">{tl("sort_label", lang)}</span>
              <select
                value={sort}
                onChange={(e) => setSort(e.target.value as SortKey)}
                aria-label={tl("sort_label", lang)}
                className="min-h-11 bg-transparent pr-1 text-[var(--mp-fg)] focus:outline-none"
              >
                {SORTS.map((o) => (
                  <option key={o.key} value={o.key}>{tl(o.label, lang)}</option>
                ))}
              </select>
            </label>
          </div>
        </div>
        )}

        {/* Body */}
        <div className="px-4 lg:px-8">
          {view === "explore" ? (
            <NoteExplore lang={lang} />
          ) : view === "lists" ? (
            <CollectionsPanel
              lang={lang}
              exploreEnabled={exploreEnabled}
              onPractice={(list, opener) => {
                openerRef.current = opener;
                setReviewNotes(list);
                setStudyIndex(0);
              }}
            />
          ) : loading && notes.length === 0 ? (
            <div className="flex items-center justify-center py-20">
              <BrandedLoader />
            </div>
          ) : notesError && notes.length === 0 ? null : visible.length === 0 ? (
            <div className="max-w-md mx-auto py-10">
              <EmptyState
                icon={<BookOpen className="w-10 h-10" aria-hidden />}
                title={notes.length === 0 ? tl("empty_title", lang) : tl("no_match_title", lang)}
                body={notes.length === 0 ? tl("empty_body", lang) : tl("no_match_body", lang)}
                action={
                  notes.length === 0 ? (
                    <Link href="/quiz" className="mp-btn mp-btn--primary mt-2">
                      {tl("empty_action", lang)}
                    </Link>
                  ) : undefined
                }
              />
              {notes.length === 0 && (
                <ol className="mt-6 grid gap-3">
                  {(["empty_step_1", "empty_step_2", "empty_step_3"] as const).map((key, i) => (
                    <li key={key} className="flex items-center gap-3 text-left">
                      <span aria-hidden className="w-7 h-7 rounded-full bg-[var(--mp-viridian)]/12 text-[var(--mp-viridian)] text-sm font-bold flex items-center justify-center flex-shrink-0">
                        {i + 1}
                      </span>
                      <span className="text-sm text-[var(--mp-fg-muted)]">{tl(key, lang)}</span>
                    </li>
                  ))}
                </ol>
              )}
            </div>
          ) : (
            <>
              <LibraryTips count={notes.length} lang={lang} userId={userId} />
              <div className="flex items-center justify-between mb-3">
                <span className="text-[13px] text-[var(--mp-fg-muted)]" aria-live="polite">
                  {noteCount(visible.length, lang)}
                </span>
              </div>
              <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
                {visible.map((note) => (
                  <NoteGridCard
                    key={note.id}
                    note={note}
                    lang={lang}
                    activeExam={activeExam}
                    highlighted={highlightId === note.id}
                    menu={noteMenu(note)}
                    onOpen={event => { openerRef.current = event.currentTarget; setReadNote(note); }}
                  />
                ))}
              </div>
            </>
          )}
          {view === 'mine' && nextOffset < notesCount && <button type="button" disabled={loadingMore || loading} className="mp-btn mp-btn--secondary min-h-11 my-4 focus-ring" onClick={() => void fetchNotes(true, nextOffset)}>
            {loadingMore && <Loader2 className="h-4 w-4 animate-spin" aria-hidden />}{copy('loadMore', lang)}
          </button>}
        </div>
      </main>

      <NoteReader note={readNote ? { ...readNote, is_owner: true } : null} lang={lang} open={!!readNote} maxWidth="840px"
        onOpenChange={open => { if (!open) setReadNote(null); }} practiceLabel={copy('practice', lang)}
        menu={readNote ? noteMenu(readNote) : undefined}
        onPractice={() => { if (!readNote) return; setReviewNotes([readNote]); setReadNote(null); setStudyIndex(0); }} />
      {studyIndex !== null && reviewNotes[studyIndex] && (
        <StudyOverlay
          notes={reviewNotes}
          index={studyIndex}
          lang={lang}
          onClose={() => { setStudyIndex(null); void loadDueNotes(); requestAnimationFrame(() => openerRef.current?.focus({ preventScroll: true })); }}
          onNavigate={setStudyIndex}
          onPatch={patchNote}
          exploreEnabled={exploreEnabled}
        />
      )}
      <EditNoteDialog
        note={editing}
        lang={lang}
        onClose={() => setEditing(null)}
        onSaved={(updated) => {
          setEditing(null);
          setNotes((list) => list.map((n) => (n.id === updated.id ? updated : n)));
          setReadNote((current) => (current?.id === updated.id ? updated : current));
          toast.success(tl("edit_saved", lang));
        }}
      />
      <DeleteNoteConfirm
        open={!!deleteTarget}
        lang={lang}
        cap={cap}
        pending={deletePending}
        onOpenChange={(open) => { if (!open && !deletePending) setDeleteTarget(null); }}
        onConfirm={() => void confirmDelete()}
      />
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
