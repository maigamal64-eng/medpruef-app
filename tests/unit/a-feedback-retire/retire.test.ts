import { afterEach, describe, expect, it, vi } from 'vitest'
import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs'
import { join } from 'node:path'
import { DESTINATIONS, moreSheetDestinations, visibleDestinations } from '@/lib/nav-destinations'
import { OPEN_SUPPORT_EVENT, openSupportChat, supportChatEnabled } from '@/lib/support-chat'

/**
 * a-intercom-finalize-1023: the general feedback button is retired. Every
 * place a learner used to find it now opens the Intercom Support-Chat; the
 * in-quiz question report, /api/feedback (legacy inbox and the other cards)
 * and the admin Feedback inbox stay.
 */
const ROOT = join(__dirname, '..', '..', '..')
const read = (p: string) => readFileSync(join(ROOT, p), 'utf8')

function walk(dir: string, out: string[] = []): string[] {
  for (const name of readdirSync(join(ROOT, dir))) {
    const rel = `${dir}/${name}`
    if (statSync(join(ROOT, rel)).isDirectory()) walk(rel, out)
    else if (/\.(ts|tsx)$/.test(name)) out.push(rel)
  }
  return out
}

describe('general feedback button retired', () => {
  it('the widget and its mount are gone', () => {
    expect(existsSync(join(ROOT, 'src/components/FeedbackWidget.tsx'))).toBe(false)
    expect(existsSync(join(ROOT, 'src/components/exam/StudyChrome.tsx'))).toBe(false)
    const layout = read('src/app/layout.tsx')
    expect(layout).not.toMatch(/FeedbackWidget|StudyChrome/)
    expect(layout).toContain('<IntercomMessenger />')
  })

  it('no source file imports the widget or dispatches the old feedback event', () => {
    for (const file of walk('src')) {
      const src = read(file)
      expect(src, file).not.toMatch(/from ['"]@\/components\/FeedbackWidget['"]|from ['"]@\/components\/exam\/StudyChrome['"]/)
      expect(src, file).not.toMatch(/OPEN_FEEDBACK_EVENT|medpruef:open-feedback|['"]open-feedback['"]/)
    }
  })

  it('"Feedback und Hilfe" opens the support chat and shows only where it can open', () => {
    const entry = DESTINATIONS.find((d) => d.key === 'feedback')
    expect(entry?.action).toBe('open-support')
    expect(entry?.gated).toBe('support')
    expect(entry?.labelKey).toBe('nav_feedback_help')
    const off = { mentor: false, referrals: false }
    expect(visibleDestinations(off).some((d) => d.key === 'feedback')).toBe(false)
    expect(moreSheetDestinations({ ...off, support: true }).some((d) => d.key === 'feedback')).toBe(true)
    for (const file of ['src/components/Sidebar.tsx', 'src/components/nav/MoreSheet.tsx']) {
      const src = read(file)
      expect(src, file).toContain('useSupportChatAvailable()')
      expect(src, file).toMatch(/support: supportAvailable/)
      expect(src, file).toContain('OPEN_SUPPORT_EVENT')
    }
  })

  it('the Messenger listens for the support event and no longer points to a form', () => {
    const messenger = read('src/components/IntercomMessenger.tsx')
    expect(messenger).toMatch(/addEventListener\(OPEN_SUPPORT_EVENT/)
    expect(messenger).toContain('supportChatEnabled()')
    expect(messenger).not.toMatch(/Feedback-Formular|feedback form/)
    expect(messenger).toContain('BILLING_SUPPORT_EMAIL')
  })

  it('the Library own-note report goes to the support chat and hides while it cannot open', () => {
    const library = read('src/app/library/page.tsx')
    expect(library).toContain('openSupportChat()')
    expect(library).toContain('onReport={supportAvailable ? () => reportOwnNote(note) : undefined}')
    expect(read('src/app/library/_parts/NoteActions.tsx')).toContain('{onReport && (')
    expect(read('src/lib/i18n-library.ts')).not.toMatch(/im Feedback,|feedback form/)
  })

  it('keeps the question report, /api/feedback and the admin inbox', () => {
    for (const path of [
      'src/app/api/suggestions/route.ts',
      'src/app/api/feedback/route.ts',
      'src/app/admin/feedback/page.tsx',
      'src/components/ReportQuestionModal.tsx',
    ]) expect(existsSync(join(ROOT, path)), path).toBe(true)
    expect(read('src/components/QuestionCard.tsx')).toMatch(/ReportQuestionModal|QuestionReportForm/)
  })

  it('the retired What\'s New entry about the blue button is gone', () => {
    expect(read('src/components/WhatsNewModal.tsx')).not.toContain('whatsnew_feedback')
  })
})

describe('support-chat helpers', () => {
  afterEach(() => {
    vi.unstubAllEnvs()
    vi.unstubAllGlobals()
  })

  it('reads the Messenger flag at call time, literal true only', () => {
    vi.stubEnv('NEXT_PUBLIC_MEDPRUF_INTERCOM_ENABLED', 'true')
    expect(supportChatEnabled()).toBe(true)
    vi.stubEnv('NEXT_PUBLIC_MEDPRUF_INTERCOM_ENABLED', 'TRUE')
    expect(supportChatEnabled()).toBe(false)
    vi.stubEnv('NEXT_PUBLIC_MEDPRUF_INTERCOM_ENABLED', '')
    expect(supportChatEnabled()).toBe(false)
  })

  it('openSupportChat dispatches the one support event', () => {
    const target = new EventTarget()
    vi.stubGlobal('window', target)
    const seen: string[] = []
    target.addEventListener(OPEN_SUPPORT_EVENT, (event) => seen.push(event.type))
    openSupportChat()
    expect(seen).toEqual(['medpruef:open-support'])
  })
})
