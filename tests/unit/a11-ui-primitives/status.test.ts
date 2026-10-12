import { describe, expect, it } from 'vitest'
import { announce, nextLiveText, registerAnnouncer } from '@/lib/announce'
import { TOAST_CAP, pushToast, type ToastRecord } from '@/lib/toast-queue'

describe('announce() (UX-GLOBAL-15)', () => {
  it('re-announces an identical message by toggling a trailing mark', () => {
    const first = nextLiveText('', 'Gespeichert')
    const second = nextLiveText(first, 'Gespeichert')
    const third = nextLiveText(second, 'Gespeichert')
    expect(first).toBe('Gespeichert')
    expect(second).not.toBe(first)
    expect(third).toBe(first)
    expect(nextLiveText('Gespeichert', 'Kopiert')).toBe('Kopiert')
  })

  it('queues messages announced before the root regions mount, then flushes once', () => {
    registerAnnouncer(null)
    announce('Früh')
    announce('Fehler', 'assertive')
    const heard: Array<[string, string]> = []
    registerAnnouncer((text, politeness) => heard.push([text, politeness]))
    expect(heard).toEqual([['Früh', 'polite'], ['Fehler', 'assertive']])
    announce('Später')
    expect(heard).toHaveLength(3)
    registerAnnouncer(null)
  })
})

const toast = (id: number, variant: ToastRecord['variant'], key?: string): ToastRecord => ({ id, variant, key, title: `t${id}` })

describe('toast queue (ACC-43)', () => {
  it('a keyed toast replaces instead of stacking', () => {
    const list = pushToast([toast(1, 'info', 'translate')], toast(2, 'success', 'translate'))
    expect(list.map((t) => t.id)).toEqual([2])
  })

  it(`caps at ${TOAST_CAP}, dropping the oldest non-error first`, () => {
    let list: ToastRecord[] = []
    list = pushToast(list, toast(1, 'error'))
    list = pushToast(list, toast(2, 'info'))
    list = pushToast(list, toast(3, 'success'))
    list = pushToast(list, toast(4, 'info'))
    expect(list.map((t) => t.id)).toEqual([1, 3, 4])
  })
})
