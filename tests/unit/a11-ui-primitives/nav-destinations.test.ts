import { describe, expect, it } from 'vitest'
import { existsSync } from 'node:fs'
import {
  DESTINATIONS, GROUP_ORDER, MAX_BOTTOM_ITEMS, RAISED_SLOT, bottomSlots, groupDestinations, groupMoreSheet,
  isDestinationActive, isMoreActive, moreSheetDestinations, visibleDestinations,
} from '@/lib/nav-destinations'
import { translationKeyExists } from './i18n-keys'

const OFF = { mentor: false, referrals: false }
const ON = { mentor: true, referrals: true, support: true }

describe('one destination list (UX-GLOBAL-09, HOME-49 option B)', () => {
  it('bottom bar is at most five items including Mehr, with the raised Üben in the centre', () => {
    for (const gates of [OFF, ON]) {
      const slots = bottomSlots(gates)
      expect(slots.length + 1).toBeLessThanOrEqual(MAX_BOTTOM_ITEMS)
      expect(slots[2]).toBe(RAISED_SLOT)
      expect(RAISED_SLOT).toBe('practice')
    }
    expect(bottomSlots(OFF)).toEqual(['home', 'exam', 'practice', 'study-plan'])
  })

  it('the mentor takes the Lernplan slot only when it is available; Lernplan then leads the Mehr sheet', () => {
    expect(bottomSlots(ON)).toEqual(['home', 'exam', 'practice', 'mentor'])
    expect(moreSheetDestinations(ON)[0].key).toBe('study-plan')
  })

  it('Mehr holds every visible destination that is not in the bar, Lernplan and Meine Fehler first', () => {
    for (const gates of [OFF, ON]) {
      const bar = new Set(bottomSlots(gates))
      const sheet = moreSheetDestinations(gates).map((d) => d.key)
      const expected = visibleDestinations(gates).filter((d) => !bar.has(d.key)).map((d) => d.key)
      expect(new Set(sheet)).toEqual(new Set(expected))
    }
    const off = moreSheetDestinations(OFF).map((d) => d.key)
    expect(off.indexOf('mistakes')).toBeLessThan(2)
    expect(off).toContain('library')
    expect(off).toContain('progress')
    expect(off).toContain('history')
    expect(off).toContain('settings')
    // "Feedback und Hilfe" opens the Support-Chat: only where it can open.
    expect(off).not.toContain('feedback')
    expect(moreSheetDestinations(ON).map((d) => d.key)).toContain('feedback')
  })

  it('the Sidebar and the Mehr sheet use the same group order', () => {
    const sidebarGroups = groupDestinations(visibleDestinations(ON)).map((g) => g.group)
    const sheetGroups = groupMoreSheet(ON).map((g) => g.group).filter((g) => g !== 'top')
    expect(sidebarGroups).toEqual(GROUP_ORDER.filter((g) => sidebarGroups.includes(g)))
    expect(sheetGroups).toEqual(GROUP_ORDER.filter((g) => sheetGroups.includes(g)))
  })

  it('gated destinations stay hidden until enabled', () => {
    expect(visibleDestinations(OFF).some((d) => d.key === 'mentor' || d.key === 'referrals' || d.key === 'feedback')).toBe(false)
    expect(visibleDestinations({ ...ON, support: false }).some((d) => d.key === 'feedback')).toBe(false)
    expect(visibleDestinations(ON).some((d) => d.key === 'mentor')).toBe(true)
    expect(visibleDestinations(ON).some((d) => d.key === 'feedback')).toBe(true)
  })

  it('every route destination resolves to an existing page and every label key exists', () => {
    for (const d of DESTINATIONS) {
      expect(translationKeyExists(d.labelKey), d.labelKey).toBe(true)
      if (d.slotLabelKey) expect(translationKeyExists(d.slotLabelKey), d.slotLabelKey).toBe(true)
      if (!d.href) { expect(d.action).toBeDefined(); continue }
      const path = new URL(d.href, 'https://medpruf.com').pathname
      const file = path === '/' ? 'src/app/page.tsx' : `src/app${path}/page.tsx`
      expect(existsSync(file), file).toBe(true)
    }
  })

  it('active state and the Mehr highlight follow the route, including locked destinations', () => {
    const find = (key: string) => DESTINATIONS.find((d) => d.key === key)!
    expect(isDestinationActive(find('home'), '/')).toBe(true)
    expect(isDestinationActive(find('home'), '/quiz')).toBe(false)
    expect(isDestinationActive(find('practice'), '/quiz')).toBe(true)
    expect(isDestinationActive(find('history'), '/history/abc')).toBe(true)
    expect(isDestinationActive(find('stats'), '/statsx')).toBe(false)
    expect(isMoreActive('/history', OFF)).toBe(true)
    expect(isMoreActive('/settings', OFF)).toBe(true)
    expect(isMoreActive('/exam', OFF)).toBe(false)
    expect(isMoreActive('/study-plan', ON)).toBe(true)
    expect(isMoreActive('/study-plan', OFF)).toBe(false)
  })
})
