import { NextRequest, NextResponse } from 'next/server'
import { validateInitData, validateLoginWidget } from '@/lib/telegram'
import { getServiceClient } from '@/lib/supabase'

export async function POST(req: NextRequest) {
  try {
    const body = await req.json()
    const { initData, widgetData } = body
    const botToken = process.env.TELEGRAM_BOT_TOKEN!

    // In development, allow mock users
    let telegramUser
    if (process.env.NODE_ENV === 'development' && !initData && !widgetData) {
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
