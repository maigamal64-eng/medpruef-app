"use client";

import { authDestination, readAuthEntry } from './auth-entry';
import { authFetch } from './authFetch';
import { getStoredSession, storeSession } from './auth';
import { setStoredExamSource } from './topics';

/** Call only after the signed session is stored. Failure never loses URL context. */
export async function completeAuthEntry(params: URLSearchParams): Promise<string> {
  const entry = readAuthEntry(params);
  if (entry.exam) {
    setStoredExamSource(entry.exam);
    try {
      const response = await authFetch('/api/user/exam-preference', {
        method: 'PATCH', timeoutMs: 8_000, skipAuthRedirect: true,
        headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ activeExam: entry.exam }),
      });
      const current = getStoredSession();
      if (response.ok && current) storeSession({ ...current, user: { ...current.user, active_exam: entry.exam } });
    } catch { /* The local preference and validated URL remain usable. */ }
  }
  return authDestination(entry);
}
