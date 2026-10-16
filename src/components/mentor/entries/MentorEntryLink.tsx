"use client";

/**
 * MentorEntryLink (a39): one plain link into /mentor. Renders nothing unless
 * the mentor is available for this learner. Not a modal, not a banner and not
 * part of the announcement gate. One impression per session per surface.
 */
import Link from "next/link";
import { useEffect, useState } from "react";
import { MessageCircle } from "lucide-react";
import { getStoredSession } from "@/lib/auth";
import { useMentorAvailability } from "@/components/mentor/useMentorAvailability";
import { trackMentor, trackMentorOnce } from "@/components/mentor/telemetry";
import { mentorEntryHref, type MentorEntryHrefInput } from "./href";

export interface MentorEntryLinkProps extends MentorEntryHrefInput {
  /** Dedup key for the impression, e.g. "home_plan" or "mistakes". */
  surface: string;
  label: string;
  /** Prominent: secondary button. Quiet: text link. Both are 44px tall. */
  tone?: "prominent" | "quiet";
  className?: string;
  /** Small line under the link (e.g. "zählt als eine Nachricht"). */
  note?: string;
  /**
   * Impression dedup key when one surface repeats (a-mentor-question-entry-v2:
   * one per question card, e.g. "question:123"). Defaults to `surface`. Never
   * sent: event data stays entry and mode only.
   */
  dedupKey?: string;
}

function userId(): string {
  try { return getStoredSession()?.user?.id ?? ""; } catch { return ""; }
}

export function MentorEntryLink({ surface, label, tone = "quiet", className = "", note, dedupKey, ...input }: MentorEntryLinkProps) {
  const availability = useMentorAvailability();
  // Server HTML never knows availability; render only after mount (no hydration mismatch).
  const [mounted, setMounted] = useState(false);
  useEffect(() => { setMounted(true); }, []);
  const available = mounted && availability === "available";
  const impressionKey = dedupKey ?? surface;
  useEffect(() => {
    if (available) trackMentorOnce(userId(), "mentor_entry_shown", impressionKey, { entry: input.from, mode: input.mode });
  }, [available, impressionKey, input.from, input.mode]);
  if (!available) return null;
  const href = mentorEntryHref(input);
  const cls = tone === "prominent"
    ? "mp-btn mp-btn--secondary min-h-11"
    : "inline-flex items-center gap-1.5 min-h-11 text-sm font-semibold text-[var(--mp-viridian)] underline-offset-2 hover:underline";
  return (
    <div className={className} data-mentor-entry={surface}>
      <Link href={href} className={cls} onClick={() => trackMentor("mentor_entry_click", { entry: input.from, mode: input.mode })}>
        <MessageCircle className="w-4 h-4" aria-hidden />
        {label}
      </Link>
      {note && <p className="text-xs text-[var(--mp-fg-muted)] mt-0.5">{note}</p>}
    </div>
  );
}

export default MentorEntryLink;
