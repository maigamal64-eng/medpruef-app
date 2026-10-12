/**
 * Offline copy (UX-GLOBAL-20): one copy set for the status region. Each line
 * is shown only when the behaviour behind it is verified: the queued line
 * only when the IndexedDB outbox really holds answers, the "ready" line only
 * when questions are stored on this device, "Alles gesendet" only when the
 * outbox is empty. Nothing here promises offline study in general (HOME-55
 * is undecided). Pure.
 */
export const OFFLINE_SHOW_AFTER_MS = 3_000;
export const RECONNECT_VISIBLE_MS = 5_000;

export type OfflineView =
  | { state: 'hidden' }
  | { state: 'offline'; tone: 'info' | 'warning'; text: string; short: string; detail: string | null; action: { label: string; href: string } | null }
  | { state: 'reconnected'; tone: 'info'; text: string; short: string; detail: null; action: null };

export interface OfflineInput {
  online: boolean;
  /** Offline for at least OFFLINE_SHOW_AFTER_MS. */
  persisted: boolean;
  /** Pending answers in the outbox for this account (null = unknown). */
  queued: number | null;
  /** Questions stored on this device (null = unknown). */
  stored: number | null;
  /** True during the reconnect window after coming back online. */
  justReconnected: boolean;
  lang: string;
}

function n(value: number, lang: string): string {
  return value.toLocaleString(lang === 'de' ? 'de-AT' : 'en-GB');
}

export function offlineView(input: OfflineInput): OfflineView {
  const de = input.lang === 'de';
  if (input.online) {
    if (input.justReconnected && input.queued === 0) {
      const text = de ? 'Wieder online. Alles gesendet.' : 'Back online. Everything sent.';
      return { state: 'reconnected', tone: 'info', text, short: text, detail: null, action: null };
    }
    return { state: 'hidden' };
  }
  if (!input.persisted) return { state: 'hidden' };
  const queued = input.queued ?? 0;
  const stored = input.stored ?? 0;
  const detail = queued > 0 ? (de ? `${n(queued, input.lang)} warten` : `${n(queued, input.lang)} waiting`) : null;
  if (queued > 0) {
    return {
      state: 'offline', tone: 'info',
      text: de ? 'Offline. Ihre Antworten werden auf diesem Gerät gespeichert und später gesendet.' : 'Offline. Your answers are saved on this device and sent later.',
      short: de ? 'Offline. Antworten werden später gesendet.' : 'Offline. Answers are sent later.',
      detail,
      action: null,
    };
  }
  if (stored > 0) {
    const text = de ? `Offline: ${n(stored, input.lang)} Fragen bereit.` : `Offline: ${n(stored, input.lang)} questions ready.`;
    return { state: 'offline', tone: 'info', text, short: text, detail: null, action: null };
  }
  // Nothing can be done offline: warning tone with the one useful action.
  const text = de ? 'Offline: keine Fragen geladen.' : 'Offline: no questions downloaded.';
  return {
    state: 'offline', tone: 'warning', text, short: text, detail: null,
    action: { label: de ? 'Fragen herunterladen' : 'Download questions', href: '/settings#offline' },
  };
}
