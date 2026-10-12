/**
 * Overlay stack + back-gesture contract (UX-GLOBAL-14).
 *
 * Every modal overlay registers here while it is open, so:
 *   - Escape closes only the topmost layer;
 *   - nested dialogs stack (depth feeds the z token);
 *   - Android Back and iOS swipe-back close the overlay through a pushed
 *     history entry instead of leaving the route.
 *
 * The pushed entry copies the current history.state so the Next.js App
 * Router keeps its own markers (a state without them makes it reload).
 * `closeOverlayEntry` only steps back when the overlay's entry is still on
 * top, so a link that navigated away is never undone.
 *
 * Pure module (no React). Tested in tests/unit/a11-ui-primitives.
 */

export interface OverlayHistory {
  readonly state: unknown
  pushState(data: unknown, unused: string): void
  replaceState(data: unknown, unused: string): void
  back(): void
}

/** Defers a callback past the current React commit (overridable in tests). */
export type Scheduler = (fn: () => void) => unknown
let schedule: Scheduler = (fn) => setTimeout(fn, 0)
let cancel: (handle: unknown) => void = (handle) => clearTimeout(handle as ReturnType<typeof setTimeout>)
export function setOverlayScheduler(next: Scheduler, nextCancel: (handle: unknown) => void): void {
  schedule = next
  cancel = nextCancel
}

/** A programmatic Back that has been scheduled but not yet fired. */
let pendingBack: unknown = null
/** Set while the popstate caused by our own Back is being dispatched. */
let selfPopArmed = false

const stack: string[] = []
const MARK = '__mpOverlay'

export function overlayStack(): readonly string[] {
  return stack
}

export function pushOverlay(id: string): number {
  if (!stack.includes(id)) stack.push(id)
  return stack.indexOf(id)
}

export function removeOverlay(id: string): void {
  const index = stack.indexOf(id)
  if (index >= 0) stack.splice(index, 1)
}

export function isTopOverlay(id: string): boolean {
  return stack.length > 0 && stack[stack.length - 1] === id
}

export function overlayDepth(id: string): number {
  const index = stack.indexOf(id)
  return index < 0 ? 0 : index
}

function stateMark(state: unknown): string | undefined {
  if (state && typeof state === 'object' && MARK in (state as Record<string, unknown>)) {
    const value = (state as Record<string, unknown>)[MARK]
    return typeof value === 'string' ? value : undefined
  }
  return undefined
}

/**
 * Push a same-URL history entry that belongs to this overlay. When another
 * overlay just closed in the same commit (one dialog replacing another), the
 * new overlay adopts that entry instead: the scheduled Back is cancelled and
 * the entry is re-marked, so neither the history nor the new overlay is
 * disturbed by a late popstate.
 */
export function pushOverlayEntry(id: string, history: OverlayHistory): void {
  const base = history.state && typeof history.state === 'object' ? (history.state as Record<string, unknown>) : {}
  if (pendingBack !== null && stateMark(history.state)) {
    cancel(pendingBack)
    pendingBack = null
    history.replaceState({ ...base, [MARK]: id }, '')
    return
  }
  history.pushState({ ...base, [MARK]: id }, '')
}

/**
 * True for the popstate caused by our own programmatic Back. Every overlay
 * listener of that one event sees true; the flag clears after dispatch.
 */
export function consumeSelfPop(): boolean {
  if (!selfPopArmed) return false
  schedule(() => { selfPopArmed = false })
  return true
}

/** True when the overlay's entry is the current history entry. */
export function ownsCurrentEntry(id: string, history: OverlayHistory): boolean {
  return stateMark(history.state) === id
}

/**
 * Close path for a programmatic close (button, Escape, scrim). Steps back
 * over the overlay's own entry only while that entry is current.
 * Returns true when it stepped back.
 */
export function closeOverlayEntry(id: string, history: OverlayHistory): boolean {
  if (!ownsCurrentEntry(id, history)) return false
  if (pendingBack !== null) return true
  pendingBack = schedule(() => {
    pendingBack = null
    // Still ours (no other overlay adopted it): step back over it.
    if (stateMark(history.state)) {
      selfPopArmed = true
      history.back()
    }
  })
  return true
}
