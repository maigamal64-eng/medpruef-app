import { describe, expect, it } from 'vitest'
import { beforeEach } from 'vitest'
import { closeOverlayEntry, consumeSelfPop, isTopOverlay, overlayDepth, ownsCurrentEntry, pushOverlay, pushOverlayEntry, removeOverlay, setOverlayScheduler, type OverlayHistory } from '@/lib/overlay-stack'

let queue: Array<() => void> = []
const flush = () => { const q = queue; queue = []; q.forEach((fn) => fn()) }
beforeEach(() => {
  queue = []
  setOverlayScheduler((fn) => { queue.push(fn); return fn }, (handle) => { queue = queue.filter((fn) => fn !== handle) })
})

function fakeHistory(initial: unknown = { __NA: true }): OverlayHistory & { entries: unknown[] } {
  const entries: unknown[] = [initial]
  return {
    entries,
    get state() { return entries[entries.length - 1] },
    pushState(data: unknown) { entries.push(data) },
    replaceState(data: unknown) { entries[entries.length - 1] = data },
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
    flush()
    expect(h.entries.length).toBe(1)
    // The popstate of our own Back is ignored by the remaining overlays.
    expect(consumeSelfPop()).toBe(true)
    flush()
    expect(consumeSelfPop()).toBe(false)
  })

  it('skips the Back when the page navigated while the overlay was open', () => {
    const h = fakeHistory()
    pushOverlayEntry('nav', h)
    const location = { href: 'https://medpruf.com/quiz' }
    expect(closeOverlayEntry('nav', h, location, 'https://medpruf.com/materials')).toBe(true)
    flush()
    expect(h.entries.length).toBe(2)
    expect(consumeSelfPop()).toBe(false)
  })

  it('a dialog that replaces another in the same commit adopts its entry', () => {
    const h = fakeHistory()
    pushOverlayEntry('first', h)
    closeOverlayEntry('first', h)
    pushOverlayEntry('second', h)
    flush()
    expect(h.entries.length).toBe(2)
    expect(ownsCurrentEntry('second', h)).toBe(true)
    expect(consumeSelfPop()).toBe(false)
  })

  it('never steps back when a link already navigated away', () => {
    const h = fakeHistory()
    pushOverlayEntry('x', h)
    h.pushState({ __NA: true, page: 'next' }, '')
    expect(closeOverlayEntry('x', h)).toBe(false)
    flush()
    expect(h.entries.length).toBe(3)
  })
})
