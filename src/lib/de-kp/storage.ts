/**
 * Local persistence for a KP-DE run (3d): one in-progress session and an
 * outbox of finished runs per account, under own keys (never the /exam or KAF
 * keys). Best-effort, never throws.
 */
import { parseSession, pendingKey, sessionKey, type DeKpSession } from "./case-run";

function ls(): Storage | null {
  try { return typeof window === "undefined" ? null : window.localStorage; } catch { return null; }
}

export function loadSession(userId: string): DeKpSession | null {
  const key = sessionKey(userId);
  const s = ls();
  if (!key || !s) return null;
  try { return parseSession(s.getItem(key)); } catch { return null; }
}

export function saveSession(userId: string, session: DeKpSession): boolean {
  const key = sessionKey(userId);
  const s = ls();
  if (!key || !s) return false;
  try { s.setItem(key, JSON.stringify({ ...session, v: 1, savedAt: Date.now() })); return true; } catch { return false; }
}

export function clearSession(userId: string, attemptId?: string): void {
  const key = sessionKey(userId);
  const s = ls();
  if (!key || !s) return;
  try {
    if (attemptId && parseSession(s.getItem(key))?.attemptId !== attemptId) return;
    s.removeItem(key);
  } catch { /* keep */ }
}

export function loadPending(userId: string): DeKpSession[] {
  const key = pendingKey(userId);
  const s = ls();
  if (!key || !s) return [];
  try {
    const rows = JSON.parse(s.getItem(key) || "[]");
    return Array.isArray(rows) ? rows.map((r) => parseSession(JSON.stringify(r))).filter((r): r is DeKpSession => !!r) : [];
  } catch { return []; }
}

export function savePending(userId: string, session: DeKpSession): boolean {
  const key = pendingKey(userId);
  const s = ls();
  if (!key || !s) return false;
  try {
    const rows = loadPending(userId).filter((r) => r.attemptId !== session.attemptId);
    s.setItem(key, JSON.stringify([...rows, { ...session, v: 1, savedAt: Date.now() }]));
    return true;
  } catch { return false; }
}

export function acknowledgePending(userId: string, attemptId: string): void {
  const key = pendingKey(userId);
  const s = ls();
  if (!key || !s) return;
  try { s.setItem(key, JSON.stringify(loadPending(userId).filter((r) => r.attemptId !== attemptId))); } catch { /* retained */ }
}
