"use client";
/**
 * Client side of the "your plan to your sitting" card (a-trial-end-decision).
 * Asks /api/trial-end only while TRIAL_END_CARD_ENABLED is on (from
 * /api/auth/me), for a signed-in non-admin account, and only when the
 * surface wants it (the banner in the trial's last 24 hours, Home for an
 * account without paid access, the paywall when it opens). A "none" answer
 * is remembered on the device for 6 hours per account, so Home asks at most
 * that often. Then the learner's own topic progress (the shared
 * /api/user/topic-progress) gives the answered count and weakest fields.
 */
import { useEffect, useState } from "react";
import { authFetch as fetch } from "@/lib/authFetch";
import { getStoredSession } from "@/lib/auth";
import { useUserTier } from "@/lib/hooks/useUserTier";
import { safeSessionStorage, safeStorage } from "@/lib/safe-storage";
import type { PuypExamType } from "@/lib/exam-dates";
import type { V2Readiness } from "@/lib/pricing-v2/readiness";
import type { TopicProgressRow, TrialEndState, TrialEndSurface, TrialEndTarget, TrialKind } from "@/lib/trial-end/rules";

export interface TrialEndView {
  state: Exclude<TrialEndState, "none">;
  endsAt: string;
  trial: TrialKind;
  exam: PuypExamType;
  sitting: { bank: PuypExamType; date: string; lastDay: string } | null;
  translations: number | null;
  /** The free sample of the bank is used up (trial answers count toward it); null when unknown. */
  capped: boolean | null;
  homeSeen: boolean | null;
  v2: boolean;
  guard: boolean;
  ready: V2Readiness;
  /** a-cram-part-plan: the newest timed SIP part run with its subjects below 60 percent, or null. */
  partRun: { examKey: "sip4a" | "sip5a"; day: string; weak: string[] } | null;
}

export interface TrialEndData {
  view: TrialEndView;
  /** Distinct answered questions in the bank (sum over topics), null when unknown. */
  answered: number | null;
  topics: TopicProgressRow[] | null;
}

const NONE_TTL_MS = 6 * 60 * 60_000;
const noneKey = (uid: string) => `medpruef_trial_end_none:${uid}`;

function noneRemembered(uid: string): boolean {
  try {
    const at = Number(safeStorage.getItem(noneKey(uid)));
    return Number.isFinite(at) && at > Date.now() - NONE_TTL_MS;
  } catch { return false; }
}
function rememberNone(uid: string) {
  try { safeStorage.setItem(noneKey(uid), String(Date.now())); } catch { /* best effort */ }
}
const homeSeenKey = (uid: string) => `medpruef_trial_end_home_seen:${uid}`;
/** The one-time Home card was shown on this device or, per the server, on any device. */
export function homeSeenOnDevice(uid: string): boolean {
  try { return safeStorage.getItem(homeSeenKey(uid)) === "1"; } catch { return false; }
}
export function markHomeSeen(uid: string) {
  try { safeStorage.setItem(homeSeenKey(uid), "1"); } catch { /* the server marker still holds */ }
}

function parseView(d: unknown): TrialEndView | null {
  const v = d as Record<string, unknown> | null;
  if (!v || v.enabled !== true || (v.state !== "last_day" && v.state !== "ended") || typeof v.ends_at !== "string") return null;
  const ready = v.ready as V2Readiness | undefined;
  return {
    state: v.state,
    endsAt: v.ends_at,
    trial: v.trial === "claim" ? "claim" : "auto",
    exam: (typeof v.exam === "string" ? v.exam : "kenntnispruefung") as PuypExamType,
    sitting: (v.sitting as TrialEndView["sitting"]) ?? null,
    translations: typeof v.translations === "number" ? v.translations : null,
    capped: typeof v.capped === "boolean" ? v.capped : null,
    homeSeen: typeof v.home_seen === "boolean" ? v.home_seen : null,
    v2: v.v2 === true,
    guard: v.guard === true,
    ready: ready ?? { flex_month: true, sitting_pass: true, half_year: false, guarantee_ticket: false },
    partRun: parsePartRun(v.part_run),
  };
}

function parsePartRun(raw: unknown): TrialEndView["partRun"] {
  const r = raw as Record<string, unknown> | null | undefined;
  if (!r || (r.exam_key !== "sip4a" && r.exam_key !== "sip5a") || typeof r.day !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(r.day) || !Array.isArray(r.weak)) return null;
  const weak = r.weak.filter((x): x is string => typeof x === "string" && x.length > 0 && x.length <= 80).slice(0, 10);
  return weak.length > 0 ? { examKey: r.exam_key, day: r.day, weak } : null;
}

/**
 * The card's data for one surface, or null (nothing to show, not asked, or
 * still loading). `wants` is the surface's own condition.
 */
export function useTrialEnd(surface: TrialEndSurface, wants: boolean): TrialEndData | null {
  const { trialEndCard, isAdmin, isLoading } = useUserTier();
  const [data, setData] = useState<TrialEndData | null>(null);
  const uid = typeof window === "undefined" ? null : getStoredSession()?.user.id ?? null;
  const ask = trialEndCard && !isLoading && !isAdmin && wants && Boolean(uid) && !uid!.startsWith("guest_");

  useEffect(() => {
    if (!ask || !uid) { setData(null); return; }
    if (surface === "home" && noneRemembered(uid)) return;
    let active = true;
    (async () => {
      try {
        const r = await fetch(`/api/trial-end?surface=${surface}`, { timeoutMs: 8_000, skipAuthRedirect: true });
        if (!r.ok) return;
        const body = await r.json().catch(() => null);
        const view = parseView(body);
        if (!view) {
          if (body?.enabled === true && body?.state === "none") rememberNone(uid);
          if (active) setData(null);
          return;
        }
        // Home: the card shows only on a definite "not seen". Seen elsewhere: remember it on
        // this device and ask nothing more (reviewer P2-1); unknown: try again next visit.
        if (surface === "home" && view.homeSeen !== false) {
          if (view.homeSeen === true) markHomeSeen(uid);
          if (active) setData(null);
          return;
        }
        let topics: TopicProgressRow[] | null = null;
        let answered: number | null = null;
        try {
          const t = await fetch(`/api/user/topic-progress?examType=${encodeURIComponent(view.exam)}`, { timeoutMs: 8_000, skipAuthRedirect: true });
          const rows = t.ok ? await t.json() : null;
          if (Array.isArray(rows)) {
            topics = rows as TopicProgressRow[];
            answered = (rows as Array<{ answered?: unknown }>).reduce((sum, row) => sum + (Number(row.answered) || 0), 0);
          }
        } catch { /* progress lines are left out, never shown as 0 */ }
        if (active) setData({ view, answered, topics });
      } catch { /* nothing shown */ }
    })();
    return () => { active = false; };
  }, [ask, uid, surface]);

  return ask ? data : null;
}

/** shown/click for the Monday scoreboard; written by the server, fire and forget. */
export function postTrialEndEvent(event: "shown" | "click", fields: { surface: TrialEndSurface; plan?: string; exam?: string; trial?: TrialKind; target?: TrialEndTarget }) {
  try {
    void fetch("/api/trial-end", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ event, ...fields }),
      keepalive: true,
      timeoutMs: 8_000,
      skipAuthRedirect: true,
    }).catch(() => {});
  } catch { /* best effort */ }
}

/** Once per browser session per surface (the Home card is once ever, by the server marker). */
export function shownOnce(surface: TrialEndSurface, uid: string | null): boolean {
  if (!uid) return false;
  const key = `medpruef_trial_end_shown:${surface}:${uid}`;
  try {
    if (safeSessionStorage.getItem(key)) return false;
    safeSessionStorage.setItem(key, "1");
  } catch { /* storage blocked: still record */ }
  return true;
}
