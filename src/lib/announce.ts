/**
 * announce() — the one way to speak a status change (UX-GLOBAL-15).
 *
 * Two live regions are mounted once in the root layout (<LiveRegions />):
 *   polite    role=status  saved, copied, synced, progress, exam switched,
 *                          route titles
 *   assertive role=alert   only failures that need action
 *
 * Rules (do not re-implement per component):
 * - Visible status text is plain text, not itself live. The code that changes
 *   it calls announce() once, so nothing is spoken twice.
 * - A message is announced by announce() OR by moving focus to it, never both.
 * - No ticking countdowns through announce().
 * - Errors also render inline near their cause; a toast or announce() alone is
 *   never the only channel for a failure.
 */

export type Politeness = 'polite' | 'assertive'

type Sink = (text: string, politeness: Politeness) => void

let sink: Sink | null = null
const pending: Array<[string, Politeness]> = []

/** Mark appended to a repeated identical message so screen readers re-read it. */
const REPEAT_MARK = ' '

/**
 * Text to write into a live region. An identical repeat gets a trailing
 * non-breaking space (toggled) so the DOM text changes and is re-announced.
 */
export function nextLiveText(previous: string, text: string): string {
  const clean = text.trim()
  if (!clean) return ''
  const base = previous.endsWith(REPEAT_MARK) ? previous.slice(0, -1) : previous
  if (base === clean) return previous.endsWith(REPEAT_MARK) ? clean : clean + REPEAT_MARK
  return clean
}

export function announce(text: string, politeness: Politeness = 'polite'): void {
  const clean = String(text ?? '').trim()
  if (!clean) return
  if (sink) sink(clean, politeness)
  else if (pending.length < 5) pending.push([clean, politeness])
}

/** Registered by <LiveRegions />. Flushes anything announced before mount. */
export function registerAnnouncer(next: Sink | null): void {
  sink = next
  if (next) {
    while (pending.length) {
      const [text, politeness] = pending.shift()!
      next(text, politeness)
    }
  }
}
