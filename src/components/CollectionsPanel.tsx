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
 * Strings inlined de/en to match the Library page convention. No em dashes.
 */

import { useCallback, useEffect, useState } from "react";
import { authFetch as fetch } from "@/lib/authFetch";
import { BrandedLoader, EmptyState, useToast } from "@/components/ui";
import NoteReader, { SourceBadge, type ReaderNote } from "@/components/NoteReader";
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
}

export default function CollectionsPanel({ lang }: { lang: Lang }) {
  const toast = useToast();
  const de = lang === "de";
  const [collections, setCollections] = useState<Collection[]>([]);
  const [loading, setLoading] = useState(true);
  const [open, setOpen] = useState<Collection | null>(null);
  const [items, setItems] = useState<CollectionItem[] | null>(null);
  const [itemsLoading, setItemsLoading] = useState(false);

  const [newName, setNewName] = useState("");
  const [creating, setCreating] = useState(false);
  const [renamingId, setRenamingId] = useState<string | null>(null);
  const [renameVal, setRenameVal] = useState("");

  const [readerNote, setReaderNote] = useState<ReaderNote | null>(null);
  const [readerOpen, setReaderOpen] = useState(false);

  const loadCollections = useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetch("/api/notes/collections");
      const d = res.ok ? await res.json() : null;
      setCollections(Array.isArray(d?.collections) ? d.collections : []);
    } catch {
      setCollections([]);
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
    try {
      const res = await fetch(`/api/notes/collections/${c.id}`);
      const d = res.ok ? await res.json() : null;
      setItems(Array.isArray(d?.items) ? d.items : []);
    } catch {
      setItems([]);
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
        toast.success(de ? "Liste erstellt" : "List created");
      } else {
        toast.error(de ? "Fehler" : "Error");
      }
    } catch {
      toast.error(de ? "Fehler" : "Error");
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
      } else {
        toast.error(de ? "Fehler" : "Error");
      }
    } catch {
      toast.error(de ? "Fehler" : "Error");
    }
  };

  const remove = async (c: Collection) => {
    if (
      !window.confirm(
        de
          ? `Liste "${c.name}" löschen? Die Notizen bleiben in deiner Bibliothek erhalten.`
          : `Delete list "${c.name}"? The notes stay in your Library.`,
      )
    )
      return;
    try {
      const res = await fetch(`/api/notes/collections/${c.id}`, { method: "DELETE" });
      if (res.ok) {
        setCollections((cs) => cs.filter((x) => x.id !== c.id));
        if (open?.id === c.id) setOpen(null);
        toast.success(de ? "Liste gelöscht" : "List deleted");
      } else {
        toast.error(de ? "Fehler" : "Error");
      }
    } catch {
      toast.error(de ? "Fehler" : "Error");
    }
  };

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
          {de ? "Alle Listen" : "All lists"}
        </button>

        <div className="flex items-center gap-2 mb-3">
          {open.is_default ? (
            <Star className="w-5 h-5 text-[var(--mp-status-warning)]" />
          ) : (
            <FolderOpen className="w-5 h-5 text-[var(--mp-viridian)]" />
          )}
          <h2 className="font-display font-bold text-lg text-[var(--mp-fg)]">{open.name}</h2>
        </div>

        {itemsLoading ? (
          <div className="flex items-center justify-center py-16">
            <BrandedLoader />
          </div>
        ) : !items || items.length === 0 ? (
          <div className="max-w-md mx-auto py-8">
            <EmptyState
              icon={<Folder className="w-10 h-10" aria-hidden />}
              title={de ? "Diese Liste ist leer" : "This list is empty"}
              body={
                de
                  ? "Öffne eine Notiz in Entdecken und speichere sie in diese Liste."
                  : "Open a note in Explore and save it to this list."
              }
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
                    <SourceBadge curated={it.curated} kind={it.kind} lang={lang} />
                    {it.is_reference && (
                      <span className="text-[10px] font-mono text-[var(--mp-fg-subtle)]">
                        {de ? "gespeichert" : "saved"}
                      </span>
                    )}
                  </div>
                  <p dir="auto" className="font-display font-bold text-[var(--mp-fg)] leading-snug line-clamp-2">
                    {it.note.title || (de ? "Ohne Titel" : "Untitled")}
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
            placeholder={de ? "Neue Liste erstellen…" : "Create a new list…"}
            className="w-full pl-9 pr-3 py-2.5 rounded-[var(--mp-r-card)] bg-[var(--mp-surface)] border border-[var(--mp-border-soft)] text-[var(--mp-fg)] text-sm focus:outline-none focus:border-[var(--mp-viridian)]"
          />
        </div>
        <button
          type="button"
          onClick={createList}
          disabled={creating || !newName.trim()}
          className="mp-btn mp-btn--primary inline-flex items-center gap-1.5 disabled:opacity-50"
        >
          {creating ? <Loader2 className="w-4 h-4 animate-spin" /> : <Plus className="w-4 h-4" />}
          {de ? "Erstellen" : "Create"}
        </button>
      </div>

      {loading ? (
        <div className="flex items-center justify-center py-16">
          <BrandedLoader />
        </div>
      ) : collections.length === 0 ? (
        <div className="max-w-md mx-auto py-8">
          <EmptyState
            icon={<Folder className="w-10 h-10" aria-hidden />}
            title={de ? "Noch keine Listen" : "No lists yet"}
            body={
              de
                ? "Erstelle Listen wie „Kardiologie“ oder „Vor der Prüfung“, um deine Notizen zu ordnen. Gespeicherte Explore-Notizen landen automatisch in „Gespeichert“."
                : 'Create lists like "Cardiology" or "Before the exam" to organize your notes. Notes you save from Explore land in "Saved" automatically.'
            }
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
                  <button
                    type="button"
                    onClick={() => rename(c.id)}
                    className="text-[var(--mp-viridian)] p-1"
                    aria-label={de ? "Speichern" : "Save"}
                  >
                    <Check className="w-4 h-4" />
                  </button>
                  <button
                    type="button"
                    onClick={() => setRenamingId(null)}
                    className="text-[var(--mp-fg-subtle)] p-1"
                    aria-label={de ? "Abbrechen" : "Cancel"}
                  >
                    <X className="w-4 h-4" />
                  </button>
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
                      {c.item_count}{" "}
                      {de
                        ? c.item_count === 1
                          ? "Notiz"
                          : "Notizen"
                        : c.item_count === 1
                          ? "note"
                          : "notes"}
                    </p>
                  </button>
                  <div className="flex items-center gap-0.5 flex-shrink-0">
                    <button
                      type="button"
                      onClick={() => {
                        setRenamingId(c.id);
                        setRenameVal(c.name);
                      }}
                      className="p-1.5 text-[var(--mp-fg-subtle)] hover:text-[var(--mp-fg)] transition-colors"
                      aria-label={de ? "Umbenennen" : "Rename"}
                    >
                      <Pencil className="w-3.5 h-3.5" />
                    </button>
                    <button
                      type="button"
                      onClick={() => remove(c)}
                      className="p-1.5 text-[var(--mp-fg-subtle)] hover:text-[var(--mp-error)] transition-colors"
                      aria-label={de ? "Löschen" : "Delete"}
                    >
                      <Trash2 className="w-3.5 h-3.5" />
                    </button>
                    <button
                      type="button"
                      onClick={() => openCollection(c)}
                      className="p-1.5 text-[var(--mp-fg-subtle)] hover:text-[var(--mp-fg)] transition-colors"
                      aria-label={de ? "Öffnen" : "Open"}
                    >
                      <ChevronRight className="w-4 h-4" />
                    </button>
                  </div>
                </>
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
