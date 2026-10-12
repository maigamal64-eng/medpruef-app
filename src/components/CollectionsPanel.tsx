"use client";

/**
 * CollectionsPanel — the user's lists/collections for organizing notes
 * (EXP-1 §5). A collection can hold the user's own notes AND notes saved from
 * Explore (references). This is the ONE organization mechanism that works for
 * both (you cannot tag a curated note you did not author).
 *
 * Shows the list of collections; opening one shows its notes in the shared
 * <NoteReader>. Create / rename / delete lists inline.
 *
 * a25 (UX-STU-56): strings live in src/lib/i18n-library.ts (Sie); empty
 * states describe what works today (Explore wording only while Explore is
 * on); failures say what failed and why, with retry; list delete confirms in
 * the shared ConfirmAction (a list cannot be restored, so no undo); each list
 * offers "Diese Liste üben" through the Library review dialog. No em dashes.
 */

import { useCallback, useEffect, useState } from "react";
import { authFetch as fetch } from "@/lib/authFetch";
import { Alert, BrandedLoader, ConfirmAction, EmptyState, IconButton, useToast } from "@/components/ui";
import { listFailure, noteCount, tl, type ListAction } from "@/lib/i18n-library";
import NoteReader, { SourceBadge, type ReaderNote } from "@/components/NoteReader";
import type { NoteReview } from "@/lib/notes-review";
import type { NoteContent } from "@/lib/notes";
import {
  ListPlus,
  FolderOpen,
  Folder,
  ChevronRight,
  ArrowLeft,
  Plus,
  Loader2,
  Trash2,
  Pencil,
  Check,
  X,
  Layers,
  Star,
  GraduationCap,
} from "lucide-react";

type Lang = "de" | "en";

interface Collection {
  id: string;
  name: string;
  is_default: boolean;
  item_count: number;
}

interface CollectionItem {
  note: {
    id: string;
    title: string;
    content: NoteContent;
    tags: string[];
    exam_type: string | null;
    topic: string | null;
    source_type: string | null;
  };
  is_reference: boolean;
  is_owner: boolean;
  curated: boolean;
  kind: "guide" | "card" | "community";
  review?: NoteReview | null;
}

/** A list item as the Library review dialog takes it. */
export interface ListPracticeNote {
  id: string;
  title: string;
  content: NoteContent;
  is_owner: boolean;
}

export default function CollectionsPanel({
  lang,
  exploreEnabled = false,
  onPractice,
}: {
  lang: Lang;
  /** Explore wording only while NOTES_EXPLORE_ENABLED is on. */
  exploreEnabled?: boolean;
  /** Opens the Library review dialog with this list's notes. */
  onPractice?: (notes: ListPracticeNote[], opener: HTMLElement | null) => void;
}) {
  const toast = useToast();
  const [collections, setCollections] = useState<Collection[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState(false);
  const [open, setOpen] = useState<Collection | null>(null);
  const [items, setItems] = useState<CollectionItem[] | null>(null);
  const [itemsLoading, setItemsLoading] = useState(false);
  const [itemsError, setItemsError] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState<Collection | null>(null);
  const [deleting, setDeleting] = useState(false);

  const fail = useCallback((action: ListAction, status: number | null) => {
    const failure = listFailure(action, status, lang);
    toast.error(failure.title, failure.body);
  }, [lang, toast]);

  const [newName, setNewName] = useState("");
  const [creating, setCreating] = useState(false);
  const [renamingId, setRenamingId] = useState<string | null>(null);
  const [renameVal, setRenameVal] = useState("");

  const [readerNote, setReaderNote] = useState<ReaderNote | null>(null);
  const [readerOpen, setReaderOpen] = useState(false);

  // A failed read keeps the last good lists and shows retry; it never turns
  // into an empty state.
  const loadCollections = useCallback(async () => {
    setLoading(true);
    setLoadError(false);
    try {
      const res = await fetch("/api/notes/collections", { signal: AbortSignal.timeout(10_000) });
      const d = res.ok ? await res.json() : null;
      if (!Array.isArray(d?.collections)) throw new Error(String(res.status));
      setCollections(d.collections);
    } catch {
      setLoadError(true);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    loadCollections();
  }, [loadCollections]);

  const openCollection = async (c: Collection) => {
    setOpen(c);
    setItems(null);
    setItemsLoading(true);
    setItemsError(false);
    try {
      const res = await fetch(`/api/notes/collections/${c.id}`, { signal: AbortSignal.timeout(10_000) });
      const d = res.ok ? await res.json() : null;
      if (!Array.isArray(d?.items)) throw new Error(String(res.status));
      setItems(d.items);
    } catch {
      setItemsError(true);
    } finally {
      setItemsLoading(false);
    }
  };

  const createList = async () => {
    const name = newName.trim();
    if (!name || creating) return;
    setCreating(true);
    try {
      const res = await fetch("/api/notes/collections", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name }),
      });
      const d = res.ok ? await res.json() : null;
      if (d?.collection) {
        setNewName("");
        setCollections((c) => [...c, d.collection].sort((a, b) => Number(b.is_default) - Number(a.is_default)));
        toast.success(tl("lists_created", lang));
      } else {
        fail("create", res.status);
      }
    } catch {
      fail("create", null);
    } finally {
      setCreating(false);
    }
  };

  const rename = async (id: string) => {
    const name = renameVal.trim();
    if (!name) return;
    try {
      const res = await fetch(`/api/notes/collections/${id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name }),
      });
      if (res.ok) {
        setCollections((cs) => cs.map((c) => (c.id === id ? { ...c, name } : c)));
        if (open?.id === id) setOpen({ ...open, name });
        setRenamingId(null);
        toast.success(tl("list_renamed", lang));
      } else {
        fail("rename", res.status);
      }
    } catch {
      fail("rename", null);
    }
  };

  // STU-56 / UX-GLOBAL-14: confirmed in the shared ConfirmAction, never
  // window.confirm. A deleted list cannot be restored, so there is no undo.
  const remove = async () => {
    const c = confirmDelete;
    if (!c || deleting) return;
    setDeleting(true);
    try {
      const res = await fetch(`/api/notes/collections/${c.id}`, { method: "DELETE" });
      if (res.ok) {
        setCollections((cs) => cs.filter((x) => x.id !== c.id));
        if (open?.id === c.id) setOpen(null);
        setConfirmDelete(null);
        toast.success(tl("list_deleted", lang));
      } else {
        fail("delete", res.status);
      }
    } catch {
      fail("delete", null);
    } finally {
      setDeleting(false);
    }
  };

  const deleteDialog = (
    <ConfirmAction
      open={!!confirmDelete}
      onOpenChange={(value) => { if (!value && !deleting) setConfirmDelete(null); }}
      title={tl("list_delete_title", lang, { name: confirmDelete?.name ?? "" })}
      consequence={tl("list_delete_body", lang)}
      confirmLabel={tl("delete_confirm", lang)}
      cancelLabel={tl("cancel", lang)}
      pendingLabel={tl("delete_pending", lang)}
      destructive
      pending={deleting}
      onConfirm={() => void remove()}
    />
  );

  const openReader = (it: CollectionItem) => {
    setReaderNote({
      id: it.note.id,
      title: it.note.title,
      content: it.note.content,
      tags: it.note.tags,
      exam_type: it.note.exam_type,
      topic: it.note.topic,
      curated: it.curated,
      kind: it.kind,
      review: it.review ?? null,
      is_owner: it.is_owner,
    });
    setReaderOpen(true);
  };

  // ── A single collection's contents ──────────────────────────────────────
  if (open) {
    return (
      <div>
        <button
          type="button"
          onClick={() => {
            setOpen(null);
            setItems(null);
          }}
          className="inline-flex items-center gap-1.5 text-sm font-semibold text-[var(--mp-fg-muted)] hover:text-[var(--mp-fg)] mb-3"
        >
          <ArrowLeft className="w-4 h-4" />
          {tl("lists_all", lang)}
        </button>

        <div className="flex flex-wrap items-center gap-2 mb-3">
          {open.is_default ? (
            <Star className="w-5 h-5 text-[var(--mp-status-warning)]" aria-hidden />
          ) : (
            <FolderOpen className="w-5 h-5 text-[var(--mp-viridian)]" aria-hidden />
          )}
          <h2 className="font-display font-bold text-lg text-[var(--mp-fg)] flex-1 min-w-0">{open.name}</h2>
          {onPractice && items && items.length > 0 && (
            <button
              type="button"
              className="mp-btn mp-btn--secondary min-h-11 focus-ring"
              onClick={(event) => onPractice(
                items.map((it) => ({ id: it.note.id, title: it.note.title, content: { ...it.note.content, blocks: it.note.content?.blocks ?? [] }, is_owner: it.is_owner })),
                event.currentTarget,
              )}
            >
              <GraduationCap className="w-4 h-4" aria-hidden />
              {tl("list_practice", lang)}
            </button>
          )}
        </div>

        {itemsLoading ? (
          <div className="flex items-center justify-center py-16">
            <BrandedLoader />
          </div>
        ) : itemsError ? (
          <Alert variant="error" title={tl("list_load_error", lang)}>
            <button type="button" className="mp-btn mp-btn--secondary min-h-11 mt-2 focus-ring" onClick={() => void openCollection(open)}>
              {tl("retry", lang)}
            </button>
          </Alert>
        ) : !items || items.length === 0 ? (
          <div className="max-w-md mx-auto py-8">
            <EmptyState
              icon={<Folder className="w-10 h-10" aria-hidden />}
              title={tl("list_empty_title", lang)}
              body={exploreEnabled ? `${tl("list_empty_body", lang)} ${tl("list_empty_explore", lang)}` : tl("list_empty_body", lang)}
            />
          </div>
        ) : (
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
            {items.map((it) => {
              const firstBlock = it.note.content?.blocks?.[0];
              const preview = firstBlock
                ? firstBlock.type === "concept"
                  ? firstBlock.back || firstBlock.front
                  : firstBlock.text
                : "";
              return (
                <button
                  key={it.note.id}
                  type="button"
                  onClick={() => openReader(it)}
                  className="group text-left rounded-[var(--mp-r-card)] bg-[var(--mp-surface)] border border-[var(--mp-border-soft)] hover:border-[var(--mp-border)] shadow-[var(--mp-shadow-card)] hover:shadow-[var(--mp-shadow-elev)] transition-all p-4 flex flex-col gap-2 min-h-[148px] focus-ring"
                >
                  <div className="flex items-center justify-between gap-2">
                    <SourceBadge curated={it.curated} kind={it.kind} lang={lang} review={it.review} />
                    {it.is_reference && (
                      <span className="text-xs text-[var(--mp-fg-subtle)]">
                        {tl("list_saved_ref", lang)}
                      </span>
                    )}
                  </div>
                  <p dir="auto" className="font-display font-bold text-[var(--mp-fg)] leading-snug line-clamp-2">
                    {it.note.title || tl("untitled", lang)}
                  </p>
                  {preview && (
                    <p dir="auto" className="text-[13px] text-[var(--mp-fg-muted)] leading-relaxed line-clamp-2 flex-1">
                      {preview}
                    </p>
                  )}
                  <div className="flex items-center justify-end mt-auto pt-1">
                    <span className="inline-flex items-center gap-1 text-[11px] font-semibold text-[var(--mp-viridian)]">
                      <Layers className="w-3.5 h-3.5" />
                      {it.note.content?.blocks?.length ?? 0}
                    </span>
                  </div>
                </button>
              );
            })}
          </div>
        )}

        <NoteReader
          note={readerNote}
          lang={lang}
          open={readerOpen}
          onOpenChange={setReaderOpen}
          onSavedChange={() => open && openCollection(open)}
        />
        {deleteDialog}
      </div>
    );
  }

  // ── The list of collections ──────────────────────────────────────────────
  return (
    <div>
      {/* Create a new list */}
      <div className="flex items-center gap-2 mb-4">
        <div className="relative flex-1">
          <ListPlus className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-[var(--mp-fg-subtle)]" />
          <input
            type="text"
            value={newName}
            onChange={(e) => setNewName(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter") createList();
            }}
            maxLength={80}
            aria-label={tl("lists_new_label", lang)}
            placeholder={tl("lists_new_placeholder", lang)}
            className="w-full min-h-11 pl-9 pr-3 py-2.5 rounded-[var(--mp-r-card)] bg-[var(--mp-surface)] border border-[var(--mp-border-soft)] text-[var(--mp-fg)] text-sm focus:outline-none focus:border-[var(--mp-viridian)]"
          />
        </div>
        <button
          type="button"
          onClick={createList}
          disabled={creating || !newName.trim()}
          className="mp-btn mp-btn--primary min-h-11 inline-flex items-center gap-1.5 disabled:opacity-50"
        >
          {creating ? <Loader2 className="w-4 h-4 animate-spin" aria-hidden /> : <Plus className="w-4 h-4" aria-hidden />}
          {tl("lists_create", lang)}
        </button>
      </div>

      {loadError && (
        <Alert variant="error" title={tl("lists_load_error", lang)} className="mb-3">
          <button type="button" className="mp-btn mp-btn--secondary min-h-11 mt-2 focus-ring" disabled={loading} onClick={() => void loadCollections()}>
            {tl("retry", lang)}
          </button>
        </Alert>
      )}
      {loading && collections.length === 0 ? (
        <div className="flex items-center justify-center py-16">
          <BrandedLoader />
        </div>
      ) : loadError && collections.length === 0 ? null : collections.length === 0 ? (
        <div className="max-w-md mx-auto py-8">
          <EmptyState
            icon={<Folder className="w-10 h-10" aria-hidden />}
            title={tl("lists_empty_title", lang)}
            body={exploreEnabled ? `${tl("lists_empty_body", lang)} ${tl("lists_empty_explore", lang)}` : tl("lists_empty_body", lang)}
          />
        </div>
      ) : (
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
          {collections.map((c) => (
            <div
              key={c.id}
              className="rounded-[var(--mp-r-card)] bg-[var(--mp-surface)] border border-[var(--mp-border-soft)] shadow-[var(--mp-shadow-card)] p-3.5 flex items-center gap-3"
            >
              <span
                className={`w-10 h-10 rounded-xl flex items-center justify-center flex-shrink-0 ${
                  c.is_default
                    ? "bg-[var(--mp-status-warning)]/12 text-[var(--mp-status-warning)]"
                    : "bg-[var(--mp-viridian)]/12 text-[var(--mp-viridian)]"
                }`}
              >
                {c.is_default ? <Star className="w-5 h-5" /> : <Folder className="w-5 h-5" />}
              </span>

              {renamingId === c.id ? (
                <div className="flex-1 flex items-center gap-1.5 min-w-0">
                  <input
                    type="text"
                    value={renameVal}
                    onChange={(e) => setRenameVal(e.target.value)}
                    onKeyDown={(e) => {
                      if (e.key === "Enter") rename(c.id);
                      if (e.key === "Escape") setRenamingId(null);
                    }}
                    autoFocus
                    maxLength={80}
                    className="flex-1 min-w-0 text-sm px-2 py-1.5 rounded-lg bg-[var(--mp-surface-sunken)] border border-[var(--mp-border-soft)] text-[var(--mp-fg)] focus:outline-none focus:border-[var(--mp-viridian)]"
                  />
                  <IconButton
                    label={tl("list_save_name", lang)}
                    icon={<Check className="w-4 h-4 text-[var(--mp-viridian)]" aria-hidden />}
                    onClick={() => rename(c.id)}
                  />
                  <IconButton
                    label={tl("cancel", lang)}
                    icon={<X className="w-4 h-4" aria-hidden />}
                    onClick={() => setRenamingId(null)}
                  />
                </div>
              ) : (
                <>
                  <button
                    type="button"
                    onClick={() => openCollection(c)}
                    className="flex-1 min-w-0 text-left"
                  >
                    <p className="font-semibold text-[var(--mp-fg)] truncate">{c.name}</p>
                    <p className="text-[13px] text-[var(--mp-fg-muted)]">
                      {noteCount(c.item_count, lang)}
                    </p>
                  </button>
                  <div className="flex items-center flex-shrink-0">
                    <IconButton
                      label={`${tl("list_rename", lang)}: ${c.name}`}
                      icon={<Pencil className="w-4 h-4" aria-hidden />}
                      onClick={() => {
                        setRenamingId(c.id);
                        setRenameVal(c.name);
                      }}
                    />
                    <IconButton
                      label={`${tl("list_delete", lang)}: ${c.name}`}
                      icon={<Trash2 className="w-4 h-4" aria-hidden />}
                      onClick={() => setConfirmDelete(c)}
                    />
                    <IconButton
                      label={`${tl("list_open", lang)}: ${c.name}`}
                      icon={<ChevronRight className="w-4 h-4" aria-hidden />}
                      onClick={() => openCollection(c)}
                    />
                  </div>
                </>
              )}
            </div>
          ))}
        </div>
      )}
      {deleteDialog}
    </div>
  );
}
