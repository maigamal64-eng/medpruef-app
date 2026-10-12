import { NextRequest, NextResponse } from 'next/server'
import { getServiceClient } from '@/lib/supabase'
import crypto from 'crypto'
import { campaignWelcomeUrl, parseCampaignStart } from '@/lib/campaign-links'
import { safeEqual } from '@/lib/security/timing-safe'
import { frageStartQuestionId, handleFrageCallback, handleFrageCommand, isFrageCommand, isFrageEnabled } from '@/lib/telegram-frage'

export const dynamic = 'force-dynamic'
export const maxDuration = 30;

/**
 * Telegram bot webhook endpoint.
 *
 * Registered via:
 *   curl "https://api.telegram.org/bot<TOKEN>/setWebhook" \
 *     -d '{"url":"https://medpruf.com/api/telegram/webhook","secret_token":"<SECRET>","allowed_updates":["message"]}'
 *
 * Required env vars:
 *   - TELEGRAM_BOT_TOKEN
 *   - TELEGRAM_WEBHOOK_SECRET     (must match the secret_token used at registration)
 *   - NEXT_PUBLIC_SITE_URL        (used to build the deep-link URL sent back to the user)
 *
 * Optional env var:
 *   - TELEGRAM_OPS_FORWARD_TOKEN  (2026-07-11, OFF by default) — when set, an
 *     internal ops bot token used to forward a short notification of every
 *     inbound text message to chat 0 (the default [name] bot, per
 *     workspace Telegram-routing rules). The telegram_inbound DB log below
 *     is the primary fix and always fires regardless of this var.
 */

interface TelegramFrom {
  id: number
  first_name?: string
  last_name?: string
  username?: string
  language_code?: string
}

interface TelegramMessage {
  chat: { id: number; type?: string }
  text?: string
  from?: TelegramFrom
}

interface TelegramUpdate {
  message?: TelegramMessage
  callback_query?: { id: string; data?: unknown; from: { id: number }; message?: { chat?: { id: number; type?: string } } }
}

/** Customer bot only (never the internal ops bot). Never throws. */
async function botCall(method: string, body: Record<string, unknown>): Promise<void> {
  try {
    await fetch(`https://api.telegram.org/bot${process.env.TELEGRAM_BOT_TOKEN}/${method}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    })
  } catch (e) {
    console.error(`telegram ${method} failed:`, e)
  }
}

const TOKEN_TTL_MS = 10 * 60 * 1000 // 10 minutes

/**
 * Best-effort visibility log for an inbound TEXT message + optional forward
 * to internal ops. ADDITIVE ONLY — this runs after the update has already
 * been parsed and before the existing /start-only logic decides what (if
 * anything) to reply. It must NEVER throw and must NEVER block or alter the
 * existing auth/login/activation flow below it: every failure here is
 * swallowed and logged to console, same never-throw contract as the
 * sendMessage calls elsewhere in this file.
 *
 * Fixes the ops blind spot where a real user's free-text reply (anything
 * that isn't "/start" or "/start <payload>") vanished with zero trace: the
 * startMatch regex further down fails for it and the handler returns 200
 * immediately, so previously nothing was recorded anywhere.
 *
 * Only called from the `!startMatch` branch (see POST below), so `from` and
 * `text` are guaranteed present by the guard above it — this deliberately
 * never sees /start login-token exchanges or bot-activation traffic.
 */
async function logTelegramInbound(msg: TelegramMessage): Promise<void> {
  const from = msg.from
  const text = msg.text
  if (!from || !text) return // guaranteed by the caller's guard; satisfies TS narrowing only
  try {
    const sb = getServiceClient()
    const { data: matchedUser } = await sb
      .from('users')
      .select('id')
      .eq('telegram_id', from.id)
      .maybeSingle()
    const { error } = await sb.from('telegram_inbound').insert({
      telegram_id: from.id,
      chat_id: msg.chat.id,
      username: from.username || null,
      first_name: from.first_name || null,
      message_text: text,
      raw: msg as unknown as Record<string, unknown>,
      matched_user_id: matchedUser?.id ?? null,
    })
    if (error) {
      console.error('telegram_inbound insert failed:', error)
    }

    // Bonus: best-effort forward to internal ops ([name] bot, chat 0).
    // OFF by default — TELEGRAM_OPS_FORWARD_TOKEN is not currently set in
    // this project's env (only the customer-facing TELEGRAM_BOT_TOKEN for
    // @MedPruefBot exists here; the internal [name]-bot token lives at the
    // workspace level, not in medpruef-app). The DB row above is the
    // primary fix and always fires regardless of this env var. Set
    // TELEGRAM_OPS_FORWARD_TOKEN in Vercel to turn the forward on.
    const opsToken = process.env.TELEGRAM_OPS_FORWARD_TOKEN
    if (opsToken) {
      const name = from.first_name || from.username || String(from.id)
      const truncated = text.length > 300 ? `${text.slice(0, 300)}…` : text
      const forwardText = `[MedPrüf][bot-inbound] ${name} (${from.id}): ${truncated}`
      try {
        await fetch(`https://api.telegram.org/bot${opsToken}/sendMessage`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ chat_id: 0, text: forwardText }),
        })
      } catch (e) {
        console.error('telegram ops-forward sendMessage failed:', e)
      }
    }
  } catch (e) {
    console.error('logTelegramInbound failed:', e)
  }
}

/**
 * Escape text for Telegram's MarkdownV2 parse mode. Every one of these
 * characters is reserved and MUST be backslash-escaped in normal text,
 * or Telegram rejects the whole sendMessage with 400. We use MarkdownV2
 * so the login code can be wrapped in a backtick code span, which
 * renders as a one-tap "copy" chip in the Telegram client (the load-
 * bearing UX for the mobile-PWA hand-off — FB-08). Text INSIDE a code
 * span is literal, so the UUID itself needs no escaping; only the
 * surrounding prose does.
 */
function escapeMdV2(text: string): string {
  return text.replace(/[_*\[\]()~`>#+\-=|{}.!\\]/g, (c) => `\\${c}`)
}

export async function POST(req: NextRequest) {
  // Validate secret header (set by Telegram if configured at setWebhook time)
  const secret = req.headers.get('x-telegram-bot-api-secret-token')
  const expected = process.env.TELEGRAM_WEBHOOK_SECRET
  if (!expected || !safeEqual(secret, expected)) {
    return NextResponse.json({ error: 'unauthorized' }, { status: 401 })
  }

  let update: TelegramUpdate
  try {
    update = (await req.json()) as TelegramUpdate
  } catch {
    return NextResponse.json({ ok: true })
  }

  // LX-34 phase 1: option taps on the /frage keyboard (flag default OFF).
  if (update.callback_query) {
    if (isFrageEnabled()) await handleFrageCallback(getServiceClient(), update.callback_query, botCall)
    return NextResponse.json({ ok: true })
  }

  const msg = update.message
  if (!msg || !msg.text || !msg.from) return NextResponse.json({ ok: true })

  // LX-34 phase 1: "/frage" answers with the free question of the day (flag default OFF).
  if (isFrageEnabled() && isFrageCommand(msg.text)) {
    await handleFrageCommand(getServiceClient(), { chat: msg.chat, from: msg.from }, botCall)
    return NextResponse.json({ ok: true })
  }

  // Match "/start" or "/start <payload>"
  const startMatch = msg.text.match(/^\/start(?:@\w+)?(?:\s+(\S+))?$/)
  if (!startMatch) {
    // Visibility log (2026-07-11): every inbound message that ISN'T a
    // /start command falls through here today with zero trace — that's
    // exactly the ops blind spot (a free-text reply to outreach). Scoped
    // to this branch on purpose so it never logs our own /start login-token
    // exchanges or bot-activation traffic (auth_<uuid> / web_login), only
    // genuine free-text replies from a real user. Awaited (not fire-and-
    // forget) because Vercel serverless functions can freeze/terminate the
    // moment the response is returned, which would silently drop an
    // un-awaited insert. The function itself is wrapped in try/catch and
    // never throws, so this cannot fail or alter the response below.
    await logTelegramInbound(msg)
    return NextResponse.json({ ok: true })
  }
  const payload = startMatch[1]

  // Bot activation flow (review-2026-04-26-B2): the /dashboard
  // TelegramActivationCard sends users to t.me/MedPruefBot?start=auth_<uuid>.
  // The bot stamps users.telegram_chat_id_confirmed for the matching uuid
  // so we know we can push messages to them. Confirms via a thank-you
  // reply.
  const authMatch = payload?.match(/^auth_([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})$/i)
  if (authMatch) {
    const uuid = authMatch[1]
    const sb = getServiceClient()
    const { data: user, error: lookupErr } = await sb
      .from('users')
      .select('id, telegram_id, language_code')
      .eq('id', uuid)
      .maybeSingle()
    if (!lookupErr && user) {
      // Confirm only when the Telegram from-id equals the user's stored
      // telegram_id. This path NEVER links a Telegram account: the user
      // id in the deep link is not a secret, and writing telegram_id here
      // let anyone who knew an email-only account's id attach their own
      // Telegram and then sign in to that account via web_login (account
      // takeover, closed 2026-10-13). The activation card only renders for
      // accounts that already have a telegram_id, so no real flow needs it.
      const fromIdMatches =
        user.telegram_id != null && Number(user.telegram_id) === msg.from.id
      if (fromIdMatches) {
        await sb
          .from('users')
          .update({ telegram_chat_id_confirmed: new Date().toISOString() })
          .eq('id', uuid)
        const lang = (user.language_code as string | null) || msg.from.language_code || 'en'
        // NOTE: this bot only handles /start* commands — free-text replies
        // sent back here are NOT processed/forwarded, so the copy must not
        // promise that every reply is read (C-7, 2026-06-02). Point feedback
        // at the in-app channel instead.
        const text = lang.startsWith('de')
          ? 'Telegram-Benachrichtigungen aktiviert. Du bekommst hier wichtige MedPrüf-Updates. Feedback? Nutze am besten den Feedback-Button in der App, dort lese ich ([name]) mit.'
          : 'Telegram notifications activated. You will receive important MedPrüf updates here. Got feedback? Best use the feedback button in the app. That\'s where I ([name]) read every message.'
        try {
          await fetch(`https://api.telegram.org/bot${process.env.TELEGRAM_BOT_TOKEN}/sendMessage`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ chat_id: msg.chat.id, text }),
          })
        } catch (e) {
          console.error('telegram activation reply failed:', e)
        }
      }
    }
    return NextResponse.json({ ok: true })
  }

  // Detect language from payload suffix (web_login_de / web_login_en) then
  // fall back to the Telegram client's language_code. This lets the landing
  // page CTA pass the UI language via the deep-link so the bot reply matches
  // the language the user was already reading. F10 fix (2026-04-26).
  const from = msg.from
  let payloadLang: 'de' | 'en' | null = null
  if (payload?.endsWith('_de')) payloadLang = 'de'
  else if (payload?.endsWith('_en')) payloadLang = 'en'
  const isDE =
    payloadLang === 'de' ||
    (!payloadLang && from.language_code?.startsWith('de'))

  // Bare /start (payload empty/undefined) or unrecognised payload: send a
  // welcome message with two inline buttons — one for the web app, one for
  // the Mini App. F4 fix (2026-04-26).
  // LX-34: "/start frage_<id>" from the /frage button signs the person who
  // tapped it in and opens that question (flag default OFF).
  const frageQuestionId = isFrageEnabled() ? frageStartQuestionId(payload) : null
  const isWebLogin =
    payload === 'web_login' ||
    payload === 'web_login_de' ||
    payload === 'web_login_en' ||
    frageQuestionId !== null

  if (!isWebLogin) {
    // Unknown or empty payload → send welcome reply. A campaign start
    // (c_<slug>, one per community post) puts the same utm tags on the
    // site button, so the post shows up in the admin Growth sources
    // (a20, ADM-18 A). Anything else keeps the untagged button.
    const campaign = parseCampaignStart(payload)
    const siteUrl = (process.env.NEXT_PUBLIC_SITE_URL || 'https://medpruf.com').replace(/\/$/, '')
    const welcomeText = isDE
      ? `Willkommen bei MedPrüf: 10.000+ kuratierte Übungsfragen für Kenntnisprüfung Wien, Stichprobentest (Innsbruck) und Pharmakologie.\n\nBeim ersten Versuch bestehen, oder kostenlos weiterlernen, bis du es schaffst.`
      : `Welcome to MedPrüf: 10,000+ curated practice questions for Kenntnisprüfung Wien, Stichprobentest (Innsbruck) and Pharmakologie.\n\nPass first try, or study free until you do.`
    const webLabel = isDE ? 'MedPrüf öffnen & anmelden' : 'Open MedPrüf & sign in'
    const miniAppLabel = isDE ? 'Mini App öffnen' : 'Open Mini App'
    // Deep-link with language suffix so the subsequent token exchange also
    // returns the right language.
    const langSuffix = isDE ? '_de' : '_en'
    const deepLinkUrl = `https://t.me/MedPruefBot?start=web_login${langSuffix}`
    try {
      await fetch(`https://api.telegram.org/bot${process.env.TELEGRAM_BOT_TOKEN}/sendMessage`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          chat_id: msg.chat.id,
          text: welcomeText,
          reply_markup: {
            inline_keyboard: [
              [
                { text: webLabel, url: campaignWelcomeUrl(siteUrl, campaign) },
                { text: miniAppLabel, url: deepLinkUrl },
              ],
            ],
          },
        }),
      })
    } catch (e) {
      console.error('welcome sendMessage failed:', e)
    }
    return NextResponse.json({ ok: true })
  }

  // A sign-in link is only ever sent into a private chat with the person who
  // asked for it, never into a group where other members could use it.
  if (msg.chat.type && msg.chat.type !== 'private') return NextResponse.json({ ok: true })

  const token = crypto.randomUUID()
  const expiresAt = new Date(Date.now() + TOKEN_TTL_MS).toISOString()

  const sb = getServiceClient()

  // LX-34: open the /frage question in its own bank (and only while it is active).
  let frageNext: string | null = null
  if (frageQuestionId !== null) {
    const { data: q } = await sb.from('questions').select('exam_type').eq('id', frageQuestionId).eq('is_active', true).maybeSingle()
    frageNext = q?.exam_type
      ? `/quiz?examSource=${encodeURIComponent(String(q.exam_type))}&questionId=${frageQuestionId}`
      : null
  }
  const { error: insertErr } = await sb.from('telegram_login_tokens').insert({
    token,
    telegram_id: from.id,
    first_name: from.first_name || null,
    last_name: from.last_name || null,
    username: from.username || null,
    language_code: from.language_code || null,
    expires_at: expiresAt,
  })
  if (insertErr) {
    console.error('Token insert failed:', insertErr)
    return NextResponse.json({ ok: true })
  }

  const siteUrl = (process.env.NEXT_PUBLIC_SITE_URL || 'https://medpruf.com').replace(/\/$/, '')
  const loginUrl = `${siteUrl}/?tg_token=${encodeURIComponent(token)}${frageNext ? `&next=${encodeURIComponent(frageNext)}` : ''}`
  const buttonLabel = isDE ? 'MedPrüf öffnen' : 'Open MedPrüf'

  // Two ways to sign in from ONE token (FB-08, mobile-PWA fix):
  //   1) The button — works on desktop and in a real mobile browser,
  //      where the exchanged session persists in the same context.
  //   2) The copyable CODE below it — for phone users who study in the
  //      INSTALLED APP. Tapping the button on mobile opens Telegram's
  //      in-app browser (isolated storage), so the session would be
  //      trapped there and never reach the app. Instead they open the
  //      MedPrüf app and PASTE this code, and the session mints inside
  //      the app. Same single-use, 10-min token either way — no new
  //      security surface (the exchange runs through the audited
  //      /api/auth tokenExchange path).
  //
  // The code is wrapped in a MarkdownV2 code span so Telegram renders it
  // as a one-tap "copy" chip. The prose around it is escaped; the code
  // itself is literal inside the span.
  // Build each prose line through escapeMdV2 (so no reserved char can 400
  // the send), then join with the raw code span. Only the code span is
  // left un-escaped — its backticks must reach Telegram literally to form
  // the copy chip, and a UUID contains nothing reserved inside a span.
  const codeLine = '`' + token + '`'
  const proseLines = isDE
    ? [
        'Am Computer oder im Browser? Tippe auf den Button, um MedPrüf zu öffnen und dich anzumelden.',
        '',
        'In der installierten MedPrüf-App am Handy?',
        'Öffne die App, geh zur Anmeldung, tippe auf „Ich habe einen Telegram-Code“ und füge diesen Code ein (10 Min. gültig):',
      ]
    : [
        'On a computer or in a browser? Tap the button to open MedPrüf and sign in.',
        '',
        'In the installed MedPrüf app on your phone?',
        'Open the app, go to sign in, tap "I have a Telegram code" and paste this code (valid 10 min):',
      ]
  const text = [...proseLines.map(escapeMdV2), '', codeLine].join('\n')

  try {
    await fetch(`https://api.telegram.org/bot${process.env.TELEGRAM_BOT_TOKEN}/sendMessage`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        chat_id: msg.chat.id,
        text,
        parse_mode: 'MarkdownV2',
        reply_markup: {
          inline_keyboard: [[{ text: buttonLabel, url: loginUrl }]],
        },
      }),
    })
  } catch (e) {
    console.error('sendMessage failed:', e)
  }

  return NextResponse.json({ ok: true })
}
