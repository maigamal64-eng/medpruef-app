import { describe, expect, it } from 'vitest'
import { CONSENT_HEAD_SCRIPT, consentCopyKeys, consentFromCookie, consentMode } from '@/lib/consent-copy'
import { optionStateFor, optionTagKey, type OptionState } from '@/components/ui/Option'
import { resultVerdict } from '@/components/ui/ResultCard'
import { shellChrome, resolveLayoutMode } from '@/components/ui/AppLayout'
import { germanOf, translationKeyExists } from './i18n-keys'

const DU = /\b(du|dich|dir|dein|deine|deiner|deinen|wähle)\b/i

describe('cookie consent copy (UX-GLOBAL-13)', () => {
  it('copy follows the build tracking mode, one key per mode', () => {
    expect(consentMode(true)).toBe('optout')
    expect(consentMode(false)).toBe('optin')
    const optout = consentCopyKeys('optout')
    const optin = consentCopyKeys('optin')
    expect(optout.body).not.toBe(optin.body)
    expect(optout.decline).toBe(optin.decline)
    for (const key of [...Object.values(optout), ...Object.values(optin)]) expect(translationKeyExists(key), key).toBe(true)
  })

  it('German copy is formal Sie, uses "Ablehnen" for decline, and fits two lines', () => {
    for (const key of ['cookie_optout_body', 'cookie_optin_body']) {
      const de = germanOf(key)!
      expect(de).not.toMatch(DU)
      expect(de.length).toBeLessThanOrEqual(90)
    }
    expect(germanOf('cookie_decline')).toBe('Ablehnen')
    expect(germanOf('cookie_optout_body')).toMatch(/jederzeit ablehnen/)
    expect(germanOf('cookie_optin_body')).toMatch(/nur wenn Sie zustimmen/)
    expect(translationKeyExists('cookie_body')).toBe(false)
  })

  it('a decline persists through the cookie mirror when storage is blocked', () => {
    expect(consentFromCookie('a=1; mp_consent=declined; b=2')).toBe('declined')
    expect(consentFromCookie('mp_consent=bogus')).toBeNull()
    expect(CONSENT_HEAD_SCRIPT).toContain('mp-consent-pending')
    expect(CONSENT_HEAD_SCRIPT).toContain('mp_consent')
  })
})

describe('Option vocabulary (UX-GLOBAL-25)', () => {
  it('maps grading to one state set', () => {
    expect(optionStateFor({ answered: false, selected: true, correct: true })).toBe('selected')
    expect(optionStateFor({ answered: true, selected: true, correct: true })).toBe('correct')
    expect(optionStateFor({ answered: true, selected: false, correct: true })).toBe('missed')
    expect(optionStateFor({ answered: true, selected: true, correct: false })).toBe('wrong')
    expect(optionStateFor({ answered: true, selected: false, correct: false })).toBe('disabled')
  })

  it('uses one tag vocabulary in quiz and review, in Sie', () => {
    const tags: Record<OptionState, string | null> = {
      idle: null, selected: null, disabled: null,
      correct: 'Ihre Wahl, richtig', wrong: 'Ihre Wahl, falsch', missed: 'Richtig, nicht gewählt', revealed: 'Richtige Antwort',
    }
    for (const [state, de] of Object.entries(tags) as Array<[OptionState, string | null]>) {
      const key = optionTagKey(state)
      expect(key ? germanOf(key) : null, state).toBe(de)
    }
  })
})

describe('ResultCard verdicts (UX-GLOBAL-27)', () => {
  it('never says passed: full runs are above/below the practice threshold', () => {
    expect(resultVerdict({ pct: 0.66, threshold: 0.6, verdictRun: true, timedOut: false })).toEqual({ status: 'above', emphasise: true })
    expect(resultVerdict({ pct: 0.4, threshold: 0.6, verdictRun: true, timedOut: false })).toEqual({ status: 'below', emphasise: false })
  })

  it('part or custom runs are neutral practice; time-out says so', () => {
    expect(resultVerdict({ pct: 0.9, threshold: 0.6, verdictRun: false, timedOut: false })).toEqual({ status: 'practice', emphasise: false })
    expect(resultVerdict({ pct: 0.9, threshold: 0.6, verdictRun: true, timedOut: true }).status).toBe('timeout')
  })

  it('result copy carries no pass word and no du', () => {
    for (const key of ['result_above', 'result_below', 'result_practice_note', 'result_threshold_note', 'result_time_up', 'result_round_nothing_graded']) {
      const de = germanOf(key)!
      expect(de, key).not.toMatch(/bestanden|Bestehens/i)
      expect(de, key).not.toMatch(DU)
    }
  })
})

describe('shell modes (UX-GLOBAL-10)', () => {
  it('focus mounts no BottomNav, Sidebar or floating chrome; public no learner chrome', () => {
    expect(shellChrome('focus')).toEqual({ sidebar: false, bottomNav: false, floatingChrome: false })
    expect(shellChrome('public')).toMatchObject({ sidebar: false, bottomNav: false })
    expect(shellChrome('standard')).toMatchObject({ sidebar: true, bottomNav: true })
    expect(resolveLayoutMode(undefined, 'focus')).toBe('focus')
    expect(resolveLayoutMode(undefined, 'default')).toBe('standard')
  })
})
