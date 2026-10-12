"use client";
import { buildAuthHref } from "@/lib/auth-entry";
import PartialTranslationNote from "@/components/PartialTranslationNote";
import { Alert, Dialog, RatingButton } from "@/components/ui";
import { checkedJson, DataResponseError } from "@/lib/async-data";
import { libraryP0Copy as copy, libraryMigrationHintKey } from "@/lib/library-p0-copy";
import { LIBRARY_PAGE_SIZE, checkedLibraryReview, isLibraryPage, mergeLibraryPage, libraryReadFailure } from "@/lib/library-p0-state";
import { useLang as useGlobalLang, renderLang } from "@/lib/i18n";

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
 */

import {
  useEffect,
  useState,
  useCallback,
  useMemo,
  useRef,
  Suspense,
  type MouseEvent,
} from "react";
import Link from "next/link";
import { BrandedLoader } from "@/components/Logo";
import { authFetch as fetch } from "@/lib/authFetch";
import { getLang } from "@/lib/i18n";
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

/* ─── Source-type presentation ───────────────────────────────────── */
const SOURCE_META: Record<
  NoteSourceType,
  { de: string; en: string; Icon: typeof Bookmark; color: string }
> = {
  bookmark: { de: "Frage", en: "Question", Icon: Bookmark, color: "var(--mp-cta-blue)" },
  user_note: { de: "Notiz", en: "Note", Icon: StickyNote, color: "var(--mp-viridian)" },
  ai_explanation: { de: "KI", en: "AI", Icon: Sparkles, color: "var(--mp-accent-teal)" },
  manual: { de: "Manuell erstellt", en: "Manually created", Icon: PenLine, color: "var(--mp-spark)" },
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

  return (
    <button
      type="button"
      onClick={onOpen}
      className="group text-left rounded-[var(--mp-r-card)] bg-[var(--mp-surface)] border border-[var(--mp-border-soft)] hover:border-[var(--mp-border)] shadow-[var(--mp-shadow-card)] hover:shadow-[var(--mp-shadow-elev)] transition-all p-4 flex flex-col gap-2 focus-ring"
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

      <p dir="auto" className="font-display font-bold text-[var(--mp-fg)] leading-snug line-clamp-2">
        {note.title || (lang === "de" ? "Ohne Titel" : "Untitled")}
      </p>
      {previewText && (
        <p dir="auto" className="text-[13px] text-[var(--mp-fg-muted)] leading-relaxed line-clamp-2">
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
          {blockCount} {lang === "de" ? "Blöcke" : "blocks"}
        </span>
      </div>

    </button>
  );
}

/** Review is a deliberate mode; reading and navigation never submit ratings. */
function StudyOverlay({ notes, index, lang, onClose, onNavigate, onPatch, exploreEnabled }: {
  notes: ServerNote[]; index: number; lang: Lang; onClose: () => void;
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
    title={copy('review', lang)} maxWidth="840px" closeOnBackdrop={!rating} closeOnEscape={!rating} hideCloseButton={!!rating}>
    <p className="mb-3 text-center text-sm text-[var(--mp-fg-muted)]" aria-live="polite">
      {lang === 'de' ? `Karte ${index + 1} von ${notes.length}` : `Card ${index + 1} of ${notes.length}`}
    </p>
    <div className="rounded-[var(--mp-r-card)] border border-[var(--mp-border-soft)] bg-[var(--mp-surface)] p-4 sm:p-6">
      {!flipped ? <button ref={frontRef} type="button" onClick={() => setFlipped(true)}
        className="w-full text-start focus-ring rounded-[var(--mp-r-button)]" aria-label={copy('reveal', lang)}>
        <p dir="auto" className="font-display text-xl font-bold text-[var(--mp-fg)] whitespace-pre-line">{note.title}</p>
        {concept?.front && <p dir="auto" className="mt-3 text-[var(--mp-fg-muted)] whitespace-pre-line">{concept.front}</p>}
        <p className="mt-4 text-sm text-[var(--mp-fg-muted)] inline-flex items-center gap-2"><RotateCw className="h-4 w-4" aria-hidden />{copy('revealHint', lang)}</p>
      </button> : <div dir="auto" className="space-y-4" role="region" aria-label={lang === 'de' ? 'Inhalt' : 'Content'}>
        <h2 className="text-lg font-bold text-[var(--mp-fg)]">{note.title}</h2>
        {note.content.blocks.map((block, i) => <BlockRow key={i} block={block} lang={lang} />)}
        {!!note.content.refs?.length && <p className="text-sm text-[var(--mp-fg-muted)]">{note.content.refs.map(ref => ref.label).join(' · ')}</p>}
      </div>}
    </div>
    <div className="my-4 flex flex-wrap items-center justify-center gap-3">
      <AddToListControl noteId={note.id} lang={lang} />
      {exploreEnabled && <PublishButton note={note} lang={lang} onPatch={onPatch} />}
    </div>
    {flipped && !nextReview && <div role="group" aria-labelledby="library-rating-label" aria-busy={!!rating}>
      <p id="library-rating-label" className="mb-2 text-center text-sm font-bold text-[var(--mp-fg)]">{copy('ratingLabel', lang)}</p>
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
        {(['again', 'hard', 'good', 'easy'] as const).map((confidence, i) =>
          <RatingButton key={confidence} intensity={i as 0 | 1 | 2 | 3} disabled={!!rating} onClick={() => void rate(confidence)}>
            {rating === confidence && <Loader2 className="inline h-4 w-4 animate-spin mr-1" aria-label={copy('saving', lang)} />}{copy(confidence, lang)}
          </RatingButton>)}
      </div>
    </div>}
    {ratingError && <Alert variant="error" className="mt-3">{copy('ratingError', lang)}</Alert>}
    {nextReview && <p role="status" className="mt-3 text-sm text-[var(--mp-fg)]">
      {lang === 'de' ? 'Nächste Wiederholung: ' : 'Next review: '}{new Date(nextReview).toLocaleDateString(lang === 'de' ? 'de-AT' : 'en-GB')}
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
    <p className="flex-1 text-sm text-[var(--mp-fg-muted)]">{copy('migrationHint', lang)}</p>
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

/* ─── New-note composer (a clear "add your own note" entry) ──────────── */
function NewNoteCard({ lang, onNoteCreated }: { lang: Lang; onNoteCreated: () => void }) {
  const [openComposer, setOpenComposer] = useState(false);
  const [text, setText] = useState("");
  const de = lang === "de";

  return (
    <div className="rounded-[var(--mp-r-card)] bg-[var(--mp-surface)] border border-[var(--mp-border-soft)] shadow-[var(--mp-shadow-card)] p-3.5">
      {!openComposer ? (
        <button
          type="button"
          onClick={() => setOpenComposer(true)}
          className="w-full flex items-center gap-3 text-left"
        >
          <span className="w-10 h-10 rounded-xl bg-[var(--mp-viridian)]/12 flex items-center justify-center text-[var(--mp-viridian)] flex-shrink-0">
            <PenLine className="w-5 h-5" />
          </span>
          <div className="min-w-0 flex-1">
            <p className="font-semibold text-[var(--mp-fg)]">
              {de ? "Neue Notiz" : "New note"}
            </p>
            <p className="text-[13px] text-[var(--mp-fg-muted)] truncate">
              {de
                ? "Schreibe etwas, die KI macht daraus eine Lernkarte."
                : "Write something; the AI turns it into a flash-note."}
            </p>
          </div>
          <Sparkles className="w-4 h-4 text-[var(--mp-fg-subtle)] flex-shrink-0" />
        </button>
      ) : (
        <div className="space-y-2">
          <div className="flex items-center gap-2">
            <PenLine className="w-4 h-4 text-[var(--mp-viridian)]" />
            <p className="font-semibold text-[var(--mp-fg)] text-sm">
              {de ? "Neue Notiz" : "New note"}
            </p>
            <button
              type="button"
              onClick={() => {
                setOpenComposer(false);
                setText("");
              }}
              aria-label={de ? "Schließen" : "Close"}
              className="ml-auto text-[var(--mp-fg-subtle)] hover:text-[var(--mp-fg)]"
            >
              <X className="w-4 h-4" />
            </button>
          </div>
          <textarea
            value={text}
            onChange={(e) => setText(e.target.value)}
            rows={3}
            maxLength={4000}
            autoFocus
            placeholder={
              de
                ? "z. B. Merkmale des Marfan-Syndroms, wichtige Differenzialdiagnosen…"
                : "e.g. features of Marfan syndrome, key differentials…"
            }
            className="w-full text-sm px-3 py-2 rounded-[var(--mp-r-card)] bg-[var(--mp-surface-sunken)] border border-[var(--mp-border-soft)] text-[var(--mp-fg)] placeholder-[var(--mp-fg-subtle)] focus:outline-none focus:border-[var(--mp-viridian)] resize-none"
          />
          {text.trim().length > 0 && (
            <TurnIntoNoteButton
              kind="user_note"
              lang={lang}
              text={text.trim()}
              allowCustomize
              size="sm"
              onCreated={onNoteCreated}
            />
          )}
        </div>
      )}
    </div>
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
  const [legacyImportDone, setLegacyImportDone] = useState(false);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState("");
  const [sourceFilter, setSourceFilter] = useState<NoteSourceType | "">("");
  const [sort, setSort] = useState<SortKey>("recent");
  const [studyIndex, setStudyIndex] = useState<number | null>(null);
  const [reviewNotes, setReviewNotes] = useState<ServerNote[]>([]);
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
  const openerRef = useRef<HTMLButtonElement | null>(null);
  const importStarted = useRef(false);
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
    const confirmed = window.confirm(lang === "de"
      ? "Diese alten Notizen liegen ungeschützt auf diesem Browser und könnten von einer anderen Person stammen. Nur fortfahren, wenn du sicher bist, dass sie zu deinem Konto gehören. Die Originale bleiben im Browser gespeichert."
      : "These old notes are stored globally in this browser and may belong to someone else who used it. Continue only if you are sure they belong to your account. The originals will remain in the browser.");
    if (!confirmed) return;
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
    return filterAndSortLibraryNotes(notes, search, sourceFilter, sort);
  }, [notes, search, sourceFilter, sort]);

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
              title={lang === "de" ? "Deine Bibliothek" : "Your library"}
              body={
                lang === "de"
                  ? "Melde dich an, um deine Lernkarten und Notizen geräteübergreifend zu speichern."
                  : "Sign in to keep your flash-notes and bookmarks synced across devices."
              }
              action={
                <Link href={buildAuthHref({ next: "/library" }, "signin_required")} className="mp-btn mp-btn--primary mt-2">
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
    { key: "manual", de: "Manuell erstellt", en: "Manually created" },
  ];

  return (
    <AppLayout sidebar={sidebar} bottomNav={<BottomNav lang={lang} userId={userId} />}>
      <main className="main-content safe-area-top safe-area-bottom min-h-screen bg-[var(--mp-bg)] pb-28">
        <PartialTranslationNote />
        {view === 'mine' && notesError && <Alert variant="error" title={copy('loadError', lang)} className="mx-4 lg:mx-8 my-4">
          <p>{copy('loadErrorBody', lang)}</p>
          {(weakConnection || (typeof navigator !== 'undefined' && navigator.onLine === false)) && <p>{copy('weakConnection', lang)}</p>}
          <button type="button" className="mp-btn mp-btn--secondary min-h-11 mt-2 focus-ring" disabled={loading || loadingMore} onClick={() => void fetchNotes(failedAppend, failedAppend ? nextOffset : 0)}>{copy('retry', lang)}</button>
        </Alert>}
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

        {/* My notes / Explore / Lists tabs. Lists is always available;
            Explore appears only when NOTES_EXPLORE_ENABLED. */}
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
            {exploreEnabled && (
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
            )}
            <button
              type="button"
              onClick={() => setView("lists")}
              className={`px-3.5 py-1.5 rounded-full text-xs font-semibold inline-flex items-center gap-1 transition-colors ${
                view === "lists"
                  ? "bg-[var(--mp-surface)] text-[var(--mp-fg)] shadow-sm"
                  : "text-[var(--mp-fg-muted)]"
              }`}
            >
              <FolderHeart className="w-3.5 h-3.5" />
              {lang === "de" ? "Listen" : "Lists"}
            </button>
          </div>
        </div>

        {/* Free → Pro: the Telegram-gated trial (renders only for eligible free users). */}
        {view === "mine" && (
          <TrialActivation lang={lang} className="mx-4 lg:mx-8 mb-3" />
        )}

        {view === "mine" && legacyNotesCount > 0 && !legacyImportDone && (
          <section className="mx-4 lg:mx-8 mb-3 rounded-[var(--mp-r-card)] border border-[var(--mp-status-warning)]/35 bg-[var(--mp-status-warning)]/8 p-3.5">
            <div className="flex items-start gap-3">
              <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-[var(--mp-status-warning)]" aria-hidden />
              <div className="min-w-0 flex-1">
                <p className="text-sm font-semibold text-[var(--mp-fg)]">
                  {lang === "de" ? "Alte Notizen in diesem Browser" : "Older notes in this browser"}
                </p>
                <p className="mt-1 text-xs leading-relaxed text-[var(--mp-fg-muted)]">
                  {lang === "de"
                    ? `${legacyNotesCount} Notizen sind nicht einem Konto zugeordnet. Auf einem gemeinsam genutzten Gerät können sie einer anderen Person gehören.`
                    : `${legacyNotesCount} notes are not linked to an account. On a shared device, they may belong to someone else.`}
                </p>
                <button
                  type="button"
                  onClick={() => void importLegacyNotes()}
                  disabled={legacyImporting}
                  className="mt-2 text-xs font-semibold text-[var(--mp-cta-blue)] underline underline-offset-2 disabled:opacity-60"
                >
                  {legacyImporting
                    ? (lang === "de" ? "Import läuft…" : "Importing…")
                    : (lang === "de" ? "Als meine Notizen importieren…" : "Import as my notes…")}
                </button>
              </div>
            </div>
          </section>
        )}

        {/* Entries — only in "my notes" view: a "new note" composer + the
            flashcards review entry. */}
        {view === "mine" && (
        <div className="px-4 lg:px-8 pb-3 grid grid-cols-1 lg:grid-cols-2 gap-3">
          <NewNoteCard lang={lang} onNoteCreated={() => void fetchNotes()} />
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
        )}

        {view === 'mine' && <section className="px-4 lg:px-8 pb-3" aria-busy={dueLoading}>
          {dueError ? <Alert variant="error" title={copy('dueError', lang)}>
            <button type="button" className="mp-btn mp-btn--secondary min-h-11 mt-2 focus-ring" disabled={dueLoading} onClick={() => void loadDueNotes()}>{copy('retry', lang)}</button>
          </Alert> : null}
          {dueCount !== null && (dueNotes.length > 0 ? <button type="button" disabled={dueLoading} className="mp-btn mp-btn--secondary min-h-11 focus-ring" onClick={event => {
            openerRef.current = event.currentTarget; setReviewNotes(dueNotes); setStudyIndex(0);
          }}>{copy('dueEntry', lang)}: {dueCount}{dueCount > 20 ? (lang === 'de' ? ' · Bis zu 20 in dieser Runde' : ' · Up to 20 this round') : ''}</button> : <p className="text-sm text-[var(--mp-fg-muted)]">{copy('noDue', lang)}</p>)}
        </section>}

        {/* Controls — only in "my notes" view (Explore + Lists own their own). */}
        {view === "mine" && (
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
          <div className="flex flex-col sm:flex-row sm:items-center sm:gap-2 gap-1.5">
            <span className="text-[11px] font-semibold text-[var(--mp-fg-subtle)] sm:sr-only">
              {lang === "de" ? "Quelle" : "Source"}
            </span>
            <div className="flex items-center gap-2 overflow-x-auto -mx-1 px-1 pb-0.5 min-w-0">
            {SOURCE_FILTERS.map((f) => (
              <button
                key={f.key || "all"}
                type="button"
                onClick={() => setSourceFilter(f.key)}
                aria-pressed={sourceFilter === f.key}
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
            </div>
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
        )}

        {/* Body */}
        <div className="px-4 lg:px-8">
          {view === "explore" ? (
            <NoteExplore lang={lang} />
          ) : view === "lists" ? (
            <CollectionsPanel lang={lang} />
          ) : loading && notes.length === 0 ? (
            <div className="flex items-center justify-center py-20">
              <BrandedLoader />
            </div>
          ) : notesError && notes.length === 0 ? null : visible.length === 0 ? (
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
                      ? "Speichere eine Frage als Lesezeichen oder notiere etwas beim Üben, daraus wird deine erste Lernkarte."
                      : "Bookmark a question or jot a note while practising; it becomes your first flash-note."
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
                      de: '„Als Lernkarte speichern“ tippen: die KI macht daraus eine Karteikarte',
                      en: 'Tap "Save as flash-note": the AI turns it into a card',
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
              <LibraryTips count={notes.length} lang={lang} userId={userId} />
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
                {visible.map((note) => (
                  <NoteGridCard
                    key={note.id}
                    note={note}
                    lang={lang}
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
