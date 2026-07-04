"use client";

/**
 * NoteReader — a shared, read-in-place viewer for any flash-note (Explore
 * public note, a saved collection item, or one of the user's own notes).
 *
 * EXP-1 §2: an Explore note must be openable/readable directly, WITHOUT
 * importing. This is that reader. It renders the note's title + blocks
 * (concept / keyfact / pitfall / mnemonic) straight, inside an accessible
 * <BottomSheet> — no flip-to-reveal (that is a study interaction, wrong for
 * "just read it").
 *
 * Labeling (EXP-1 §1): curated MedPrüf-Team content shows a "MedPrüf Team"
 * verified badge. Genuine community notes show a neutral "Community" chip.
 * NEVER "unverified".
 *
 * Actions:
 *   - Save to my Library (EXP-1 §4): a lightweight reference-save into a
 *     collection (default "Saved", or pick a list). NOT a clone. Foreign
 *     public notes are Pro-gated (402 → upsell); own notes save freely.
 *   - Report (public foreign notes only) → the admin moderation queue.
 *
 * Strings are inlined de/en to match the Library page convention (getLang,
 * de/en-narrow). No em dashes.
 */

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { authFetch as fetch } from "@/lib/authFetch";
import { BottomSheet, useToast } from "@/components/ui";
import type { NoteBlock } from "@/lib/notes";
import {
  BadgeCheck,
  Users,
  Lightbulb,
  AlertTriangle,
  Brain,
  Bookmark,
  BookmarkCheck,
  Loader2,
  Flag,
  ChevronDown,
  Plus,
  Check,
  Crown,
} from "lucide-react";

type Lang = "de" | "en";

export interface ReaderNote {
  id: string;
  title: string;
  content: { title?: string; blocks?: NoteBlock[]; refs?: { label: string }[] };
  tags?: string[];
  exam_type?: string | null;
  topic?: string | null;
  /** Curated MedPrüf-Team content (verified). */
  curated?: boolean;
  /** Presentation kind — guide | card | community. */
  kind?: "guide" | "card" | "community";
  /** True when the caller authored this note (own note, never Pro-gated to save). */
  is_owner?: boolean;
}

interface Collection {
  id: string;
  name: string;
  is_default: boolean;
  item_count: number;
}

const REPORT_REASONS: { key: string; de: string; en: string }[] = [
  { key: "pii", de: "Persönliche Daten", en: "Personal data" },
  { key: "wrong", de: "Medizinisch falsch", en: "Medically wrong" },
  { key: "spam", de: "Spam", en: "Spam" },
  { key: "copyright", de: "Urheberrecht", en: "Copyright" },
  { key: "other", de: "Sonstiges", en: "Other" },
];

/* ─── Block rendering (straight, no flip) ─────────────────────────── */
function ReaderBlock({ block, lang }: { block: NoteBlock; lang: Lang }) {
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

/** The verified / community source badge — the fix for the "unverified" bug. */
export function SourceBadge({
  curated,
  kind,
  lang,
}: {
  curated?: boolean;
  kind?: "guide" | "card" | "community";
  lang: Lang;
}) {
  const de = lang === "de";
  if (curated) {
    const label = kind === "guide" ? (de ? "MedPrüf Team · Leitfaden" : "MedPrüf Team · Guide") : "MedPrüf Team";
    return (
      <span className="inline-flex items-center gap-1 text-[10px] font-bold uppercase tracking-wide px-2 py-0.5 rounded-full bg-[var(--mp-viridian)]/12 text-[var(--mp-viridian)] self-start">
        <BadgeCheck className="w-3 h-3" />
        {label}
      </span>
    );
  }
  return (
    <span className="inline-flex items-center gap-1 text-[10px] font-bold uppercase tracking-wide px-2 py-0.5 rounded-full bg-[var(--mp-cta-blue)]/12 text-[var(--mp-cta-blue)] self-start">
      <Users className="w-3 h-3" />
      {de ? "Community" : "Community"}
    </span>
  );
}

export default function NoteReader({
  note,
  lang,
  open,
  onOpenChange,
  onSavedChange,
}: {
  note: ReaderNote | null;
  lang: Lang;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** Called after a successful save/unsave so a parent list can refresh. */
  onSavedChange?: () => void;
}) {
  const toast = useToast();
  const de = lang === "de";
  const [collections, setCollections] = useState<Collection[]>([]);
  const [savedIn, setSavedIn] = useState<Set<string>>(new Set());
  const [busy, setBusy] = useState<string | null>(null);
  const [pickerOpen, setPickerOpen] = useState(false);
  const [newListName, setNewListName] = useState("");
  const [creating, setCreating] = useState(false);
  const [reportOpen, setReportOpen] = useState(false);
  const [reported, setReported] = useState(false);

  const isOwner = !!note?.is_owner;

  const loadState = useCallback(async () => {
    if (!note) return;
    try {
      const [colsRes, savedRes] = await Promise.all([
        fetch("/api/notes/collections"),
        fetch(`/api/notes/${note.id}/save`),
      ]);
      const colsData = colsRes.ok ? await colsRes.json() : null;
      const savedData = savedRes.ok ? await savedRes.json() : null;
      setCollections(Array.isArray(colsData?.collections) ? colsData.collections : []);
      setSavedIn(new Set(Array.isArray(savedData?.collection_ids) ? savedData.collection_ids : []));
    } catch {
      /* non-blocking */
    }
  }, [note]);

  useEffect(() => {
    if (open && note) {
      setPickerOpen(false);
      setReportOpen(false);
      setReported(false);
      setNewListName("");
      loadState();
    }
  }, [open, note, loadState]);

  const savedAnywhere = savedIn.size > 0;

  const saveToDefault = async () => {
    if (!note || busy) return;
    setBusy("default");
    try {
      const res = await fetch(`/api/notes/${note.id}/save`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ lang }),
      });
      const d = await res.json().catch(() => ({}));
      if (res.ok) {
        if (d.collection_id) setSavedIn((s) => new Set(s).add(d.collection_id));
        toast.success(de ? "Gespeichert" : "Saved", de ? "In deiner Bibliothek." : "In your Library.");
        onSavedChange?.();
        await loadState();
      } else if (res.status === 402) {
        toast.error(
          de ? "Pro-Funktion" : "Pro feature",
          de ? "Community-Notizen speichern ist Teil von Pro." : "Saving community notes is part of Pro.",
        );
      } else {
        toast.error(de ? "Fehler" : "Error");
      }
    } catch {
      toast.error(de ? "Fehler" : "Error");
    } finally {
      setBusy(null);
    }
  };

  const toggleInCollection = async (collectionId: string) => {
    if (!note || busy) return;
    setBusy(collectionId);
    const isIn = savedIn.has(collectionId);
    try {
      if (isIn) {
        const res = await fetch(
          `/api/notes/${note.id}/save?collection_id=${collectionId}`,
          { method: "DELETE" },
        );
        if (res.ok) {
          setSavedIn((s) => {
            const n = new Set(s);
            n.delete(collectionId);
            return n;
          });
          onSavedChange?.();
        } else {
          toast.error(de ? "Fehler" : "Error");
        }
      } else {
        const res = await fetch(`/api/notes/${note.id}/save`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ collection_id: collectionId, lang }),
        });
        if (res.ok) {
          setSavedIn((s) => new Set(s).add(collectionId));
          onSavedChange?.();
        } else if (res.status === 402) {
          toast.error(
            de ? "Pro-Funktion" : "Pro feature",
            de ? "Community-Notizen speichern ist Teil von Pro." : "Saving community notes is part of Pro.",
          );
        } else {
          toast.error(de ? "Fehler" : "Error");
        }
      }
    } catch {
      toast.error(de ? "Fehler" : "Error");
    } finally {
      setBusy(null);
      await loadState();
    }
  };

  const createList = async () => {
    const name = newListName.trim();
    if (!name || !note || creating) return;
    setCreating(true);
    try {
      const res = await fetch("/api/notes/collections", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name }),
      });
      const d = await res.json().catch(() => ({}));
      if (res.ok && d.collection?.id) {
        setNewListName("");
        setCollections((c) => [d.collection, ...c]);
        // immediately add the note to the new list
        await toggleInCollection(d.collection.id);
      } else {
        toast.error(de ? "Fehler" : "Error");
      }
    } catch {
      toast.error(de ? "Fehler" : "Error");
    } finally {
      setCreating(false);
    }
  };

  const report = async (reason: string) => {
    if (!note) return;
    setReportOpen(false);
    try {
      await fetch(`/api/notes/${note.id}/report`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ reason }),
      });
      setReported(true);
      toast.success(de ? "Gemeldet" : "Reported", de ? "Danke, wir prüfen das." : "Thanks, we'll review it.");
    } catch {
      toast.error(de ? "Fehler" : "Error");
    }
  };

  if (!note) return null;
  const blocks = note.content?.blocks ?? [];
  const refs = note.content?.refs ?? [];
  const canReport = !isOwner && (note.kind === "community" || note.curated === false);

  const footer = (
    <div className="p-3 space-y-2">
      <div className="flex items-center gap-2">
        <button
          type="button"
          onClick={saveToDefault}
          disabled={busy === "default"}
          className={`inline-flex items-center gap-1.5 flex-1 justify-center px-3 py-2.5 rounded-[var(--mp-r-card)] text-sm font-semibold transition-colors disabled:opacity-60 ${
            savedAnywhere
              ? "bg-[var(--mp-viridian)]/12 text-[var(--mp-viridian)]"
              : "bg-[var(--mp-viridian)] text-white hover:opacity-90"
          }`}
        >
          {busy === "default" ? (
            <Loader2 className="w-4 h-4 animate-spin" />
          ) : savedAnywhere ? (
            <BookmarkCheck className="w-4 h-4" />
          ) : (
            <Bookmark className="w-4 h-4" />
          )}
          {savedAnywhere
            ? de ? "In Bibliothek" : "In Library"
            : de ? "In Bibliothek speichern" : "Save to Library"}
        </button>
        <button
          type="button"
          onClick={() => setPickerOpen((o) => !o)}
          aria-expanded={pickerOpen}
          className="inline-flex items-center gap-1 px-3 py-2.5 rounded-[var(--mp-r-card)] text-sm font-semibold border border-[var(--mp-border-soft)] text-[var(--mp-fg-muted)] hover:text-[var(--mp-fg)] transition-colors"
        >
          {de ? "Liste" : "List"}
          <ChevronDown className={`w-3.5 h-3.5 transition-transform ${pickerOpen ? "rotate-180" : ""}`} />
        </button>
      </div>

      {pickerOpen && (
        <div className="rounded-[var(--mp-r-card)] border border-[var(--mp-border-soft)] bg-[var(--mp-surface-sunken)] p-2 space-y-1 max-h-56 overflow-y-auto">
          {!isOwner && (
            <p className="text-[10px] text-[var(--mp-fg-subtle)] px-1 pb-1 flex items-center gap-1">
              <Crown className="w-3 h-3 text-[var(--mp-status-warning)]" />
              {de ? "Community-Notizen speichern ist Teil von Pro." : "Saving community notes is part of Pro."}
            </p>
          )}
          {collections.length === 0 && (
            <p className="text-xs text-[var(--mp-fg-subtle)] px-1 py-1">
              {de ? "Noch keine Listen." : "No lists yet."}
            </p>
          )}
          {collections.map((c) => {
            const inList = savedIn.has(c.id);
            return (
              <button
                key={c.id}
                type="button"
                onClick={() => toggleInCollection(c.id)}
                disabled={busy === c.id}
                className="w-full flex items-center justify-between gap-2 text-left text-sm px-2 py-1.5 rounded-lg hover:bg-[var(--mp-surface)] text-[var(--mp-fg-muted)] disabled:opacity-60"
              >
                <span className="truncate">{c.name}</span>
                {busy === c.id ? (
                  <Loader2 className="w-3.5 h-3.5 animate-spin flex-shrink-0" />
                ) : inList ? (
                  <Check className="w-3.5 h-3.5 text-[var(--mp-viridian)] flex-shrink-0" />
                ) : (
                  <Plus className="w-3.5 h-3.5 text-[var(--mp-fg-subtle)] flex-shrink-0" />
                )}
              </button>
            );
          })}
          <div className="flex items-center gap-1.5 pt-1">
            <input
              type="text"
              value={newListName}
              onChange={(e) => setNewListName(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter") createList();
              }}
              maxLength={80}
              placeholder={de ? "Neue Liste…" : "New list…"}
              className="flex-1 min-w-0 text-sm px-2 py-1.5 rounded-lg bg-[var(--mp-surface)] border border-[var(--mp-border-soft)] text-[var(--mp-fg)] placeholder-[var(--mp-fg-subtle)] focus:outline-none focus:border-[var(--mp-viridian)]"
            />
            <button
              type="button"
              onClick={createList}
              disabled={creating || !newListName.trim()}
              className="inline-flex items-center gap-1 text-xs font-semibold px-2.5 py-1.5 rounded-lg bg-[var(--mp-viridian)]/12 text-[var(--mp-viridian)] disabled:opacity-50"
            >
              {creating ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Plus className="w-3.5 h-3.5" />}
              {de ? "Erstellen" : "Create"}
            </button>
          </div>
        </div>
      )}

      {canReport && (
        <div className="relative">
          {reported ? (
            <span className="text-xs text-[var(--mp-fg-subtle)] px-1">
              {de ? "Gemeldet" : "Reported"}
            </span>
          ) : (
            <button
              type="button"
              onClick={() => setReportOpen((r) => !r)}
              className="inline-flex items-center gap-1 text-xs text-[var(--mp-fg-subtle)] hover:text-[var(--mp-error)] transition-colors px-1"
            >
              <Flag className="w-3.5 h-3.5" /> {de ? "Melden" : "Report"}
            </button>
          )}
          {reportOpen && (
            <div className="absolute bottom-full left-0 mb-1 w-48 rounded-lg bg-[var(--mp-surface-raised)] border border-[var(--mp-border)] shadow-[var(--mp-shadow-elev)] p-1 z-10">
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
      )}
    </div>
  );

  return (
    <BottomSheet
      open={open}
      onOpenChange={onOpenChange}
      title={note.title || (de ? "Ohne Titel" : "Untitled")}
      description={note.topic || note.exam_type || undefined}
      footer={footer}
    >
      <div dir="auto" className="px-5 py-4 space-y-3">
        <SourceBadge curated={note.curated} kind={note.kind} lang={lang} />

        {blocks.length === 0 && (
          <p className="text-sm text-[var(--mp-fg-muted)]">
            {de ? "Diese Notiz hat keinen Inhalt." : "This note has no content."}
          </p>
        )}
        {blocks.map((b, i) => (
          <ReaderBlock key={i} block={b} lang={lang} />
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

        {(note.tags ?? []).filter((t) => t !== "kuratiert" && t !== "guide").length > 0 && (
          <div className="flex flex-wrap gap-1.5 pt-1 border-t border-[var(--mp-border-soft)] mt-1">
            {(note.tags ?? [])
              .filter((t) => t !== "kuratiert" && t !== "guide")
              .slice(0, 12)
              .map((tag) => (
                <span
                  key={tag}
                  className="text-[10px] text-[var(--mp-fg-subtle)] bg-[var(--mp-surface-sunken)] px-1.5 py-0.5 rounded"
                >
                  #{tag}
                </span>
              ))}
          </div>
        )}

        {isOwner && (
          <Link
            href="/library"
            className="inline-flex items-center gap-1 text-xs font-semibold text-[var(--mp-viridian)] pt-1"
            onClick={() => onOpenChange(false)}
          >
            <BadgeCheck className="w-3.5 h-3.5" />
            {de ? "Deine Notiz" : "Your note"}
          </Link>
        )}
      </div>
    </BottomSheet>
  );
}
