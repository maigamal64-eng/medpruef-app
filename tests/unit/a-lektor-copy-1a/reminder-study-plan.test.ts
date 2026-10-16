import { describe, expect, it, vi } from 'vitest'
import { OFFICIAL_SITTINGS } from '@/lib/exam-dates'
import { renderExamReminder } from '@/lib/email/exam-reminder-template'

vi.mock('@/lib/supabase', () => ({ getServiceClient: vi.fn() }))

const sitting = OFFICIAL_SITTINGS.find((s) => s.exam_key === 'rezeptierkunde')!
const unsub = 'https://medpruf.com/api/reminders?unsub=t'

describe('F14 reminder mail bridges to the study plan (F14)', () => {
  it('DE: line and absolute link after the requirements line, unsubscribe last', () => {
    const html = renderExamReminder(sitting, 7, 'de', unsub).htmlBody
    const check = html.indexOf('Bitte prüfen Sie die offiziellen Voraussetzungen')
    const plan = html.indexOf('Schon angemeldet? Tragen Sie Ihren Termin in MedPrüf ein, dann planen wir Ihre Wochen bis dahin.')
    expect(check).toBeGreaterThan(-1)
    expect(plan).toBeGreaterThan(check)
    expect(html).toContain('<a href="https://medpruf.com/study-plan">Lernplan öffnen</a>')
    expect(html.indexOf('Fristerinnerungen abbestellen')).toBeGreaterThan(plan)
  })
  it('EN: line and link', () => {
    const html = renderExamReminder(sitting, 3, 'en', unsub).htmlBody
    expect(html).toContain('Already registered? Add your sitting in MedPrüf and we plan your weeks up to it.')
    expect(html).toContain('<a href="https://medpruf.com/study-plan">Open the study plan</a>')
    expect(html.indexOf('Unsubscribe from deadline reminders')).toBeGreaterThan(html.indexOf('study-plan'))
  })
  it('stays a service mail: no price, no offer', () => {
    const html = renderExamReminder(sitting, 1, 'de', unsub).htmlBody
    expect(html).not.toMatch(/€|Pro\b|Rabatt|kostenlos/)
  })
})
