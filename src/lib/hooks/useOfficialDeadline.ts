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
  getOpenOfficialDeadlineGroups,
  getPharmaPointerGroup,
  getUpcomingOfficialFor,
  isOfficialWindowOpen,
  type OfficialExamKey,
  type PuypExamType,
} from "@/lib/exam-dates";
import {
  describeDeadlineGroup,
  describeStpSitting,
  describeUpcomingGroup,
  officialSourceStamps,
  td,
  type OfficialSourceStamp,
} from "@/lib/i18n-dates";
import { useLang } from "@/lib/i18n";
import { getStoredSession } from "@/lib/auth";
import { guidanceLink, withLang } from "@/lib/guidance/public-links";
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
 * U2: the Rezeptierkunde/Gerichtsmedizin registration line shown under the
 * Stichprobentest line while that window is open. The link is the public
 * registration guide, which never changes the learner's saved bank.
 */
export type OfficialDeadlinePointer = {
  key: string;
  /** Who the line applies to (Vienna filers only): Innsbruck filers sit Innsbruck's rounds. */
  scope: string;
  text: string;
  sources: OfficialSourceStamp[];
  link: { href: string; label: string };
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

/**
 * Home "hide until the next deadline" keys (U2). The first key is read: the
 * Rez/GM pointer is a new deadline, so a line hidden before it appeared shows
 * again while it is open. Hiding writes every key, so a line hidden during
 * the pointer window stays hidden after the pointer closes.
 */
export function deadlineHideKeys(contentKey: string | null, pointerKey: string | null): string[] {
  if (contentKey && pointerKey) return [`${contentKey}|${pointerKey}`, contentKey];
  const only = contentKey ?? pointerKey;
  return only ? [only] : [];
}

/**
 * The U2 pointer for a bank at an instant (pure, unit-tested): the existing
 * pharma deadline sentence and its source stamps, plus the registration
 * guide link, only for the Stichprobentest bank and only while the
 * Rezeptierkunde/Gerichtsmedizin registration is open.
 */
export function buildDeadlinePointer(
  bank: PuypExamType,
  now: Date,
  lang: string
): OfficialDeadlinePointer | null {
  const g = getPharmaPointerGroup(bank, now);
  const guide = guidanceLink("/wien-route/rez-gm-anmeldung");
  if (!g || !guide) return null;
  // Guide pages are DE/EN; every other UI language opens the English page.
  const linkLang = (["de", "en"] as const).find((l) => l === lang) ?? "en";
  return {
    key: `pharma:${g.registration_closes}`,
    scope: td("home_deadline_rezgm_scope", lang),
    text: describeDeadlineGroup(g, lang, now),
    sources: officialSourceStamps(g.rows, lang),
    link: { href: withLang(guide.href, linkLang), label: guide.label[linkLang] },
  };
}

/**
 * a-journey-engine: the learner's own named sitting (exam keys and sitting
 * date from /api/journey). When given, the line shows that sitting's open
 * deadlines (both Stichprobentest publishers together) instead of the bank's
 * next deadline; same formatters, same OFFICIAL_SITTINGS rows.
 */
export type DeadlineRestriction = { key: string; exams: readonly OfficialExamKey[]; date: string };

/** The deadline content for a named sitting at an instant, or null when none of its windows is open (pure). */
export function buildRestrictedDeadline(
  restrict: DeadlineRestriction,
  now: Date,
  lang: string
): OfficialDeadlineContent | null {
  const exams = [...restrict.exams];
  if (exams.includes("stichprobentest")) {
    const rows = getUpcomingOfficialFor({ exams, now }).filter((r) => r.date === restrict.date && !r.window_unconfirmed);
    const open = rows.some((r) => isOfficialWindowOpen(r, now));
    if (!open || rows.length === 0) return null;
    return {
      key: `named:${restrict.key}`,
      text: describeStpSitting(rows, lang),
      href: rows[0].source_url,
      publisher: rows[0].publisher,
      sources: officialSourceStamps(rows, lang),
    };
  }
  const g = getOpenOfficialDeadlineGroups({ exams, now })
    .map((group) => ({ ...group, rows: group.rows.filter((r) => r.date === restrict.date && !r.window_unconfirmed) }))
    .find((group) => group.rows.length > 0);
  if (!g) return null;
  return {
    key: `named:${restrict.key}:${g.registration_closes}`,
    text: g.started ? describeDeadlineGroup(g, lang, now) : describeUpcomingGroup(g, lang),
    href: g.rows[0].source_url,
    publisher: g.rows[0].publisher,
    sources: officialSourceStamps(g.rows, lang),
  };
}

export function useOfficialDeadline(restrict: DeadlineRestriction | null = null) {
  const lang = useLang();
  const [bank, setBank] = useState<PuypExamType | null>(null);
  const [now, setNow] = useState<Date | null>(null);

  // Client-only: the bank lives in localStorage / the stored session, and
  // the deadline maths needs the real clock (no SSR mismatch).
  useEffect(() => {
    setBank(readActiveBank());
    setNow(new Date());
    const onExam = () => setBank(readActiveBank());
    // A page left open across a close (e.g. 12:00 Vienna) drops the expired
    // line within a minute; tab return re-checks at once.
    const tick = () => setNow(new Date());
    const onVisible = () => {
      if (document.visibilityState === "visible") tick();
    };
    const timer = window.setInterval(tick, 60_000);
    window.addEventListener("medpruef:examChanged", onExam);
    document.addEventListener("visibilitychange", onVisible);
    return () => {
      window.clearInterval(timer);
      window.removeEventListener("medpruef:examChanged", onExam);
      document.removeEventListener("visibilitychange", onVisible);
    };
  }, []);

  const restrictKey = restrict ? `${restrict.key}|${restrict.exams.join("+")}|${restrict.date}` : null;
  const content = useMemo<OfficialDeadlineContent | null>(() => {
    if (!bank || !now) return null;
    if (restrict) {
      const own = buildRestrictedDeadline(restrict, now, lang);
      if (own) return own;
    }
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
    // restrictKey stands for restrict (a new object every render).
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [bank, now, lang, restrictKey]);

  const pointer = useMemo<OfficialDeadlinePointer | null>(
    () => (bank && now ? buildDeadlinePointer(bank, now, lang) : null),
    [bank, now, lang]
  );

  return { content, pointer, lang };
}
