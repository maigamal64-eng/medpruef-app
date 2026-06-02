import { NextRequest, NextResponse } from 'next/server'
import { getServiceClient } from '@/lib/supabase'
import { QUESTIONS } from '@/lib/content-truth'
import crypto from 'crypto'

export const dynamic = 'force-dynamic'

/**
 * Telegram bot webhook endpoint.
 *
 * Registered via:
 *   curl "https://api.telegram.org/bot<TOKEN>/setWebhook" \
 *     -d '{"url":"https://medpruf.com/api/telegram/webhook","secret_token":"<SECRET>","allowed_updates":["message"]}'
 *
 * Required env vars:
 *   - TELEGRAM_BOT_TOKEN
 *   - TELEGRAM_WEBHOOK_SECRET  (must match the secret_token used at registration)
 *   - NEXT_PUBLIC_SITE_URL     (used to build the deep-link URL sent back to the user)
 */

interface TelegramFrom {
  id: number
  first_name?: string
  last_name?: string
  username?: string
  language_code?: string
}

interface TelegramMessage {
  chat: { id: number }
  text?: string
  from?: TelegramFrom
}

interface TelegramUpdate {
  message?: TelegramMessage
}

const TOKEN_TTL_MS = 10 * 60 * 1000 // 10 minutes

export async function POST(req: NextRequest) {
  // Validate secret header (set by Telegram if configured at setWebhook time)
  const secret = req.headers.get('x-telegram-bot-api-secret-token')
  const expected = process.env.TELEGRAM_WEBHOOK_SECRET
  if (!expected || secret !== expected) {
    return NextResponse.json({ error: 'unauthorized' }, { status: 401 })
  }

  let update: TelegramUpdate
  try {
    update = (await req.json()) as TelegramUpdate
  } catch {
    return NextResponse.json({ ok: true })
  }

  const msg = update.message
  if (!msg || !msg.text || !msg.from) return NextResponse.json({ ok: true })

  // Match "/start" or "/start <payload>"
  const startMatch = msg.text.match(/^\/start(?:@\w+)?(?:\s+(\S+))?$/)
  if (!startMatch) return NextResponse.json({ ok: true })
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
      // Defensive: only confirm if the Telegram from-id matches the
      // user's stored telegram_id (or the user has no telegram_id yet,
      // in which case we link it). Prevents user A from confirming
      // user B's bot via a leaked uuid.
      const fromIdMatches =
        !user.telegram_id || Number(user.telegram_id) === msg.from.id
      if (fromIdMatches) {
        const update: Record<string, unknown> = {
          telegram_chat_id_confirmed: new Date().toISOString(),
        }
        if (!user.telegram_id) {
          update.telegram_id = msg.from.id
        }
        await sb.from('users').update(update).eq('id', uuid)
        const lang = (user.language_code as string | null) || msg.from.language_code || 'en'
        // NOTE: this bot only handles /start* commands — free-text replies
        // sent back here are NOT processed/forwarded, so the copy must not
        // promise that every reply is read (C-7, 2026-06-02). Point feedback
        // at the in-app channel instead.
        const text = lang.startsWith('de')
          ? 'Telegram-Benachrichtigungen aktiviert. Du bekommst hier wichtige MedPrüf-Updates. Feedback? Nutze am besten den Feedback-Button in der App — dort lese ich ([name]) mit.'
          : 'Telegram notifications activated. You will receive important MedPrüf updates here. Got feedback? Best use the feedback button in the app — that\'s where I ([name]) read every message.'
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
  const isWebLogin =
    payload === 'web_login' ||
    payload === 'web_login_de' ||
    payload === 'web_login_en'

  if (!isWebLogin) {
    // Unknown or empty payload → send welcome reply
    const siteUrl = (process.env.NEXT_PUBLIC_SITE_URL || 'https://medpruf.com').replace(/\/$/, '')
    // Question count sourced live from content-truth.ts SSoT — never hardcode
    // it here (a stale hardcoded count drift was caught in this copy 2026-06-02).
    // SOT-REF: medpruef_question_count@DB:medpruef.questions
    const welcomeText = isDE
      ? `Willkommen bei MedPrüf — ${QUESTIONS.total.toLocaleString('de-DE')} Prüfungsfragen für Kenntnisprüfung Wien, KMP Innsbruck und Pharmakologie.\n\nPass beim ersten Versuch — oder lerne kostenlos weiter, bis du es schaffst.`
      : `Welcome to MedPrüf — ${QUESTIONS.total.toLocaleString('en-US')} exam questions for Kenntnisprüfung Wien, KMP Innsbruck and Pharmakologie.\n\nPass first try — or study free until you do.`
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
                { text: webLabel, url: `${siteUrl}/?tg_start=1` },
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

  const token = crypto.randomUUID()
  const expiresAt = new Date(Date.now() + TOKEN_TTL_MS).toISOString()

  const sb = getServiceClient()
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
  const loginUrl = `${siteUrl}/?tg_token=${encodeURIComponent(token)}`
  const text = isDE
    ? 'Tippe auf den Button, um MedPrüf zu öffnen und dich anzumelden:'
    : 'Tap the button to open MedPrüf and sign in:'
  const buttonLabel = isDE ? 'MedPrüf öffnen' : 'Open MedPrüf'

  try {
    await fetch(`https://api.telegram.org/bot${process.env.TELEGRAM_BOT_TOKEN}/sendMessage`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        chat_id: msg.chat.id,
        text,
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
