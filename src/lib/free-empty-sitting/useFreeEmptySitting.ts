"use client";

/**
 * Client read of GET /api/free-empty/sitting-line (a-growth-lines-1102, A1).
 * Reads once per mount while the free empty state shows for the Vienna bank and
 * /api/auth/me reports the switch on;
 * a failure, a 401 or the switch being off all read as { state: "none" }, so
 * the empty state keeps today's lines.
 */
import { useEffect, useState } from "react";
import { authFetch } from "@/lib/authFetch";
import { useUserTier } from "@/lib/hooks/useUserTier";
import { freeEmptyLang } from "./copy";
import { parseFreeEmptySitting, type FreeEmptySitting } from "./index";

const NONE: FreeEmptySitting = { state: "none" };

export function useFreeEmptySitting(active: boolean, bank: string, lang: string): FreeEmptySitting {
  const { freeEmptySitting } = useUserTier();
  const [result, setResult] = useState<FreeEmptySitting>(NONE);
  useEffect(() => {
    // The server switch is reported by /api/auth/me (env only): off, nothing is asked.
    if (!active || !freeEmptySitting || bank !== "kenntnispruefung") { setResult(NONE); return; }
    let alive = true;
    const q = new URLSearchParams({ bank, lang: freeEmptyLang(lang) });
    authFetch(`/api/free-empty/sitting-line?${q.toString()}`, { skipAuthRedirect: true, timeoutMs: 8_000 })
      .then(async (r) => (r.ok ? parseFreeEmptySitting(await r.json().catch(() => null)) : NONE))
      .catch(() => NONE)
      .then((next) => { if (alive) setResult(next); });
    return () => { alive = false; };
  }, [active, freeEmptySitting, bank, lang]);
  return result;
}
