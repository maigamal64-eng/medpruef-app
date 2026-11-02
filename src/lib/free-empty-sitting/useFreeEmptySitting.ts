"use client";

/**
 * Client read of GET /api/free-empty/sitting-line (a-growth-lines-1102, A1).
 * Reads once per mount while the free empty state shows for the Vienna bank;
 * a failure, a 401 or the switch being off all read as { state: "none" }, so
 * the empty state keeps today's lines.
 */
import { useEffect, useState } from "react";
import { authFetch } from "@/lib/authFetch";
import { freeEmptyLang } from "./copy";
import { parseFreeEmptySitting, type FreeEmptySitting } from "./index";

const NONE: FreeEmptySitting = { state: "none" };

export function useFreeEmptySitting(active: boolean, bank: string, lang: string): FreeEmptySitting {
  const [result, setResult] = useState<FreeEmptySitting>(NONE);
  useEffect(() => {
    if (!active || bank !== "kenntnispruefung") { setResult(NONE); return; }
    let alive = true;
    const q = new URLSearchParams({ bank, lang: freeEmptyLang(lang) });
    authFetch(`/api/free-empty/sitting-line?${q.toString()}`, { skipAuthRedirect: true, timeoutMs: 8_000 })
      .then(async (r) => (r.ok ? parseFreeEmptySitting(await r.json().catch(() => null)) : NONE))
      .catch(() => NONE)
      .then((next) => { if (alive) setResult(next); });
    return () => { alive = false; };
  }, [active, bank, lang]);
  return result;
}
