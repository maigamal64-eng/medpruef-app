import { describe, expect, it } from 'vitest'
import { buildAuthHref } from '@/lib/auth-entry'
import { freeSignInHref, signInProseLines, welcomeMessage } from '@/lib/telegram-welcome'

const base = { siteUrl: 'https://medpruf.com', campaign: null, miniAppUrl: 'https://t.me/MedPruefBot?start=web_login_de' }

describe('F09 bot welcome asks which exam is yours', () => {
  it('DE: exact text and five buttons, labels from getExamLabel', () => {
    const w = welcomeMessage({ ...base, isDE: true })
    expect(w.text).toBe(
      'Willkommen bei MedPrüf, einer Übungsplattform für Prüfungen in Österreich.\n\nWelche Prüfung steht bei Ihnen an? Tippen Sie unten darauf, dann starten Sie mit der passenden Fragenbank. Die kostenlose Probe braucht keine Karte.',
    )
    expect(w.inline_keyboard.flat().map((b) => b.text)).toEqual([
      'SIP4a / SIP5a Wien',
      'Stichprobentest (Innsbruck)',
      'Pharmakologie / Rezeptierkunde',
      'Ich weiß es noch nicht',
      'Mini App öffnen',
    ])
  })
  it('EN: exact text and labels', () => {
    const w = welcomeMessage({ ...base, isDE: false, miniAppUrl: 'https://t.me/MedPruefBot?start=web_login_en' })
    expect(w.text).toBe(
      'Welcome to MedPrüf, a practice platform for exams in Austria.\n\nWhich exam is yours? Tap it below and you start with the matching question bank. The free sample needs no card.',
    )
    expect(w.inline_keyboard.flat().map((b) => b.text)).toEqual([
      'SIP4a / SIP5a Wien',
      'Stichprobentest (Innsbruck)',
      'Pharmacology / Rezeptierkunde',
      'I am not sure yet',
      'Open Mini App',
    ])
  })
  it('bank buttons carry the exam into sign-in; "not sure" opens /find-your-path; Mini App stays', () => {
    const w = welcomeMessage({ ...base, isDE: true })
    const [sip, spt, rx, unsure, mini] = w.inline_keyboard.flat().map((b) => new URL(b.url))
    expect(sip.pathname).toBe('/login')
    expect(sip.searchParams.get('exam')).toBe('kenntnispruefung')
    expect(sip.searchParams.get('intent')).toBe('free')
    expect(spt.searchParams.get('exam')).toBe('kmp_innsbruck')
    expect(rx.searchParams.get('exam')).toBe('pharma')
    expect(unsure.pathname).toBe('/find-your-path')
    expect(mini.href).toBe(base.miniAppUrl)
  })
  it('campaign case: utm tags on every site button, none on the Mini App link', () => {
    const w = welcomeMessage({ ...base, isDE: true, campaign: 'fristen-17-okt' })
    const urls = w.inline_keyboard.flat().map((b) => new URL(b.url))
    for (const u of urls.slice(0, 4)) {
      expect(u.searchParams.get('utm_source')).toBe('telegram')
      expect(u.searchParams.get('utm_medium')).toBe('bot')
      expect(u.searchParams.get('utm_campaign')).toBe('fristen-17-okt')
    }
    expect(urls[4].searchParams.has('utm_campaign')).toBe(false)
  })
  it('no campaign: no utm tags', () => {
    const w = welcomeMessage({ ...base, isDE: false })
    for (const b of w.inline_keyboard.flat()) expect(new URL(b.url).searchParams.has('utm_source')).toBe(false)
  })
})

describe('freeSignInHref stays equal to buildAuthHref', () => {
  it.each(['kenntnispruefung', 'kmp_innsbruck', 'pharma'] as const)('%s', (exam) => {
    expect(freeSignInHref(exam)).toBe(buildAuthHref({ intent: 'free', exam }))
  })
})

describe('F10 sign-in lines are Sie', () => {
  it('DE has no du forms and quotes the code-field label', () => {
    const text = signInProseLines(true).join('\n')
    expect(text).toContain('Tippen Sie auf den Button, um MedPrüf zu öffnen und sich anzumelden.')
    expect(text).toContain('Öffnen Sie die App, gehen Sie zur Anmeldung, tippen Sie auf „Ich habe einen Telegram-Code“ und fügen Sie diesen Code ein (10 Min. gültig):')
    expect(text).not.toMatch(/\b(Tippe|dich|Öffne|geh|füge)\b/)
  })
  it('EN lines are unchanged', () => {
    expect(signInProseLines(false)).toEqual([
      'On a computer or in a browser? Tap the button to open MedPrüf and sign in.',
      '',
      'In the installed MedPrüf app on your phone?',
      'Open the app, go to sign in, tap "I have a Telegram code" and paste this code (valid 10 min):',
    ])
  })
})
