"use client";

/**
 * useActiveExam: one hook for every study screen (UX-GLOBAL-30, STU-44).
 * Reads the account preference from /api/user/exam-preference, keeps the
 * browser mirror (EXAM_SOURCE_KEY) in step, and resolves the active exam with
 * the pure contract in src/lib/active-exam.ts. Never defaults to an exam.
 *
 * The mirror is not yet scoped per user; the safeStorage mirror is UX-GLOBAL-39.
 */
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { authFetch } from "@/lib/authFetch";
import { getStoredSession } from "@/lib/auth";
import { EXAM_SOURCE_KEY, setStoredExamSource, type ExamSourceId } from "@/lib/topics";
import { asExamSourceId, resolveActiveExam, type AccountExamState, type ActiveExamResolution } from "@/lib/active-exam";

function readMirror(): string | null {
  try { return localStorage.getItem(EXAM_SOURCE_KEY); } catch { return null; }
}

export interface UseActiveExam {
  resolution: ActiveExamResolution;
  /** Save an explicit choice to the account; resolves true when the server accepted it. */
  switchExam: (exam: ExamSourceId) => Promise<boolean>;
  switching: boolean;
}

export function useActiveExam(urlExam: string | null): UseActiveExam {
  const [account, setAccount] = useState<AccountExamState>({ kind: "loading" });
  const [mirror, setMirror] = useState<string | null>(null);
  const [switching, setSwitching] = useState(false);
  const persisted = useRef(false);

  useEffect(() => {
    let cancelled = false;
    setMirror(readMirror());
    const userId = getStoredSession()?.user?.id;
    if (!userId || userId.startsWith("guest_")) {
      setAccount({ kind: "signed-out" });
      return;
    }
    authFetch("/api/user/exam-preference")
      .then(async (res) => {
        if (!res.ok) throw new Error("Preference unavailable");
        return res.json() as Promise<{ activeExam?: unknown }>;
      })
      .then((data) => {
        if (cancelled) return;
        const exam = asExamSourceId(data?.activeExam);
        if (exam) { setStoredExamSource(exam); setMirror(exam); }
        setAccount({ kind: "loaded", exam });
      })
      .catch(() => { if (!cancelled) setAccount({ kind: "failed" }); });
    return () => { cancelled = true; };
  }, []);

  const resolution = useMemo(() => resolveActiveExam({ account, mirror, url: urlExam }), [account, mirror, urlExam]);

  const switchExam = useCallback(async (exam: ExamSourceId) => {
    if (account.kind === "signed-out") {
      // No account to save to: the browser choice is the source.
      setStoredExamSource(exam);
      setMirror(exam);
      return true;
    }
    setSwitching(true);
    try {
      const res = await authFetch("/api/user/exam-preference", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ activeExam: exam }),
      });
      if (!res.ok) return false;
      setStoredExamSource(exam);
      setMirror(exam);
      setAccount({ kind: "loaded", exam });
      return true;
    } catch {
      return false;
    } finally {
      setSwitching(false);
    }
  }, [account.kind]);

  // A just-made browser choice (onboarding) is saved once to the account.
  useEffect(() => {
    if (resolution.status !== "ready" || !resolution.persist || persisted.current) return;
    persisted.current = true;
    void switchExam(resolution.exam);
  }, [resolution, switchExam]);

  return { resolution, switchExam, switching };
}
