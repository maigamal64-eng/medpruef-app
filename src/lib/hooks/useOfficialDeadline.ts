"use client";

/**
 * The learner's next official registration deadline for their own bank,
 * shared by the global CohortCountdownBanner and the Home "Dein Termin" line
 * (UX-HOME-17, [name] 2026-10-11: shown to all tiers on Home). Facts come from
 * OFFICIAL_SITTINGS in src/lib/exam-dates.ts; null when no window is known.
 */

import { useEffect, useMemo, useState } from "react";
import {
  OFFICIAL_KEYS_BY_BANK,
  asPuypExamType,
  getNextOfficialDeadlineGroup,
  getUpcomingOfficialFor,
  type PuypExamType,
} from "@/lib/exam-dates";
import {
  describeDeadlineGroup,
  describeStpSitting,
  describeUpcomingGroup,
  officialSourceStamps,
  type OfficialSourceStamp,
} from "@/lib/i18n-dates";
import { useLang } from "@/lib/i18n";
import { getStoredSession } from "@/lib/auth";
import { DEFAULT_EXAM_SOURCE, getStoredExamSource, hasSelectedExam } from "@/lib/topics";

export const DEADLINE_DISMISS_PREFIX = "medpruef_deadline_dismissed:";

export type OfficialDeadlineContent = {
  key: string;
  text: string;
  href: string;
  publisher: string;
  /** Source name, link and read date of every row behind the text (TR-06). */
  sources: OfficialSourceStamp[];
};

/**
 * The learner's bank, resolved the way the app resolves it: an explicit pick
 * in this browser (with the legacy 'SIP' migration), else the server's
 * active_exam, else the app default (the Vienna bank).
 */
function readActiveBank(): PuypExamType {
  try {
    if (hasSelectedExam()) {
      const picked = asPuypExamType(getStoredExamSource());
      if (picked) return picked;
    }
  } catch {
    /* storage blocked */
  }
  const user = getStoredSession()?.user as { active_exam?: string | null } | undefined;
  return asPuypExamType(user?.active_exam ?? null) ?? (DEFAULT_EXAM_SOURCE as PuypExamType);
}

export function readDeadlineDismissed(key: string, prefix = DEADLINE_DISMISS_PREFIX): boolean {
  try {
    return localStorage.getItem(prefix + key) === "1";
  } catch {
    return false;
  }
}

export function useOfficialDeadline() {
  const lang = useLang();
  const [bank, setBank] = useState<PuypExamType | null>(null);
  const [now, setNow] = useState<Date | null>(null);

  // Client-only: the bank lives in localStorage / the stored session, and
  // the deadline maths needs the real clock (no SSR mismatch).
  useEffect(() => {
    setBank(readActiveBank());
    setNow(new Date());
    const onExam = () => setBank(readActiveBank());
    window.addEventListener("medpruef:examChanged", onExam);
    return () => window.removeEventListener("medpruef:examChanged", onExam);
  }, []);

  const content = useMemo<OfficialDeadlineContent | null>(() => {
    if (!bank || !now) return null;
    const exams = OFFICIAL_KEYS_BY_BANK[bank];
    if (bank === "kmp_innsbruck") {
      // Next Stichprobentest sitting with any open deadline, all publishers.
      const open = getNextOfficialDeadlineGroup({ exams, now });
      if (!open) return null;
      const date = open.rows[0].date;
      const rows = getUpcomingOfficialFor({ exams, now }).filter((r) => r.date === date);
      return {
        key: `${bank}:${date}`,
        text: describeStpSitting(rows, lang),
        href: open.rows[0].source_url,
        publisher: open.rows[0].publisher,
        sources: officialSourceStamps(rows, lang),
      };
    }
    const g = getNextOfficialDeadlineGroup({ exams, now });
    if (!g) return null;
    return {
      key: `${bank}:${g.registration_closes}`,
      text: g.started ? describeDeadlineGroup(g, lang, now) : describeUpcomingGroup(g, lang),
      href: g.rows[0].source_url,
      publisher: g.rows[0].publisher,
      sources: officialSourceStamps(g.rows, lang),
    };
  }, [bank, now, lang]);

  return { content, lang };
}
