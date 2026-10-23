"use client";

/**
 * Own-note actions for the Library (UX-STU-51, pick-ux-stu-51 B):
 * a 44 px three-dot menu (Bearbeiten, Löschen, Fehlerhafte Lernnotiz melden)
 * on every owned card and in the reader, the edit dialog (existing PATCH), the
 * delete confirm (existing DELETE, ui ConfirmAction) and the free allowance
 * meter. Deleting is irreversible (the review schedule and list entries go
 * with the note), so it confirms instead of offering an undo; for free
 * accounts the confirm states that a deleted note does not return a slot.
 *
 * Strings: src/lib/i18n-library.ts (Sie, English fallback). No em dashes.
 */

import { useEffect, useId, useRef, useState, type KeyboardEvent } from "react";
import Link from "next/link";
import { MoreVertical, Pencil, Trash2, Flag } from "lucide-react";
import { authFetch as fetch } from "@/lib/authFetch";
import { ConfirmAction, Dialog, DialogFooter, Button, IconButton, TextField, Textarea, Alert } from "@/components/ui";
import { tl, meterState, remainingLine } from "@/lib/i18n-library";
import type { NoteAllowance } from "@/lib/notes-cap";
import type { NoteBlock, NoteContent } from "@/lib/notes";

/* ─── Three-dot menu ───────────────────────────────────────────────── */
export function NoteActionsMenu({
  title,
  lang,
  canDelete,
  onEdit,
  onDelete,
  onReport,
  className = "",
}: {
  title: string;
  lang: string;
  /** False for free accounts while lifetime counting is not live. */
  canDelete: boolean;
  onEdit: () => void;
  onDelete: () => void;
  /** Absent while the Support-Chat cannot open: the report row is hidden. */
  onReport?: () => void;
  className?: string;
}) {
  const [open, setOpen] = useState(false);
  const menuId = useId();
  const triggerRef = useRef<HTMLButtonElement>(null);
  const menuRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    menuRef.current?.querySelector<HTMLButtonElement>('[role="menuitem"]')?.focus();
    const onDown = (event: PointerEvent) => {
      const target = event.target as Node;
      if (!menuRef.current?.contains(target) && !triggerRef.current?.contains(target)) setOpen(false);
    };
    document.addEventListener("pointerdown", onDown);
    return () => document.removeEventListener("pointerdown", onDown);
  }, [open]);

  const close = (refocus = true) => {
    setOpen(false);
    if (refocus) requestAnimationFrame(() => triggerRef.current?.focus());
  };
  const run = (action: () => void) => {
    setOpen(false);
    action();
  };
  const onMenuKey = (event: KeyboardEvent<HTMLDivElement>) => {
    const items = Array.from(menuRef.current?.querySelectorAll<HTMLButtonElement>('[role="menuitem"]') ?? []);
    const index = items.indexOf(document.activeElement as HTMLButtonElement);
    if (event.key === "Escape") {
      event.preventDefault();
      event.stopPropagation();
      close();
    } else if (event.key === "ArrowDown" || event.key === "ArrowUp") {
      event.preventDefault();
      const next = event.key === "ArrowDown" ? (index + 1) % items.length : (index - 1 + items.length) % items.length;
      items[next]?.focus();
    } else if (event.key === "Home" || event.key === "End") {
      event.preventDefault();
      items[event.key === "Home" ? 0 : items.length - 1]?.focus();
    } else if (event.key === "Tab") {
      close(false);
    }
  };

  const item = "flex w-full min-h-11 items-center gap-2 rounded-lg px-3 text-left text-sm text-[var(--mp-fg)] hover:bg-[var(--mp-surface-sunken)] focus-ring";
  return (
    <div className={`relative ${className}`}>
      <IconButton
        ref={triggerRef}
        label={tl("menu_label", lang, { title: title || tl("untitled", lang) })}
        icon={<MoreVertical className="h-4 w-4" aria-hidden />}
        aria-haspopup="menu"
        aria-expanded={open}
        aria-controls={open ? menuId : undefined}
        onClick={(event) => {
          event.stopPropagation();
          setOpen((value) => !value);
        }}
      />
      {open && (
        <div
          ref={menuRef}
          id={menuId}
          role="menu"
          aria-label={tl("menu_label", lang, { title: title || tl("untitled", lang) })}
          onKeyDown={onMenuKey}
          className="absolute right-0 top-full z-[70] mt-1 w-60 rounded-[var(--mp-r-card)] border border-[var(--mp-border)] bg-[var(--mp-surface-raised)] p-1 shadow-[var(--mp-shadow-elev)]"
        >
          <button type="button" role="menuitem" className={item} onClick={() => run(onEdit)}>
            <Pencil className="h-4 w-4 text-[var(--mp-fg-muted)]" aria-hidden />
            {tl("menu_edit", lang)}
          </button>
          {canDelete && (
            <button type="button" role="menuitem" className={`${item} text-[var(--mp-error-text)]`} onClick={() => run(onDelete)}>
              <Trash2 className="h-4 w-4" aria-hidden />
              {tl("menu_delete", lang)}
            </button>
          )}
          {onReport && (
            <button type="button" role="menuitem" className={item} onClick={() => run(onReport)}>
              <Flag className="h-4 w-4 text-[var(--mp-fg-muted)]" aria-hidden />
              {tl("menu_report", lang)}
            </button>
          )}
        </div>
      )}
    </div>
  );
}

/* ─── Edit dialog (existing PATCH /api/notes/[id]) ─────────────────── */
export interface EditableNote {
  id: string;
  title: string;
  content: NoteContent;
}

function blockLabel(block: NoteBlock, lang: string): string {
  if (block.type === "keyfact") return tl("block_keyfact", lang);
  if (block.type === "pitfall") return tl("block_pitfall", lang);
  if (block.type === "mnemonic") return tl("block_mnemonic", lang);
  return "";
}

/** True when the edited note still has a title or any block text. */
export function hasEditableContent(title: string, blocks: NoteBlock[]): boolean {
  if (title.trim()) return true;
  return blocks.some((block) => (block.type === "concept" ? `${block.front}${block.back}` : block.text).trim().length > 0);
}

export function EditNoteDialog<T extends EditableNote>({
  note,
  lang,
  onClose,
  onSaved,
}: {
  note: T | null;
  lang: string;
  onClose: () => void;
  onSaved: (updated: T) => void;
}) {
  const [title, setTitle] = useState("");
  const [blocks, setBlocks] = useState<NoteBlock[]>([]);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const busy = useRef(false);
  // Keep the last note so the Dialog sees open flip to false and returns
  // focus to the menu trigger (UX-STU-50 focus contract).
  const lastNote = useRef<T | null>(null);
  if (note) lastNote.current = note;
  const shown = note ?? lastNote.current;

  useEffect(() => {
    if (!note) return;
    setTitle(note.title ?? "");
    setBlocks((note.content?.blocks ?? []).map((block) => ({ ...block })));
    setError(null);
  }, [note]);

  if (!shown) return null;
  const valid = hasEditableContent(title, blocks);
  const patchBlock = (index: number, patch: Partial<NoteBlock>) =>
    setBlocks((list) => list.map((block, i) => (i === index ? ({ ...block, ...patch } as NoteBlock) : block)));

  const save = async () => {
    if (busy.current) return;
    if (!valid) {
      setError(tl("edit_empty", lang));
      return;
    }
    busy.current = true;
    setSaving(true);
    setError(null);
    try {
      const content = { ...shown.content, title: title.trim(), blocks };
      const res = await fetch(`/api/notes/${shown.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ content, title: title.trim() }),
        signal: AbortSignal.timeout(15_000),
      });
      const data = await res.json().catch(() => null);
      if (!res.ok || !data?.note) throw new Error(String(res.status));
      onSaved({ ...shown, ...data.note });
    } catch {
      setError(tl("edit_error", lang));
    } finally {
      busy.current = false;
      setSaving(false);
    }
  };

  return (
    <Dialog
      open={!!note}
      onOpenChange={(open) => { if (!open && !busy.current) onClose(); }}
      title={tl("edit_title", lang)}
      kind="form"
      busy={saving}
      maxWidth="640px"
      footer={
        <DialogFooter>
          <Button variant="secondary" data-dialog-safe onClick={onClose} disabled={saving}>{tl("cancel", lang)}</Button>
          <Button variant="primary" data-dialog-primary onClick={() => void save()} loading={saving}>
            {saving ? tl("edit_pending", lang) : tl("edit_save", lang)}
          </Button>
        </DialogFooter>
      }
    >
      <form
        className="space-y-3"
        onSubmit={(event) => { event.preventDefault(); void save(); }}
      >
        <TextField label={tl("edit_field_title", lang)} value={title} maxLength={200} dir="auto" onChange={(event) => setTitle(event.target.value)} />
        {blocks.map((block, i) =>
          block.type === "concept" ? (
            <div key={i} className="space-y-2 rounded-[var(--mp-r-card)] bg-[var(--mp-surface-sunken)] p-3">
              <Textarea label={tl("edit_front", lang)} value={block.front} rows={2} maxLength={2000} dir="auto" onChange={(event) => patchBlock(i, { front: event.target.value })} />
              <Textarea label={tl("edit_back", lang)} value={block.back} rows={3} maxLength={2000} dir="auto" onChange={(event) => patchBlock(i, { back: event.target.value })} />
            </div>
          ) : (
            <Textarea key={i} label={blockLabel(block, lang)} value={block.text} rows={3} maxLength={2000} dir="auto" onChange={(event) => patchBlock(i, { text: event.target.value })} />
          ),
        )}
        {error && <Alert variant="error">{error}</Alert>}
      </form>
    </Dialog>
  );
}

/* ─── Delete confirm (existing DELETE /api/notes/[id]) ────────────── */
export type DeleteOutcome = "deleted" | "unavailable" | "failed";

/** Map a DELETE response to the learner outcome. */
export async function deleteOutcome(res: Response | null): Promise<DeleteOutcome> {
  if (!res) return "failed";
  if (res.ok) return "deleted";
  if (res.status === 503) {
    const data = await res.json().catch(() => null);
    if (data?.code === "NOTE_DELETE_UNAVAILABLE") return "unavailable";
  }
  return "failed";
}

export function DeleteNoteConfirm({
  open,
  lang,
  cap,
  pending,
  onOpenChange,
  onConfirm,
}: {
  open: boolean;
  lang: string;
  /** The free allowance; null for paid accounts. */
  cap: NoteAllowance | null;
  pending: boolean;
  onOpenChange: (open: boolean) => void;
  onConfirm: () => void;
}) {
  const consequence = cap
    ? `${tl("delete_body", lang)} ${tl("delete_body_free", lang, { limit: cap.limit })}`
    : tl("delete_body", lang);
  return (
    <ConfirmAction
      open={open}
      onOpenChange={onOpenChange}
      title={tl("delete_title", lang)}
      consequence={consequence}
      confirmLabel={tl("delete_confirm", lang)}
      cancelLabel={tl("cancel", lang)}
      pendingLabel={tl("delete_pending", lang)}
      destructive
      pending={pending}
      onConfirm={() => onConfirm()}
    />
  );
}

/* ─── Free allowance meter (UX-STU-51) ────────────────────────────── */
export function NoteAllowanceMeter({ cap, lang, className = "" }: { cap: NoteAllowance | null; lang: string; className?: string }) {
  if (!cap) return null;
  const used = Math.min(cap.used, cap.limit);
  const state = meterState(cap.used, cap.limit);
  const pct = cap.limit > 0 ? Math.round((used / cap.limit) * 100) : 0;
  return (
    <div className={`max-w-md ${className}`}>
      <div className="flex items-baseline justify-between gap-2">
        <span className="text-sm text-[var(--mp-fg-muted)]">{tl("meter_label", lang)}</span>
        <span className="text-sm font-semibold text-[var(--mp-fg)] tabular-nums">{tl("meter", lang, { used, limit: cap.limit })}</span>
      </div>
      <div
        role="meter"
        aria-label={tl("meter_label", lang)}
        aria-valuemin={0}
        aria-valuemax={cap.limit}
        aria-valuenow={used}
        aria-valuetext={tl("meter", lang, { used, limit: cap.limit })}
        className="mt-1 h-1 w-full overflow-hidden rounded-full bg-[var(--mp-surface-sunken)]"
      >
        <div className="h-full rounded-full bg-[var(--mp-fg-subtle)]" style={{ width: `${pct}%` }} />
      </div>
      {state !== "calm" && (
        <p className="mt-1 text-xs text-[var(--mp-fg-muted)]">
          {state === "full" ? tl("meter_full", lang, { limit: cap.limit }) : remainingLine(cap.limit - cap.used, lang)}{" "}
          <Link href="/pricing?gate=notes" className="font-semibold text-[var(--mp-accent-text)] underline underline-offset-2">
            {tl("meter_plans", lang)}
          </Link>
        </p>
      )}
    </div>
  );
}
