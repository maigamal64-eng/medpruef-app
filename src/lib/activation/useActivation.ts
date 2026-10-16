"use client";
/**
 * useActivation (a-activation-48h): the learner's first-48-hours step from
 * /api/activation. Asks nothing while /api/auth/me reports the flag off.
 * Concurrent callers share one request per account and language (reused for
 * 60 seconds); Home and the quiz round end read fresh on mount, so a starter
 * link never carries ids answered since. An exam switch reloads fresh.
 */
import { useEffect, useState } from "react";
import { authFetch } from "@/lib/authFetch";
import { useLang } from "@/lib/i18n";
import { useUserTier } from "@/lib/hooks/useUserTier";
import { getStoredSession } from "@/lib/auth";
import type { ActivationSegment, ActivationStage } from "@/lib/activation/rules";
import type { TranslationTarget } from "@/lib/explanation-translation";

export interface ActivationView {
  enabled: true;
  stage: ActivationStage;
  window_ends_at?: string | null;
  exam?: string;
  segment?: ActivationSegment;
  answered?: number;
  first_win_size?: number;
  named?: boolean;
  starter?: { href: string; ids: number[]; translated: number | null; lang: TranslationTarget | null } | null;
  reminder_hour?: number;
}

export const ACTIVATION_REUSE_MS = 60_000;

interface Entry { at: number; key: string; promise: Promise<ActivationView | null> }
let entry: Entry | null = null;

export function __resetActivationCacheForTests(): void {
  entry = null;
}

export async function loadActivation(userId: string, lang: string, fresh = false, fetcher: typeof authFetch = authFetch): Promise<ActivationView | null> {
  const key = `${userId}:${lang}`;
  const now = Date.now();
  if (!fresh && entry && entry.key === key && now - entry.at < ACTIVATION_REUSE_MS) return entry.promise;
  const promise = (async () => {
    try {
      const r = await fetcher(`/api/activation?lang=${encodeURIComponent(lang)}`, { timeoutMs: 8_000, skipAuthRedirect: true });
      if (!r.ok) return null;
      const body = (await r.json()) as Partial<ActivationView> & { enabled?: boolean };
      return body.enabled === true && typeof body.stage === "string" ? (body as ActivationView) : null;
    } catch {
      return null;
    }
  })();
  entry = { at: now, key, promise };
  const result = await promise;
  // A failed read is not reused.
  if (result === null && entry?.promise === promise) entry = null;
  return result;
}

export function useActivation(opts: { fresh?: boolean } = {}): ActivationView | null {
  const { activation } = useUserTier();
  const lang = useLang();
  const [view, setView] = useState<ActivationView | null>(null);
  const fresh = opts.fresh === true;
  useEffect(() => {
    const userId = getStoredSession()?.user?.id ?? null;
    if (!activation || !userId || userId.startsWith("guest_")) { setView(null); return; }
    let live = true;
    const load = (force: boolean) => void loadActivation(userId, lang, force).then((v) => { if (live) setView(v); });
    load(fresh);
    const onExam = () => load(true);
    window.addEventListener("medpruef:examChanged", onExam);
    return () => { live = false; window.removeEventListener("medpruef:examChanged", onExam); };
  }, [activation, lang, fresh]);
  return view;
}
