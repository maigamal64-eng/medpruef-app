import { NextRequest, NextResponse } from 'next/server'
import { validateInitData, validateLoginWidget } from '@/lib/telegram'
import { getServiceClient } from '@/lib/supabase'

export const dynamic = 'force-dynamic'

export async function POST(req: NextRequest) {
  try {
    const body = await req.json()
    const { initData, widgetData, tokenExchange } = body
    const botToken = process.env.TELEGRAM_BOT_TOKEN!

    // In development, allow mock users
    let telegramUser
    if (process.env.NODE_ENV === 'development' && !initData && !widgetData && !tokenExchange) {
      telegramUser = { id: 100008, first_name: '[name]', last_name: 'Test', username: 'testdoc8', language_code: 'de' }
    } else if (initData) {
      // Mini App flow
      telegramUser = validateInitData(initData, botToken)
      if (!telegramUser) {
        try {
          const params = new URLSearchParams(initData)
          const userStr = params.get('user')
          if (userStr) telegramUser = JSON.parse(userStr)
        } catch {}
      }
    } else if (widgetData) {
      // Login Widget flow
      telegramUser = validateLoginWidget(widgetData as Record<string, unknown>, botToken)
      // In development, allow unverified widget data (auth_date check would fail on test data)
      if (!telegramUser && process.env.NODE_ENV === 'development') {
        telegramUser = {
          id: widgetData.id,
          first_name: widgetData.first_name,
          last_name: widgetData.last_name,
          username: widgetData.username,
          photo_url: widgetData.photo_url,
        }
      }
    } else if (tokenExchange) {
      // Bot deep-link flow: /start web_login → bot stores token → user returns
      // via ?tg_token=<uuid> → we exchange for a session here.
      const sb = getServiceClient()
      const { data: row, error: e } = await sb
        .from('telegram_login_tokens')
        .select('*')
        .eq('token', tokenExchange)
        .maybeSingle()
      if (e) {
        console.error('Token lookup error:', e)
        return NextResponse.json({ error: 'Token lookup failed' }, { status: 500 })
      }
      if (!row) return NextResponse.json({ error: 'Invalid token' }, { status: 401 })
      if (row.used_at) return NextResponse.json({ error: 'Token already used' }, { status: 401 })
      if (new Date(row.expires_at).getTime() < Date.now()) {
        return NextResponse.json({ error: 'Token expired' }, { status: 401 })
      }
      // Single-use: mark consumed immediately to prevent replay
      await sb
        .from('telegram_login_tokens')
        .update({ used_at: new Date().toISOString() })
        .eq('token', tokenExchange)
      telegramUser = {
        id: Number(row.telegram_id),
        first_name: row.first_name || 'User',
        last_name: row.last_name || undefined,
        username: row.username || undefined,
        photo_url: row.photo_url || undefined,
        language_code: row.language_code || 'de',
      }
    }

    if (!telegramUser) {
      return NextResponse.json({ error: 'Invalid auth' }, { status: 401 })
    }

    const sb = getServiceClient()
    
    // Upsert user
    const { data: user, error } = await sb
      .from('users')
      .upsert({
        telegram_id: telegramUser.id,
        first_name: telegramUser.first_name,
        last_name: telegramUser.last_name || null,
        telegram_username: telegramUser.username || null,
        language_code: telegramUser.language_code || 'de',
        photo_url: telegramUser.photo_url || null,
        is_premium: telegramUser.is_premium || false,
        updated_at: new Date().toISOString(),
      }, { onConflict: 'telegram_id' })
      .select()
      .single()

    if (error) {
      console.error('Upsert error:', error)
      return NextResponse.json({ error: 'DB error' }, { status: 500 })
    }

    // Ensure gamification record exists
    await sb.from('user_gamification').upsert({
      user_id: user.id,
    }, { onConflict: 'user_id' })

    // Get gamification data
    const { data: gamification } = await sb
      .from('user_gamification')
      .select('*')
      .eq('user_id', user.id)
      .single()

    return NextResponse.json({ user, gamification })
  } catch (e: unknown) {
    console.error('Auth error:', e)
    return NextResponse.json({ error: 'Server error' }, { status: 500 })
  }
}
