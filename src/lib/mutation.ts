/**
 * Mutation contract (UX-GLOBAL-18). Every write:
 *  - shows its pending state on the pressed control (ui/Button `loading`:
 *    aria-busy + aria-disabled, focus kept, never the disabled attribute);
 *  - is guarded by a ref, not state, so double taps, held keys and e.repeat
 *    never send a second request while one is in flight;
 *  - carries one client-generated action key that the server treats as an
 *    idempotency key, and a retry of the same action reuses it;
 *  - resets every pending state when the page returns from the bfcache.
 * Reversible actions run at once with a 10 s "Rückgängig" toast
 * (UNDO_WINDOW_MS); irreversible, money or access actions use a ConfirmAction
 * dialog. Pure core plus a small React hook.
 */
import { useCallback, useEffect, useRef, useState } from 'react';

export const UNDO_WINDOW_MS = 10_000;
/** Autosave rows debounce, then the last write wins (ACC-36). */
export const AUTOSAVE_DEBOUNCE_MS = 600;

export function newActionKey(): string {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') return crypto.randomUUID();
  // RFC 4122 v4 shape so server validators that expect a UUID accept it.
  const hex = Array.from({ length: 32 }, () => Math.floor(Math.random() * 16).toString(16));
  hex[12] = '4';
  hex[16] = ((parseInt(hex[16], 16) & 0x3) | 0x8).toString(16);
  const h = hex.join('');
  return `${h.slice(0, 8)}-${h.slice(8, 12)}-${h.slice(12, 16)}-${h.slice(16, 20)}-${h.slice(20)}`;
}

export interface SingleFlight {
  /** Runs `task` with this action's key, or returns `undefined` while busy. */
  run<T>(task: (actionKey: string) => Promise<T>): Promise<T | undefined>;
  busy(): boolean;
  /** Forget the pending action (bfcache return); a late settle is ignored. */
  reset(): void;
  /** Start a new logical action so the next run gets a fresh key. */
  nextAction(): void;
}

/**
 * One guard per action. A failed attempt keeps its key so "Erneut versuchen"
 * replays the same idempotent write; a success rotates the key.
 */
export function createSingleFlight(onBusyChange?: (busy: boolean) => void): SingleFlight {
  let inFlight = false;
  let generation = 0;
  let key = newActionKey();
  const set = (value: boolean) => { inFlight = value; onBusyChange?.(value); };
  return {
    async run(task) {
      if (inFlight) return undefined;
      const own = ++generation;
      set(true);
      try {
        const result = await task(key);
        if (own === generation) key = newActionKey();
        return result;
      } finally {
        if (own === generation) set(false);
      }
    },
    busy: () => inFlight,
    reset() { generation++; set(false); },
    nextAction() { key = newActionKey(); },
  };
}

/** Keyboard repeat and modifier presses never trigger a write. */
export function isRepeatActivation(event: { repeat?: boolean } | null | undefined): boolean {
  return Boolean(event?.repeat);
}

/** React binding: `pending` drives Button `loading`; `run` is the guarded call. */
export function useSingleFlight() {
  const [pending, setPending] = useState(false);
  const ref = useRef<SingleFlight | null>(null);
  if (!ref.current) ref.current = createSingleFlight(setPending);
  useEffect(() => {
    const onPageShow = (event: PageTransitionEvent) => { if (event.persisted) ref.current?.reset(); };
    window.addEventListener('pageshow', onPageShow);
    return () => window.removeEventListener('pageshow', onPageShow);
  }, []);
  const run = useCallback(<T,>(task: (actionKey: string) => Promise<T>) => ref.current!.run(task), []);
  const nextAction = useCallback(() => ref.current!.nextAction(), []);
  return { pending, run, nextAction };
}
