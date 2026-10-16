"use client";
/**
 * Win-back note on Home (J11, a-winback-credits). After paid access ended the
 * daily job grants mentor credits; on the next visit this card says so once.
 *
 * Renders nothing unless the mentor is available to this account (the note
 * would otherwise point at a dead end) and GET /api/mentor/winback returns a
 * live win-back lot (that route answers {enabled:false} without a read while
 * REWARDS_WINBACK_ENABLED is off). One read per lot and browser session.
 * A non-modal inline card through the announcement queue; "Ausblenden",
 * "Mentor öffnen" or "Tarife ansehen" end it for that lot on this device.
 */
import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { Sparkles } from "lucide-react";
import { IconButton } from "@/components/ui/IconButton";
import { authFetch } from "@/lib/authFetch";
import { dismissSurface, useAnnouncementSlot } from "@/lib/announcements/queue";
import { useMentorAvailability } from "@/components/mentor/useMentorAvailability";
import { safeSessionStorage, safeStorage } from "@/lib/safe-storage";
import { trackEvent } from "@/lib/tracker";
import { winbackCopy, winbackDate, winbackLang } from "@/lib/winback-copy";
import type { Lang } from "@/lib/i18n";

interface Note { lot_id: string; credits: number; expires_at: string }

export const WINBACK_SEEN_PREFIX = "medpruef_winback_seen_v1:";
const CHECKED_PREFIX = "medpruef_winback_checked_v1:";

function seenLot(userId: string): string | null {
  try { return safeStorage.getItem(WINBACK_SEEN_PREFIX + userId); } catch { return null; }
}

/** Pure: may this note show? */
export function winbackNoteWanted(note: Note | null, seen: string | null, nowMs: number): boolean {
  return note !== null && note.lot_id !== seen && Date.parse(note.expires_at) > nowMs && note.credits > 0;
}

export default function HomeWinbackNote({ userId, lang, className = "" }: { userId: string; lang: Lang; className?: string }) {
  const availability = useMentorAvailability();
  const [note, setNote] = useState<Note | null>(null);
  const [seen, setSeen] = useState<string | null>(null);
  const shown = useRef(false);
  const isGuest = userId.startsWith("guest_");

  useEffect(() => {
    if (isGuest || availability !== "available") return;
    setSeen(seenLot(userId));
    let checked = false;
    try { checked = safeSessionStorage.getItem(CHECKED_PREFIX + userId) === "1"; } catch { /* optional */ }
    if (checked) return;
    let cancelled = false;
    (async () => {
      try {
        const res = await authFetch("/api/mentor/winback", { cache: "no-store" });
        if (!res.ok) return;
        const body = (await res.json()) as { enabled?: boolean; note?: Note | null };
        try { safeSessionStorage.setItem(CHECKED_PREFIX + userId, "1"); } catch { /* optional */ }
        const n = body?.note;
        if (!cancelled && n && typeof n.lot_id === "string" && typeof n.credits === "number" && typeof n.expires_at === "string") setNote(n);
      } catch { /* a note is never worth an error */ }
    })();
    return () => { cancelled = true; };
  }, [userId, isGuest, availability]);

  const wants = !isGuest && availability === "available" && winbackNoteWanted(note, seen, Date.now());
  const granted = useAnnouncementSlot("winback_note", wants);
  useEffect(() => {
    if (granted && !shown.current) { shown.current = true; trackEvent("winback_note_shown", {}); }
  }, [granted]);
  if (!granted || !note) return null;

  const wl = winbackLang(lang);
  const c = winbackCopy(wl);
  const end = (action: "open" | "plans" | "dismiss") => {
    try { safeStorage.setItem(WINBACK_SEEN_PREFIX + userId, note.lot_id); } catch { /* blocked: shows at most this session */ }
    trackEvent("winback_note_action", { action });
    if (action === "dismiss") dismissSurface("winback_note", "no_interest");
    setSeen(note.lot_id);
  };

  return (
    <div
      className={"relative flex items-start gap-3 rounded-[var(--mp-r-card)] border p-4 border-[var(--mp-viridian)]/30 bg-[var(--mp-surface-raised)] " + className}
      role="region"
      aria-label={c.noteTitle}
      data-testid="home-winback-note"
    >
      <span className="w-9 h-9 rounded-xl bg-[var(--mp-viridian)]/15 flex items-center justify-center text-[var(--mp-viridian)] flex-shrink-0" aria-hidden="true">
        <Sparkles className="w-5 h-5" />
      </span>
      <div className="min-w-0 flex-1 pe-8">
        <p className="font-display font-bold text-[var(--mp-fg)]">{c.noteTitle}</p>
        <p className="text-sm text-[var(--mp-fg-muted)] mt-0.5">{c.noteBody(note.credits, winbackDate(note.expires_at, wl))}</p>
        <div className="flex flex-wrap items-center gap-2 mt-3">
          <Link href="/mentor" onClick={() => end("open")} className="mp-btn mp-btn--primary min-h-11 inline-flex items-center">{c.noteOpen}</Link>
          <Link href="/pricing" onClick={() => end("plans")} className="mp-btn mp-btn--ghost min-h-11 inline-flex items-center">{c.notePlans}</Link>
        </div>
      </div>
      <IconButton label={c.noteDismiss} onClick={() => end("dismiss")} className="absolute top-1 end-1" />
    </div>
  );
}
