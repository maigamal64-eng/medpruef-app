/**
 * Local persistence for the KAF practice run (a24). Own account-scoped keys:
 * never the /exam autosave or its pending outbox, which /exam would resume as
 * a multiple-choice run. Every read and write is best-effort and never throws.
 */
import { kafPendingKey, kafSessionKey, parseKafSession, type KafSession } from "@/lib/kaf-run";

function storage(): Storage | null {
  try {
    return typeof window === "undefined" ? null : window.localStorage;
  } catch {
    return null;
  }
}

export function loadKafSession(userId: string): KafSession | null {
  const key = kafSessionKey(userId);
  const ls = storage();
  if (!key || !ls) return null;
  try {
    const s = parseKafSession(ls.getItem(key));
    return s && s.phase !== "result" ? s : null;
  } catch {
    return null;
  }
}

export function saveKafSession(userId: string, session: Omit<KafSession, "v" | "savedAt">): boolean {
  const key = kafSessionKey(userId);
  const ls = storage();
  if (!key || !ls) return false;
  try {
    ls.setItem(key, JSON.stringify({ ...session, v: 1, savedAt: Date.now() }));
    return true;
  } catch {
    return false;
  }
}

/** Remove the in-progress run, but only when it is the given attempt (or any, without one). */
export function clearKafSession(userId: string, attemptId?: string): void {
  const key = kafSessionKey(userId);
  const ls = storage();
  if (!key || !ls) return;
  try {
    if (attemptId && parseKafSession(ls.getItem(key))?.attemptId !== attemptId) return;
    ls.removeItem(key);
  } catch {
    /* keep */
  }
}

/** Finished runs wait here until /api/history/exams acknowledges them. */
export function loadPendingKaf(userId: string): KafSession[] {
  const key = kafPendingKey(userId);
  const ls = storage();
  if (!key || !ls) return [];
  try {
    const rows = JSON.parse(ls.getItem(key) || "[]");
    if (!Array.isArray(rows)) return [];
    return rows
      .map((row) => parseKafSession(JSON.stringify(row)))
      .filter((row): row is KafSession => !!row && row.phase === "result" && typeof row.finishedAt === "number");
  } catch {
    return [];
  }
}

export function savePendingKaf(userId: string, session: Omit<KafSession, "v" | "savedAt">): boolean {
  const key = kafPendingKey(userId);
  const ls = storage();
  if (!key || !ls) return false;
  try {
    const rows = loadPendingKaf(userId).filter((row) => row.attemptId !== session.attemptId);
    ls.setItem(key, JSON.stringify([...rows, { ...session, phase: "result", v: 1, savedAt: Date.now() }]));
    return true;
  } catch {
    return false;
  }
}

export function acknowledgePendingKaf(userId: string, attemptId: string): void {
  const key = kafPendingKey(userId);
  const ls = storage();
  if (!key || !ls) return;
  try {
    ls.setItem(key, JSON.stringify(loadPendingKaf(userId).filter((row) => row.attemptId !== attemptId)));
  } catch {
    /* retained on failure */
  }
}
