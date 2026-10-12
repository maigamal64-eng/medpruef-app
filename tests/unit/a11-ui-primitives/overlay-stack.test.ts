import { describe, expect, it } from 'vitest'
import { closeOverlayEntry, isTopOverlay, overlayDepth, ownsCurrentEntry, pushOverlay, pushOverlayEntry, removeOverlay, type OverlayHistory } from '@/lib/overlay-stack'

function fakeHistory(initial: unknown = { __NA: true }): OverlayHistory & { entries: unknown[] } {
  const entries: unknown[] = [initial]
  return {
    entries,
    get state() { return entries[entries.length - 1] },
    pushState(data: unknown) { entries.push(data) },
    back() { entries.pop() },
  }
}

describe('overlay stack (UX-GLOBAL-14)', () => {
  it('Escape targets only the topmost overlay; nested dialogs stack', () => {
    pushOverlay('a'); pushOverlay('b')
    expect(isTopOverlay('b')).toBe(true)
    expect(isTopOverlay('a')).toBe(false)
    expect(overlayDepth('b')).toBe(1)
    removeOverlay('b')
    expect(isTopOverlay('a')).toBe(true)
    removeOverlay('a')
  })

  it('Back closes the overlay through its own history entry and keeps router state', () => {
    const h = fakeHistory({ __NA: true, tree: 1 })
    pushOverlayEntry('x', h)
    expect(h.state).toMatchObject({ __NA: true, tree: 1 })
    expect(ownsCurrentEntry('x', h)).toBe(true)
    expect(closeOverlayEntry('x', h)).toBe(true)
    expect(h.entries.length).toBe(1)
  })

  it('never steps back when a link already navigated away', () => {
    const h = fakeHistory()
    pushOverlayEntry('x', h)
    h.pushState({ __NA: true, page: 'next' }, '')
    expect(closeOverlayEntry('x', h)).toBe(false)
    expect(h.entries.length).toBe(3)
  })
})
