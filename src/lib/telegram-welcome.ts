import { CAMPAIGN_SOURCE } from '@/lib/campaign-links'
import { getExamLabel, EXAM_LABEL_KEYS } from '@/lib/master-locale/exam-label'
import { tgWelcomeUrl, tw } from '@/lib/tg-welcome'
import { fristenCopy } from '@/lib/fristen-channel'

/**
 * Bot welcome (F09): ask which exam is the learner's, one button per bank,
 * and carry the answer into sign-in. Labels come from getExamLabel, never
 * typed. A campaign start keeps its utm tags on every site button.
 */
/**
 * Same string as buildAuthHref({ intent: 'free', exam }) in auth-entry.ts. That
 * module pulls in the client-only i18n hooks, which a route handler cannot
 * import, so the href is built here and a unit test pins the two together.
 */
export function freeSignInHref(exam: string): string {
  return `/login?${new URLSearchParams({ mode: 'register', next: '/', intent: 'free', exam })}`
}

export type WelcomeButton = { text: string; url: string }

export function welcomeMessage(opts: {
  isDE: boolean
  siteUrl: string
  campaign: string | null
  miniAppUrl: string
  /** a-channel-inflow: append the Fristen channel line (caller checks the flag and that the chat is private). */
  channelLine?: boolean
}): { text: string; inline_keyboard: WelcomeButton[][] } {
  const { isDE, campaign, miniAppUrl } = opts
  const lang = isDE ? 'de' : 'en'
  const site = opts.siteUrl.replace(/\/$/, '')
  const tag = (path: string): string => {
    const url = new URL(`${site}${path}`)
    if (campaign) {
      url.searchParams.set('utm_source', CAMPAIGN_SOURCE)
      url.searchParams.set('utm_medium', 'bot')
      url.searchParams.set('utm_campaign', campaign)
    }
    return url.toString()
  }
  const intro = isDE
    ? 'Willkommen bei MedPrüf, einer Übungsplattform für Prüfungen in Österreich.\n\nWelche Prüfung steht bei Ihnen an? Tippen Sie unten darauf, dann starten Sie mit der passenden Fragenbank. Die kostenlose Probe braucht keine Karte.'
    : 'Welcome to MedPrüf, a practice platform for exams in Austria.\n\nWhich exam is yours? Tap it below and you start with the matching question bank. The free sample needs no card.'
  const text = opts.channelLine ? `${intro}\n\n${fristenCopy('bot_line', lang)}` : intro
  const banks: WelcomeButton[][] = EXAM_LABEL_KEYS.map((key) => [
    {
      text: getExamLabel(key, 'full', lang),
      url: tag(freeSignInHref(key)),
    },
  ])
  return {
    text,
    inline_keyboard: [
      ...banks,
      [{ text: isDE ? 'Ich weiß es noch nicht' : 'I am not sure yet', url: tag('/find-your-path') }],
      [{ text: isDE ? 'Mini App öffnen' : 'Open Mini App', url: miniAppUrl }],
    ],
  }
}

export type MiniAppWelcomeButton = { text: string; url: string } | { text: string; web_app: { url: string } }

/**
 * Mini App welcome (a-tg-miniapp-welcome, TG_MINIAPP_WELCOME_ENABLED, private
 * chats only: the Bot API rejects inline web_app buttons anywhere else). Same
 * text as welcomeMessage plus one line; each bank is a web_app button that
 * opens /tg-welcome inside Telegram, where the existing initData sign-in runs.
 * "Not sure" keeps the public /find-your-path link. The web_login deep link
 * stays as the secondary "Im Browser öffnen" button (it signs in a browser
 * through the one-time token message, as today).
 */
export function miniAppWelcomeMessage(opts: {
  isDE: boolean
  siteUrl: string
  campaign: string | null
  browserLoginUrl: string
  channelLine?: boolean
}): { text: string; inline_keyboard: MiniAppWelcomeButton[][] } {
  const { isDE, campaign } = opts
  const lang = isDE ? 'de' : 'en'
  const base = welcomeMessage({ isDE, siteUrl: opts.siteUrl, campaign, miniAppUrl: opts.browserLoginUrl })
  const channel = opts.channelLine ? `\n\n${fristenCopy('bot_line', lang)}` : ''
  const tags = campaign ? { source: CAMPAIGN_SOURCE, medium: 'bot', campaign } : null
  const banks: MiniAppWelcomeButton[][] = EXAM_LABEL_KEYS.map((key) => [
    { text: getExamLabel(key, 'full', lang), web_app: { url: tgWelcomeUrl({ siteUrl: opts.siteUrl, exam: key, lang, campaign: tags }) } },
  ])
  const unsure = base.inline_keyboard[EXAM_LABEL_KEYS.length]
  return {
    text: `${base.text}\n\n${tw('bot_miniapp_line', lang)}${channel}`,
    inline_keyboard: [
      ...banks,
      unsure,
      [{ text: tw('bot_browser_button', lang), url: opts.browserLoginUrl }],
    ],
  }
}

/** The two sign-in prose lines of the private-chat login message (F10), before MarkdownV2 escaping. */
export function signInProseLines(isDE: boolean): string[] {
  return isDE
    ? [
        'Am Computer oder im Browser? Tippen Sie auf den Button, um MedPrüf zu öffnen und sich anzumelden.',
        '',
        'In der installierten MedPrüf-App am Handy?',
        'Öffnen Sie die App, gehen Sie zur Anmeldung, tippen Sie auf „Ich habe einen Telegram-Code“ und fügen Sie diesen Code ein (10 Min. gültig):',
      ]
    : [
        'On a computer or in a browser? Tap the button to open MedPrüf and sign in.',
        '',
        'In the installed MedPrüf app on your phone?',
        'Open the app, go to sign in, tap "I have a Telegram code" and paste this code (valid 10 min):',
      ]
}
