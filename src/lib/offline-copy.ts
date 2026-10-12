/**
 * Offline copy (UX-GLOBAL-20): one copy set for the status region. Each line
 * is shown only when the behaviour behind it is verified: the queued line
 * only when the IndexedDB outbox really holds answers, the "ready" line only
 * when questions are stored on this device, "Alles gesendet" only when the
 * outbox is empty. Nothing here promises offline study in general (HOME-55
 * is undecided). Pure.
 */
import { t, type Lang } from './i18n';

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
  const locale = { de: 'de-AT' }[lang] ?? 'en-GB';
  return value.toLocaleString(locale);
}

export function offlineView(input: OfflineInput): OfflineView {
  const lang = input.lang as Lang;
  if (input.online) {
    if (input.justReconnected && input.queued === 0) {
      const text = t('a12_offline_reconnected', lang);
      return { state: 'reconnected', tone: 'info', text, short: text, detail: null, action: null };
    }
    return { state: 'hidden' };
  }
  if (!input.persisted) return { state: 'hidden' };
  const queued = input.queued ?? 0;
  const stored = input.stored ?? 0;
  if (queued > 0) {
    return {
      state: 'offline', tone: 'info',
      text: t('a12_offline_queued', lang),
      short: t('a12_offline_queued_short', lang),
      detail: t('a12_offline_waiting', lang).replace('{n}', n(queued, input.lang)),
      action: null,
    };
  }
  if (stored > 0) {
    const text = t('a12_offline_ready', lang).replace('{n}', n(stored, input.lang));
    return { state: 'offline', tone: 'info', text, short: text, detail: null, action: null };
  }
  // Nothing can be done offline: warning tone with the one useful action.
  const text = t('a12_offline_empty', lang);
  return {
    state: 'offline', tone: 'warning', text, short: text, detail: null,
    action: { label: t('a12_offline_download', lang), href: '/settings#offline' },
  };
}
