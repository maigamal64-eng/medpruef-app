import crypto from 'crypto'
import { safeEqual } from '@/lib/security/timing-safe'

/**
 * Server-side: validate Telegram initData and extract user.
 * For client-side Telegram detection, see src/lib/auth.ts
 */

export interface TelegramUser {
  id: number
  first_name: string
  last_name?: string
  username?: string
  language_code?: string
  is_premium?: boolean
  photo_url?: string
}

/** Validate Mini App initData (HMAC-SHA256 with "WebAppData" key). */
export function validateInitData(initData: string, botToken: string): TelegramUser | null {
  try {
    const params = new URLSearchParams(initData)
    const hash = params.get('hash')
    if (!hash) return null

    params.delete('hash')
    const entries = Array.from(params.entries())
    entries.sort(([a], [b]) => a.localeCompare(b))
    const dataCheckString = entries.map(([k, v]) => `${k}=${v}`).join('\n')

    const secretKey = crypto.createHmac('sha256', 'WebAppData').update(botToken).digest()
    const calculatedHash = crypto.createHmac('sha256', secretKey).update(dataCheckString).digest('hex')

    if (!safeEqual(calculatedHash, hash)) return null

    const userStr = params.get('user')
    if (!userStr) return null
    return JSON.parse(userStr) as TelegramUser
  } catch {
    return null
  }
}

/** Validate Login Widget data (SHA256 secret key, not HMAC). */
export function validateLoginWidget(
  data: Record<string, unknown>,
  botToken: string
): TelegramUser | null {
  try {
    const hash = data.hash as string
    if (!hash) return null

    // auth_date must be within 1 day
    const authDate = Number(data.auth_date)
    if (Date.now() / 1000 - authDate > 86400) return null

    const checkString = Object.entries(data)
      .filter(([k]) => k !== 'hash')
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([k, v]) => `${k}=${v}`)
      .join('\n')

    const secretKey = crypto.createHash('sha256').update(botToken).digest()
    const computed = crypto.createHmac('sha256', secretKey).update(checkString).digest('hex')

    if (!safeEqual(computed, hash)) return null

    return {
      id: data.id as number,
      first_name: data.first_name as string,
      last_name: data.last_name as string | undefined,
      username: data.username as string | undefined,
      photo_url: data.photo_url as string | undefined,
    }
  } catch {
    return null
  }
}

export type CustomerBotSendResult =
  | { ok: true }
  | { ok: false; reason: 'not_configured' | 'blocked' | 'rejected' | 'error' }

/**
 * Send a plain-text message from the learner-facing customer bot
 * (@MedPruefBot, TELEGRAM_BOT_TOKEN) to a learner's own private chat. Never the
 * internal ops bot. Buttons are URL buttons only. Logs nothing about the
 * recipient or the text; the caller records the outcome.
 * 403 means the learner blocked the bot or never started it ('blocked').
 */
export async function sendCustomerBotMessage(
  chatId: number,
  text: string,
  buttons: { text: string; url: string }[] = [],
): Promise<CustomerBotSendResult> {
  const token = process.env.TELEGRAM_BOT_TOKEN
  if (!token) return { ok: false, reason: 'not_configured' }
  try {
    const res = await fetch(`https://api.telegram.org/bot${token}/sendMessage`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        chat_id: chatId,
        text,
        disable_web_page_preview: true,
        ...(buttons.length ? { reply_markup: { inline_keyboard: buttons.map((b) => [b]) } } : {}),
      }),
      signal: AbortSignal.timeout(10_000),
    })
    if (res.ok) return { ok: true }
    return { ok: false, reason: res.status === 403 ? 'blocked' : res.status >= 500 ? 'error' : 'rejected' }
  } catch {
    return { ok: false, reason: 'error' }
  }
}
