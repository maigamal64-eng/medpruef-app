"use client";

import { authDestination, readAuthEntry } from './auth-entry';
import { authFetch } from './authFetch';
import { getStoredSession, storeSession } from './auth';
import { setStoredExamSource } from './topics';

/** Call only after the signed session is stored. Failure never loses URL context. */
export async function completeAuthEntry(params: URLSearchParams): Promise<string> {
  const entry = readAuthEntry(params);
  // a-public-selftest: only a sign-in that came through the self-check link (intent in this URL, not just a
  // stored entry from another visitor on a shared device) carries the result. The carry owns the exam switch,
  // so an account's own date and its active exam never end up on different banks.
  let carried = false;
  if (entry.intent === 'selftest' && params.get('intent') === 'selftest') {
    try { const { carrySelftest } = await import('./public-selftest/carry'); carried = (await carrySelftest()).ran; } catch { /* the record stays for a later sign-in until it expires */ }
  }
  if (entry.exam && !carried) {
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
