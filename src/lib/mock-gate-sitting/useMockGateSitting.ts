"use client";

/**
 * Client read of GET /api/mock-gate/sitting-line (a-b2-mock-gate-1110, B2).
 * Reads once per mount while the mock-exam wall shows for a free learner and
 * /api/auth/me reports the switch on; a failure, a 401 or the switch being
 * off all read as { state: "none" }, so the gate keeps today's lines.
 */
import { useEffect, useState } from "react";
import { authFetch } from "@/lib/authFetch";
import { useUserTier } from "@/lib/hooks/useUserTier";
import { mockGateLang } from "./copy";
import { parseMockGateLine, MOCK_GATE_BANKS, type MockGateLine } from "./index";

const NONE: MockGateLine = { state: "none" };

export function useMockGateSitting(active: boolean, bank: string, lang: string): MockGateLine {
  const { mockGateSitting } = useUserTier();
  const [result, setResult] = useState<MockGateLine>(NONE);
  useEffect(() => {
    // The server switch is reported by /api/auth/me (env and window only): off, nothing is asked.
    if (!active || !mockGateSitting || !MOCK_GATE_BANKS.some((b) => b === bank)) { setResult(NONE); return; }
    let alive = true;
    const q = new URLSearchParams({ bank, lang: mockGateLang(lang) });
    authFetch(`/api/mock-gate/sitting-line?${q.toString()}`, { skipAuthRedirect: true, timeoutMs: 8_000 })
      .then(async (r) => (r.ok ? parseMockGateLine(await r.json().catch(() => null)) : NONE))
      .catch(() => NONE)
      .then((next) => { if (alive) setResult(next); });
    return () => { alive = false; };
  }, [active, mockGateSitting, bank, lang]);
  return result;
}
