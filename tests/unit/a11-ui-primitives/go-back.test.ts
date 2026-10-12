import { describe, expect, it } from 'vitest'
import { iaParent, pushTrail, readReturnTo, resolveBack, withReturnTo } from '@/lib/go-back'

describe('one Back order (UX-GLOBAL-10)', () => {
  it('1. a validated returnTo wins', () => {
    expect(resolveBack({ pathname: '/quiz', search: '?returnTo=%2Fstudy-plan', hasSession: true, previousInAppPath: '/' }))
      .toEqual({ kind: 'returnTo', href: '/study-plan', labelKey: 'back' })
  })

  it('rejects external, protocol-relative and unknown returnTo values', () => {
    for (const bad of ['https://evil.test', '//evil.test', '/\\evil', 'javascript:alert(1)', '/%2F%2Fevil.test']) {
      expect(readReturnTo(`?returnTo=${encodeURIComponent(bad)}`), bad).toBeNull()
    }
  })

  it('2. in-app history when the previous entry is in-app (never document.referrer)', () => {
    expect(resolveBack({ pathname: '/quiz', hasSession: true, previousInAppPath: '/curriculum' })).toEqual({ kind: 'history', labelKey: 'back' })
  })

  it('3. the IA parent: study pages to Home, Fortschritt tabs to Fortschritt', () => {
    expect(iaParent('/stats')).toBe('/progress')
    expect(iaParent('/history')).toBe('/progress')
    expect(iaParent('/history/123')).toBe('/history')
    expect(iaParent('/study-plan')).toBe('/')
    expect(resolveBack({ pathname: '/stats', hasSession: true })).toEqual({ kind: 'parent', href: '/progress', labelKey: 'back' })
    expect(resolveBack({ pathname: '/library', hasSession: true })).toEqual({ kind: 'parent', href: '/', labelKey: 'home' })
  })

  it('4. Home with a session, /landing without', () => {
    expect(resolveBack({ pathname: '/', hasSession: true }).href).toBe('/')
    expect(resolveBack({ pathname: '/library', hasSession: false })).toEqual({ kind: 'landing', href: '/landing', labelKey: 'home' })
  })

  it('withReturnTo builds a safe in-app link', () => {
    expect(withReturnTo('/quiz?topic=x', '/study-plan')).toBe('/quiz?topic=x&returnTo=%2Fstudy-plan')
    expect(withReturnTo('/quiz', 'https://evil.test')).toBe('/quiz')
  })

  it('the trail does not duplicate consecutive entries and stays bounded', () => {
    let trail: string[] = []
    for (let i = 0; i < 30; i++) trail = pushTrail(trail, `/p${i}`)
    expect(trail.length).toBe(20)
    expect(pushTrail(['/a'], '/a')).toEqual(['/a'])
  })
})
