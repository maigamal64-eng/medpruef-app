"use client";

/**
 * Client read of GET /api/stp-deadline-card/line (a-c1-stp-card-1119, C1).
 * Reads once per mount (and on a language change) while /api/auth/me reports
 * the switch on; a failure, a 401 or the switch being off all read as
 * { state: "none" }, so Home keeps today's cards.
 */
import { useEffect, useState } from "react";
import { authFetch } from "@/lib/authFetch";
import { useUserTier } from "@/lib/hooks/useUserTier";
import { stpCardLang } from "./copy";
import { parseStpCard, type StpCard } from "./index";

const NONE: StpCard = { state: "none" };

export function useStpDeadlineCard(active: boolean, lang: string): StpCard {
  const { stpDeadlineCard } = useUserTier();
  const [result, setResult] = useState<StpCard>(NONE);
  useEffect(() => {
    if (!active || !stpDeadlineCard) { setResult(NONE); return; }
    let alive = true;
    const q = new URLSearchParams({ lang: stpCardLang(lang) });
    authFetch(`/api/stp-deadline-card/line?${q.toString()}`, { skipAuthRedirect: true, timeoutMs: 8_000 })
      .then(async (r) => (r.ok ? parseStpCard(await r.json().catch(() => null)) : NONE))
      .catch(() => NONE)
      .then((next) => { if (alive) setResult(next); });
    return () => { alive = false; };
  }, [active, stpDeadlineCard, lang]);
  return result;
}
